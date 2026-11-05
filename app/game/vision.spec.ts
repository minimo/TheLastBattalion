import { describe, expect, it } from 'vitest'
import { createBattle, orderAttack, summarize, updateBattle } from './battle'
import { UNIT_VISION } from './battleConfig'
import { TILE_PX } from './constants'
import { generateMap } from './mapGenerator'
import { PLAYABLE_GRID_MIN } from './playableArea'
import { createMulberry32, hashString } from './random'
import { clearVisionWalls, isVisibleAt, refreshVision, setVisionWalls, VISION_SIZE, visionRangeAt } from './vision'

const makeBattle = (seed = 'vision') => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), 'meadow')
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field')
}
type TestBattle = ReturnType<typeof makeBattle>

const CENTER = 416
/** 平らで遮るもののない戦場に、人間軍の視点を中央に1つだけ置く。 */
const flatten = (battle: TestBattle) => {
    const { ground, kinds, baseKinds, owners } = battle.vision
    ground.fill(10); kinds.fill(0); baseKinds.fill(0); owners.fill(255)
    battle.forts.length = 0
    battle.soldiers = []
    for (const squad of battle.squads) squad.count = 0
    const scout = battle.squads.find(squad => squad.owner === 'player')!
    scout.count = 1
    scout.center = { x: CENTER, y: CENTER }
    scout.leaderId = -1
    battle.dayTime = 720
}
/** 中央から東へ dx のマスの番号。 */
const cellEast = (dx: number) => {
    const j = Math.round(CENTER / TILE_PX) - PLAYABLE_GRID_MIN
    return j * VISION_SIZE + j + Math.round(dx / TILE_PX)
}
const seen = (battle: TestBattle, dx: number) => isVisibleAt(battle.vision, 'player', CENTER + dx, CENTER)
const WOOD_DENSE = 2

describe('視界', () => {
    it('昼は遠くまで、夜は近くまで見え、朝夕はその間を変わる', () => {
        const range = UNIT_VISION.player.infantry
        expect(visionRangeAt(range, 720)).toBe(600)
        expect(visionRangeAt(range, 0)).toBe(150)
        expect(visionRangeAt(range, 1050)).toBeGreaterThan(150)
        expect(visionRangeAt(range, 1050)).toBeLessThan(600)
        const battle = makeBattle()
        flatten(battle)
        refreshVision(battle)
        expect(seen(battle, 560)).toBe(true)
        expect(seen(battle, 650)).toBe(false)
        battle.dayTime = 0
        refreshVision(battle)
        expect(seen(battle, 128)).toBe(true)
        expect(seen(battle, 200)).toBe(false)
    })

    it('山の奥は見えない', () => {
        const battle = makeBattle()
        flatten(battle)
        battle.vision.ground[cellEast(160)] = 200
        refreshVision(battle)
        expect(seen(battle, 128)).toBe(true)
        expect(seen(battle, 320)).toBe(false)
    })

    it('森は浅ければ見通せて、深ければ見通せない', () => {
        const battle = makeBattle()
        flatten(battle)
        battle.vision.kinds[cellEast(160)] = WOOD_DENSE
        refreshVision(battle)
        expect(seen(battle, 320)).toBe(true)
        for (let dx = 176; dx <= 208; dx += TILE_PX) battle.vision.kinds[cellEast(dx)] = WOOD_DENSE
        refreshVision(battle)
        expect(seen(battle, 160)).toBe(true)
        expect(seen(battle, 320)).toBe(false)
    })

    it('敵の柵の奥は少しだけ見え、自軍の柵は視界を遮らず、壊れたら元に戻る', () => {
        const battle = makeBattle()
        flatten(battle)
        const fence = { gx: Math.round(CENTER / TILE_PX) + 10, gy: Math.round(CENTER / TILE_PX) }
        setVisionWalls(battle.vision, [fence], 'cpu')
        refreshVision(battle)
        expect(seen(battle, 160)).toBe(true)
        expect(seen(battle, 192)).toBe(true)
        expect(seen(battle, 320)).toBe(false)
        setVisionWalls(battle.vision, [fence], 'player')
        refreshVision(battle)
        expect(seen(battle, 320)).toBe(true)
        setVisionWalls(battle.vision, [fence], 'cpu')
        clearVisionWalls(battle.vision, [fence])
        refreshVision(battle)
        expect(seen(battle, 320)).toBe(true)
    })

    it('見失った攻撃目標は追わず、最後に見えた地点に着いたら構える', () => {
        const battle = makeBattle()
        const hunter = battle.squads.find(squad => squad.owner === 'player' && squad.type === 'infantry')!
        const prey = battle.squads.find(squad => squad.owner === 'cpu' && squad.type === 'infantry')!
        // 中隊の「遠くの敵を追わない」決まりが働かないよう、中隊から外す。
        const company = battle.companyById.get(hunter.companyId)
        if (company) company.squadIds = company.squadIds.filter(id => id !== hunter.id)
        hunter.companyId = -1
        orderAttack(battle, hunter.id, prey.id)
        const anchor = { ...hunter.anchor }
        prey.center = { x: prey.center.x + 300, y: prey.center.y }
        prey.seenCount = 0
        battle.vision.timer = 100
        updateBattle(battle, .01)
        expect(hunter.anchor).toEqual(anchor)
        expect(hunter.order).toBe('attack')
        for (const s of battle.soldiers) if (s.squadId === hunter.id) { s.x = anchor.x; s.y = anchor.y }
        updateBattle(battle, .01)
        expect(hunter.order).toBe('hold')
    })

    it('一度でも発見した敵の兵を兵種ごとに数え、見失っても減らさず、死んだら減らす', () => {
        const battle = makeBattle()
        const discovered = () => summarize(battle).cpu.discovered
        flatten(battle)
        const squad = battle.squads.find(sq => sq.owner === 'cpu')!
        const place = (type: string, x: number) => {
            const soldier = { state: 'hold', owner: 'cpu', type, squadId: squad.id, x, y: CENTER, spottedUntil: 0, discovered: false } as never as TestBattle['soldiers'][number]
            battle.soldiers.push(soldier)
            return soldier
        }
        refreshVision(battle)
        expect(summarize(battle).cpu.found).toBe(false)
        const swordsman = place('infantry', CENTER + 64)
        const archer = place('archer', CENTER + 2000)
        // 編成の間は、今見えている兵だけを数える。
        refreshVision(battle)
        expect(discovered()).toMatchObject({ total: 1, infantry: 1, archer: 0 })
        swordsman.x = CENTER + 2000
        refreshVision(battle)
        expect(discovered().total).toBe(0)
        swordsman.x = CENTER + 64
        refreshVision(battle)
        expect(discovered().total).toBe(1)
        battle.time = 1
        // 同じ兵を何度見ても増えず、視界から消えても減らない。
        refreshVision(battle)
        swordsman.x = CENTER + 2000
        refreshVision(battle)
        expect(discovered()).toMatchObject({ total: 1, infantry: 1, archer: 0 })
        archer.x = CENTER + 64
        refreshVision(battle)
        expect(discovered()).toMatchObject({ total: 2, infantry: 1, archer: 1 })
        archer.state = 'dead'
        expect(discovered()).toMatchObject({ total: 1, infantry: 1, archer: 0 })
        // 発見した兵が全滅しても、未発見には戻らない。
        swordsman.state = 'dead'
        battle.soldiers = []
        refreshVision(battle)
        expect(discovered().total).toBe(0)
        expect(summarize(battle).cpu.found).toBe(true)
    })

    it('敵の建設物は一度視界に入れば認識したままになる', () => {
        const battle = makeBattle()
        flatten(battle)
        const gx = Math.round(CENTER / TILE_PX)
        const site = { area: [{ gx, gy: gx }], walls: [], deck: [], seenBy: { player: false, cpu: true }, kind: 'barricade', owner: 'cpu', complete: false, center: { x: CENTER, y: CENTER } } as never as TestBattle['constructions'][number]
        battle.constructions.push(site)
        refreshVision(battle)
        expect(site.seenBy.player).toBe(true)
        for (const squad of battle.squads) squad.count = 0
        refreshVision(battle)
        expect(isVisibleAt(battle.vision, 'player', CENTER, CENTER)).toBe(false)
        expect(site.seenBy.player).toBe(true)
    })
})
