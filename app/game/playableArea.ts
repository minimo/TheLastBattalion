import { GRID_MAX, TILE, TILE_PX, TILE_VARIANT } from './constants'
import type { Army, Fort, FortKind } from '../types/game'
import { fortDims, fortGroundAt, fortTileAt, localToGrid } from './fortLayout'
import { createHeightfield } from '../render/three/heightfield'
import { createLandscape, TERRAIN_CENTER } from '../render/three/landscape'

// Placement and navigation expand around the existing terrain and camera center.
/** 両軍の砦を置く戦場の広さ（砦はこの範囲の東西の端に置く）。 */
export const BATTLEFIELD_SIZE = 1400
export const BATTLEFIELD_MIN = TERRAIN_CENTER - BATTLEFIELD_SIZE / 2
export const BATTLEFIELD_MAX = TERRAIN_CENTER + BATTLEFIELD_SIZE / 2
const BATTLEFIELD_GRID_MIN = Math.ceil(BATTLEFIELD_MIN / TILE_PX)
const BATTLEFIELD_GRID_MAX = Math.floor(BATTLEFIELD_MAX / TILE_PX)
/** 部隊が動ける範囲。砦の背後の丘にも出られるよう、戦場より四方に広く取る。 */
export const PLAYABLE_SIZE = BATTLEFIELD_SIZE + 240 * 2
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

/** キャンプを戦場の端から内側へずらせる最大のマス数と、両軍の砦の中心どうしの目標の距離（px）。 */
const CAMP_MAX_INSET = 6
const TARGET_FORT_DISTANCE = 1050

type FortCandidate = FortSite & { score: number; x: number; y: number }

/**
 * 人間軍の砦を戦場の左側、魔王軍の砦を右側に置く（owners の軍の砦だけ）。地形は作り直さず、
 * 水がなく低く、正門から戦場へ出られる場所を選ぶ。キャンプは端から内側へずらすこともでき、
 * 両軍の砦が遠くなりすぎないよう、二つの場所を組にして選ぶ（中心どうしが TARGET_FORT_DISTANCE を超えるほど嫌う）。
 * 敷地の高低差が大きい場所（平らにすると周りが崖になる）と、正門の前（陣を敷く所）に川がある場所も嫌う。
 * 水のない場所が見つからなければ、水を強く嫌うだけにして選ぶ（敷地の水は埋め立てる）。
 */
export function placeForts(grid: number[][], owners: Army[] = ['player', 'cpu'], kind: FortKind = 'camp'): FortSite[] {
    const sides = ([
        { owner: 'player', kind, front: 1 },
        { owner: 'cpu', kind, front: -1 },
    ] as { owner: Army; kind: FortKind; front: 1 | -1 }[]).filter(side => owners.includes(side.owner))
    const reachable = floodLand(grid, Math.round(TERRAIN_CENTER / TILE_PX), Math.round(TERRAIN_CENTER / TILE_PX))
    const terrain = siteTerrain(grid)
    let candidates = sides.map(side => fortCandidates(side, terrain, reachable, false))
    if (candidates.some(list => !list.length)) candidates = sides.map(side => fortCandidates(side, terrain, reachable, true))
    candidates.forEach((list, i) => { if (!list.length) throw new Error(`No suitable site for the ${sides[i]!.owner} fort`) })
    const strip = ({ score: _score, x: _x, y: _y, ...site }: FortCandidate): FortSite => site
    if (candidates.length === 1) return [strip(candidates[0]!.reduce((a, b) => b.score < a.score ? b : a))]
    let best: [FortCandidate, FortCandidate] | undefined, bestScore = Infinity
    for (const a of candidates[0]!) for (const b of candidates[1]!) {
        const distance = Math.hypot(b.x - a.x, b.y - a.y)
        const score = a.score + b.score + Math.max(0, distance - TARGET_FORT_DISTANCE) / TILE_PX * 5
        if (score < bestScore) { bestScore = score; best = [a, b] }
    }
    return best!.map(strip)
}

/**
 * 砦の敷地の良さを素早く調べるための、マスごとの水と起伏の累積和。
 * sum(table, 矩形) で、グリッドの矩形の中の水のマス数・起伏の合計が定数時間で求まる。
 */
function siteTerrain(grid: number[][]) {
    const landscape = getPlayableLandscape(grid)
    const size = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN + 2
    const water = new Float64Array(size * size), rough = new Float64Array(size * size)
    const height = new Float64Array(size * size), height2 = new Float64Array(size * size)
    for (let j = 1; j < size; j++) for (let i = 1; i < size; i++) {
        const gx = PLAYABLE_GRID_MIN + i - 1, gy = PLAYABLE_GRID_MIN + j - 1
        const tile = getPlayableTile(grid, gx, gy)
        const wet = tile === TILE.WATER || tile === TILE.BRIDGE
        const value = wet ? 0 : (isLowland(tile) ? 0 : 1) + Math.max(0, landscape.heightAt(gx * TILE_PX, gy * TILE_PX) - 50) / 40
        const h = Math.max(0, landscape.heightAt(gx * TILE_PX, gy * TILE_PX))
        const k = j * size + i
        const accumulate = (table: Float64Array, v: number) => { table[k] = v + table[k - 1]! + table[k - size]! - table[k - size - 1]! }
        accumulate(water, wet ? 1 : 0)
        accumulate(rough, value)
        accumulate(height, h)
        accumulate(height2, h * h)
    }
    /** グリッドの矩形（両端を含む、戦場の範囲に切り詰める）の合計。 */
    const sum = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) => {
        const i0 = Math.max(1, x0 - PLAYABLE_GRID_MIN + 1), j0 = Math.max(1, y0 - PLAYABLE_GRID_MIN + 1)
        const i1 = Math.min(size - 1, x1 - PLAYABLE_GRID_MIN + 1), j1 = Math.min(size - 1, y1 - PLAYABLE_GRID_MIN + 1)
        if (i1 < i0 || j1 < j0) return 0
        return table[j1 * size + i1]! - table[(j0 - 1) * size + i1]! - table[j1 * size + i0 - 1]! + table[(j0 - 1) * size + i0 - 1]!
    }
    return { water, rough, height, height2, sum }
}

/** 片軍の砦を置ける場所と、その良さ（小さいほどよい）。 */
function fortCandidates(side: { owner: Army; kind: FortKind; front: 1 | -1 }, terrain: ReturnType<typeof siteTerrain>, reachable: Set<string>, allowWater: boolean): FortCandidate[] {
    const { kind } = side
    const { depth, width, front: marginFront, side: marginSide } = fortDims(kind)
    const centerGy = Math.round(TERRAIN_CENTER / TILE_PX) - Math.floor(width / 2)
    const span = BATTLEFIELD_GRID_MAX - BATTLEFIELD_GRID_MIN - width - 4
    const list: FortCandidate[] = []
    // 城は大きいので戦場の端に置く。キャンプは内側へずらしてもよい（少しだけ嫌う）。
    for (let inset = 0; inset <= (kind === 'camp' ? CAMP_MAX_INSET : 0); inset++) {
        const originGx = side.front === 1 ? BATTLEFIELD_GRID_MIN + inset : BATTLEFIELD_GRID_MAX - depth + 1 - inset
        for (let offset = 0; offset <= span; offset++) for (const sign of offset ? [-1, 1] : [1]) {
            const originGy = centerGy + offset * sign
            if (originGy - marginSide < BATTLEFIELD_GRID_MIN + 1 || originGy + width + marginSide > BATTLEFIELD_GRID_MAX - 1) continue
            const frame = { kind, front: side.front, originGx, originGy }
            // 敷地と正門前（ローカル -1〜depth+marginFront+2, -marginSide-1〜width+marginSide）の水と起伏。
            const a = localToGrid(frame, -1, -marginSide - 1), b = localToGrid(frame, depth + marginFront + 2, width + marginSide)
            const x0 = Math.min(a.gx, b.gx), x1 = Math.max(a.gx, b.gx), y0 = Math.min(a.gy, b.gy), y1 = Math.max(a.gy, b.gy)
            const water = terrain.sum(terrain.water, x0, y0, x1, y1)
            // キャンプは水のない場所に限る。大きな城は水を避けきれないこともあるので、水を強く嫌うだけにする。
            if (water && kind === 'camp' && !allowWater) continue
            const rough = terrain.sum(terrain.rough, x0, y0, x1, y1)
            // 敷地の高さのばらつき（標準偏差、px）。
            const cells = (x1 - x0 + 1) * (y1 - y0 + 1), mean = terrain.sum(terrain.height, x0, y0, x1, y1) / cells
            const spread = Math.sqrt(Math.max(0, terrain.sum(terrain.height2, x0, y0, x1, y1) / cells - mean * mean))
            // 正門の前（陣を敷く所）の川。
            const c = localToGrid(frame, depth + marginFront + 3, 0), d = localToGrid(frame, depth + marginFront + 12, width - 1)
            const frontWater = terrain.sum(terrain.water, Math.min(c.gx, d.gx), Math.min(c.gy, d.gy), Math.max(c.gx, d.gx), Math.max(c.gy, d.gy))
            const gate = localToGrid(frame, depth + marginFront + 1, Math.floor(width / 2) - 1)
            if (!reachable.has(`${gate.gx},${gate.gy}`)) continue
            const center = localToGrid(frame, (depth - 1) / 2, (width - 1) / 2)
            list.push({ ...side, originGx, originGy, score: rough + offset * .4 + inset * 1.5 + water * 50 + spread * 3 + frontWater * 4, x: center.gx * TILE_PX, y: center.gy * TILE_PX })
        }
    }
    return list
}

function floodLand(grid: number[][], centerX: number, centerY: number) {
    // 中心が川のこともあるので、中心に最も近い陸のマスから広げる。
    let startX = centerX, startY = centerY
    search: for (let ring = 0; ring < 40; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || getPlayableTile(grid, centerX + dx, centerY + dy) === TILE.WATER) continue
        startX = centerX + dx; startY = centerY + dy
        break search
    }
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
