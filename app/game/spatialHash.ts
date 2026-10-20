import { PLAYABLE_MIN, PLAYABLE_SIZE } from './playableArea'
import type { Soldier } from '../types/game'

const PADDING = 64

/** 兵士の近傍検索用の一様グリッド。毎ティック作り直す（連結リスト方式）。 */
export function createSpatialHash(cellSize = 16) {
    const min = PLAYABLE_MIN - PADDING
    const cols = Math.ceil((PLAYABLE_SIZE + PADDING * 2) / cellSize)
    const head = new Int32Array(cols * cols)
    let next = new Int32Array(1024)
    let items: Soldier[] = []
    const cellOf = (v: number) => Math.max(0, Math.min(cols - 1, Math.floor((v - min) / cellSize)))
    return {
        rebuild(soldiers: Soldier[]) {
            head.fill(-1)
            if (next.length < soldiers.length) next = new Int32Array(soldiers.length * 2)
            items = soldiers
            for (let i = 0; i < soldiers.length; i++) {
                const s = soldiers[i]!
                if (s.state === 'dead') continue
                const c = cellOf(s.y) * cols + cellOf(s.x)
                next[i] = head[c]!
                head[c] = i
            }
        },
        /** 半径内（セル単位の近似）の兵士を列挙する。visitがtrueを返すと打ち切る。 */
        forEachNear(x: number, y: number, radius: number, visit: (soldier: Soldier) => boolean | void) {
            const x0 = cellOf(x - radius), x1 = cellOf(x + radius), y0 = cellOf(y - radius), y1 = cellOf(y + radius)
            for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
                for (let i = head[cy * cols + cx]!; i !== -1; i = next[i]!) {
                    if (visit(items[i]!)) return
                }
            }
        },
    }
}
export type SpatialHash = ReturnType<typeof createSpatialHash>
