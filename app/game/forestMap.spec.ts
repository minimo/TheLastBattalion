import { describe, expect, it } from 'vitest'
import { createBattle } from './battle'
import { generateMap } from './mapGenerator'
import { clearConstructionTiles, fellTree, getCellHeight, getTerrainTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { createMulberry32, hashString } from './random'
import { TILE } from './constants'
import { inForestClearing } from './fortLayout'
import { felledCells } from './construction'

const makeBattle = (seed: string) => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), 'forest')
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field')
}
const isWood = (tile: number) => tile >= 31 && tile <= 41

describe('森林', () => {
    it('動ける範囲の多くが林で、陣地の周りと高台には木がない', () => {
        for (const seed of ['1', '155433']) {
            const battle = makeBattle(seed)
            let wood = 0, total = 0, open = 0
            for (let gy = PLAYABLE_GRID_MIN; gy <= PLAYABLE_GRID_MAX; gy++) for (let gx = PLAYABLE_GRID_MIN; gx <= PLAYABLE_GRID_MAX; gx++) {
                const tile = getTerrainTile(battle.grid, gx, gy)
                total++
                if (isWood(tile)) wood++
                if (battle.forts.some(fort => inForestClearing(fort, gx, gy))) expect(isWood(tile)).toBe(false)
                if (tile === TILE.GRASS && getCellHeight(battle.grid, gx, gy) >= 56) open++
            }
            expect(wood / total).toBeGreaterThan(.4)
            expect(open).toBeGreaterThan(0)
        }
    }, 120000)
    it('拠点の木は進み具合に合わせて減り、完成までになくなる', () => {
        const area = Array.from({ length: 25 }, (_, i) => ({ gx: i % 5, gy: Math.floor(i / 5) }))
        const count = (progress: number) => felledCells({ kind: 'outpost', area, progress }).length
        expect(count(0)).toBe(0)
        expect(count(.45)).toBeGreaterThan(5)
        expect(count(.45)).toBeLessThan(25)
        expect(count(.9)).toBe(25)
        expect(count(1)).toBe(25)
        expect(felledCells({ kind: 'barricade', area, progress: 1 })).toEqual([])
    })

    it('切り払ったマスは草地になり、戦い直すと木が戻る', () => {
        const battle = makeBattle('1')
        let cell: { gx: number; gy: number } | undefined
        for (let gy = 0; gy <= 52 && !cell; gy++) for (let gx = 0; gx <= 52 && !cell; gx++) if (isWood(getTerrainTile(battle.grid, gx, gy))) cell = { gx, gy }
        const before = getTerrainTile(battle.grid, cell!.gx, cell!.gy)
        fellTree(battle.grid, cell!.gx, cell!.gy)
        expect(getTerrainTile(battle.grid, cell!.gx, cell!.gy)).toBe(TILE.GRASS)
        clearConstructionTiles(battle.grid)
        expect(getTerrainTile(battle.grid, cell!.gx, cell!.gy)).toBe(before)
    }, 120000)
})
