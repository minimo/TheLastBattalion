import { describe, expect, it } from 'vitest'
import { createBattle } from './battle'
import { TILE, TILE_PX } from './constants'
import { generateMap } from './mapGenerator'
import { getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { createMulberry32, hashString } from './random'
import { getTileCost } from './terrain'

const makeBattle = (seed: string) => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), 'greatRiver')
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field')
}

/** 歩いて a から b へ行けるか（bridges が false なら橋を通らない）。 */
const reachable = (grid: number[][], a: { x: number; y: number }, b: { x: number; y: number }, bridges: boolean) => {
    const key = (x: number, y: number) => `${x},${y}`
    const start = { x: Math.round(a.x / TILE_PX), y: Math.round(a.y / TILE_PX) }, goal = key(Math.round(b.x / TILE_PX), Math.round(b.y / TILE_PX))
    const seen = new Set([key(start.x, start.y)]), queue = [start]
    for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]!
        if (key(x, y) === goal) return true
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx!, ny = y + dy!
            if (nx < PLAYABLE_GRID_MIN || nx > PLAYABLE_GRID_MAX || ny < PLAYABLE_GRID_MIN || ny > PLAYABLE_GRID_MAX || seen.has(key(nx, ny))) continue
            if (!Number.isFinite(getTileCost(grid, nx, ny)) || !bridges && getPlayableTile(grid, nx, ny) === TILE.BRIDGE) continue
            seen.add(key(nx, ny)); queue.push({ x: nx, y: ny })
        }
    }
    return false
}

describe('大河', () => {
    it('川は歩いて渡れず、両軍の砦は橋を通ってだけ行き来できる', () => {
        for (const seed of ['1', '2', '3', '4', '155433']) {
            const battle = makeBattle(seed)
            expect(battle.forts).toHaveLength(2)
            const [a, b] = battle.forts
            let water = 0, bridges = 0
            for (let gy = 0; gy <= 52; gy++) for (let gx = 0; gx <= 52; gx++) {
                const tile = battle.grid[gy]![gx]
                if (tile === TILE.WATER) water++
                if (tile === TILE.BRIDGE) bridges++
            }
            expect(water).toBeGreaterThan(200)
            expect(bridges).toBeGreaterThanOrEqual(2 * 3 * 4)
            expect(Number.isFinite(getTileCost(battle.grid, Math.round(a!.x / TILE_PX), Math.round(a!.y / TILE_PX)))).toBe(true)
            expect(reachable(battle.grid, a!, b!, true)).toBe(true)
            // 橋を通らなければ、戦場の外へ回り込んでも渡れない。
            expect(reachable(battle.grid, a!, b!, false)).toBe(false)
        }
    }, 120000)
})
