import { TILE, TILE_PX } from './constants'
import { BARRICADE_LENGTH, BRIDGE_MAX_LENGTH, OUTPOST_SIZE, fortVicinityOf } from './battleConfig'
import { fortTileAt } from './fortLayout'
import { getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { getTileCost } from './terrain'
import type { Army, Construction, ConstructionAxis, ConstructionKind, ConstructionPlan, Fort, FortCell, Point } from '../types/game'

/** 建設地を調べるのに要る戦場の状態。 */
interface Site { grid: number[][]; forts: Fort[]; constructions: Construction[] }

const key = (c: FortCell) => `${c.gx},${c.gy}`
export const cellPoint = (c: FortCell): Point => ({ x: c.gx * TILE_PX, y: c.gy * TILE_PX })
const insideGrid = (gx: number, gy: number) => gx > PLAYABLE_GRID_MIN && gx < PLAYABLE_GRID_MAX && gy > PLAYABLE_GRID_MIN && gy < PLAYABLE_GRID_MAX

/**
 * 工兵が建てる建設物の敷地を決め、建てられるかを調べる（建設の指示と、置く前の下見の両方で使う）。
 * - 拠点: 地点を中心とする7×7マス。外周は柵で、四方の真ん中が門。陸の上にしか建たない
 * - バリケード: 地点を中心に、axis の向きに5マス並ぶ柵。陸か橋の上に建つ
 * - 橋: 地点の近くの川を、最も短く渡れる向きに架ける幅2マスの橋
 */
export function planConstruction(site: Site, owner: Army, kind: ConstructionKind, point: Point, axis: ConstructionAxis = 'y'): ConstructionPlan {
    const occupied = new Set(site.constructions.flatMap(c => c.area.map(key)))
    const inFort = (gx: number, gy: number) => site.forts.some(f => fortTileAt(f, gx, gy) !== undefined)
    /** 他の建設物・砦と重ならず、戦場の内側にあるマス。 */
    const free = (gx: number, gy: number) => insideGrid(gx, gy) && !inFort(gx, gy) && !occupied.has(`${gx},${gy}`)
    const water = (gx: number, gy: number) => getPlayableTile(site.grid, gx, gy) === TILE.WATER
    /** 建物を建てられる陸地（川・柵でない）。 */
    const walkable = (gx: number, gy: number) => Number.isFinite(getTileCost(site.grid, gx, gy)) && !water(gx, gy)
    const cx = Math.round(point.x / TILE_PX), cy = Math.round(point.y / TILE_PX)
    const plan: ConstructionPlan = { kind, owner, axis, walls: [], deck: [], area: [], center: { x: cx * TILE_PX, y: cy * TILE_PX }, ends: [], valid: false, reason: '' }
    const fail = (reason: string) => { plan.valid = false; plan.reason = reason; return plan }

    if (kind === 'outpost') {
        const half = (OUTPOST_SIZE - 1) / 2
        for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
            const cell = { gx: cx + dx, gy: cy + dy }
            plan.area.push(cell)
            const ring = Math.max(Math.abs(dx), Math.abs(dy)) === half
            if (ring && dx !== 0 && dy !== 0) plan.walls.push(cell)
        }
        if (plan.area.some(c => !free(c.gx, c.gy))) return fail('他の建設物や砦と重なっています')
        if (plan.area.some(c => !walkable(c.gx, c.gy) || getPlayableTile(site.grid, c.gx, c.gy) === TILE.BRIDGE)) return fail('川や橋の上には建てられません')
        const enemy = site.forts.find(f => f.owner !== owner)
        if (enemy && Math.hypot(enemy.x - plan.center.x, enemy.y - plan.center.y) < fortVicinityOf(enemy.kind) + 60) return fail('敵陣に近すぎます')
        // 門の外へ出られること（四方のどこか1つでよい）。
        const gates = [[0, -half - 1], [0, half + 1], [-half - 1, 0], [half + 1, 0]] as const
        if (!gates.some(([dx, dy]) => walkable(cx + dx, cy + dy) && free(cx + dx, cy + dy))) return fail('門の外に出られません')
    } else if (kind === 'barricade') {
        const half = Math.floor(BARRICADE_LENGTH / 2)
        for (let t = -half; t <= half; t++) {
            const cell = axis === 'y' ? { gx: cx, gy: cy + t } : { gx: cx + t, gy: cy }
            plan.area.push(cell); plan.walls.push(cell)
        }
        if (plan.area.some(c => !free(c.gx, c.gy))) return fail('他の建設物や砦と重なっています')
        if (plan.area.some(c => !walkable(c.gx, c.gy))) return fail('川の上には建てられません')
    } else {
        // 指した地点の近くの水のマスから、縦横それぞれに向こう岸まで伸ばし、短い方を選ぶ。
        let start: FortCell | undefined
        for (let r = 0; r <= 2 && !start; r++) {
            let best = Infinity
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                const gx = cx + dx, gy = cy + dy
                if (!water(gx, gy) || !free(gx, gy)) continue
                const d = Math.hypot(gx * TILE_PX - point.x, gy * TILE_PX - point.y)
                if (d < best) { best = d; start = { gx, gy } }
            }
        }
        if (!start) return fail('川の上を選んでください')
        const s = start
        const bank = (gx: number, gy: number) => walkable(gx, gy) && free(gx, gy)
        let best: { axis: ConstructionAxis; from: number; to: number } | undefined
        for (const dir of ['x', 'y'] as const) {
            const step = (t: number) => dir === 'x' ? { gx: s.gx + t, gy: s.gy } : { gx: s.gx, gy: s.gy + t }
            let to = 0, from = 0
            while (to <= BRIDGE_MAX_LENGTH && water(step(to + 1).gx, step(to + 1).gy)) to++
            while (from >= -BRIDGE_MAX_LENGTH && water(step(from - 1).gx, step(from - 1).gy)) from--
            const a = step(from - 1), b = step(to + 1)
            if (to - from + 1 > BRIDGE_MAX_LENGTH || !bank(a.gx, a.gy) || !bank(b.gx, b.gy)) continue
            let clear = true
            for (let t = from; t <= to && clear; t++) clear = free(step(t).gx, step(t).gy)
            if (!clear) continue
            if (!best || to - from < best.to - best.from) best = { axis: dir, from, to }
        }
        if (!best) {
            plan.area = plan.deck = [s]
            plan.center = cellPoint(s)
            return fail('向こう岸が遠すぎるか、岸に降りられません')
        }
        plan.axis = best.axis
        const along = best.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 }, across = { x: along.y, y: along.x }
        const cell = (t: number, side: number) => ({ gx: s.gx + along.x * t + across.x * side, gy: s.gy + along.y * t + across.y * side })
        // 2列目は、川の中か渡れる陸地で、ほかと重ならない側に付ける。
        let second = 0
        for (const side of [1, -1]) {
            let ok = true
            for (let t = best.from; t <= best.to && ok; t++) {
                const c = cell(t, side)
                ok = free(c.gx, c.gy) && (water(c.gx, c.gy) || walkable(c.gx, c.gy))
            }
            if (ok) { second = side; break }
        }
        for (const side of second ? [0, second] : [0]) for (let t = best.from; t <= best.to; t++) {
            const c = cell(t, side)
            if (water(c.gx, c.gy)) plan.deck.push(c)
        }
        plan.area = [...plan.deck]
        const shift = second * TILE_PX / 2
        const end = (t: number) => ({ x: cell(t, 0).gx * TILE_PX + across.x * shift, y: cell(t, 0).gy * TILE_PX + across.y * shift })
        plan.ends = [end(best.from - 1), end(best.to + 1)]
        plan.center = { x: (plan.ends[0]!.x + plan.ends[1]!.x) / 2, y: (plan.ends[0]!.y + plan.ends[1]!.y) / 2 }
    }
    plan.valid = true
    return plan
}

/**
 * 工兵が立って作業する地点・そこへ向かう経路の目的地・拠点の内側の地点を決める。
 * 橋は工兵がいる側の岸で作業する。
 */
export function constructionWorkSite(plan: ConstructionPlan, builder: Point, passable: (x: number, y: number) => boolean) {
    const walls = new Set([...plan.walls, ...plan.deck].map(key))
    const open = (p: Point) => passable(p.x, p.y) && !walls.has(`${Math.round(p.x / TILE_PX)},${Math.round(p.y / TILE_PX)}`)
    const workPoints: Point[] = []
    const interior: Point[] = []
    let approach = plan.center
    if (plan.kind === 'outpost') {
        const half = (OUTPOST_SIZE - 1) / 2 - 1
        for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) interior.push({ x: plan.center.x + dx * TILE_PX, y: plan.center.y + dy * TILE_PX })
        for (const [ox, oy] of [[-4, -4], [4, 4]]) for (const p of interior) workPoints.push({ x: p.x + ox!, y: p.y + oy! })
    } else if (plan.kind === 'barricade') {
        const n = plan.axis === 'y' ? { x: 1, y: 0 } : { x: 0, y: 1 }, a = { x: n.y, y: n.x }
        // 工兵の来た側から先に埋める。
        const near = (builder.x - plan.center.x) * n.x + (builder.y - plan.center.y) * n.y >= 0 ? 1 : -1
        for (const side of [near, -near]) for (const offset of [0, -5, 5]) for (const c of plan.walls) {
            const p = cellPoint(c)
            workPoints.push({ x: p.x + n.x * side * 13 + a.x * offset, y: p.y + n.y * side * 13 + a.y * offset })
        }
        approach = { x: plan.center.x + n.x * near * 22, y: plan.center.y + n.y * near * 22 }
        if (!open(approach)) approach = { x: plan.center.x - n.x * near * 22, y: plan.center.y - n.y * near * 22 }
    } else {
        const [a, b] = plan.ends
        const end = !a || !b ? plan.center : Math.hypot(a.x - builder.x, a.y - builder.y) <= Math.hypot(b.x - builder.x, b.y - builder.y) ? a : b
        approach = end
        for (let dy = -30; dy <= 30; dy += 5) for (let dx = -30; dx <= 30; dx += 5) {
            if (Math.hypot(dx, dy) <= 30) workPoints.push({ x: end.x + dx, y: end.y + dy })
        }
        workPoints.sort((p, q) => Math.hypot(p.x - end.x, p.y - end.y) - Math.hypot(q.x - end.x, q.y - end.y))
    }
    const usable = workPoints.filter(open)
    return { workPoints: usable.length ? usable.slice(0, 60) : [approach], approach, interior }
}
