import type { MapType } from '../../types/game'

export type TreeStyle = 'broadleaf' | 'palm' | 'dead'

/** 地形の種類ごとの見た目。地形の形は game/mapType.ts の TERRAIN_PROFILE が決める。 */
export interface MapTheme {
    ground: {
        /** 地面の基本色と、まだらに混ぜる色（patch の割合まで）。 */
        base: number; patch: number; patchAmount: number
        /** 斜面・高所の岩肌と、水際の色。 */
        rock: number; shore: number
        /** 高いところ（砂丘の稜線など）を明るくする色と割合。 */
        crest?: { color: number; amount: number; from: number; to: number }
    }
    /** 草の色と本数の上限（0で生えない）。 */
    grass: { color: number; count: number }
    /** 岩の色（HSLの色相・彩度・明度の下限）、数の上限、置き始める高さ。 */
    rocks: { hue: number; saturation: number; lightness: number; count: number; above: number }
    /** 木の形、戦場の外に植える数の上限、（枯れ木の）幹の色。 */
    trees: { style: TreeStyle; outsideCount: number; barkColor?: number }
    /** 水面の色と不透明度。roughness・metalness が小さいほど空を強く映す。 */
    water: { color: number; opacity: number; roughness: number; metalness: number }
    sky: {
        dayZenith: number; dayHorizon: number; nightZenith: number; nightHorizon: number
        dayCloud: number; nightCloud: number; cloudAmount: number; fog: number
        /** 夜に昇る月（なければ描かない）。 */
        moon?: { color: number; glow: number }
    }
    light: { sky: number; ground: number; sun: number; nightSun: number; sunScale: number }
}

export const MAP_THEME: Record<MapType, MapTheme> = {
    standard: {
        ground: { base: 0x596d49, patch: 0x96916b, patchAmount: .5, rock: 0x807e72, shore: 0x968d70 },
        grass: { color: 0x738456, count: 2600 },
        rocks: { hue: .12, saturation: .08, lightness: .55, count: 260, above: 35 },
        trees: { style: 'broadleaf', outsideCount: 500 },
        water: { color: 0x466e73, opacity: .87, roughness: .2, metalness: .45 },
        sky: {
            dayZenith: 0x79a8cc, dayHorizon: 0xb6c9cb, nightZenith: 0x1c2948, nightHorizon: 0x202d43,
            dayCloud: 0xe7eded, nightCloud: 0x626c81, cloudAmount: .2, fog: .00028,
        },
        light: { sky: 0xc8e5e4, ground: 0x56634d, sun: 0xffdeb3, nightSun: 0xa1bbff, sunScale: 1 },
    },
    meadow: {
        ground: { base: 0x5f7a45, patch: 0x8a9658, patchAmount: .45, rock: 0x86836f, shore: 0x8e8a63 },
        grass: { color: 0x7d9455, count: 4200 },
        rocks: { hue: .12, saturation: .07, lightness: .6, count: 90, above: 45 },
        trees: { style: 'broadleaf', outsideCount: 260 },
        water: { color: 0x466e73, opacity: .87, roughness: .2, metalness: .45 },
        sky: {
            dayZenith: 0x72a7d8, dayHorizon: 0xbcd3d6, nightZenith: 0x1c2948, nightHorizon: 0x202d43,
            dayCloud: 0xdde6e6, nightCloud: 0x626c81, cloudAmount: .28, fog: .00024,
        },
        light: { sky: 0xcfe8e2, ground: 0x5b6d47, sun: 0xffe2b8, nightSun: 0xa1bbff, sunScale: 1.05 },
    },
    desert: {
        ground: { base: 0xc2a06a, patch: 0xa9844f, patchAmount: .4, rock: 0x9a7552, shore: 0x8d8456,
            crest: { color: 0xe0c48e, amount: .45, from: 26, to: 42 } },
        grass: { color: 0x9b9256, count: 0 },
        rocks: { hue: .07, saturation: .3, lightness: .5, count: 120, above: 40 },
        trees: { style: 'palm', outsideCount: 0 },
        water: { color: 0x2f8382, opacity: .85, roughness: .55, metalness: .05 },
        sky: {
            dayZenith: 0x86afd2, dayHorizon: 0xe2d6bd, nightZenith: 0x1e2a48, nightHorizon: 0x2a2c3e,
            dayCloud: 0xece2cf, nightCloud: 0x5f6578, cloudAmount: .08, fog: .00034,
        },
        light: { sky: 0xe9e1cc, ground: 0x9a7f57, sun: 0xffe0b0, nightSun: 0xa4b4ef, sunScale: 1.12 },
    },
    wasteland: {
        ground: { base: 0x7d6c52, patch: 0x8f7f63, patchAmount: .55, rock: 0x6e665c, shore: 0x7b6e55 },
        grass: { color: 0x8d8256, count: 1400 },
        rocks: { hue: .08, saturation: .14, lightness: .45, count: 420, above: 20 },
        trees: { style: 'dead', outsideCount: 90, barkColor: 0x5a5148 },
        water: { color: 0x5a5a47, opacity: .9, roughness: .6, metalness: .05 },
        sky: {
            dayZenith: 0x8ea3b4, dayHorizon: 0xc9c1aa, nightZenith: 0x1f2534, nightHorizon: 0x272a35,
            dayCloud: 0xcfc6b3, nightCloud: 0x5a5c68, cloudAmount: .16, fog: .00032,
        },
        light: { sky: 0xd9d2bd, ground: 0x6b5b45, sun: 0xffd9a8, nightSun: 0xa3b3e6, sunScale: 1 },
    },
    demonland: {
        ground: { base: 0x3b302b, patch: 0x5c5450, patchAmount: .5, rock: 0x2c2523, shore: 0x463a33 },
        grass: { color: 0x4a3d33, count: 500 },
        rocks: { hue: .02, saturation: .12, lightness: .2, count: 380, above: 20 },
        trees: { style: 'dead', outsideCount: 140, barkColor: 0x2b2421 },
        water: { color: 0x3d1f1a, opacity: .94, roughness: .6, metalness: 0 },
        sky: {
            dayZenith: 0x6a3a35, dayHorizon: 0x9a6a5a, nightZenith: 0x1c0606, nightHorizon: 0x3c0d0c,
            dayCloud: 0x8a5249, nightCloud: 0x4a1410, cloudAmount: .3, fog: .00042,
            moon: { color: 0xff3b24, glow: 0xb3180e },
        },
        light: { sky: 0xc9958a, ground: 0x3d2a24, sun: 0xffa983, nightSun: 0xff6a4d, sunScale: .82 },
    },
}
