import type { BattleMode, MapType } from '../types/game'

export const MAP_TYPES: MapType[] = ['standard', 'meadow', 'desert', 'wasteland', 'demonland']
export const MAP_TYPE_NAME: Record<MapType, string> = {
    standard: '標準', meadow: '草原', desert: '砂漠', wasteland: '荒野', demonland: '魔王城付近',
}
export const MAP_TYPE_DESCRIPTION: Record<MapType, string> = {
    standard: '森と山と川のある戦場',
    meadow: 'なだらかな丘の続く草原。川はない',
    desert: '砂丘の連なる砂漠。川はなく、オアシスがある',
    wasteland: '起伏の少ない荒野。川のあることもある',
    demonland: '荒れ果てた魔王城の周り。赤い空に赤い月が昇る',
}

/** 攻防戦は地形を選べる。攻城戦は魔王城付近、防衛戦は標準の地形で戦う。 */
export function mapTypeForMode(mode: BattleMode, chosen: MapType): MapType {
    return mode === 'siege' ? 'demonland' : mode === 'defense' ? 'standard' : chosen
}

/** 地形の生成と高さのパラメータ。ゲームロジック（移動・配置）と描画の両方が同じ値を使う。 */
export interface TerrainProfile {
    /** 川の本数を決める（rnd を使う回数は標準の地形と同じにしておく）。 */
    rivers: (rnd: () => number) => number
    /** 高さのノイズがこれを超えると山、湿り気のノイズがこれを超えると林。 */
    mountainAbove: number
    woodAbove: number
    /** オアシス（丸い池とヤシの林）の数。 */
    oases: [min: number, max: number]
    /** 山のマスの高さの倍率。 */
    mountainScale: number
    /** 戦場の外の山並みの高さ: 近く（base）と遠く（far）。 */
    outerMountain: { base: number; far: number; sharp: number }
}

export const TERRAIN_PROFILE: Record<MapType, TerrainProfile> = {
    standard: {
        rivers: rnd => 1 + Math.floor(rnd() * 2), mountainAbove: .45, woodAbove: .3, oases: [0, 0], mountainScale: 1,
        outerMountain: { base: 85, far: 320, sharp: 2 },
    },
    meadow: {
        rivers: () => 0, mountainAbove: .6, woodAbove: .5, oases: [0, 0], mountainScale: .75,
        outerMountain: { base: 45, far: 220, sharp: 2 },
    },
    desert: {
        rivers: () => 0, mountainAbove: .68, woodAbove: Infinity, oases: [1, 2], mountainScale: .8,
        outerMountain: { base: 20, far: 160, sharp: 3 },
    },
    wasteland: {
        // 4割ほどは川がなく、残りは1〜2本。
        rivers: rnd => { const r = rnd(); return r < .4 ? 0 : r < .8 ? 1 : 2 }, mountainAbove: .56, woodAbove: .62, oases: [0, 0], mountainScale: .8,
        outerMountain: { base: 60, far: 260, sharp: 1 },
    },
    demonland: {
        rivers: rnd => 1 + Math.floor(rnd() * 2), mountainAbove: .52, woodAbove: .6, oases: [0, 0], mountainScale: 1,
        outerMountain: { base: 100, far: 280, sharp: 4 },
    },
}

const registry = new WeakMap<number[][], MapType>()

/** 生成したグリッドに地形の種類を結びつける。高さ・描画はここから種類を引く。 */
export function registerMapType(grid: number[][], type: MapType) {
    registry.set(grid, type)
}

export function mapTypeOf(grid: number[][]): MapType {
    return registry.get(grid) ?? 'standard'
}
