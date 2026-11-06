import { describe, expect, it } from 'vitest'
import { createBattle } from './battle'
import { TILE, TILE_PX } from './constants'
import { generateMap } from './mapGenerator'
import { getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { createMulberry32, hashString } from './random'
import { getTerrainSpeedMultiplier, getTileCost } from './terrain'

const makeBattle = (seed: string) => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), 'snowfield')
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field')
}

describe('雪原', () => {
    it('川は凍っていて橋がなく、氷の上は地面と同じ速さで歩ける', () => {
        for (const seed of ['1', '2', '3', '155433']) {
            const { grid } = makeBattle(seed)
            let ice = 0
            for (let gy = PLAYABLE_GRID_MIN; gy <= PLAYABLE_GRID_MAX; gy++) for (let gx = PLAYABLE_GRID_MIN; gx <= PLAYABLE_GRID_MAX; gx++) {
                const tile = getPlayableTile(grid, gx, gy)
                expect(tile).not.toBe(TILE.WATER)
                expect(tile).not.toBe(TILE.BRIDGE)
                if (tile !== TILE.ICE) continue
                if (!ice++) {
                    expect(getTileCost(grid, gx, gy)).toBe(1)
                    expect(getTerrainSpeedMultiplier(grid, gx * TILE_PX, gy * TILE_PX, 'infantry')).toBeCloseTo(.85)
                }
            }
            expect(ice).toBeGreaterThan(0)
        }
    }, 120000)

    it('砦が2つ置かれ、その中心に立てる', () => {
        for (const seed of ['1', '2', '3', '4', '5', '155433']) {
            const battle = makeBattle(seed)
            expect(battle.forts).toHaveLength(2)
            const [a, b] = battle.forts
            expect(battle.paths.passable(a!.x, a!.y)).toBe(true)
            expect(battle.paths.passable(b!.x, b!.y)).toBe(true)
        }
    }, 120000)
})
