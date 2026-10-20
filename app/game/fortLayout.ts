import { TILE_PX } from './constants'
import type { Fort, FortKind, Point } from '../types/game'
import {
    CASTLE_ASSAULT_CELLS, CASTLE_CORE, CASTLE_DEPTH, CASTLE_FOOT_SPAWN_CELLS, CASTLE_FRONT_GATE, CASTLE_MARGIN, CASTLE_MOUNTED_SPAWN_CELLS,
    CASTLE_TOWER_CELLS, CASTLE_WIDTH, castleCell, isCastleBlocked, shapeCastleGround,
} from './castleLayout'

/**
 * 砦はベースキャンプ型の陣地。セル単位のローカル座標で定義する。
 * lx: 0(後方) → FORT_DEPTH-1(前面、敵側)、ly: 0 → FORT_WIDTH-1。
 * 外周は柵で囲み、前面に正門、左右に通用門を設ける。
 */
export const FORT_DEPTH = 12
export const FORT_WIDTH = 16
/** 正門前のバリケード列（柵の外側）。 */
export const BARRICADE_LX = FORT_DEPTH + 1
/** 地形の平坦化・景観の除外に使う、外周からの余白（セル）。 */
export const FORT_MARGIN_BACK = 1
export const FORT_MARGIN_FRONT = 3
export const FORT_MARGIN_SIDE = 1

export type StructureKind = 'command' | 'barracks' | 'stable' | 'range' | 'depot' | 'tower' | 'gateTower' | 'barricade' | 'campfire' | 'well' | 'rack'

export interface FortStructure {
    kind: StructureKind
    lx: number
    ly: number
    w: number
    h: number
    blocking: boolean
}

const FRONT_GATE = [7, 8]
const SIDE_GATE = [5, 6]

export const FORT_STRUCTURES: FortStructure[] = [
    { kind: 'command', lx: 2, ly: 7, w: 2, h: 2, blocking: true },
    { kind: 'barracks', lx: 2, ly: 2, w: 2, h: 3, blocking: true },
    { kind: 'barracks', lx: 2, ly: 11, w: 2, h: 3, blocking: true },
    { kind: 'stable', lx: 6, ly: 2, w: 3, h: 2, blocking: true },
    { kind: 'range', lx: 6, ly: 12, w: 3, h: 2, blocking: true },
    { kind: 'depot', lx: 5, ly: 5, w: 1, h: 1, blocking: true },
    { kind: 'depot', lx: 5, ly: 10, w: 1, h: 1, blocking: true },
    { kind: 'well', lx: 1, ly: 4, w: 1, h: 1, blocking: true },
    { kind: 'rack', lx: 1, ly: 11, w: 1, h: 1, blocking: true },
    { kind: 'campfire', lx: 9, ly: 4, w: 1, h: 1, blocking: false },
    { kind: 'campfire', lx: 9, ly: 11, w: 1, h: 1, blocking: false },
    { kind: 'campfire', lx: 4, ly: 1, w: 1, h: 1, blocking: false },
    { kind: 'campfire', lx: 4, ly: 14, w: 1, h: 1, blocking: false },
    // 四隅の物見櫓と正門の櫓は柵の上に立つ。
    { kind: 'tower', lx: 0, ly: 0, w: 1, h: 1, blocking: true },
    { kind: 'tower', lx: 0, ly: FORT_WIDTH - 1, w: 1, h: 1, blocking: true },
    { kind: 'tower', lx: FORT_DEPTH - 1, ly: 0, w: 1, h: 1, blocking: true },
    { kind: 'tower', lx: FORT_DEPTH - 1, ly: FORT_WIDTH - 1, w: 1, h: 1, blocking: true },
    { kind: 'gateTower', lx: FORT_DEPTH - 1, ly: FRONT_GATE[0]! - 1, w: 1, h: 1, blocking: true },
    { kind: 'gateTower', lx: FORT_DEPTH - 1, ly: FRONT_GATE[1]! + 1, w: 1, h: 1, blocking: true },
    // 正門前のバリケード。中央の進入路は空けておく。
    { kind: 'barricade', lx: BARRICADE_LX, ly: 1, w: 1, h: 5, blocking: true },
    { kind: 'barricade', lx: BARRICADE_LX, ly: 10, w: 1, h: 5, blocking: true },
]

/** 本陣を囲む攻撃地点（ローカルセル）。 */
const ASSAULT_CELLS: [number, number][] = [[4, 7], [4, 8], [2, 6], [3, 6], [2, 9], [3, 9], [1, 7], [1, 8]]
/** 歩兵・弓兵は兵舎の前、騎兵は厩舎の前から出撃する。 */
export const FOOT_SPAWN_CELLS: [number, number][] = [[4, 2], [4, 3], [4, 4], [4, 11], [4, 12], [4, 13], [1, 3], [1, 12]]
export const MOUNTED_SPAWN_CELLS: [number, number][] = [[6, 4], [7, 4], [8, 4], [6, 11], [7, 11], [8, 11]]

export function isFortWallCell(lx: number, ly: number): boolean {
    const onRing = lx === 0 || lx === FORT_DEPTH - 1 || ly === 0 || ly === FORT_WIDTH - 1
    if (!onRing) return false
    if (lx === FORT_DEPTH - 1 && FRONT_GATE.includes(ly)) return false
    if ((ly === 0 || ly === FORT_WIDTH - 1) && SIDE_GATE.includes(lx)) return false
    return true
}

export function isGateCell(lx: number, ly: number): boolean {
    return (lx === FORT_DEPTH - 1 && FRONT_GATE.includes(ly)) || ((ly === 0 || ly === FORT_WIDTH - 1) && SIDE_GATE.includes(lx))
}

/** ローカルセルが通行不可か。 */
export function isBlockedLocal(lx: number, ly: number): boolean {
    if (isFortWallCell(lx, ly)) return true
    return FORT_STRUCTURES.some(s => s.blocking && lx >= s.lx && lx < s.lx + s.w && ly >= s.ly && ly < s.ly + s.h)
}

export type FortFrame = Pick<Fort, 'kind' | 'front' | 'originGx' | 'originGy'>

/** 砦の種類ごとの大きさ（セル）と、地形を置き換える外周からの余白。 */
export function fortDims(kind: FortKind) {
    return kind === 'castle'
        ? { depth: CASTLE_DEPTH, width: CASTLE_WIDTH, back: CASTLE_MARGIN.back, front: CASTLE_MARGIN.front, side: CASTLE_MARGIN.side }
        : { depth: FORT_DEPTH, width: FORT_WIDTH, back: FORT_MARGIN_BACK, front: FORT_MARGIN_FRONT, side: FORT_MARGIN_SIDE }
}

/** ローカルセル → ワールドのグリッドセル。モンスター側は180度回転させて配置する。 */
export function localToGrid(fort: FortFrame, lx: number, ly: number) {
    const { depth, width } = fortDims(fort.kind)
    return fort.front === 1
        ? { gx: fort.originGx + lx, gy: fort.originGy + ly }
        : { gx: fort.originGx + depth - 1 - lx, gy: fort.originGy + width - 1 - ly }
}

/** ワールドのグリッドセル（小数可）→ ローカルセル。 */
export function gridToLocal(fort: FortFrame, gx: number, gy: number) {
    const { depth, width } = fortDims(fort.kind)
    return fort.front === 1
        ? { lx: gx - fort.originGx, ly: gy - fort.originGy }
        : { lx: fort.originGx + depth - 1 - gx, ly: fort.originGy + width - 1 - gy }
}

/** ローカル座標（セル単位、小数可）→ ワールド座標。 */
export function localToWorld(fort: FortFrame, lx: number, ly: number): Point {
    const { gx, gy } = localToGrid(fort, lx, ly)
    return { x: gx * TILE_PX, y: gy * TILE_PX }
}

export function fortCenter(fort: FortFrame): Point {
    const { depth, width } = fortDims(fort.kind)
    return localToWorld(fort, (depth - 1) / 2, (width - 1) / 2)
}

/** 平坦化する範囲（ワールド座標の矩形）。 */
export function fortFootprint(fort: FortFrame) {
    const { depth, width, back, front, side } = fortDims(fort.kind)
    const a = localToWorld(fort, -back - .5, -side - .5)
    const b = localToWorld(fort, depth - .5 + front, width - .5 + side)
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) }
}

/** 砦の範囲に含まれるワールドセルなら、そのタイル（壁 or 草地）を返す。 */
export function fortTileAt(fort: FortFrame, gx: number, gy: number): 'wall' | 'open' | undefined {
    const { lx, ly } = gridToLocal(fort, gx, gy)
    const { depth, width, back, front, side } = fortDims(fort.kind)
    if (lx < -back || lx > depth - 1 + front || ly < -side || ly > width - 1 + side) return undefined
    if (fort.kind === 'castle') return isCastleBlocked(castleCell(lx, ly)) ? 'wall' : 'open'
    return isBlockedLocal(lx, ly) ? 'wall' : 'open'
}

/**
 * 砦の地面の高さ。キャンプは平坦（ground）。城は岩山と、周りのなだらかなつなぎ（範囲外でもつなぎの幅までは h を城の地面へ寄せる）。
 * 砦の範囲外で地形を変えなければ undefined。
 */
export function fortGroundAt(fort: FortFrame, x: number, y: number, ground: number, h: number): number | undefined {
    const { lx, ly } = gridToLocal(fort, x / TILE_PX, y / TILE_PX)
    if (fort.kind === 'castle') return shapeCastleGround(lx, ly, ground, h)
    return fortTileAt(fort, Math.round(x / TILE_PX), Math.round(y / TILE_PX)) ? ground : undefined
}

export function createFortGeometry(fort: FortFrame) {
    const toWorld = ([lx, ly]: [number, number]) => localToWorld(fort, lx, ly)
    if (fort.kind === 'castle') {
        return {
            core: localToWorld(fort, CASTLE_CORE.x, CASTLE_CORE.y),
            assaultPoints: CASTLE_ASSAULT_CELLS.map(toWorld),
            towers: CASTLE_TOWER_CELLS.map(toWorld),
            footSpawns: CASTLE_FOOT_SPAWN_CELLS.map(toWorld),
            mountedSpawns: CASTLE_MOUNTED_SPAWN_CELLS.map(toWorld),
            frontGate: localToWorld(fort, CASTLE_FRONT_GATE.x, CASTLE_FRONT_GATE.y),
        }
    }
    const command = FORT_STRUCTURES.find(s => s.kind === 'command')!
    return {
        core: localToWorld(fort, command.lx + (command.w - 1) / 2, command.ly + (command.h - 1) / 2),
        assaultPoints: ASSAULT_CELLS.map(toWorld),
        towers: FORT_STRUCTURES.filter(s => s.kind === 'tower' || s.kind === 'gateTower').map(s => localToWorld(fort, s.lx, s.ly)),
        footSpawns: FOOT_SPAWN_CELLS.map(toWorld),
        mountedSpawns: MOUNTED_SPAWN_CELLS.map(toWorld),
        /** 正門の外側。出撃した兵がまず目指す地点。 */
        frontGate: localToWorld(fort, FORT_DEPTH + .5, 7.5),
    }
}
