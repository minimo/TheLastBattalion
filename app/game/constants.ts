import type { Rank } from '../types/game'

export const GRID_MAX = 52
export const GRID_SIZE = 53
export const TILE_PX = 16
export const LOGICAL_SIZE = 832

export const TILE = {
    GRASS: 0,
    WATER: 1,
    MOUNTAIN: 2,
    WOOD: 3,
    BRIDGE: 4,
    /** Fort palisades, towers and barricades. Impassable for every unit. */
    WALL: 5,
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
