import { describe, expect, it } from 'vitest'
import { createBattle } from './battle'
import { TILE, TILE_PX } from './constants'
import { generateMap } from './mapGenerator'
import { marshFor } from './marsh'
import { getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { createMulberry32, hashString } from './random'
import { getTerrainSpeedMultiplier, getTileCost } from './terrain'
import { fortTileAt } from './fortLayout'
import { planConstruction } from './construction'

const makeBattle = (seed: string, type: 'marsh' | 'standard' = 'marsh') => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), type)
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field')
}

/** a から b へ歩いて行けるか。 */
const reachable = (grid: number[][], a: { x: number; y: number }, b: { x: number; y: number }) => {
    const wet = (x: number, y: number) => !Number.isFinite(getTileCost(grid, x, y))
    const key = (x: number, y: number) => `${x},${y}`
    const start = { x: Math.round(a.x / TILE_PX), y: Math.round(a.y / TILE_PX) }, goal = key(Math.round(b.x / TILE_PX), Math.round(b.y / TILE_PX))
    const seen = new Set([key(start.x, start.y)]), queue = [start]
    for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]!
        if (key(x, y) === goal) return true
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx!, ny = y + dy!
            if (nx < PLAYABLE_GRID_MIN || nx > PLAYABLE_GRID_MAX || ny < PLAYABLE_GRID_MIN || ny > PLAYABLE_GRID_MAX || seen.has(key(nx, ny)) || wet(nx, ny)) continue
            seen.add(key(nx, ny)); queue.push({ x: nx, y: ny })
        }
    }
    return false
}

describe('湿地', () => {
    it('沼と葦原が戦場全体に広がり、陣地は沼にかからず、両軍の陣地を行き来できる', () => {
        for (const seed of ['1', '2', '3', '4', '155433']) {
            const battle = makeBattle(seed)
            expect(battle.forts).toHaveLength(2)
            const [a, b] = battle.forts
            const grid = battle.grid
            const tiles = []
            for (let y = PLAYABLE_GRID_MIN; y <= PLAYABLE_GRID_MAX; y++) for (let x = PLAYABLE_GRID_MIN; x <= PLAYABLE_GRID_MAX; x++) tiles.push(getPlayableTile(grid, x, y))
            const wet = (t: number) => t === TILE.MARSH || t === TILE.REEDS || t === TILE.REEDS_DENSE
            expect(tiles.filter(wet).length).toBeGreaterThan(tiles.length * .3)
            // 葦が沼の多くに茂り、見通しの効かない密な葦原もある。
            expect(tiles.filter(t => t === TILE.REEDS || t === TILE.REEDS_DENSE).length).toBeGreaterThan(tiles.filter(wet).length * .5)
            expect(tiles.filter(t => t === TILE.REEDS_DENSE).length).toBeGreaterThan(0)
            // 沼は両軍の間だけでなく、陣地の側（東西の端の3分の1）にも広がる。
            const size = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN + 1
            const third = (from: number, to: number) => tiles.filter((t, k) => k % size >= from && k % size < to && wet(t)).length / (size * (to - from))
            expect(third(0, size / 3)).toBeGreaterThan(.15)
            expect(third(size * 2 / 3, size)).toBeGreaterThan(.15)
            // 沼の上には砦を建てない。
            for (let y = PLAYABLE_GRID_MIN; y <= PLAYABLE_GRID_MAX; y++) for (let x = PLAYABLE_GRID_MIN; x <= PLAYABLE_GRID_MAX; x++) {
                if (battle.forts.some(f => fortTileAt(f, x, y))) expect(marshFor(grid)!.wetness(x * TILE_PX, y * TILE_PX) > 0 && marshFor(grid)!.causeway(x * TILE_PX, y * TILE_PX) <= 0).toBe(false)
            }
            expect(reachable(grid, a!, b!)).toBe(true)
        }
    }, 120000)

    it('沼は遅く、馬は徒歩よりさらに遅い', () => {
        const grid = makeBattle('1').grid
        let cell: { x: number; y: number } | undefined
        for (let y = PLAYABLE_GRID_MIN; y <= PLAYABLE_GRID_MAX && !cell; y++) for (let x = PLAYABLE_GRID_MIN; x <= PLAYABLE_GRID_MAX && !cell; x++) {
            if (getPlayableTile(grid, x, y) === TILE.MARSH) cell = { x, y }
        }
        const foot = getTerrainSpeedMultiplier(grid, cell!.x * TILE_PX, cell!.y * TILE_PX, 'infantry')
        const mounted = getTerrainSpeedMultiplier(grid, cell!.x * TILE_PX, cell!.y * TILE_PX, 'cavalry')
        expect(foot).toBe(.5)
        expect(mounted).toBe(.4)
    }, 60000)

    it('沼・葦原には拠点を建てられない', () => {
        const battle = makeBattle('1')
        const grid = battle.grid
        // 周りの5×5マスがすべて沼か葦原で、敵陣から遠い所を探す。
        const wet = (x: number, y: number) => [TILE.MARSH, TILE.REEDS, TILE.REEDS_DENSE].includes(getPlayableTile(grid, x, y) as never)
        let spot: { x: number; y: number } | undefined
        for (let y = PLAYABLE_GRID_MIN + 3; y <= PLAYABLE_GRID_MAX - 3 && !spot; y++) for (let x = PLAYABLE_GRID_MIN + 3; x <= 26 && !spot; x++) {
            if ([-2, -1, 0, 1, 2].every(dy => [-2, -1, 0, 1, 2].every(dx => wet(x + dx, y + dy)))) spot = { x, y }
        }
        const plan = planConstruction(battle, 'player', 'outpost', { x: spot!.x * TILE_PX, y: spot!.y * TILE_PX })
        expect(plan.valid).toBe(false)
        expect(plan.reason).toBe('沼には建てられません')
    }, 60000)

    it('湿地の形は湿地の戦場だけにある', () => {
        const grid = makeBattle('1', 'standard').grid
        expect(marshFor(grid)).toBeNull()
    }, 60000)
})
