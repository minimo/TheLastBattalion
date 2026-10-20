import { GRID_MAX, TILE, TILE_PX, TILE_VARIANT } from './constants'
import type { Army, Fort, FortKind } from '../types/game'
import { fortDims, fortGroundAt, fortTileAt, localToGrid } from './fortLayout'
import { createHeightfield } from '../render/three/heightfield'
import { createLandscape, TERRAIN_CENTER } from '../render/three/landscape'

// Placement and navigation expand around the existing terrain and camera center.
export const PLAYABLE_SIZE = 1400
export const PLAYABLE_MIN = TERRAIN_CENTER - PLAYABLE_SIZE / 2
export const PLAYABLE_MAX = TERRAIN_CENTER + PLAYABLE_SIZE / 2
export const PLAYABLE_GRID_MIN = Math.ceil(PLAYABLE_MIN / TILE_PX)
export const PLAYABLE_GRID_MAX = Math.floor(PLAYABLE_MAX / TILE_PX)

const landscapes = new WeakMap<number[][], ReturnType<typeof createLandscape>>()
const outsideTiles = new WeakMap<number[][], Map<string, number>>()
const cellHeights = new WeakMap<number[][], Map<number, number>>()
type FortFrame = Pick<Fort, 'kind' | 'front' | 'originGx' | 'originGy'> & { groundHeight?: number }
const fortFrames = new WeakMap<number[][], FortFrame[]>()
/** 工兵の建設物で置き換えたマス（完成した柵 = WALL、橋 = BRIDGE）。元の地形より優先する。 */
const constructionTiles = new WeakMap<number[][], Map<number, number>>()
const cellKey = (gx: number, gy: number) => (gy + 4096) * 8192 + gx + 4096

/** 建設物が完成・破壊されたときに、マスの地形を置き換える（undefinedで元に戻す）。 */
export function setConstructionTile(grid: number[][], gx: number, gy: number, tile: number | undefined) {
    let tiles = constructionTiles.get(grid)
    if (!tiles) constructionTiles.set(grid, tiles = new Map())
    if (tile === undefined) tiles.delete(cellKey(gx, gy))
    else tiles.set(cellKey(gx, gy), tile)
}

export function getConstructionTile(grid: number[][], gx: number, gy: number): number | undefined {
    return constructionTiles.get(grid)?.get(cellKey(gx, gy))
}

export function clearConstructionTiles(grid: number[][]) {
    constructionTiles.delete(grid)
}

/** 砦の敷地では地形を置き換える: 柵は通行不可、それ以外は平地（高さは砦の地面にそろう）。 */
export function registerForts(grid: number[][], forts: FortFrame[]) {
    fortFrames.set(grid, forts.map(({ kind, front, originGx, originGy, groundHeight }) => ({ kind, front, originGx, originGy, groundHeight })))
    cellHeights.delete(grid)
}

export function getPlayableLandscape(grid: number[][]) {
    let landscape = landscapes.get(grid)
    if (!landscape) {
        landscape = createLandscape(grid, createHeightfield(grid, []))
        landscapes.set(grid, landscape)
    }
    return landscape
}

/** Keep the existing tiles, and sample the visible landscape beyond their edges. */
export function getPlayableTile(grid: number[][], gx: number, gy: number): number {
    return constructionTiles.get(grid)?.get(cellKey(gx, gy)) ?? getTerrainTile(grid, gx, gy)
}

/** 建設物による置き換えを除いた、元の地形のマス。 */
export function getTerrainTile(grid: number[][], gx: number, gy: number): number {
    const forts = fortFrames.get(grid)
    if (forts) for (const fort of forts) {
        const tile = fortTileAt(fort, gx, gy)
        if (tile) return tile === 'wall' ? TILE.WALL : TILE.GRASS
    }
    let tiles = outsideTiles.get(grid)
    if (!tiles) {
        tiles = new Map()
        outsideTiles.set(grid, tiles)
    }
    const key = `${gx},${gy}`
    const cached = tiles.get(key)
    if (cached !== undefined) return cached
    const landscape = getPlayableLandscape(grid)
    if (gx >= 0 && gx <= GRID_MAX && gy >= 0 && gy <= GRID_MAX) {
        let tile = grid[gy]?.[gx] ?? TILE.GRASS
        // なめらかにした川岸では、陸のマスが水面より低くなることがある。兵が描画上の水の中に立たないよう水として扱う。
        // 橋の隣のマスは元のままにして、渡れなくならないようにする。
        const nearBridge = [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => grid[gy + dy]?.[gx + dx] === TILE.BRIDGE))
        const x = gx * TILE_PX, y = gy * TILE_PX
        const sunken = [[0, 0], [-6, -6], [-6, 6], [6, -6], [6, 6]].some(([dx, dy]) => landscape.heightAt(x + dx!, y + dy!) <= .3)
        if (tile !== TILE.WATER && tile !== TILE.BRIDGE && !nearBridge && sunken) tile = TILE.WATER
        tiles.set(key, tile)
        return tile
    }
    const x = gx * TILE_PX, y = gy * TILE_PX
    const height = landscape.heightAt(x, y)
    // Include cell corners so routes keep a little clearance from the riverbank.
    const touchesWater = [[0, 0], [-8, -8], [-8, 8], [8, -8], [8, 8]]
        .some(([dx, dy]) => landscape.heightAt(x + dx!, y + dy!) <= 0)
    const tile = touchesWater ? TILE.WATER : height >= 130 ? TILE_VARIANT.HIGH_MOUNTAIN_MIN
        : height >= 72 ? TILE_VARIANT.LOW_MOUNTAIN_MIN : TILE.GRASS
    tiles.set(key, tile)
    return tile
}

/** マス中心の地面の高さ（移動コストの勾配に使う）。砦の敷地は平坦化した地面（城は岩山）の高さ。 */
export function getCellHeight(grid: number[][], gx: number, gy: number): number {
    let heights = cellHeights.get(grid)
    if (!heights) {
        heights = new Map()
        cellHeights.set(grid, heights)
    }
    const key = (gy + 4096) * 8192 + gx + 4096
    const cached = heights.get(key)
    if (cached !== undefined) return cached
    let height = Math.max(0, getPlayableLandscape(grid).heightAt(gx * TILE_PX, gy * TILE_PX))
    const forts = fortFrames.get(grid)
    if (forts) for (const fort of forts) {
        const shaped = fort.groundHeight === undefined ? undefined : fortGroundAt(fort, gx * TILE_PX, gy * TILE_PX, fort.groundHeight, height)
        if (shaped !== undefined) { height = shaped; break }
    }
    heights.set(key, height)
    return height
}

export type FortSite = { owner: Army; kind: FortKind; front: 1 | -1; originGx: number; originGy: number }

const isLowland = (tile: number) => tile !== TILE.WATER && tile !== TILE.BRIDGE
    && !(tile === TILE.MOUNTAIN || tile >= TILE_VARIANT.LOW_MOUNTAIN_MIN && tile <= TILE_VARIANT.HIGH_MOUNTAIN_MAX)

/**
 * 人間軍の砦を戦場の左端、モンスター軍の砦を右端に置く（owners の軍の砦だけ）。地形は作り直さず、
 * 端に沿って砦をずらし、水がなく低く、正門から戦場へ出られる場所を選ぶ。
 */
export function placeForts(grid: number[][], owners: Army[] = ['player', 'cpu'], kind: FortKind = 'camp'): FortSite[] {
    const landscape = getPlayableLandscape(grid)
    const { depth, width, front: marginFront, side: marginSide } = fortDims(kind)
    const centerGy = Math.round(TERRAIN_CENTER / TILE_PX) - Math.floor(width / 2)
    const sides = ([
        { owner: 'player', kind, front: 1, originGx: PLAYABLE_GRID_MIN },
        { owner: 'cpu', kind, front: -1, originGx: PLAYABLE_GRID_MAX - depth + 1 },
    ] as { owner: Army; kind: FortKind; front: 1 | -1; originGx: number }[]).filter(side => owners.includes(side.owner))
    const reachable = floodLand(grid, Math.round(TERRAIN_CENTER / TILE_PX), Math.round(TERRAIN_CENTER / TILE_PX))
    return sides.map(side => {
        let best: { originGy: number; score: number } | undefined
        const span = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN - width - 4
        for (let offset = 0; offset <= span; offset++) for (const sign of offset ? [-1, 1] : [1]) {
            const originGy = centerGy + offset * sign
            if (originGy - marginSide < PLAYABLE_GRID_MIN + 1 || originGy + width + marginSide > PLAYABLE_GRID_MAX - 1) continue
            const frame = { kind, front: side.front, originGx: side.originGx, originGy }
            let water = 0, rough = 0
            for (let ly = -marginSide - 1; ly <= width + marginSide && (kind === 'castle' || !water); ly++) {
                for (let lx = -1; lx <= depth + marginFront + 2; lx++) {
                    const { gx, gy } = localToGrid(frame, lx, ly)
                    const tile = getPlayableTile(grid, gx, gy)
                    if (tile === TILE.WATER || tile === TILE.BRIDGE) { water++; continue }
                    if (!isLowland(tile)) rough += 1
                    rough += Math.max(0, landscape.heightAt(gx * TILE_PX, gy * TILE_PX) - 50) / 40
                }
            }
            // キャンプは水のない場所に限る。大きな城は水を避けきれないこともあるので、水を強く嫌うだけにする（敷地の水は埋め立てる）。
            if (water && kind === 'camp') continue
            const gate = localToGrid(frame, depth + marginFront + 1, Math.floor(width / 2) - 1)
            if (!reachable.has(`${gate.gx},${gate.gy}`)) continue
            const score = rough + offset * .4 + water * 50
            if (!best || score < best.score) best = { originGy, score }
        }
        if (!best) throw new Error(`No suitable site for the ${side.owner} fort`)
        return { ...side, originGy: best.originGy }
    })
}

function floodLand(grid: number[][], startX: number, startY: number) {
    const reachable = new Set<string>([`${startX},${startY}`])
    const queue = [{ x: startX, y: startY }]
    for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]!
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx!, ny = y + dy!
            if (nx < PLAYABLE_GRID_MIN || nx > PLAYABLE_GRID_MAX || ny < PLAYABLE_GRID_MIN || ny > PLAYABLE_GRID_MAX) continue
            const key = `${nx},${ny}`
            if (reachable.has(key) || getPlayableTile(grid, nx, ny) === TILE.WATER) continue
            reachable.add(key)
            queue.push({ x: nx, y: ny })
        }
    }
    return reachable
}
