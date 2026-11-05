import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { generateMap } from '~/game/mapGenerator'
import { mapTypeForMode } from '~/game/mapType'
import { createMulberry32, hashString } from '~/game/random'
import {
    createBattle, orderArmy, orderAttack, orderBuild, orderCharge, orderCompany, orderCompanyAttack, orderCompanyDemolish, orderCompanyMove, orderConstruct,
    orderDemolish, orderFormation, orderHold, orderMove, orderOccupy, orderResupply, orderRetreat, orderSupport, placeUnit, redeployArmy, setFormation, summarize, updateBattle,
    type ArmyOrder, type Battle, type CompanyOrder, type PlacementTarget,
} from '~/game/battle'
import { createCpuCommander, type CpuCommander } from '~/game/cpuCommander'
import { createGuidelineDirector, markCommanded, setGuideline, type GuidelineDirector } from '~/game/squadGuidelines'
import { cpuDeployment, defaultDeployment, normalizeDeployment, UNIT_TYPES, type DeploymentPlan } from '~/game/deployment'
import { START_TIME_MINUTES } from '~/game/daynight'
import { VISION } from '~/game/battleConfig'
import { refreshVision } from '~/game/vision'
import type { Army, ArmySummary, BattleMode, ConstructionAxis, ConstructionKind, Directive, FormationType, GameStatus, Guideline, MapType, Point, SquadOrder, StartTime, UnitType } from '~/types/game'

/** 1倍速のときの実時間に対するゲーム内時間の倍率。 */
const BASE_TIME_SCALE = .5
/** シミュレーション1ステップの最大時間（秒）。高速時はこれ以下に分割して計算する。 */
const MAX_STEP = .1
/** シミュレーション1ステップの最小時間（秒）。描画の間隔がこれより短いときは、時間をためて次の描画でまとめて進める。 */
const MIN_STEP = .002
export const GAME_SPEEDS = [.5, 1, 2, 3] as const
export type GameSpeed = typeof GAME_SPEEDS[number]

const MODES: BattleMode[] = ['field', 'siege', 'defense']
const PLAN_STORAGE_KEY = 'the-last-battalion:deployment'

/** 前回の編成（戦場の種類ごと）。読めなければ既定の編成。 */
function loadPlans(): Record<BattleMode, DeploymentPlan> {
    let saved: Partial<Record<BattleMode, DeploymentPlan>> = {}
    try { saved = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) ?? '{}') ?? {} } catch { /* 保存できない環境では既定の編成 */ }
    return Object.fromEntries(MODES.map(mode => {
        const plan = saved[mode]
        const valid = plan && Array.isArray(plan.squads) && plan.squads.length > 0
        return [mode, valid ? normalizeDeployment(plan, mode, 'player') : defaultDeployment(mode, 'player')]
    })) as Record<BattleMode, DeploymentPlan>
}

const emptySummary = (): ArmySummary => ({ infantry: 0, pikeman: 0, archer: 0, cavalry: 0, supply: 0, engineer: 0, total: 0, fortHp: 0, fortMaxHp: 1, killed: 0, deserted: 0, reserves: 0, hasFort: true, found: false, discovered: { infantry: 0, pikeman: 0, archer: 0, cavalry: 0, supply: 0, engineer: 0, total: 0 } })

export interface SquadSummary {
    id: number
    owner: Army
    type: UnitType
    number: number
    companyId: number
    /** 中隊の本隊へ戻っている最中か。 */
    count: number
    size: number
    order: SquadOrder
    arrows: number
    maxArrows: number
    stamina: number
    supplies: number
    maxSupplies: number
    /** 建てている（壊しに行く・占領している）建設物の種類と、建設の進み具合（0〜100）・耐久の割合（0〜100）・占領の進み具合（0〜100）。 */
    construction: { kind: ConstructionKind; progress: number; hp: number; complete: boolean; occupation: number } | null
    /** 行動と、命令で動いているか（中隊に入らない小隊だけが使う。中隊の小隊は中隊の行動に従う）。 */
    guideline: Guideline
    directive: Directive
}

export interface CompanySummary {
    id: number
    owner: Army
    number: number
    squadIds: number[]
    /** 小隊の兵種（重なりなし、兵種の順）。 */
    types: UnitType[]
    count: number
    size: number
    guideline: Guideline
    directive: Directive
}

/** 中隊への指示（地点・敵の小隊・敵の中隊・建設物と、まとめて出す指示）。 */
export interface CompanyCommand {
    order: CompanyOrder | 'move' | 'attack' | 'demolish'
    point?: Point
    targetSquadId?: number
    targetCompanyId?: number
    constructionId?: number
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
        /** 人間軍の部隊を行動に沿って動かす。 */
        director: null as GuidelineDirector | null,
        dayTime: 360,
        status: 'title' as GameStatus,
        seed: '',
        /** 戦場の種類（攻防戦・攻城戦・防衛戦）。 */
        mode: 'field' as BattleMode,
        /** 攻防戦で選んだ地形の種類。 */
        mapChoice: 'standard' as MapType,
        /** 今の戦場の地形の種類（攻城戦は魔王城付近、防衛戦は標準）。 */
        mapType: 'standard' as MapType,
        /** 開戦の時刻。 */
        startTime: 'dawn' as StartTime,
        winner: null as Army | null,
        isGameOver: false,
        summary: { player: emptySummary(), cpu: emptySummary() } as Record<Army, ArmySummary>,
        squads: [] as SquadSummary[],
        companies: [] as CompanySummary[],
        formation: 'line' as FormationType,
        summaryTimer: 0,
        /** まだ進めていないゲーム内時間（MIN_STEP に満たない分）。 */
        pendingTime: 0,
        gameSpeed: 1 as GameSpeed,
        visionTimer: 0,
        /** 開発時の確認用: 敵をすべて表示する（ゲームの進行には影響しない）。 */
        revealEnemies: false,
        /** 人間軍の開戦時の編成（戦場の種類ごと）。 */
        plans: loadPlans(),
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
            const battle = createBattle(mapGrid, rnd, this.mode, { player: this.plans[this.mode], cpu: cpuDeployment(this.mode, rnd) })
            battle.dayTime = START_TIME_MINUTES[this.startTime]
            refreshVision(battle)
            this.battle = markRaw(battle)
            this.commander = markRaw(createCpuCommander(battle))
            this.director = markRaw(createGuidelineDirector(battle, 'player'))
            this.dayTime = battle.dayTime
            this.pendingTime = 0
            this.isGameOver = false
            this.winner = null
            this.refresh()
        },

        /** 戦場に入る。deploy なら部隊編成から始め（開戦前）、そうでなければ前回の編成ですぐ開戦する。 */
        startGame(seed?: string, mode?: BattleMode, mapChoice?: MapType, deploy = true, startTime?: StartTime): void {
            if (mode) this.mode = mode
            if (mapChoice) this.mapChoice = mapChoice
            if (startTime) this.startTime = startTime
            this.status = deploy ? 'deploying' : 'playing'
            this.initGame(seed)
        },

        /** 部隊編成の画面で、編成どおりに人間軍を布陣し直す（開戦前だけ）。 */
        previewPlan(plan: DeploymentPlan): void {
            if (this.status !== 'deploying' || !this.battle) return
            redeployArmy(this.battle, 'player', plan)
            this.refresh()
        },

        /** 部隊編成の間に、自軍の中隊か中隊に入らない小隊を地点へ置く。置けない地点なら false。 */
        placeUnit(target: PlacementTarget, point: Point): boolean {
            const battle = this.battle
            const owner = 'companyId' in target ? battle?.companyById.get(target.companyId)?.owner : battle?.squadById.get(target.squadId)?.owner
            if (this.status !== 'deploying' || !battle || owner !== 'player') return false
            const placed = placeUnit(battle, target, point)
            if (placed) this.refresh()
            return placed
        },

        /** 編成を決めて開戦する。 */
        beginBattle(plan: DeploymentPlan): void {
            if (this.status !== 'deploying') return
            this.setPlan(this.mode, plan)
            this.previewPlan(this.plans[this.mode])
            this.status = 'playing'
        },

        /** 戦場の種類の編成を決める（次の開戦から使う）。 */
        setPlan(mode: BattleMode, plan: DeploymentPlan): void {
            this.plans[mode] = normalizeDeployment(plan, mode, 'player')
            try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(this.plans)) } catch { /* 保存できなくても編成はこの場で使える */ }
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
                const site = sq.order === 'build' || sq.order === 'demolish' || sq.order === 'occupy' ? battle.constructionById.get(sq.constructionId) : undefined
                return {
                    id: sq.id, owner: sq.owner, type: sq.type, number: sq.number, companyId: sq.companyId, count: sq.count, size: sq.size, order: sq.order, arrows: Math.floor(sq.arrows), maxArrows: sq.maxArrows,
                    stamina: Math.round(sq.stamina), supplies: sq.supplies, maxSupplies: sq.maxSupplies,
                    construction: site ? { kind: site.kind, progress: Math.floor(site.progress * 100), hp: Math.round(site.hp / site.maxHp * 100), complete: site.complete, occupation: Math.floor(site.occupation * 100) } : null,
                    guideline: sq.guidance.guideline, directive: sq.guidance.directive,
                }
            })
            const squadById = new Map(this.squads.map(sq => [sq.id, sq]))
            this.companies = battle.companies.map(c => {
                const squads = c.squadIds.map(id => squadById.get(id)).filter((sq): sq is SquadSummary => !!sq)
                const types = new Set(squads.map(sq => sq.type))
                return {
                    id: c.id, owner: c.owner, number: c.number, squadIds: squads.map(sq => sq.id), types: UNIT_TYPES.filter(t => types.has(t)),
                    count: squads.reduce((sum, sq) => sum + sq.count, 0), size: squads.reduce((sum, sq) => sum + sq.size, 0),
                    guideline: c.guidance.guideline, directive: c.guidance.directive,
                }
            })
            this.formation = battle.formations.player.type
        },

        /** 自軍の部隊への指示。中隊の小隊には個別に指示できない（中隊へ指示する）。 */
        orderSquad(squadId: number, order: SquadOrder, options: SquadCommand = {}): void {
            const battle = this.battle
            const squad = battle?.squadById.get(squadId)
            if (!battle || squad?.owner !== 'player' || battle.companyById.has(squad.companyId) || this.isGameOver) return
            if (order === 'move' && options.point) orderMove(battle, squadId, options.point)
            else if (order === 'build' && options.constructionId !== undefined) orderBuild(battle, squadId, options.constructionId)
            else if (order === 'build' && options.kind && options.point) orderConstruct(battle, squadId, options.kind, options.point, options.axis)
            else if (order === 'demolish' && options.constructionId !== undefined) orderDemolish(battle, squadId, options.constructionId)
            else if (order === 'occupy' && options.constructionId !== undefined) orderOccupy(battle, squadId, options.constructionId)
            else if (order === 'attack' && options.targetSquadId !== undefined) orderAttack(battle, squadId, options.targetSquadId)
            else if (order === 'hold') orderHold(battle, squadId)
            else if (order === 'charge') orderCharge(battle, squadId)
            else if (order === 'retreat') orderRetreat(battle, squadId)
            else if (order === 'formation') orderFormation(battle, squadId)
            else if (order === 'resupply') orderResupply(battle, squadId)
            else if (order === 'support') orderSupport(battle, squadId, options.targetSquadId)
            markCommanded(battle, { squadId }, order === 'hold' ? 'wait' : 'order')
            // 小隊に個別の指示を出したら、中隊は足並みをそろえるのをやめる（小隊は中隊の範囲の中で動く）。
            const company = battle.companyById.get(battle.squadById.get(squadId)!.companyId)
            if (company) company.together = false
            this.refresh()
        },

        /** 自軍の中隊への指示。 */
        orderCompany(companyId: number, command: CompanyCommand): void {
            const battle = this.battle
            if (!battle || battle.companyById.get(companyId)?.owner !== 'player' || this.isGameOver) return
            const { order } = command
            if (order === 'move') { if (command.point) orderCompanyMove(battle, companyId, command.point) }
            else if (order === 'attack') orderCompanyAttack(battle, companyId, { squadId: command.targetSquadId, companyId: command.targetCompanyId })
            else if (order === 'demolish') { if (command.constructionId !== undefined) orderCompanyDemolish(battle, companyId, command.constructionId) }
            else orderCompany(battle, companyId, order)
            markCommanded(battle, { companyId }, order === 'hold' ? 'wait' : 'order')
            this.refresh()
        },

        /** 工兵に建設物を建てさせる。建てられない場所ならfalse。中隊の小隊には個別に指示できない。 */
        construct(squadId: number, kind: ConstructionKind, point: Point, axis: ConstructionAxis): boolean {
            const battle = this.battle
            const squad = battle?.squadById.get(squadId)
            if (!battle || squad?.owner !== 'player' || battle.companyById.has(squad.companyId) || this.isGameOver) return false
            const placed = orderConstruct(battle, squadId, kind, point, axis)
            if (placed) markCommanded(battle, { squadId }, 'order')
            this.refresh()
            return placed
        },

        setFormation(type: FormationType): void {
            if (!this.battle || this.isGameOver) return
            setFormation(this.battle, 'player', type)
            markCommanded(this.battle, { army: 'player' }, 'order')
            this.refresh()
        },

        orderArmy(order: ArmyOrder): void {
            if (!this.battle || this.isGameOver) return
            orderArmy(this.battle, 'player', order)
            markCommanded(this.battle, { army: 'player' }, order === 'hold' ? 'wait' : 'order')
            this.refresh()
        },

        /** 自軍の中隊（companyId）か、中隊に入らない小隊（squadId）の行動を変える。 */
        setGuideline(target: { companyId: number } | { squadId: number }, guideline: Guideline): void {
            const battle = this.battle
            if (!battle || this.isGameOver) return
            const guidance = 'companyId' in target ? battle.companyById.get(target.companyId)?.guidance : battle.squadById.get(target.squadId)?.guidance
            const owner = 'companyId' in target ? battle.companyById.get(target.companyId)?.owner : battle.squadById.get(target.squadId)?.owner
            if (!guidance || owner !== 'player') return
            setGuideline(guidance, guideline)
            this.refresh()
        },

        setGameSpeed(speed: GameSpeed): void {
            this.gameSpeed = speed
        },

        /** 実時間の経過を受け取り、現在の速度に応じてゲームを進める。 */
        update(realDeltaSeconds: number): void {
            // 極端に短い刻みでは兵の速度の見積もりが乱れるので、MIN_STEP に満たない時間は次の描画へ持ち越す。
            let remaining = this.pendingTime + realDeltaSeconds * this.timeScale
            while (remaining >= MIN_STEP && this.status === 'playing') {
                const step = Math.min(remaining, MAX_STEP)
                remaining -= step
                this.step(step)
            }
            this.pendingTime = this.status === 'playing' ? remaining : 0
            // 開戦前は時間が進まないので、配置の変更に合わせて視界を計算し直す。
            if (this.status === 'deploying' && this.battle) {
                this.visionTimer -= realDeltaSeconds
                if (this.visionTimer <= 0) {
                    this.visionTimer = VISION.interval
                    refreshVision(this.battle)
                    this.summary = summarize(this.battle)
                }
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
            this.director?.update(deltaSeconds)
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
