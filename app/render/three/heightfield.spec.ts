import { describe, expect, it } from 'vitest'
import { generateMap } from '../../game/mapGenerator'
import { createMulberry32, hashString } from '../../game/random'
import { createHeightfield, MESH_STEP } from './heightfield'
import { TERRAIN_PROFILE } from '../../game/mapType'

describe('標準の地形の山', () => {
    const maps = ['1', '155433', '305894', '139595'].map(seed => generateMap(createMulberry32(hashString(seed)), 'standard').mapGrid)

    it('隣り合う頂点の勾配が上限を超えない', () => {
        for (const grid of maps) {
            const { heights, size } = createHeightfield(grid, [], 'standard')
            let steepest = 0
            for (let j = 0; j < size; j++) for (let i = 0; i < size - 1; i++) {
                steepest = Math.max(steepest, Math.abs(heights[j * size + i]! - heights[j * size + i + 1]!), Math.abs(heights[i * size + j]! - heights[(i + 1) * size + j]!))
            }
            expect(steepest / MESH_STEP).toBeLessThanOrEqual(TERRAIN_PROFILE.standard.maxGrade + 1e-3)
        }
    }, 60000)
})
