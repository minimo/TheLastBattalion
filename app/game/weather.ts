import type { MapType, Weather, WeatherChoice } from '../types/game'
import { createMulberry32, hashString } from './random'

export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'snow', 'fog', 'sandstorm']
export const WEATHER_CHOICES: WeatherChoice[] = ['auto', ...WEATHERS]
export const WEATHER_NAME: Record<WeatherChoice, string> = {
    auto: 'ランダム', clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', fog: '濃霧', sandstorm: '砂嵐',
}
export const WEATHER_DESCRIPTION: Record<WeatherChoice, string> = {
    auto: '始まりの天候をランダムに決める。どの天候になるかは開戦まで分からない',
    clear: '晴れ渡った空。遠くまで見通せる',
    cloudy: '雲が空を覆う。見通しが少し悪い',
    rain: '雨が降り続く。見通しが悪く、足元がぬかるみ、矢が散らばる',
    snow: '雪が降りしきる。見通しが悪く、雪に足を取られ、矢も散らばる',
    sandstorm: '砂嵐が吹き荒れる。近くしか見えず、砂に足を取られ、矢が大きく散らばる',
    fog: '濃い霧が立ちこめる。ごく近くしか見えず、矢も散らばる',
}

/**
 * 天候の影響。両軍に同じようにかかる（どちらかの軍に有利な天候はない）。
 * vision: 視界の倍率（昼夜の視界に掛ける）/ speed: 移動の速さの倍率 / arrowSpread: 兵を狙う矢の散らばりの倍率
 * reach: 視界の上限（px）。部隊や陣地の視界がどれだけ広くても、ここまでしか見えない（なければ上限なし）。
 */
export const WEATHER_EFFECT: Record<Weather, { vision: number; speed: number; arrowSpread: number; reach?: number }> = {
    clear: { vision: 1, speed: 1, arrowSpread: 1 },
    cloudy: { vision: .9, speed: 1, arrowSpread: 1 },
    rain: { vision: .7, speed: .9, arrowSpread: 1.5 },
    snow: { vision: .75, speed: .85, arrowSpread: 1.3 },
    fog: { vision: .35, speed: 1, arrowSpread: 1.2 },
    sandstorm: { vision: 1, speed: .85, arrowSpread: 1.7, reach: 120 },
}

/** 地形ごとに起こりうる天候。雪原と砂漠に雨は降らず、砂漠と魔王城付近に雪は降らず、砂漠に霧は出ない。砂嵐は砂漠だけ。魔王城付近の雨は専用の天候として後で足す。 */
export const MAP_WEATHERS: Record<MapType, Weather[]> = {
    standard: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    meadow: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    forest: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    snowfield: ['clear', 'cloudy', 'snow', 'fog'],
    greatRiver: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    marsh: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    desert: ['clear', 'cloudy', 'sandstorm'],
    wasteland: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
    demonland: ['clear', 'cloudy', 'fog'],
}

/** ランダムのときの起こりやすさ（その地形で起こりうる天候の中で比べる）。 */
const WEATHER_ODDS: Record<Weather, number> = { clear: 40, cloudy: 25, rain: 20, snow: 12, fog: 15, sandstorm: 20 }

/**
 * 戦闘中の天候の移り変わり（時間はすべて戦闘の経過時間の秒。1秒は戦場の6分）。
 * hold: ひとつの天候が続く長さ（この間でランダム）/ shift: 次の天候へ移り変わるのにかかる長さ。
 * fogShift: 霧や砂嵐が立ちこめる・引くときの長さ（ゆっくり濃くなり、ゆっくり引く）。
 * snowBuild: 雪が降り続いて一面に積もるまでの長さ。
 * snowMelt: 雪が止んでから溶けきるまでの長さ（そのときの天候ごと。日の差す晴れと、雪を流す雨では早く消える）。
 */
export const WEATHER_CHANGE = {
    hold: [30, 150] as [number, number], shift: 20, fogShift: 45,
    snowBuild: 170,
    snowMelt: { clear: 45, cloudy: 70, rain: 35, fog: 70, sandstorm: 45 } as Record<Exclude<Weather, 'snow'>, number>,
}

/**
 * 戦闘中の天候。from から to へ blend（0〜1。1で移り終わり）で移り変わる。移り終わっていれば from と to は同じ。
 * next: 次に天候が変わり始める時刻 / count: これまでに変わった回数（次の天候を SEED から決めるのに使う）。
 * snow: 積雪の進み具合（0〜1。雪の間は増え、止むと減る。見た目だけに使う）。
 * effect: 今の天候の影響（weatherEffect の値。毎回作り直さないよう、天候を進めるたびに求めておく）。
 */
export interface WeatherState {
    from: Weather; to: Weather; blend: number; duration: number
    next: number; count: number; snow: number
    mapType: MapType; seed: string
    effect: { vision: number; speed: number; arrowSpread: number }
}

/** 天候の乱数。何回目の変化かごとに SEED から作るので、同じ SEED なら同じ移り変わりになる。 */
const weatherRandom = (seed: string, count: number) => createMulberry32(hashString(`${seed}:weather:${count}`))

export function createWeatherState(weather: Weather, mapType: MapType, seed: string): WeatherState {
    const random = weatherRandom(seed, 0)
    return { from: weather, to: weather, blend: 1, duration: 0, next: holdLength(random), count: 0, snow: 0, mapType, seed, effect: { ...WEATHER_EFFECT[weather] } }
}

const holdLength = (random: () => number) => WEATHER_CHANGE.hold[0] + random() * (WEATHER_CHANGE.hold[1] - WEATHER_CHANGE.hold[0])

/** その天候がどれだけ効いているか（0〜1）。移り変わりの途中では、前の天候と次の天候が混ざる。 */
export function weatherAmount(state: WeatherState, weather: Weather) {
    return (state.to === weather ? state.blend : 0) + (state.from === weather ? 1 - state.blend : 0)
}

/** 今の天候の影響。移り変わりの途中は、前の天候と次の天候の倍率を混ぜる（霧が濃くなるほど視界が狭くなる）。 */
export function weatherEffect(state: WeatherState) {
    const a = WEATHER_EFFECT[state.from], b = WEATHER_EFFECT[state.to], t = state.blend
    const effect = state.effect
    effect.vision = a.vision + (b.vision - a.vision) * t
    effect.speed = a.speed + (b.speed - a.speed) * t
    effect.arrowSpread = a.arrowSpread + (b.arrowSpread - a.arrowSpread) * t
    return effect
}

/** 天候を進める。決まった時刻が来ると、その地形で起こりうるほかの天候へ移り変わり始める。 */
export function updateWeather(state: WeatherState, time: number, dt: number) {
    if (state.blend < 1) {
        state.blend = Math.min(1, state.blend + dt / state.duration)
        if (state.blend >= 1) state.from = state.to
    } else if (time >= state.next) {
        state.count++
        const random = weatherRandom(state.seed, state.count)
        const choices = MAP_WEATHERS[state.mapType].filter(w => w !== state.to)
        if (choices.length) {
            const next = pickWeather(choices, random())
            state.from = state.to
            state.to = next
            state.blend = 0
            state.duration = [state.from, next].some(w => w === 'fog' || w === 'sandstorm') ? WEATHER_CHANGE.fogShift : WEATHER_CHANGE.shift
        }
        state.next = time + (choices.length ? state.duration : 0) + holdLength(random)
    }
    weatherEffect(state)
    // 雪が降っている間は積もり、止むとそのときの天候に合った速さで少しずつ溶ける（移り変わりの途中は前後の天候を混ぜる）。
    const snowing = weatherAmount(state, 'snow')
    let melt = 0
    for (const w of [state.from, state.to]) if (w !== 'snow') melt += weatherAmount(state, w) / WEATHER_CHANGE.snowMelt[w]
    if (state.from === state.to && state.to !== 'snow') melt = 1 / WEATHER_CHANGE.snowMelt[state.to]
    state.snow = Math.min(1, Math.max(0, state.snow + dt * (snowing / WEATHER_CHANGE.snowBuild - melt)))
}

function pickWeather(choices: Weather[], roll: number) {
    const total = choices.reduce((sum, w) => sum + WEATHER_ODDS[w], 0)
    roll *= total
    for (const w of choices) {
        roll -= WEATHER_ODDS[w]
        if (roll < 0) return w
    }
    return choices[choices.length - 1]!
}

export function weatherAllowed(mapType: MapType, choice: WeatherChoice) {
    return choice === 'auto' || MAP_WEATHERS[mapType].includes(choice)
}

/**
 * 開戦時の天候を決める。ランダムは SEED から決めるので、同じ SEED なら同じ天候になる。
 * 地図の乱数とは別の乱数を使う（地図の生成は乱数を使う回数をそろえてあるので、共有すると地形が変わる）。
 */
export function resolveWeather(choice: WeatherChoice, mapType: MapType, seed: string): Weather {
    const allowed = MAP_WEATHERS[mapType]
    if (choice !== 'auto') return allowed.includes(choice) ? choice : 'clear'
    return pickWeather(allowed, createMulberry32(hashString(`${seed}:weather`))())
}
