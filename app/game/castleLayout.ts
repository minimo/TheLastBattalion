import type { Point } from '../types/game'

/**
 * 攻城戦・防衛戦で守り手が籠もる城。セル単位のローカル座標で定義する。
 * lx: 0(後方) → CASTLE_DEPTH-1(前面、敵側)、ly: 0 → CASTLE_WIDTH-1。
 * 岩山。周りを城壁と塔が一周して囲み、門は前面の正門ひとつ。斜面は家並みで、裏手には林もある。
 * 門を入った広場から、家並みの間を登る大通りと、城壁沿いを回って登る道の二筋が山を巻いて登り、
 * 頂の本陣を囲む前庭（テラス）へ出る。本陣の裏手には高い棟が建つ。
 */
export const CASTLE_DEPTH = 24
export const CASTLE_WIDTH = 28
/** 地形の置き換え（通行・平坦化）に使う、外周からの余白（セル）。 */
export const CASTLE_MARGIN = { back: 1, front: 3, side: 1 }
/** 岩山の頂（本陣の建つ岩盤）の、城壁の内側の地面からの高さ（px）。 */
export const CASTLE_SUMMIT = 64
/** 城の外周から、元の地形へなだらかにつなぐ幅（px）。 */
export const CASTLE_APRON = 60

const CX = (CASTLE_DEPTH - 1) / 2
const CY = (CASTLE_WIDTH - 1) / 2
/** 岩山の輪郭の基準の楕円の半径（セル）。輪郭は向きによって少し出入りする（castleOutline）。 */
const RX = 11.4
const RY = 13.3
const deg = (d: number) => d * Math.PI / 180

/**
 * 正規化半径での区分。keep: 本陣の岩盤、terrace: 本陣を囲む前庭（|向き| < terraceArc）、
 * 本陣の裏手（|向き| >= backArc、keepGrounds 以内）は本陣の棟が建つ敷地。それより外の斜面は家並みで、裏手には林（grove）が混じる。
 */
export const CASTLE_BANDS = { keep: .22, terrace: .36, keepGrounds: .5, backArc: deg(124), terraceArc: deg(118) }
/** 正門（前面）の幅の半分（セル）と、門を入った広場の広さ。 */
const FRONT_GATE_HALF = 1.5
const SQUARE = { r: .72, arc: deg(26) }

/** ローカル座標の、基準の楕円での正規化半径。 */
export function castleRadius(lx: number, ly: number) {
    return Math.hypot((lx - CX) / RX, (ly - CY) / RY)
}

/** ローカル座標の、城の中心から見た向き（前面が0）。 */
export function castleAngle(lx: number, ly: number) {
    return Math.atan2((ly - CY) / RY, (lx - CX) / RX)
}

/** 正規化半径・向きの点のローカル座標。 */
export function castlePoint(r: number, angle: number) {
    return { lx: CX + Math.cos(angle) * r * RX, ly: CY + Math.sin(angle) * r * RY }
}

/** 岩山の輪郭（向きごとの正規化半径）。自然な島の形になるよう、楕円から少し出入りさせる。 */
export function castleOutline(angle: number) {
    return 1 + .035 * Math.sin(angle * 3 + .7) + .025 * Math.sin(angle * 5 + 2.1)
}

/**
 * 登り道（ローカルセルの折れ線）と道幅の半分。
 * 大通りは正門の広場から左手へ家並みの間を巻いて登り、もう一筋は右手の城壁沿いをしばらく回ってから登る。
 */
const route = (count: number, at: (s: number) => { r: number; angle: number }) =>
    Array.from({ length: count + 1 }, (_, i) => { const p = at(i / count); return castlePoint(p.r, p.angle) })
const ROUTES = [
    { half: 1.3, points: route(60, s => ({ angle: deg(12 + 90 * s), r: .8 - .49 * Math.pow(s, .85) })) },
    { half: 1.3, points: route(60, s => ({ angle: -deg(12 + 90 * s), r: s < .45 ? .8 : .8 - .49 * (s - .45) / .55 })) },
]
/** 登り道の中心線（描画用、ローカルセル）。 */
export const CASTLE_ROUTES = ROUTES.map(r => r.points)

const segmentDistance = (p: { lx: number; ly: number }, a: { lx: number; ly: number }, b: { lx: number; ly: number }) => {
    const dx = b.lx - a.lx, dy = b.ly - a.ly
    const t = Math.max(0, Math.min(1, ((p.lx - a.lx) * dx + (p.ly - a.ly) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(p.lx - a.lx - dx * t, p.ly - a.ly - dy * t)
}
const onRoute = (lx: number, ly: number) => ROUTES.some(({ half, points }) =>
    points.some((a, i) => i > 0 && segmentDistance({ lx, ly }, points[i - 1]!, a) < half))

export type CastleCell = 'outside' | 'rampart' | 'gate' | 'street' | 'house' | 'grove' | 'terrace' | 'keep'

const inside = (lx: number, ly: number) => castleRadius(lx, ly) <= castleOutline(castleAngle(lx, ly))

function classify(lx: number, ly: number): CastleCell {
    if (!inside(lx, ly)) return 'outside'
    const r = castleRadius(lx, ly), angle = castleAngle(lx, ly), side = Math.abs(angle)
    // 輪郭のマス（内側にあり、8近傍のどれかが外側）。4連結の輪になり、斜めにすり抜けられない。
    let edge = false
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!inside(lx + dx, ly + dy)) { edge = true; break }
    if (edge) {
        if (lx > CX && Math.abs(ly - CY) <= FRONT_GATE_HALF) return 'gate'
        return 'rampart'
    }
    if (r < CASTLE_BANDS.keep) return 'keep'
    if (r < CASTLE_BANDS.terrace && side < CASTLE_BANDS.terraceArc) return 'terrace'
    if (r > SQUARE.r && side < SQUARE.arc) return 'street'
    if (onRoute(lx, ly)) return 'street'
    if (side >= CASTLE_BANDS.backArc) {
        // 本陣の裏手の敷地と、裏手の斜面に混じる林（マスごとに決まった並び）。
        if (r < CASTLE_BANDS.keepGrounds) return 'grove'
        const hash = ((Math.sin(lx * 12.9898 + ly * 78.233) * 43758.5453) % 1 + 1) % 1
        if (hash < .3) return 'grove'
    }
    return 'house'
}

const CELLS: CastleCell[][] = Array.from({ length: CASTLE_DEPTH }, (_, lx) => Array.from({ length: CASTLE_WIDTH }, (_, ly) => classify(lx, ly)))

export function castleCell(lx: number, ly: number): CastleCell {
    return CELLS[lx]?.[ly] ?? 'outside'
}

export const isCastleBlocked = (cell: CastleCell) => cell === 'rampart' || cell === 'keep' || cell === 'house' || cell === 'grove'

/**
 * 岩山の高さ（城壁の内側の地面から、px）。裾はなだらかで、頂へ向かうほど切り立つ。
 * 正規化半径で決めるので、ゲームの坂（移動の遅さ）と描画の地形で共有する。
 */
export function castleRise(lx: number, ly: number) {
    const t = Math.max(0, Math.min(1, (castleRadius(lx, ly) - .25) / .67))
    return CASTLE_SUMMIT * Math.pow(1 - t, 1.6)
}

/**
 * 地形の高さ h を、城の地形に置き換える。輪郭の内側は城の地面（ground）＋岩山、
 * 外側は CASTLE_APRON の幅で元の地形へなだらかにつなぐ。
 */
export function shapeCastleGround(lx: number, ly: number, ground: number, h: number) {
    const over = castleRadius(lx, ly) - castleOutline(castleAngle(lx, ly))
    if (over <= 0) return ground + castleRise(lx, ly)
    const t = Math.max(0, Math.min(1, over * (RX + RY) / 2 * 16 / CASTLE_APRON))
    return h + (ground - h) * (1 - t * t * (3 - 2 * t))
}

/** 地点に最も近い、条件を満たすマス。 */
function nearestCell(target: { lx: number; ly: number }, accept: (cell: CastleCell, lx: number, ly: number) => boolean): [number, number] {
    let best: [number, number] = [Math.round(target.lx), Math.round(target.ly)], bestDistance = Infinity
    for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
        if (!accept(castleCell(lx, ly), lx, ly)) continue
        const d = Math.hypot(lx - target.lx, ly - target.ly)
        if (d < bestDistance) { bestDistance = d; best = [lx, ly] }
    }
    return best
}

const square = (cell: CastleCell, lx: number, ly: number) => cell === 'street' && castleRadius(lx, ly) > SQUARE.r && Math.abs(castleAngle(lx, ly)) < SQUARE.arc

/** 本陣を囲む攻撃地点（＝退却・補給の集合地点）。頂の前庭の上。 */
export const CASTLE_ASSAULT_CELLS = [-100, -70, -40, -12, 12, 40, 70, 100].map(d => nearestCell(castlePoint(.285, deg(d)), cell => cell === 'terrace'))
/** 城壁の塔（射撃する）。正門の両脇と、城壁に沿って一周。 */
export const CASTLE_TOWER_ANGLES = [24, -24, 58, -58, 92, -92, 126, -126, 160, -160]
export const CASTLE_TOWER_CELLS = CASTLE_TOWER_ANGLES.map(d => nearestCell(castlePoint(castleOutline(deg(d)) * .97, deg(d)), cell => cell === 'rampart'))
/** 増援は正門の内側の広場から出撃する。 */
export const CASTLE_FOOT_SPAWN_CELLS = [6, -6, 14, -14, 20, -20].map(d => nearestCell(castlePoint(.8, deg(d)), square))
export const CASTLE_MOUNTED_SPAWN_CELLS = [0, 10, -10].map(d => nearestCell(castlePoint(.86, deg(d)), square))
/** 本陣の中心と、正門の外側（ローカルセル）。 */
export const CASTLE_CORE: Point = { x: CX, y: CY }
export const CASTLE_FRONT_GATE: Point = { x: CASTLE_DEPTH + .5, y: CY }
/** 本陣の岩盤の半径（px）。前庭から本陣に取り付けば攻撃できる。 */
export const CASTLE_CORE_RADIUS = 50
/** 正門の幅の半分（セル）。描画用。 */
export const CASTLE_GATE_HALF = FRONT_GATE_HALF
/** 基準の楕円の半径（ローカルセル）。描画用。 */
export const CASTLE_RADII = { x: RX, y: RY }
