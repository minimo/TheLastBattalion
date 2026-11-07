import type { Weather } from '../../types/game'
import type { WeatherState } from '../../game/weather'

/**
 * 天候の見た目。ゲームへの影響は game/weather.ts の WEATHER_EFFECT が決め、ここは描き方だけを決める。
 * fog: 地形ごとの霞の濃さに掛ける倍率 / haze: 地平線と霞の色を灰色へ寄せる割合
 * overcast: 空を雲で覆う割合（太陽と月も隠れる） / sun・sky: 日差しと空の明るさの倍率
 * rain・snow・sand: 雨・雪・砂嵐の砂の降る量（0〜1。precipitation.ts）/ dust: 霞の色を砂の色へ寄せる割合/ mist: 地面を漂うもやの濃さ（0でもやなし。mist.ts）
 */
export interface WeatherLook { fog: number; haze: number; overcast: number; sun: number; sky: number; rain: number; snow: number; sand: number; dust: number; mist: number }

export const WEATHER_LOOK: Record<Weather, WeatherLook> = {
    clear: { fog: 1, haze: 0, overcast: 0, sun: 1, sky: 1, rain: 0, snow: 0, sand: 0, dust: 0, mist: 0 },
    cloudy: { fog: 1.2, haze: .25, overcast: .75, sun: .5, sky: .9, rain: 0, snow: 0, sand: 0, dust: 0, mist: 0 },
    rain: { fog: 1.6, haze: .5, overcast: .95, sun: .3, sky: .75, rain: 1, snow: 0, sand: 0, dust: 0, mist: 0 },
    snow: { fog: 2, haze: .7, overcast: .9, sun: .4, sky: .9, rain: 0, snow: 1, sand: 0, dust: 0, mist: 0 },
    fog: { fog: 3.2, haze: .85, overcast: .75, sun: .4, sky: .9, rain: 0, snow: 0, sand: 0, dust: 0, mist: .85 },
    sandstorm: { fog: 4.2, haze: .2, overcast: .9, sun: .35, sky: .8, rain: 0, snow: 0, sand: 1, dust: .9, mist: .85 },
}

const KEYS = Object.keys(WEATHER_LOOK.clear) as (keyof WeatherLook)[]

/** 移り変わりの途中の見た目。前の天候と次の天候の見た目を混ぜる（霧は濃さが少しずつ増え、少しずつ引く）。 */
export function blendWeatherLook(state: WeatherState, into: WeatherLook): WeatherLook {
    const a = WEATHER_LOOK[state.from], b = WEATHER_LOOK[state.to], t = state.blend
    for (const key of KEYS) into[key] = a[key] + (b[key] - a[key]) * t
    return into
}
