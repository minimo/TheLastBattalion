import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { generateMap } from '~/game/mapGenerator'
import { mapTypeForMode } from '~/game/mapType'
import { createMulberry32, hashString } from '~/game/random'
import {
    createBattle, moveFormation, orderArmy, orderAttack, orderBuild, orderCharge, orderConstruct, orderDemolish, orderFormation, orderHold, orderMove,
    orderResupply, orderRetreat, orderSupport, setFormation, summarize, updateBattle, type ArmyOrder, type Battle,
} from '~/game/battle'
import { createCpuCommander, type CpuCommander } from '~/game/cpuCommander'
import type { Army, ArmySummary, BattleMode, ConstructionAxis, ConstructionKind, FormationType, GameStatus, MapType, Point, SquadOrder, UnitType } from '~/types/game'

/** 1倍速のときの実時間に対するゲーム内時間の倍率。 */
const BASE_TIME_SCALE = .5
/** シミュレーション1ステップの最大時間（秒）。高速時はこれ以下に分割して計算する。 */
const MAX_STEP = .1
export const GAME_SPEEDS = [.5, 1, 2, 3] as const
export type GameSpeed = typeof GAME_SPEEDS[number]

const emptySummary = (): ArmySummary => ({ infantry: 0, pikeman: 0, archer: 0, cavalry: 0, supply: 0, engineer: 0, total: 0, fortHp: 0, fortMaxHp: 1, killed: 0, reserves: 0, hasFort: true })

export interface SquadSummary {
    id: number
    owner: Army
    type: UnitType
    number: number
    count: number
    size: number
    order: SquadOrder
    arrows: number
    maxArrows: number
    stamina: number
    supplies: number
    maxSupplies: number
    /** 建てている（壊しに行く）建設物の種類と、建設の進み具合（0〜100）・耐久の割合（0〜100）。 */
    construction: { kind: ConstructionKind; progress: number; hp: number; complete: boolean } | null
}

export interface SquadCommand {
    point?: Point
    targetSquadId?: number
    constructionId?: number
    kind?: ConstructionKind
    axis?: ConstructionAxis
}

export const useGameStore = defineStore('game', {
    state: () => ({
        // 地形グリッドと戦闘状態は数千の兵士を含むため、リアクティブにしない。
        mapGrid: markRaw([]) as number[][],
        battle: null as Battle | null,
        commander: null as CpuCommander | null,
        dayTime: 360,
        status: 'title' as GameStatus,
        seed: '',
        /** 戦場の種類（攻防戦・攻城戦・防衛戦）。 */
        mode: 'field' as BattleMode,
        /** 攻防戦で選んだ地形の種類。 */
        mapChoice: 'standard' as MapType,
        /** 今の戦場の地形の種類（攻城戦は魔王城付近、防衛戦は標準）。 */
        mapType: 'standard' as MapType,
        winner: null as Army | null,
        isGameOver: false,
        summary: { player: emptySummary(), cpu: emptySummary() } as Record<Army, ArmySummary>,
        squads: [] as SquadSummary[],
        formation: 'line' as FormationType,
        summaryTimer: 0,
        gameSpeed: 1 as GameSpeed,
    }),

    getters: {
        /** 実時間1秒あたりに進むゲーム内の秒数。 */
        timeScale: (state): number => BASE_TIME_SCALE * state.gameSpeed,
    },

    actions: {
        initGame(customSeed?: string): void {
            if (customSeed) {
                this.seed = customSeed
            } else if (!this.seed) {
                // Generate random 6-digit number string
                this.seed = Math.floor(100000 + Math.random() * 900000).toString()
            }
            const rnd = createMulberry32(hashString(this.seed))
            // no-life-kingと同じマップ生成（同じSEEDなら同じ地形）
            this.mapType = mapTypeForMode(this.mode, this.mapChoice)
            const { mapGrid } = generateMap(rnd, this.mapType)
            this.mapGrid = markRaw(mapGrid)
            const battle = createBattle(mapGrid, rnd, this.mode)
            this.battle = markRaw(battle)
            this.commander = markRaw(createCpuCommander(battle))
            this.dayTime = battle.dayTime
            this.isGameOver = false
            this.winner = null
            this.refresh()
        },

        startGame(seed?: string, mode?: BattleMode, mapChoice?: MapType): void {
            if (mode) this.mode = mode
            if (mapChoice) this.mapChoice = mapChoice
            this.status = 'playing'
            this.initGame(seed)
        },

        backToTitle(): void {
            this.status = 'title'
        },

        pauseGame(): void {
            if (this.status === 'playing') this.status = 'paused'
        },

        resumeGame(): void {
            if (this.status === 'paused') this.status = 'playing'
        },

        togglePause(): void {
            if (this.status === 'playing') this.pauseGame()
            else this.resumeGame()
        },

        /** 画面表示用の集計を更新する。 */
        refresh(): void {
            const battle = this.battle
            if (!battle) return
            this.summary = summarize(battle)
            this.squads = battle.squads.map(sq => {
                const site = sq.order === 'build' || sq.order === 'demolish' ? battle.constructionById.get(sq.constructionId) : undefined
                return {
                    id: sq.id, owner: sq.owner, type: sq.type, number: sq.number, count: sq.count, size: sq.size, order: sq.order, arrows: Math.floor(sq.arrows), maxArrows: sq.maxArrows,
                    stamina: Math.round(sq.stamina), supplies: sq.supplies, maxSupplies: sq.maxSupplies,
                    construction: site ? { kind: site.kind, progress: Math.floor(site.progress * 100), hp: Math.round(site.hp / site.maxHp * 100), complete: site.complete } : null,
                }
            })
            this.formation = battle.formations.player.type
        },

        /** 自軍の部隊への指示。 */
        orderSquad(squadId: number, order: SquadOrder, options: SquadCommand = {}): void {
            const battle = this.battle
            if (!battle || battle.squadById.get(squadId)?.owner !== 'player' || this.isGameOver) return
            if (order === 'move' && options.point) orderMove(battle, squadId, options.point)
            else if (order === 'build' && options.constructionId !== undefined) orderBuild(battle, squadId, options.constructionId)
            else if (order === 'build' && options.kind && options.point) orderConstruct(battle, squadId, options.kind, options.point, options.axis)
            else if (order === 'demolish' && options.constructionId !== undefined) orderDemolish(battle, squadId, options.constructionId)
            else if (order === 'attack' && options.targetSquadId !== undefined) orderAttack(battle, squadId, options.targetSquadId)
            else if (order === 'hold') orderHold(battle, squadId)
            else if (order === 'charge') orderCharge(battle, squadId)
            else if (order === 'retreat') orderRetreat(battle, squadId)
            else if (order === 'formation') orderFormation(battle, squadId)
            else if (order === 'resupply') orderResupply(battle, squadId)
            else if (order === 'support') orderSupport(battle, squadId, options.targetSquadId)
            this.refresh()
        },

        /** 工兵に建設物を建てさせる。建てられない場所ならfalse。 */
        construct(squadId: number, kind: ConstructionKind, point: Point, axis: ConstructionAxis): boolean {
            const battle = this.battle
            if (!battle || battle.squadById.get(squadId)?.owner !== 'player' || this.isGameOver) return false
            const placed = orderConstruct(battle, squadId, kind, point, axis)
            this.refresh()
            return placed
        },

        setFormation(type: FormationType): void {
            if (!this.battle || this.isGameOver) return
            setFormation(this.battle, 'player', type)
            this.refresh()
        },

        moveFormation(point: Point): void {
            if (!this.battle || this.isGameOver) return
            moveFormation(this.battle, 'player', point)
            this.refresh()
        },

        orderArmy(order: ArmyOrder): void {
            if (!this.battle || this.isGameOver) return
            orderArmy(this.battle, 'player', order)
            this.refresh()
        },

        setGameSpeed(speed: GameSpeed): void {
            this.gameSpeed = speed
        },

        /** 実時間の経過を受け取り、現在の速度に応じてゲームを進める。 */
        update(realDeltaSeconds: number): void {
            let remaining = realDeltaSeconds * this.timeScale
            while (remaining > 0 && this.status === 'playing') {
                const step = Math.min(remaining, MAX_STEP)
                remaining -= step
                this.step(step)
            }
            // 画面の集計は速度に関係なく実時間で一定間隔に更新する。
            this.summaryTimer -= realDeltaSeconds
            if (this.status === 'playing' && this.summaryTimer <= 0) {
                this.summaryTimer = .25
                this.refresh()
            }
        },

        step(deltaSeconds: number): void {
            const battle = this.battle
            if (this.status !== 'playing' || !battle) return
            updateBattle(battle, deltaSeconds)
            this.commander?.update(deltaSeconds)
            this.dayTime = battle.dayTime
            if (battle.winner) {
                this.refresh()
                this.winner = battle.winner
                this.isGameOver = true
                this.status = 'gameover'
            }
        },
    },
})
