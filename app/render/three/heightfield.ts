import { createNoise2D } from 'simplex-noise'
import { createMulberry32, hashString } from '../../game/random'
import { LOGICAL_SIZE, TILE, TILE_PX, WORLD_SCALE as S } from '../../game/constants'
import { DIMENSIONS, m } from '../../game/dimensions'
import type { Base, MapType } from '../../types/game'
import { mapTypeOf, TERRAIN_PROFILE } from '../../game/mapType'
import { getFortGroundRadius } from './fortLayout'
import { marshFor } from '../../game/marsh'

export const WATER_HEIGHT = 0
export const BRIDGE_HEIGHT = 4
/** 地形の頂点の間隔。地形は遠景の端まで同じ細かさで作るので、マスの半分にする。 */
export const MESH_STEP = TILE_PX / 2
export const MAP_MIN = -TILE_PX / 2
export const MAP_MAX = LOGICAL_SIZE + TILE_PX / 2

type Noise = (x: number, y: number) => number
const ease = (t: number) => t * t * (3 - 2 * t)
const smoothstep = (a: number, b: number, v: number) => ease(Math.max(0, Math.min(1, (v - a) / (b - a))))

/** 部隊の動ける範囲の半分の幅（playableArea の PLAYABLE_SIZE / 2。循環 import を避けて持つ）。 */
const PLAYABLE_HALF = m(DIMENSIONS.battlefield) / 2 + m(DIMENSIONS.playableMargin)
/** 遠景の山並みが上がり始める、動ける範囲の端からの距離と、上がりきる距離（px）。 */
const RIM_FROM = m(60), RIM_TO = m(DIMENSIONS.landscapeMargin)

/**
 * 遠景の山並み: 部隊の動ける範囲の外で、地平線の手前に山がゆるく立ち上がる（内側と同じ地形・林の上に重ねる）。
 */
function rimAt(type: MapType, noise: Noise, x: number, y: number) {
    const center = LOGICAL_SIZE / 2
    const beyond = Math.max(Math.abs(x - center), Math.abs(y - center)) - PLAYABLE_HALF
    if (beyond <= RIM_FROM) return 0
    const { base, far, sharp } = TERRAIN_PROFILE[type].outerMountain
    const warpX = x + noise(x * .0009 / S, y * .0009 / S) * 100 * S
    const warpY = y + noise(x * .0009 / S + 60, y * .0009 / S) * 100 * S
    const ridgeNoise = noise(warpX * .001 / S, warpY * .001 / S)
    const ridge = 1 - ridgeNoise * ridgeNoise
    return ridge ** sharp * (base + far * .15) * Math.sqrt(S) * smoothstep(RIM_FROM, RIM_TO, beyond)
}

/**
 * 地形の種類ごとの、山を除いた地面の起伏。戦場の外の地形（landscape）も同じ式で続ける。
 * 砂丘は一方向に並ぶ稜線で、風上はゆるく、風下（稜線の向こう）は急に落ちる。
 */
export function reliefAt(type: MapType, noise: Noise, x: number, y: number): number {
    switch (type) {
        case 'meadow':
            return 26 + noise(x * .0012, y * .0012) * 16 + noise(x * .003, y * .003) * 12 + noise(x * .011, y * .011) * 1.5
        case 'forest': {
            // 草原に近いゆるい起伏に、頂の平らな高台が混じる。
            const hill = ease(Math.max(0, Math.min(1, (noise(x * .0042 + 30, y * .0042 - 20) - .25) / .3)))
            return 24 + noise(x * .0012, y * .0012) * 10 + noise(x * .003, y * .003) * 6 + hill * 34 + noise(x * .011, y * .011) * 1.5
        }
        case 'snowfield':
            // 雪に覆われたゆるやかな起伏。細かい凹凸は雪で均される。
            return 26 + noise(x * .0013, y * .0013) * 12 + noise(x * .0035, y * .0035) * 7 + noise(x * .012, y * .012) * 1.2
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

/** 隣の頂点との勾配が maxGrade を超えないように、高すぎる所を削る（低い所は変えない）。 */
function limitGrade(heights: Float32Array, size: number, maxGrade: number) {
    if (maxGrade === Infinity) return
    const straight = maxGrade * MESH_STEP, diagonal = straight * Math.SQRT2
    const relax = (j: number, i: number, fromJ: number, fromI: number, rise: number) => {
        if (fromJ < 0 || fromJ >= size || fromI < 0 || fromI >= size) return
        const limit = heights[fromJ * size + fromI]! + rise
        if (heights[j * size + i]! > limit) heights[j * size + i] = limit
    }
    // 2回の走査で、低い所から広がる上限が全体に行き渡る。
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        relax(j, i, j, i - 1, straight); relax(j, i, j - 1, i, straight)
        relax(j, i, j - 1, i - 1, diagonal); relax(j, i, j - 1, i + 1, diagonal)
    }
    for (let j = size - 1; j >= 0; j--) for (let i = size - 1; i >= 0; i--) {
        relax(j, i, j, i + 1, straight); relax(j, i, j + 1, i, straight)
        relax(j, i, j + 1, i + 1, diagonal); relax(j, i, j + 1, i - 1, diagonal)
    }
}

/** Rendering-only elevation. Never modifies the map or movement costs. */
export function createHeightfield(grid: number[][], bases: Base[], mapType: MapType = mapTypeOf(grid)) {
    const noise = createNoise2D(createMulberry32(hashString(JSON.stringify(grid))))
    const { mountainScale, maxGrade } = TERRAIN_PROFILE[mapType]
    const ridgeVariation = mapType === 'demonland' ? .3 : .12
    const waterAt = (gx: number, gy: number) => {
        const tile = grid[Math.max(0, Math.min(grid.length - 1, gy))]?.[Math.max(0, Math.min(grid.length - 1, gx))]
        return tile === TILE.WATER || tile === TILE.BRIDGE ? 1 : 0
    }
    // 山と川の近くかどうか（山は3マス、川は4マス以内）。遠い所では周りのマスを調べずに済ませる。
    const n = grid.length
    const mountainNear = new Uint8Array(n * n), waterNear = new Uint8Array(n * n)
    /** マスの山の高さ（高い山 130、低い山 72）。 */
    const tileMountain = new Float32Array(n * n)
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
        const t = grid[gy]![gx]!
        tileMountain[gy * n + gx] = t >= 23 && t <= 24 ? 130 : t === 2 || t >= 21 && t <= 22 ? 72 : 0
        const isMountain = t === 2 || t >= 21 && t <= 24, isWater = t === TILE.WATER || t === TILE.BRIDGE
        if (!isMountain && !isWater) continue
        const reach = isWater ? 4 : 3
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
            const x = gx + dx, y = gy + dy
            if (x < 0 || y < 0 || x >= n || y >= n) continue
            if (isMountain && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) mountainNear[y * n + x] = 1
            if (isWater) waterNear[y * n + x] = 1
        }
    }
    const near = (flags: Uint8Array, x: number, y: number) => {
        const gx = Math.round(x / TILE_PX), gy = Math.round(y / TILE_PX)
        // マス目の外は、端のマスと同じに扱う（端の外側は調べる）。
        return gx < 0 || gy < 0 || gx >= n || gy >= n || flags[gy * n + gx] === 1
    }
    const smooth = (t: number) => t * t * (3 - 2 * t)
    // Cubic filtering rounds river bends without changing the navigation tiles.
    const kernel = (distance: number) => {
        const d = Math.abs(distance)
        return d < 1 ? (4 - 6 * d * d + 3 * d * d * d) / 6 : d < 2 ? Math.pow(2 - d, 3) / 6 : 0
    }
    const waterMask = (x: number, y: number) => {
        if (!near(waterNear, x, y)) return 0
        const gx = x / TILE_PX, gy = y / TILE_PX, i = Math.floor(gx), j = Math.floor(gy)
        let mask = 0
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
            mask += waterAt(i + dx, j + dy) * kernel(gx - i - dx) * kernel(gy - j - dy)
        }
        return mask
    }
    const marsh = marshFor(grid, mapType)
    const tileAt = (x: number, y: number) => grid[Math.max(0, Math.min(grid.length - 1, Math.round(y / TILE_PX)))]?.[Math.max(0, Math.min(grid.length - 1, Math.round(x / TILE_PX)))] ?? TILE.GRASS
    const raw = (x: number, y: number) => {
        // 湿地の沼・土手道・岸は、戦場の内外で同じ式で決まる。
        const rim = rimAt(mapType, noise, x, y)
        if (marsh) return marsh.heightAt(x, y) + rim
        // Gentle, broad undulations give the whole battlefield a little relief.
        const rolling = reliefAt(mapType, noise, x, y)
        // 山からも川からも離れた所は、なだらかな起伏だけ。
        if (!near(mountainNear, x, y) && !near(waterNear, x, y)) return Math.max(7, rolling) + rim
        let mountain = 0
        let weight = 0
        let riverDistance = Infinity
        const cx = Math.round(x / TILE_PX), cy = Math.round(y / TILE_PX), fx = x / TILE_PX, fy = y / TILE_PX
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const gx = cx + dx, gy = cy + dy
            const ox = fx - gx, oy = fy - gy
            const d = Math.sqrt(ox * ox + oy * oy)
            if (d >= 3) continue
            const w = 3 - d
            weight += w
            const inGrid = gx >= 0 && gy >= 0 && gx < n && gy < n
            if (!inGrid) continue
            mountain += tileMountain[gy * n + gx]! * w
            const t = grid[gy]![gx]!
            if ((t === TILE.WATER || t === TILE.BRIDGE) && d < riverDistance) riverDistance = d
        }
        mountain *= mountainScale
        const ridge = 1 + ridgeVariation * noise(x * .012, y * .012)
        const height = Math.max(7, rolling) + mountain / Math.max(1, weight) * ridge + rim
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
    limitGrade(heights, size, maxGrade)
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
