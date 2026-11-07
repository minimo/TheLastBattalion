import { describe, expect, it } from 'vitest'
import { UNIT_VISION } from './battleConfig'
import { MAP_TYPES } from './mapType'
import { visionRangeAt } from './vision'
import { createWeatherState, MAP_WEATHERS, resolveWeather, updateWeather, WEATHER_CHANGE, WEATHER_EFFECT, weatherAmount, WEATHERS } from './weather'

describe('天候', () => {
    it('選んだ天候はそのまま使い、その地形で起こらない天候は晴れにする', () => {
        expect(resolveWeather('fog', 'standard', '1')).toBe('fog')
        expect(resolveWeather('rain', 'desert', '1')).toBe('clear')
        expect(resolveWeather('rain', 'snowfield', '1')).toBe('clear')
        expect(resolveWeather('snow', 'snowfield', '1')).toBe('snow')
        expect(resolveWeather('snow', 'desert', '1')).toBe('clear')
    })

    it('おまかせは同じ SEED なら同じ天候で、その地形で起こりうる天候だけになる', () => {
        for (const type of MAP_TYPES) {
            const seen = new Set<string>()
            for (let i = 0; i < 200; i++) {
                const weather = resolveWeather('auto', type, String(i))
                expect(MAP_WEATHERS[type]).toContain(weather)
                expect(resolveWeather('auto', type, String(i))).toBe(weather)
                seen.add(weather)
            }
            expect(seen.size).toBe(MAP_WEATHERS[type].length)
        }
    })

    it('視界は昼夜の広さに天候の倍率を掛け、晴れより悪い天候では狭くなる', () => {
        const range = UNIT_VISION.player.infantry
        expect(visionRangeAt(range, 720, WEATHER_EFFECT.clear.vision)).toBe(600)
        expect(visionRangeAt(range, 720, WEATHER_EFFECT.fog.vision)).toBeCloseTo(600 * WEATHER_EFFECT.fog.vision)
        expect(visionRangeAt(range, 0, WEATHER_EFFECT.rain.vision)).toBeCloseTo(150 * WEATHER_EFFECT.rain.vision)
        for (const w of WEATHERS) if (w !== 'clear') expect(WEATHER_EFFECT[w].vision).toBeLessThan(1)
    })

    /** 天候を dt 秒ずつ、until 秒まで進める。 */
    const run = (state: ReturnType<typeof createWeatherState>, from: number, until: number, dt = .5) => {
        for (let t = from + dt; t <= until + 1e-9; t += dt) updateWeather(state, t, dt)
    }

    it('戦闘中の天候は時間がたつと、その地形で起こりうるほかの天候へ少しずつ移り変わる', () => {
        const state = createWeatherState('clear', 'standard', '42')
        const first = state.next
        expect(first).toBeGreaterThanOrEqual(WEATHER_CHANGE.hold[0])
        expect(first).toBeLessThanOrEqual(WEATHER_CHANGE.hold[1])
        run(state, 0, first + .5)
        expect(state.from).toBe('clear')
        expect(state.to).not.toBe('clear')
        expect(MAP_WEATHERS.standard).toContain(state.to)
        expect(state.blend).toBeLessThan(1)
        run(state, first, first + state.duration + 1)
        expect(state.blend).toBe(1)
        expect(state.from).toBe(state.to)
    })

    it('同じ SEED なら同じ移り変わりになる', () => {
        const a = createWeatherState('rain', 'forest', '7'), b = createWeatherState('rain', 'forest', '7')
        run(a, 0, 600); run(b, 0, 600)
        expect(a).toEqual(b)
        expect(a.count).toBeGreaterThan(0)
    })

    it('霧への移り変わりでは、霧の濃さに比例して視界が狭くなる', () => {
        const state = createWeatherState('clear', 'standard', '1')
        state.to = 'fog'; state.blend = 0; state.duration = WEATHER_CHANGE.fogShift; state.next = Infinity
        run(state, 0, WEATHER_CHANGE.fogShift / 2)
        const fog = weatherAmount(state, 'fog')
        expect(fog).toBeCloseTo(.5)
        expect(state.effect.vision).toBeCloseTo(1 + (WEATHER_EFFECT.fog.vision - 1) * fog)
    })

    it('雪は降り続くと積もり、止むと少しずつ溶ける。晴れと雨では曇りより早く消える', () => {
        const melted = (weather: 'clear' | 'cloudy' | 'rain', seconds: number) => {
            const state = createWeatherState('snow', 'standard', '1')
            state.next = Infinity
            run(state, 0, WEATHER_CHANGE.snowBuild)
            expect(state.snow).toBeCloseTo(1)
            state.from = state.to = weather
            run(state, 0, seconds)
            return state.snow
        }
        expect(melted('clear', WEATHER_CHANGE.snowMelt.clear / 2)).toBeCloseTo(.5)
        expect(melted('clear', WEATHER_CHANGE.snowMelt.clear)).toBe(0)
        expect(melted('rain', WEATHER_CHANGE.snowMelt.rain)).toBe(0)
        expect(melted('cloudy', WEATHER_CHANGE.snowMelt.clear)).toBeGreaterThan(0)
    })
})
