import type { Rank } from '../types/game'
import { DIMENSIONS, m } from './dimensions'

/** 1マスの一辺（px）。 */
export const TILE_PX = m(DIMENSIONS.tile)
/**
 * 地形の生成の倍率。地形の生成は戦場の一辺 1,400px を基準に作ってあり、実際の戦場の広さ（DIMENSIONS.battlefield）との比で広げる。
 * 生成のマス数を倍率で掛けるので、整数にする。
 */
export const WORLD_SCALE = Math.round(m(DIMENSIONS.battlefield) / 1400)
/**
 * 地形の生成の基準の範囲（マス）。山・林の大きさ、川の流れ方はこの範囲を基準に決める（倍率を掛ける前は 52 マス）。
 * 地形はこの範囲の外へも同じ作り方で続き、川はこの範囲を横切って端まで流れる。
 */
export const GENERATION_SPAN = 52 * WORLD_SCALE
/**
 * 地形を作るマス目の一辺。部隊の動ける範囲の外の遠景の端まで覆い、内外を同じ作り方で作る（偶数にそろえる）。
 */
export const GRID_MAX = Math.ceil(m(DIMENSIONS.battlefield + (DIMENSIONS.playableMargin + DIMENSIONS.landscapeMargin) * 2) / TILE_PX / 2) * 2
export const GRID_SIZE = GRID_MAX + 1
export const LOGICAL_SIZE = GRID_MAX * TILE_PX

export const TILE = {
    GRASS: 0,
    WATER: 1,
    MOUNTAIN: 2,
    WOOD: 3,
    BRIDGE: 4,
    /** Fort palisades, towers and barricades. Impassable for every unit. */
    WALL: 5,
    /** Frozen water. Walkable like open ground; the terrain stays carved as a river. */
    ICE: 6,
    /** Shallow marsh. Walkable but slow, and slower still on horseback. */
    MARSH: 7,
    /** Marsh overgrown with reeds. Moves like MARSH and blocks sight like a sparse wood. */
    REEDS: 8,
    /** Thick reed beds. Moves like MARSH and blocks sight like a dense wood. */
    REEDS_DENSE: 9,
} as const

export const TILE_VARIANT = {
    LOW_MOUNTAIN_MIN: 21,
    LOW_MOUNTAIN_MAX: 22,
    HIGH_MOUNTAIN_MIN: 23,
    HIGH_MOUNTAIN_MAX: 24,
    WOOD_SPARSE_MIN: 31,
    WOOD_SPARSE_MAX: 33,
    WOOD_DENSE_MIN: 34,
    WOOD_DENSE_MAX: 35,
} as const

type RankConfig = {
    cap: number
    growth: number
    upgradeCost: number
}

export const RANK_CONFIG = {
    1: { cap: 100, growth: 2.0, upgradeCost: 80 },
    2: { cap: 150, growth: 3.0, upgradeCost: 120 },
    3: { cap: 999, growth: 4.5, upgradeCost: Infinity },
} as const satisfies Record<Rank, RankConfig>

export const BASE_CAMP_GROWTH_MULTIPLIER = 0.25

export const UNIT_SPEED = 30 // px/sec
