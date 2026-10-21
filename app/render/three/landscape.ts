import { createNoise2D } from 'simplex-noise'
import { createMulberry32, hashString } from '../../game/random'
import { TILE, TILE_PX } from '../../game/constants'
import { TERRAIN_PROFILE } from '../../game/mapType'
import { MAP_MIN, MAP_MAX, reliefAt, type Heightfield } from './heightfield'

// Fix the full landscape width at 3,300, independently of the battlefield size.
export const LANDSCAPE_RADIUS = 1650
export const TERRAIN_CENTER = (MAP_MIN + MAP_MAX) / 2
export const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/** 生成グリッドの外にある砦の平地。 */
export interface Foundation { minX: number; maxX: number; minY: number; maxY: number; height: number; margin: number }

/**
 * shape: 最後に地形の高さを置き換える（城の岩山）。戦場の内外で同じ関数を通すので、縁で段差ができない。
 */
export function createLandscape(grid: number[][], field: Heightfield, foundations: Foundation[] = [], shape?: (x: number, y: number, h: number) => number) {
    const noise = createNoise2D(createMulberry32(hashString(JSON.stringify(grid)) ^ 0x62a5b39))
    const { mapType } = field, outer = TERRAIN_PROFILE[mapType].outerMountain
    // 荒野の山は頂の平らな台地になる。
    const terrace = (h: number) => {
        const k = h / 36, f = k - Math.floor(k)
        return (Math.floor(k) + smooth(.7, 1, f)) * 36
    }
    const mouths: { x: number; y: number; dx: number; dy: number; width: number }[] = []
    const n = grid.length
    for (let side = 0; side < 4; side++) {
        let start = -1
        for (let i = 0; i <= n; i++) {
            const tile = side === 0 ? grid[0]?.[i] : side === 1 ? grid[n - 1]?.[i] : side === 2 ? grid[i]?.[0] : grid[i]?.[n - 1]
            const river = i < n && (tile === TILE.WATER || tile === TILE.BRIDGE)
            if (river && start < 0) start = i
            if (!river && start >= 0) {
                const middle = (start + i - 1) * TILE_PX / 2
                mouths.push({ x: side < 2 ? middle : side === 2 ? MAP_MIN : MAP_MAX, y: side >= 2 ? middle : side === 0 ? MAP_MIN : MAP_MAX,
                    dx: side === 2 ? -1 : side === 3 ? 1 : 0, dy: side === 0 ? -1 : side === 1 ? 1 : 0, width: (i - start) * TILE_PX / 2 })
                start = -1
            }
        }
    }
    const inside = (x: number, y: number) => x >= MAP_MIN && x <= MAP_MAX && y >= MAP_MIN && y <= MAP_MAX
    const distanceOutside = (x: number, y: number) => Math.hypot(Math.max(MAP_MIN - x, 0, x - MAP_MAX), Math.max(MAP_MIN - y, 0, y - MAP_MAX))
    const baseHeightAt = (x: number, y: number) => {
        if (inside(x, y)) return field.heightAt(x, y)
        const distance = distanceOutside(x, y)
        // Broad, gently warped ridges keep the distant silhouette rounded.
        const warpX = x + noise(x * .0009, y * .0009) * 100
        const warpY = y + noise(x * .0009 + 60, y * .0009) * 100
        const ridgeNoise = noise(warpX * .001, warpY * .001)
        const ridge = 1 - ridgeNoise * ridgeNoise
        let mountain = ridge ** outer.sharp * (outer.base + outer.far * smooth(250, 1800, distance))
        if (mapType === 'wasteland') mountain = terrace(mountain)
        // 魔王城の周りの山は、鋸のように尖った岩山。
        if (mapType === 'demonland') mountain += Math.abs(noise(x * .007, y * .007)) * 40 * ridge * smooth(100, 900, distance)
        let h = mapType === 'standard'
            ? 18 + mountain + noise(x * .0018, y * .0018) * 12 + noise(x * .004, y * .004) * 2
            : reliefAt(mapType, noise, x, y) - 5 + mountain + noise(x * .0018, y * .0018) * 6
        h = Math.max(8, h)
        // Rivers continue out of the battlefield, meandering through the wider valley.
        for (const mouth of mouths) {
            const along = (x - mouth.x) * mouth.dx + (y - mouth.y) * mouth.dy
            if (along < 0) continue
            const across = (x - mouth.x) * -mouth.dy + (y - mouth.y) * mouth.dx
            const meander = noise(along * .0015, mouth.x * .013 + mouth.y * .017) * Math.min(110, along * .2)
            const width = mouth.width + Math.min(28, along * .012)
            const bank = Math.abs(across - meander) - width
            const riverbed = Math.max(-6, bank * .6)
            h = Math.min(h, riverbed + h * smooth(4, 110, bank))
        }
        const boundary = field.heightAt(Math.max(MAP_MIN, Math.min(MAP_MAX, x)), Math.max(MAP_MIN, Math.min(MAP_MAX, y)))
        h = boundary + (h - boundary) * smooth(0, 200, distance)
        // 砦は平地に建ち、周りはなだらかに丘へつながる。戦場の縁で効果を弱め、内側の地形と段差なくつなぐ。
        for (const f of foundations) {
            const outside = Math.hypot(Math.max(f.minX - x, 0, x - f.maxX), Math.max(f.minY - y, 0, y - f.maxY))
            h += (f.height - h) * (1 - smooth(0, f.margin, outside)) * smooth(0, 16, distance)
        }
        return h
    }
    const heightAt = shape ? (x: number, y: number) => shape(x, y, baseHeightAt(x, y)) : baseHeightAt
    return { noise, inside, distanceOutside, heightAt,
        surfaceAt: (x: number, y: number) => inside(x, y)
            ? shape ? Math.max(0, shape(x, y, field.surfaceAt(x, y))) : field.surfaceAt(x, y)
            : Math.max(0, heightAt(x, y)),
    }
}
