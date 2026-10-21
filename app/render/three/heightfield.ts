import { createNoise2D } from 'simplex-noise'
import { createMulberry32, hashString } from '../../game/random'
import { LOGICAL_SIZE, TILE, TILE_PX } from '../../game/constants'
import type { Base, MapType } from '../../types/game'
import { mapTypeOf, TERRAIN_PROFILE } from '../../game/mapType'
import { getFortGroundRadius } from './fortLayout'

export const WATER_HEIGHT = 0
export const BRIDGE_HEIGHT = 4
export const MESH_STEP = TILE_PX / 4
export const MAP_MIN = -TILE_PX / 2
export const MAP_MAX = LOGICAL_SIZE + TILE_PX / 2

type Noise = (x: number, y: number) => number
const ease = (t: number) => t * t * (3 - 2 * t)

/**
 * 地形の種類ごとの、山を除いた地面の起伏。戦場の外の地形（landscape）も同じ式で続ける。
 * 砂丘は一方向に並ぶ稜線で、風上はゆるく、風下（稜線の向こう）は急に落ちる。
 */
export function reliefAt(type: MapType, noise: Noise, x: number, y: number): number {
    switch (type) {
        case 'meadow':
            return 26 + noise(x * .0012, y * .0012) * 16 + noise(x * .003, y * .003) * 12 + noise(x * .011, y * .011) * 1.5
        case 'desert': {
            const warp = noise(x * .0018 + 40, y * .0018) * 70 + noise(x * .004, y * .004 + 90) * 18
            const phase = (x + warp) * .0036 + noise(x * .0025, y * .0025 + 80) * .6
            const t = phase - Math.floor(phase)
            const dune = t < .72 ? ease(t / .72) : 1 - ease((t - .72) / .28)
            const amplitude = 15 + 10 * noise(x * .0022 + 15, y * .0022 - 30)
            return 17 + dune * amplitude + noise(x * .0015, y * .0015) * 6 + noise(x * .03, y * .03) * .5
        }
        case 'wasteland':
            return 22 + noise(x * .0015, y * .0015) * 6 + noise(x * .004, y * .004) * 5 + noise(x * .013, y * .013) * 2 + noise(x * .035, y * .035) * .8
        case 'demonland':
            return 21 + noise(x * .0015, y * .0015) * 7 + noise(x * .004, y * .004) * 5
                + Math.abs(noise(x * .016, y * .016)) * 4 + noise(x * .04, y * .04) * 1.2
        default:
            return 24 + noise(x * .0015, y * .0015) * 10 + noise(x * .004, y * .004) * 13 + noise(x * .013, y * .013) * 3
    }
}

/** Rendering-only elevation. Never modifies the map or movement costs. */
export function createHeightfield(grid: number[][], bases: Base[], mapType: MapType = mapTypeOf(grid)) {
    const noise = createNoise2D(createMulberry32(hashString(JSON.stringify(grid))))
    const { mountainScale } = TERRAIN_PROFILE[mapType]
    const ridgeVariation = mapType === 'demonland' ? .3 : .12
    const waterAt = (gx: number, gy: number) => {
        const tile = grid[Math.max(0, Math.min(grid.length - 1, gy))]?.[Math.max(0, Math.min(grid.length - 1, gx))]
        return tile === TILE.WATER || tile === TILE.BRIDGE ? 1 : 0
    }
    const smooth = (t: number) => t * t * (3 - 2 * t)
    // Cubic filtering rounds river bends without changing the navigation tiles.
    const kernel = (distance: number) => {
        const d = Math.abs(distance)
        return d < 1 ? (4 - 6 * d * d + 3 * d * d * d) / 6 : d < 2 ? Math.pow(2 - d, 3) / 6 : 0
    }
    const waterMask = (x: number, y: number) => {
        const gx = x / TILE_PX, gy = y / TILE_PX, i = Math.floor(gx), j = Math.floor(gy)
        let mask = 0
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
            mask += waterAt(i + dx, j + dy) * kernel(gx - i - dx) * kernel(gy - j - dy)
        }
        return mask
    }
    const tileAt = (x: number, y: number) => grid[Math.max(0, Math.min(grid.length - 1, Math.round(y / TILE_PX)))]?.[Math.max(0, Math.min(grid.length - 1, Math.round(x / TILE_PX)))] ?? TILE.GRASS
    const raw = (x: number, y: number) => {
        let mountain = 0
        let weight = 0
        let riverDistance = Infinity
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const gx = Math.round(x / TILE_PX) + dx
            const gy = Math.round(y / TILE_PX) + dy
            const t = grid[gy]?.[gx] ?? 0
            const d = Math.hypot(x / TILE_PX - gx, y / TILE_PX - gy)
            const w = Math.max(0, 3 - d)
            mountain += (t >= 23 && t <= 24 ? 130 : t === 2 || t >= 21 && t <= 22 ? 72 : 0) * mountainScale * w
            weight += w
            if (t === TILE.WATER || t === TILE.BRIDGE) riverDistance = Math.min(riverDistance, d)
        }
        // Gentle, broad undulations give the whole battlefield a little relief.
        const rolling = reliefAt(mapType, noise, x, y)
        const ridge = 1 + ridgeVariation * noise(x * .012, y * .012)
        const height = Math.max(7, rolling) + mountain / Math.max(1, weight) * ridge
        const bank = (.5 - waterMask(x, y)) * 12
        const riverBlend = smooth(Math.max(0, Math.min(1, (riverDistance - 1.3) / 2.7)))
        return bank + (height - bank) * riverBlend
    }
    const foundations = bases.map(base => ({ x: base.x, y: base.y, height: Math.max(5, raw(base.x, base.y)), radius: getFortGroundRadius(base) }))
    const size = Math.round((MAP_MAX - MAP_MIN) / MESH_STEP) + 1
    const heights = new Float32Array(size * size)
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const x = MAP_MIN + i * MESH_STEP, y = MAP_MIN + j * MESH_STEP
        let h = raw(x, y)
        if (tileAt(x, y) !== TILE.WATER && tileAt(x, y) !== TILE.BRIDGE) {
            for (const base of foundations) {
                const blend = Math.max(0, Math.min(1, (base.radius + 20 - Math.hypot(x - base.x, y - base.y)) / 20))
                h += (base.height - h) * blend
            }
        }
        heights[j * size + i] = h
    }
    const heightAt = (x: number, y: number) => {
        const gx = Math.max(0, Math.min(size - 1.000001, (x - MAP_MIN) / MESH_STEP))
        const gy = Math.max(0, Math.min(size - 1.000001, (y - MAP_MIN) / MESH_STEP))
        const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j
        const a = heights[j * size + i]!, b = heights[j * size + i + 1]!
        const c = heights[(j + 1) * size + i]!, d = heights[(j + 1) * size + i + 1]!
        // Match the two triangles used by the terrain mesh exactly.
        return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
    }
    const ramps: { x: number; y: number; alongY: boolean; direction: number; bankHeight: number }[] = []
    grid.forEach((row, j) => row.forEach((tile, i) => {
        if (tile !== TILE.BRIDGE) return
        const alongY = grid[j]?.[i - 1] === TILE.WATER || grid[j]?.[i + 1] === TILE.WATER
        for (const direction of [-1, 1]) {
            const gx = alongY ? i : i + direction, gy = alongY ? j + direction : j
            const neighbor = grid[gy]?.[gx]
            if (neighbor !== undefined && neighbor !== TILE.BRIDGE && neighbor !== TILE.WATER) {
                ramps.push({ x: i * TILE_PX, y: j * TILE_PX, alongY, direction, bankHeight: heightAt(gx * TILE_PX, gy * TILE_PX) })
            }
        }
    }))
    const surfaceAt = (x: number, y: number) => {
        const tile = tileAt(x, y)
        if (tile === TILE.BRIDGE) return BRIDGE_HEIGHT
        if (tile === TILE.WATER) return WATER_HEIGHT
        let h = Math.max(WATER_HEIGHT, heightAt(x, y))
        for (const ramp of ramps) {
            const along = (ramp.alongY ? y - ramp.y : x - ramp.x) * ramp.direction
            const across = Math.abs(ramp.alongY ? x - ramp.x : y - ramp.y)
            if (along >= 8 && along <= 16 && across <= 7) {
                h = Math.max(h, BRIDGE_HEIGHT + (ramp.bankHeight - BRIDGE_HEIGHT) * (along - 8) / 8)
            }
        }
        return h
    }
    return { size, heights, heightAt, surfaceAt, tileAt, mapType }
}
export type Heightfield = ReturnType<typeof createHeightfield>
