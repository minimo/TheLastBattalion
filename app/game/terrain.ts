import { TILE, TILE_PX, TILE_VARIANT } from './constants'
import { getPlayableTile } from './playableArea'
import type { UnitType } from '../types/game'

/** 移動の種類。川を渡る速さが変わる（騎兵は騎乗、ほかは徒歩）。 */
export type Mobility = 'foot' | 'mounted'
export const mobilityOf = (type: UnitType): Mobility => type === 'cavalry' ? 'mounted' : 'foot'
/** 川を歩いて渡るときの速度倍率。 */
export const WATER_SPEED: Record<Mobility, number> = { foot: .2, mounted: .5 }

/** ユニット現在位置の地形タイルから速度倍率を返す */
export function getTerrainSpeedMultiplier(mapGrid: number[][], worldX: number, worldY: number, type: UnitType): number {
    const gx = Math.round(worldX / TILE_PX)
    const gy = Math.round(worldY / TILE_PX)
    const tile = getPlayableTile(mapGrid, gx, gy)

    let mult = 1.0

    // 水
    if (tile === TILE.WATER) { mult = WATER_SPEED[mobilityOf(type)] }
    // 砦の柵・櫓
    else if (tile === TILE.WALL) { mult = 0.0 }
    // 橋
    else if (tile === TILE.BRIDGE) { mult = 1.0 }
    // 低山 (21-22)
    else if (tile === TILE_VARIANT.LOW_MOUNTAIN_MIN || tile === TILE_VARIANT.LOW_MOUNTAIN_MAX) { mult = 0.5 }
    // 高山 (23-24)
    else if (tile === TILE_VARIANT.HIGH_MOUNTAIN_MIN || tile === TILE_VARIANT.HIGH_MOUNTAIN_MAX) { mult = 0.35 }
    // 木・疎 (31-33)
    else if (tile >= TILE_VARIANT.WOOD_SPARSE_MIN && tile <= TILE_VARIANT.WOOD_SPARSE_MAX) { mult = 0.85 }
    // 木・密 (34-35)
    else if (tile === TILE_VARIANT.WOOD_DENSE_MIN || tile === TILE_VARIANT.WOOD_DENSE_MAX) { mult = 0.7 }

    return mult
}

/**
 * 高低差による移動コストの倍率。勾配（高さの差÷水平距離）に比例して、登りは大きく、下りは少し重くなる。
 * 参考: 隣り合うマスの勾配は中央値が約0.2、上位10%で約0.6、急な崖で2〜3。
 */
export const SLOPE_COST = {
    /** 勾配1あたりの登りの割り増し。 */
    uphill: 1.6,
    /** 勾配1あたりの下りの割り増し。 */
    downhill: .45,
    /** 倍率の上限（崖でも通れなくはしない）。 */
    max: 5,
    /** 経路選びでは割り増し分をこの倍だけ重く見て、急な坂をなるべく避ける。 */
    routeAvoidance: 1.5,
}

/** 高さの差 rise を水平距離 run で進むときの移動コスト倍率（1以上）。 */
export function getSlopeCostMultiplier(rise: number, run: number): number {
    if (run <= 0) return 1
    const grade = rise / run
    return Math.min(SLOPE_COST.max, 1 + (grade > 0 ? SLOPE_COST.uphill * grade : -SLOPE_COST.downhill * grade))
}

/** 経路探索で使う、坂の割り増しを重めに見たコスト倍率。 */
export function getSlopeRouteMultiplier(rise: number, run: number): number {
    return 1 + (getSlopeCostMultiplier(rise, run) - 1) * SLOPE_COST.routeAvoidance
}

/** グリッドタイルの移動コストを返す（速度倍率の逆数）*/
export function getTileCost(mapGrid: number[][], gx: number, gy: number, mobility: Mobility = 'foot'): number {
    const tile = getPlayableTile(mapGrid, gx, gy)
    if (tile === TILE.WATER) return 1 / WATER_SPEED[mobility] // 川（歩いて渡る）
    if (tile === TILE.WALL) return Infinity // 砦の柵・櫓
    if (tile === TILE.BRIDGE) return 1.0 // 橋
    if (tile === TILE_VARIANT.LOW_MOUNTAIN_MIN || tile === TILE_VARIANT.LOW_MOUNTAIN_MAX) return 2.0 // 低山
    if (tile === TILE_VARIANT.HIGH_MOUNTAIN_MIN || tile === TILE_VARIANT.HIGH_MOUNTAIN_MAX) return 2.86 // 高山
    if (tile >= TILE_VARIANT.WOOD_SPARSE_MIN && tile <= TILE_VARIANT.WOOD_SPARSE_MAX) return 1.18 // 木・疎
    if (tile === TILE_VARIANT.WOOD_DENSE_MIN || tile === TILE_VARIANT.WOOD_DENSE_MAX) return 1.43 // 木・密
    return 1.0
}
