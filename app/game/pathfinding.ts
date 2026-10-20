import { TILE_PX } from './constants'
import { getCellHeight, PLAYABLE_GRID_MIN, PLAYABLE_GRID_MAX } from './playableArea'
import { getSlopeRouteMultiplier, getTileCost, type Mobility } from './terrain'
import type { Point } from '../types/game'

/** A*経路探索: グリッド座標で探索し、ワールド座標のウェイポイント配列を返す */
export function findPath(mapGrid: number[][], startWX: number, startWY: number, endWX: number, endWY: number, mobility: Mobility = 'foot'): Point[] {
    const sx = Math.round(startWX / TILE_PX)
    const sy = Math.round(startWY / TILE_PX)
    const ex = Math.round(endWX / TILE_PX)
    const ey = Math.round(endWY / TILE_PX)

    // グリッド範囲外なら直線パス
    if (sx < PLAYABLE_GRID_MIN || sx > PLAYABLE_GRID_MAX || sy < PLAYABLE_GRID_MIN || sy > PLAYABLE_GRID_MAX || ex < PLAYABLE_GRID_MIN || ex > PLAYABLE_GRID_MAX || ey < PLAYABLE_GRID_MIN || ey > PLAYABLE_GRID_MAX) {
        return [{ x: startWX, y: startWY }, { x: endWX, y: endWY }]
    }

    // A*
    const DIRS: [number, number, number][] = [
        [-1, -1, 1.414], [-1, 0, 1], [-1, 1, 1.414],
        [0, -1, 1], [0, 1, 1],
        [1, -1, 1.414], [1, 0, 1], [1, 1, 1.414],
    ]

    const GRID_W = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN + 1
    const key = (x: number, y: number) => (y - PLAYABLE_GRID_MIN) * GRID_W + x - PLAYABLE_GRID_MIN
    const gScore = new Map<number, number>()
    const fScore = new Map<number, number>()
    const cameFrom = new Map<number, number>()

    // 簡易バイナリヒープ (open set)
    const open: { k: number; f: number }[] = []
    const inOpen = new Set<number>()
    const closed = new Set<number>()

    const pushOpen = (k: number, f: number) => {
        open.push({ k, f })
        inOpen.add(k)
        // bubble up
        let i = open.length - 1
        while (i > 0) {
            const pi = (i - 1) >> 1
            if (open[pi]!.f <= open[i]!.f) break
            const tmp = open[pi]!; open[pi] = open[i]!; open[i] = tmp
            i = pi
        }
    }
    const popOpen = (): { k: number; f: number } | undefined => {
        if (open.length === 0) return undefined
        const top = open[0]!
        inOpen.delete(top.k)
        const last = open.pop()!
        if (open.length > 0) {
            open[0] = last
            let i = 0
            while (true) {
                let smallest = i
                const l = 2 * i + 1, r = 2 * i + 2
                if (l < open.length && open[l]!.f < open[smallest]!.f) smallest = l
                if (r < open.length && open[r]!.f < open[smallest]!.f) smallest = r
                if (smallest === i) break
                const tmp = open[i]!; open[i] = open[smallest]!; open[smallest] = tmp
                i = smallest
            }
        }
        return top
    }

    const heuristic = (x: number, y: number) => {
        const dx = Math.abs(x - ex)
        const dy = Math.abs(y - ey)
        return Math.max(dx, dy) + (1.414 - 1) * Math.min(dx, dy)
    }

    const sk = key(sx, sy)
    gScore.set(sk, 0)
    fScore.set(sk, heuristic(sx, sy))
    pushOpen(sk, heuristic(sx, sy))

    const ek = key(ex, ey)
    let found = false

    while (open.length > 0) {
        const cur = popOpen()!
        if (cur.k === ek) { found = true; break }
        closed.add(cur.k)

        const cx = cur.k % GRID_W + PLAYABLE_GRID_MIN
        const cy = Math.floor(cur.k / GRID_W) + PLAYABLE_GRID_MIN
        const curG = gScore.get(cur.k) ?? Infinity

        for (const [ddx, ddy, baseDist] of DIRS) {
            const nx = cx + ddx
            const ny = cy + ddy
            if (nx < PLAYABLE_GRID_MIN || nx > PLAYABLE_GRID_MAX || ny < PLAYABLE_GRID_MIN || ny > PLAYABLE_GRID_MAX) continue
            const nk = key(nx, ny)
            if (closed.has(nk)) continue

            // Diagonal steps must not clip an impassable cell at the shared corner.
            if (ddx !== 0 && ddy !== 0 && (!Number.isFinite(getTileCost(mapGrid, cx + ddx, cy, mobility))
                || !Number.isFinite(getTileCost(mapGrid, cx, cy + ddy, mobility)))) continue

            const tileCost = getTileCost(mapGrid, nx, ny, mobility)
            if (!Number.isFinite(tileCost)) continue
            // 坂は登りほど高く、下りも少し高くつく（経路選びでは重めに見て避ける）
            const slope = getSlopeRouteMultiplier(getCellHeight(mapGrid, nx, ny) - getCellHeight(mapGrid, cx, cy), baseDist * TILE_PX)
            const tentG = curG + baseDist * tileCost * slope

            if (tentG < (gScore.get(nk) ?? Infinity)) {
                cameFrom.set(nk, cur.k)
                gScore.set(nk, tentG)
                const f = tentG + heuristic(nx, ny)
                fScore.set(nk, f)
                if (!inOpen.has(nk)) {
                    pushOpen(nk, f)
                }
            }
        }
    }

    if (!found) {
        // パスが見つからない場合は直線
        return [{ x: startWX, y: startWY }, { x: endWX, y: endWY }]
    }

    // パス復元
    const gridPath: Point[] = []
    let ck = ek
    while (ck !== undefined) {
        const cx = ck % GRID_W + PLAYABLE_GRID_MIN
        const cy = Math.floor(ck / GRID_W) + PLAYABLE_GRID_MIN
        gridPath.unshift({ x: cx, y: cy })
        if (ck === sk) break
        ck = cameFrom.get(ck)!
    }

    // パスをワールド座標に変換し、直線上の中間点を除去（簡略化）
    const worldPath: Point[] = []
    for (let i = 0; i < gridPath.length; i++) {
        const p = gridPath[i]!
        if (i > 0 && i < gridPath.length - 1) {
            const prev = gridPath[i - 1]!
            const next = gridPath[i + 1]!
            // 方向が同じなら中間点をスキップ
            if (p.x - prev.x === next.x - p.x && p.y - prev.y === next.y - p.y) continue
        }
        worldPath.push({ x: p.x * TILE_PX, y: p.y * TILE_PX })
    }

    // 開始点と終了点をワールド座標で正確にセット
    if (worldPath.length > 0) {
        worldPath[0] = { x: startWX, y: startWY }
        worldPath[worldPath.length - 1] = { x: endWX, y: endWY }
    }

    return worldPath
}
