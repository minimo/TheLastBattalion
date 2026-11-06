import { describe, expect, it } from 'vitest'
import { UNIT_VISION } from './battleConfig'
import { MAP_TYPES } from './mapType'
import { visionRangeAt } from './vision'
import { MAP_WEATHERS, resolveWeather, WEATHER_EFFECT, WEATHERS } from './weather'

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
        expect(visionRangeAt(range, 720, 'clear')).toBe(600)
        expect(visionRangeAt(range, 720, 'fog')).toBeCloseTo(600 * WEATHER_EFFECT.fog.vision)
        expect(visionRangeAt(range, 0, 'rain')).toBeCloseTo(150 * WEATHER_EFFECT.rain.vision)
        for (const w of WEATHERS) if (w !== 'clear') expect(WEATHER_EFFECT[w].vision).toBeLessThan(1)
    })
})
