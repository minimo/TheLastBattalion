import { TILE_PX } from './constants'
import type { Fort, FortKind, Point } from '../types/game'
import {
    CASTLE_ASSAULT_CELLS, CASTLE_CORE, CASTLE_DEPTH, CASTLE_FOOT_SPAWN_CELLS, CASTLE_FRONT_GATE, CASTLE_MARGIN, CASTLE_MOUNTED_SPAWN_CELLS,
    CASTLE_TOWER_CELLS, CASTLE_WIDTH, castleCellAt, castleGameCoord, isCastleBlocked, shapeCastleGroundAt,
} from './castleLayout'

/**
 * 砦はベースキャンプ型の陣地。セル単位のローカル座標で定義する。
 * lx: 0(後方) → FORT_DEPTH-1(前面、敵側)、ly: 0 → FORT_WIDTH-1。
 * 外周は柵で囲み、前面に正門、左右に通用門を設ける。
 * 広さは千人規模の野営地の実寸（約130m × 175m）。正門から本陣へ大通りが、左右の通用門の間を横の通りが通り、
 * 後ろ半分に兵舎が並ぶ。前半分の左に厩舎、右に射場と兵舎があり、正門の内側は出撃前に集まる広場。
 */
export const FORT_DEPTH = 36
export const FORT_WIDTH = 48
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

const MID = FORT_WIDTH / 2
/** 正門（前面の柵の ly）と通用門（左右の柵の lx）。 */
export const FRONT_GATE = [MID - 1, MID]
export const SIDE_GATE = [17, 18]
/** 左右を入れ替えた ly（h マスの施設の左端）。 */
const mirror = (ly: number, h: number) => FORT_WIDTH - ly - h
const structure = (kind: StructureKind, lx: number, ly: number, w: number, h: number, blocking = true): FortStructure => ({ kind, lx, ly, w, h, blocking })
/** 左右対称に置く施設。 */
const pair = (kind: StructureKind, lx: number, ly: number, w: number, h: number, blocking = true) =>
    [structure(kind, lx, ly, w, h, blocking), structure(kind, lx, mirror(ly, h), w, h, blocking)]

export const FORT_STRUCTURES: FortStructure[] = [
    structure('command', 2, MID - 2, 4, 4),
    // 後ろ半分の兵舎（左右に4列×5棟ずつ、間に1マスの路地）。
    ...[2, 5, 8, 11].flatMap(lx => [2, 6, 10, 14, 18].flatMap(ly => pair('barracks', lx, ly, 2, 3))),
    // 前半分: 左に厩舎、右に射場と兵舎。
    ...[20, 24].flatMap(lx => [2, 5, 8, 11, 14, 17].map(ly => structure('stable', lx, ly, 3, 2))),
    ...[2, 5, 8, 11, 14, 17].map(ly => structure('range', 20, mirror(ly, 2), 3, 2)),
    ...[2, 6, 10, 14].map(ly => structure('barracks', 24, mirror(ly, 3), 2, 3)),
    ...pair('depot', 14, 5, 1, 1), ...pair('depot', 14, 13, 1, 1), ...pair('depot', 14, 20, 1, 1),
    structure('well', 1, MID - 4, 1, 1),
    structure('rack', 1, MID + 3, 1, 1),
    ...pair('campfire', 17, 8, 1, 1, false), ...pair('campfire', 30, 10, 1, 1, false), ...pair('campfire', 14, 9, 1, 1, false),
    // 四隅と柵の途中の物見櫓、正門の櫓は柵の上に立つ。
    ...[0, FORT_DEPTH - 1].flatMap(lx => [0, 12, FORT_WIDTH - 13, FORT_WIDTH - 1].map(ly => structure('tower', lx, ly, 1, 1))),
    ...[0, FORT_WIDTH - 1].flatMap(ly => [9, 27].map(lx => structure('tower', lx, ly, 1, 1))),
    structure('gateTower', FORT_DEPTH - 1, FRONT_GATE[0]! - 1, 1, 1),
    structure('gateTower', FORT_DEPTH - 1, FRONT_GATE[1]! + 1, 1, 1),
    // 正門前のバリケード。中央の進入路は空けておく。
    ...pair('barricade', BARRICADE_LX, 2, 1, 6), ...pair('barricade', BARRICADE_LX, 10, 1, 8),
]

/** 本陣を囲む攻撃地点（ローカルセル）。本陣の後ろは柵なので、前と左右に置く。 */
const ASSAULT_CELLS: [number, number][] = [[6, MID - 1], [6, MID], [3, MID - 3], [4, MID - 3], [3, MID + 2], [4, MID + 2], [2, MID - 3], [2, MID + 2]]
/** 本陣の天幕の当たりの半径（px）。攻撃地点から天幕に取り付けば攻撃できる。 */
export const CAMP_CORE_RADIUS = 20
/** 歩兵・弓兵は横の通りの兵舎の前、騎兵は厩舎の前から出撃する。 */
export const FOOT_SPAWN_CELLS: [number, number][] = [4, 8, 12, 16].flatMap(ly => [[16, ly], [16, FORT_WIDTH - 1 - ly]] as [number, number][])
export const MOUNTED_SPAWN_CELLS: [number, number][] = [21, 22, 23, 25, 26, 27].map(lx => [lx, MID - 4])

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

/** ローカルセル → ワールドのグリッドセル。魔王軍側は180度回転させて配置する。 */
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

/** 砦の中の、柵や城壁ではない建物のマスか（兵は立てないが、中の部隊を分断しない）。 */
export function isFortBuildingCell(fort: FortFrame, gx: number, gy: number): boolean {
    const { lx, ly } = gridToLocal(fort, gx, gy)
    if (fort.kind === 'castle') {
        const cell = castleCellAt(lx, ly)
        return cell === 'house' || cell === 'keep' || cell === 'grove'
    }
    return FORT_STRUCTURES.some(s => s.blocking && s.kind !== 'tower' && s.kind !== 'gateTower' && s.kind !== 'barricade'
        && lx >= s.lx && lx < s.lx + s.w && ly >= s.ly && ly < s.ly + s.h)
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
    if (fort.kind === 'castle') return isCastleBlocked(castleCellAt(lx, ly)) ? 'wall' : 'open'
    return isBlockedLocal(lx, ly) ? 'wall' : 'open'
}

/** 森林で陣地の周りを伐採する幅（敷地の外側からのマス数）。 */
const CLEARING = 3

/** そのマスが、森林の陣地のごく近くの伐採地か。縁は少し不揃いにする。 */
export function inForestClearing(fort: FortFrame, gx: number, gy: number): boolean {
    const { lx, ly } = gridToLocal(fort, gx, gy)
    const { depth, width, back, front, side } = fortDims(fort.kind)
    const outside = Math.hypot(Math.max(-back - lx, lx - (depth - 1 + front), 0), Math.max(-side - ly, ly - (width - 1 + side), 0))
    return outside <= CLEARING + .5 * (Math.sin(gx * .7 + gy * 1.3) + Math.sin(gx * .31 - gy * .47))
}

/** キャンプの敷地の外で、元の地形へなだらかにつなぐ幅（px）。 */
const CAMP_APRON = 72

/**
 * 砦の地面の高さ。キャンプは敷地を平坦（ground）にし、外周の CAMP_APRON の幅で元の地形 h へつなぐ。
 * 城は岩山と、周りのなだらかなつなぎ。砦の範囲外で地形を変えなければ undefined。
 */
export function fortGroundAt(fort: FortFrame, x: number, y: number, ground: number, h: number): number | undefined {
    if (fort.kind === 'castle') {
        const { lx, ly } = gridToLocal(fort, x / TILE_PX, y / TILE_PX)
        return shapeCastleGroundAt(lx, ly, ground, h)
    }
    const area = fortFootprint(fort)
    const outside = Math.hypot(Math.max(area.minX - x, 0, x - area.maxX), Math.max(area.minY - y, 0, y - area.maxY))
    if (outside >= CAMP_APRON) return undefined
    const t = outside / CAMP_APRON
    return h + (ground - h) * (1 - t * t * (3 - 2 * t))
}

export function createFortGeometry(fort: FortFrame) {
    const toWorld = ([lx, ly]: [number, number]) => localToWorld(fort, lx, ly)
    if (fort.kind === 'castle') {
        // 城の地点は設計のマスで決めてあるので、ゲームのマスへ直す。
        const fromPlan = ([lx, ly]: [number, number]) => localToWorld(fort, castleGameCoord(lx), castleGameCoord(ly))
        return {
            core: fromPlan([CASTLE_CORE.x, CASTLE_CORE.y]),
            assaultPoints: CASTLE_ASSAULT_CELLS.map(fromPlan),
            towers: CASTLE_TOWER_CELLS.map(fromPlan),
            footSpawns: CASTLE_FOOT_SPAWN_CELLS.map(fromPlan),
            mountedSpawns: CASTLE_MOUNTED_SPAWN_CELLS.map(fromPlan),
            frontGate: fromPlan([CASTLE_FRONT_GATE.x, CASTLE_FRONT_GATE.y]),
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
        frontGate: localToWorld(fort, FORT_DEPTH + .5, MID - .5),
    }
}
