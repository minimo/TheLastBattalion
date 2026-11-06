import type { Weather } from '../../types/game'

/**
 * 天候の見た目。ゲームへの影響は game/weather.ts の WEATHER_EFFECT が決め、ここは描き方だけを決める。
 * fog: 地形ごとの霞の濃さに掛ける倍率 / haze: 地平線と霞の色を灰色へ寄せる割合
 * overcast: 空を雲で覆う割合（太陽と月も隠れる） / sun・sky: 日差しと空の明るさの倍率 / fall: 降らせるもの（雨か雪。precipitation.ts）
 * mist: 地面を漂うもやの濃さ（0でもやなし。mist.ts）
 */
export interface WeatherLook { fog: number; haze: number; overcast: number; sun: number; sky: number; fall: 'rain' | 'snow' | null; mist: number }

export const WEATHER_LOOK: Record<Weather, WeatherLook> = {
    clear: { fog: 1, haze: 0, overcast: 0, sun: 1, sky: 1, fall: null, mist: 0 },
    cloudy: { fog: 1.2, haze: .25, overcast: .75, sun: .5, sky: .9, fall: null, mist: 0 },
    rain: { fog: 1.6, haze: .5, overcast: .95, sun: .3, sky: .75, fall: 'rain', mist: 0 },
    snow: { fog: 2, haze: .7, overcast: .9, sun: .4, sky: .9, fall: 'snow', mist: 0 },
    fog: { fog: 3.2, haze: .85, overcast: .75, sun: .4, sky: .9, fall: null, mist: .85 },
}
