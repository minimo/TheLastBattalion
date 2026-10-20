import { TILE, TILE_PX } from './constants'
import { findPath } from './pathfinding'
import { getCellHeight, getConstructionTile, getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { getSlopeCostMultiplier, getSlopeRouteMultiplier, getTileCost, type Mobility } from './terrain'
import type { Point } from '../types/game'

const CACHE_LIMIT = 40000
/**
 * 建設物の柵（拠点の柵・バリケード）は通れないが、経路選びではとても遠回りな道として扱う。
 * 迂回路があればそちらを通り、なければ柵へ向かって詰まった兵が柵を壊しにかかる。
 */
const CONSTRUCTION_WALL_ROUTE_COST = 60
const MOBILITIES: Mobility[] = ['foot', 'mounted']
const W = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN + 1
const DIRS: [number, number, number][] = [
    [-1, -1, 1.414], [-1, 0, 1], [-1, 1, 1.414],
    [0, -1, 1], [0, 1, 1],
    [1, -1, 1.414], [1, 0, 1], [1, 1, 1.414],
]
const inside = (x: number, y: number) => x >= PLAYABLE_GRID_MIN && x <= PLAYABLE_GRID_MAX && y >= PLAYABLE_GRID_MIN && y <= PLAYABLE_GRID_MAX
const index = (x: number, y: number) => (y - PLAYABLE_GRID_MIN) * W + x - PLAYABLE_GRID_MIN

/**
 * 数千の兵士で経路を共有するための窓口。
 * 戦略目標（敵本陣の攻撃地点・自陣の集合地点）へは、no-life-kingのA*と同じ移動コスト
 * （getTileCost×坂の割り増し・8方向・斜めは角の柵を跨がない）で目的地からの累積コストを一度だけ計算し、
 * 川を渡る速さが違うので、コスト場は徒歩と騎乗で別に持つ。
 * 各兵士の経路はそこから即座に辿る。臨時の目的地（追跡中の迂回など）はA*（findPath）を回数制限付きで使う。
 * 経路配列は読み取り専用として複数の兵士が共有する。
 */
export function createPathService(grid: number[][]) {
    /** 移動できるか（通行不可はInfinity）と、経路選びに使うコスト。 */
    const tileCost = { foot: new Float32Array(W * W), mounted: new Float32Array(W * W) }
    const routeCost = { foot: new Float32Array(W * W), mounted: new Float32Array(W * W) }
    /** 立ち止まれる陸地か（川・柵でない）。 */
    const dry = new Uint8Array(W * W)
    const height = new Float32Array(W * W)
    const readCell = (x: number, y: number) => {
        const i = index(x, y)
        const wall = getConstructionTile(grid, x, y) === TILE.WALL
        for (const m of MOBILITIES) {
            tileCost[m][i] = getTileCost(grid, x, y, m)
            routeCost[m][i] = wall ? CONSTRUCTION_WALL_ROUTE_COST : tileCost[m][i]!
        }
        dry[i] = Number.isFinite(tileCost.foot[i]!) && getPlayableTile(grid, x, y) !== TILE.WATER ? 1 : 0
        height[i] = getCellHeight(grid, x, y)
    }
    for (let y = PLAYABLE_GRID_MIN; y <= PLAYABLE_GRID_MAX; y++) for (let x = PLAYABLE_GRID_MIN; x <= PLAYABLE_GRID_MAX; x++) readCell(x, y)
    /** 地形が変わるたびに増える版。古い版で作ったコスト場は、使うときに作り直す。 */
    let version = 0
    /** from → to へ1歩進むコスト（findPathと同じ: 距離×地形×坂）。 */
    const stepCost = (route: Float32Array, from: number, to: number, base: number) =>
        base * route[to]! * getSlopeRouteMultiplier(height[to]! - height[from]!, base * TILE_PX)
    /** マス中心の高さを双線形補間した地面の高さ。 */
    const groundAt = (x: number, y: number) => {
        const fx = Math.max(PLAYABLE_GRID_MIN, Math.min(PLAYABLE_GRID_MAX - 1e-3, x / TILE_PX))
        const fy = Math.max(PLAYABLE_GRID_MIN, Math.min(PLAYABLE_GRID_MAX - 1e-3, y / TILE_PX))
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
        const i = index(ix, iy)
        const top = height[i]! + (height[i + 1]! - height[i]!) * tx
        const bottom = height[i + W]! + (height[i + W + 1]! - height[i + W]!) * tx
        return top + (bottom - top) * ty
    }
    const fields = new Map<string, { goal: Point; cost: Partial<Record<Mobility, Float32Array>>; version: number }>()
    const cache = new Map<string, Point[]>()
    const pending = new Map<string, { gx: number; gy: number; goal: Point; mobility: Mobility }>()

    /** 目的地から逆向きにDijkstra。cost[c] = cからゴールまでの最小コスト。 */
    const buildField = (goal: Point, mobility: Mobility) => {
        const route = routeCost[mobility]
        const cost = new Float32Array(W * W).fill(Infinity)
        const gx = Math.round(goal.x / TILE_PX), gy = Math.round(goal.y / TILE_PX)
        if (!inside(gx, gy)) return cost
        const heap: number[] = []
        const push = (k: number) => {
            heap.push(k)
            for (let i = heap.length - 1; i > 0;) {
                const p = (i - 1) >> 1
                if (cost[heap[p]!]! <= cost[heap[i]!]!) break
                ;[heap[p], heap[i]] = [heap[i]!, heap[p]!]
                i = p
            }
        }
        const pop = () => {
            const top = heap[0]!, last = heap.pop()!
            if (heap.length) {
                heap[0] = last
                for (let i = 0; ;) {
                    let m = i
                    const l = 2 * i + 1, r = l + 1
                    if (l < heap.length && cost[heap[l]!]! < cost[heap[m]!]!) m = l
                    if (r < heap.length && cost[heap[r]!]! < cost[heap[m]!]!) m = r
                    if (m === i) break
                    ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
                    i = m
                }
            }
            return top
        }
        cost[index(gx, gy)] = 0
        push(index(gx, gy))
        const done = new Uint8Array(W * W)
        while (heap.length) {
            const k = pop()
            if (done[k]) continue
            done[k] = 1
            const nx = k % W + PLAYABLE_GRID_MIN, ny = Math.floor(k / W) + PLAYABLE_GRID_MIN
            for (const [dx, dy, base] of DIRS) {
                const cx = nx + dx, cy = ny + dy
                if (!inside(cx, cy)) continue
                const c = index(cx, cy)
                if (done[c] || !Number.isFinite(route[c]!)) continue
                // c → n の斜め移動が角の通行不可セルを跨がないこと（findPathと同じ規則）
                if (dx !== 0 && dy !== 0 && (!Number.isFinite(route[index(cx - dx, cy)]!) || !Number.isFinite(route[index(cx, cy - dy)]!))) continue
                const next = cost[k]! + stepCost(route, c, k, base)
                if (next < cost[c]!) { cost[c] = next; push(c) }
            }
        }
        return cost
    }

    /** コスト場を下りながら経路を作り、findPathと同様に同方向の中間点を省く。 */
    const trace = (cost: Float32Array, route: Float32Array, sx: number, sy: number, goal: Point): Point[] | undefined => {
        if (!inside(sx, sy) || !Number.isFinite(cost[index(sx, sy)]!)) return undefined
        const cells: Point[] = [{ x: sx, y: sy }]
        let x = sx, y = sy
        while (cost[index(x, y)]! > 0 && cells.length < W * 4) {
            let best = Infinity, bx = x, by = y
            for (const [dx, dy, base] of DIRS) {
                const nx = x + dx, ny = y + dy
                if (!inside(nx, ny)) continue
                const n = index(nx, ny)
                if (!Number.isFinite(cost[n]!)) continue
                if (dx !== 0 && dy !== 0 && (!Number.isFinite(route[index(x + dx, y)]!) || !Number.isFinite(route[index(x, y + dy)]!))) continue
                const total = stepCost(route, index(x, y), n, base) + cost[n]!
                if (total < best) { best = total; bx = nx; by = ny }
            }
            if (bx === x && by === y) break
            x = bx; y = by
            cells.push({ x, y })
        }
        const path: Point[] = []
        for (let i = 0; i < cells.length; i++) {
            const p = cells[i]!
            if (i > 0 && i < cells.length - 1) {
                const prev = cells[i - 1]!, next = cells[i + 1]!
                if (p.x - prev.x === next.x - p.x && p.y - prev.y === next.y - p.y) continue
            }
            path.push({ x: p.x * TILE_PX, y: p.y * TILE_PX })
        }
        if (path.length === 1) path.push({ ...goal })
        else path[path.length - 1] = { ...goal }
        return path
    }

    return {
        /** 戦略目標を登録する。以後この目標への経路は即座に返る。 */
        addGoal(goalKey: string, goal: Point) {
            if (!fields.has(goalKey)) fields.set(goalKey, { goal: { ...goal }, cost: { foot: buildField(goal, 'foot') }, version })
        },
        /** 建設物の完成・破壊でマスの地形が変わったら読み直す。コスト場は使うときに順次作り直す。 */
        refresh(cells: { gx: number; gy: number }[]) {
            for (const { gx, gy } of cells) if (inside(gx, gy)) readCell(gx, gy)
            version++
            cache.clear()
            pending.clear()
        },
        /** ワールド座標が立ち止まれる陸地（川・柵でない）か。布陣・集合地点・直進できるかの判定に使う。 */
        passable(x: number, y: number) {
            const gx = Math.round(x / TILE_PX), gy = Math.round(y / TILE_PX)
            return inside(gx, gy) && dry[index(gx, gy)] === 1
        },
        /** ワールド座標へ踏み込めるか（柵でなければ、川の中でもよい）。 */
        walkable(x: number, y: number) {
            const gx = Math.round(x / TILE_PX), gy = Math.round(y / TILE_PX)
            return inside(gx, gy) && Number.isFinite(tileCost.foot[index(gx, gy)]!)
        },
        /**
         * 坂による移動速度の倍率（1以下）。(dx, dy) の向きへ進むときの地面の勾配から求める。
         * 経路選びの重み付けは含めず、実際に坂を進む遅さだけを表す。
         */
        slopeSpeed(x: number, y: number, dx: number, dy: number) {
            const length = Math.hypot(dx, dy)
            if (length < 1e-6) return 1
            const probe = 4
            const rise = groundAt(x + dx / length * probe, y + dy / length * probe) - groundAt(x, y)
            return 1 / getSlopeCostMultiplier(rise, probe)
        },
        /** 使わなくなった目標を破棄する（部隊の移動先が変わったときなど）。 */
        dropGoal(goalKey: string) {
            fields.delete(goalKey)
        },
        request(x: number, y: number, goal: Point, goalKey: string, mobility: Mobility = 'foot'): Point[] | undefined {
            const gx = Math.round(x / TILE_PX), gy = Math.round(y / TILE_PX)
            const key = `${mobility}:${gx},${gy}>${goalKey}`
            const hit = cache.get(key)
            if (hit) return hit
            if (cache.size > CACHE_LIMIT) cache.clear()
            const field = fields.get(goalKey)
            if (field && field.version !== version) { field.cost = {}; field.version = version }
            if (field) {
                const cost = field.cost[mobility] ??= buildField(field.goal, mobility)
                const path = trace(cost, routeCost[mobility], gx, gy, field.goal) ?? [{ x: gx * TILE_PX, y: gy * TILE_PX }, { ...field.goal }]
                cache.set(key, path)
                return path
            }
            if (!pending.has(key)) pending.set(key, { gx, gy, goal: { ...goal }, mobility })
            return undefined
        },
        process(budget: number) {
            for (const [key, job] of pending) {
                if (budget-- <= 0) break
                pending.delete(key)
                cache.set(key, findPath(grid, job.gx * TILE_PX, job.gy * TILE_PX, job.goal.x, job.goal.y, job.mobility))
            }
        },
        get pendingCount() { return pending.size },
    }
}
export type PathService = ReturnType<typeof createPathService>
