import type { MapType, Weather, WeatherChoice } from '../types/game'
import { createMulberry32, hashString } from './random'

export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'fog']
export const WEATHER_CHOICES: WeatherChoice[] = ['auto', ...WEATHERS]
export const WEATHER_NAME: Record<WeatherChoice, string> = {
    auto: 'おまかせ', clear: '晴れ', cloudy: '曇り', rain: '雨', fog: '濃霧',
}
export const WEATHER_DESCRIPTION: Record<WeatherChoice, string> = {
    auto: '戦場の空模様にまかせる。どの天候になるかは開戦まで分からない',
    clear: '晴れ渡った空。遠くまで見通せる',
    cloudy: '雲が空を覆う。見通しが少し悪い',
    rain: '雨が降り続く。見通しが悪く、足元がぬかるみ、矢が散らばる',
    fog: '濃い霧が立ちこめる。ごく近くしか見えず、矢も散らばる',
}

/**
 * 天候の影響。両軍に同じようにかかる（どちらかの軍に有利な天候はない）。
 * vision: 視界の倍率（昼夜の視界に掛ける）/ speed: 移動の速さの倍率 / arrowSpread: 兵を狙う矢の散らばりの倍率
 */
export const WEATHER_EFFECT: Record<Weather, { vision: number; speed: number; arrowSpread: number }> = {
    clear: { vision: 1, speed: 1, arrowSpread: 1 },
    cloudy: { vision: .9, speed: 1, arrowSpread: 1 },
    rain: { vision: .7, speed: .9, arrowSpread: 1.5 },
    fog: { vision: .35, speed: 1, arrowSpread: 1.2 },
}

/** 地形ごとに起こりうる天候。雪原と砂漠に雨は降らず、砂漠に霧は出ない。魔王城付近の雨は専用の天候として後で足す。 */
export const MAP_WEATHERS: Record<MapType, Weather[]> = {
    standard: ['clear', 'cloudy', 'rain', 'fog'],
    meadow: ['clear', 'cloudy', 'rain', 'fog'],
    forest: ['clear', 'cloudy', 'rain', 'fog'],
    snowfield: ['clear', 'cloudy', 'fog'],
    greatRiver: ['clear', 'cloudy', 'rain', 'fog'],
    marsh: ['clear', 'cloudy', 'rain', 'fog'],
    desert: ['clear', 'cloudy'],
    wasteland: ['clear', 'cloudy', 'rain', 'fog'],
    demonland: ['clear', 'cloudy', 'fog'],
}

/** おまかせのときの起こりやすさ（その地形で起こりうる天候の中で比べる）。 */
const WEATHER_ODDS: Record<Weather, number> = { clear: 40, cloudy: 25, rain: 20, fog: 15 }

export function weatherAllowed(mapType: MapType, choice: WeatherChoice) {
    return choice === 'auto' || MAP_WEATHERS[mapType].includes(choice)
}

/**
 * 戦場の天候を決める。おまかせは SEED から決めるので、同じ SEED なら同じ天候になる。
 * 地図の乱数とは別の乱数を使う（地図の生成は乱数を使う回数をそろえてあるので、共有すると地形が変わる）。
 */
export function resolveWeather(choice: WeatherChoice, mapType: MapType, seed: string): Weather {
    const allowed = MAP_WEATHERS[mapType]
    if (choice !== 'auto') return allowed.includes(choice) ? choice : 'clear'
    const total = allowed.reduce((sum, w) => sum + WEATHER_ODDS[w], 0)
    let roll = createMulberry32(hashString(`${seed}:weather`))() * total
    for (const w of allowed) {
        roll -= WEATHER_ODDS[w]
        if (roll < 0) return w
    }
    return allowed[allowed.length - 1]!
}
