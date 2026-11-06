import { createNoise2D } from 'simplex-noise'
import { LOGICAL_SIZE } from './constants'
import { TERRAIN_PROFILE, mapTypeOf } from './mapType'
import { createMulberry32, hashString } from './random'
import type { MapType } from '../types/game'

/** 戦場の中心（playableArea の TERRAIN_CENTER と同じ値。循環 import を避けて持つ）。 */
const CENTER = LOGICAL_SIZE / 2
/** 部隊の動ける範囲の半分の幅（playableArea の PLAYABLE_SIZE / 2）。沼はこの内側だけに広がる。 */
const PLAYABLE_HALF = 940
/** 乾いた地面の高さと、沼の水面下の地面の高さ（水面は0）。 */
const DRY_HEIGHT = 7
const MARSH_FLOOR = -1.4
/** 土手道の、周りの地面からの高さと、芯からの半分の幅（px）。 */
const CAUSEWAY_RISE = 4
const CAUSEWAY_HALF_WIDTH = 20
/** 両軍の陣地の建つ乾いた土地の中心（陣地の敷地と正門前の中心）。 */
const KNOLLS = [{ x: CENTER - 560, y: CENTER }, { x: CENTER + 560, y: CENTER }]

type Point = { x: number; y: number }

export interface Marsh {
    /** 沼の湿り気。正なら沼、負なら乾いた陸。 */
    wetness: (x: number, y: number) => number
    /** 土手道の芯からどれだけ内側か（px）。正なら土手道の上。 */
    causeway: (x: number, y: number) => number
    /** 沼の葦: 0 はなし、1 は疎らな葦原、2 は見通しの効かない密な葦原。 */
    reeds: (x: number, y: number) => 0 | 1 | 2
    /** 地面の高さ（沼は水面下、土手道は少し高い）。 */
    heightAt: (x: number, y: number) => number
    /** 土手道の芯。 */
    causeways: Point[][]
}

const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/**
 * 湿地: 戦場全体に、浅い沼と乾いた陸が入り組んで広がる。沼の多くには葦が茂り、密な所は見通しが効かない。
 * 沼を渡る土手道は、ない戦場もあり、あれば1〜2本が向きも場所もまちまちに通る。
 */
export function createMarsh(seed: number): Marsh {
    const rnd = createMulberry32(seed)
    const noise = createNoise2D(rnd)
    // 土手道: 0〜2本。戦場のどこかを通り、向きはまちまちで、ゆるく蛇行する。
    const roll = rnd(), count = roll < .35 ? 0 : roll < .75 ? 1 : 2
    const causeways = Array.from({ length: count }, (_, i) => {
        const angle = rnd() * Math.PI, length = 700 + rnd() * 600
        const mx = CENTER + (rnd() - .5) * 700, my = CENTER + (rnd() - .5) * 700
        const dx = Math.cos(angle), dy = Math.sin(angle), steps = 40
        return Array.from({ length: steps + 1 }, (_, k) => {
            const t = k / steps, along = (t - .5) * length, swing = noise(t * 2.2, i * 9.1 + 4) * 80
            return { x: mx + dx * along - dy * swing, y: my + dy * along + dx * swing }
        })
    })
    const segments = causeways.flatMap(points => points.slice(1).map((b, k) => ({ a: points[k]!, b })))
    const causeway = (x: number, y: number) => {
        let d = -Infinity
        for (const { a, b } of segments) {
            if (x < Math.min(a.x, b.x) - 60 || x > Math.max(a.x, b.x) + 60 || y < Math.min(a.y, b.y) - 60 || y > Math.max(a.y, b.y) + 60) continue
            const vx = b.x - a.x, vy = b.y - a.y
            const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)))
            d = Math.max(d, CAUSEWAY_HALF_WIDTH - Math.hypot(x - a.x - vx * t, y - a.y - vy * t))
        }
        return d
    }
    const wetness = (x: number, y: number) => {
        // 沼と陸は戦場全体に入り組む。動ける範囲の外では乾く。
        const m = noise(x * .0045 + 50, y * .0045) * .85 + noise(x * .012, y * .012 + 30) * .15
        const edge = smooth(PLAYABLE_HALF - 140, PLAYABLE_HALF - 20, Math.max(Math.abs(x - CENTER), Math.abs(y - CENTER)))
        // 両軍の陣地は、東西の端の真ん中あたりの乾いた土地に建つ。陣地の四角い敷地を少し囲むだけの広さで、縁は不揃い。
        const knoll = Math.min(...KNOLLS.map(k => ((x - k.x) ** 4 + (y - k.y) ** 4) ** .25)) + noise(x * .012 - 40, y * .012) * 12
        return m + .05 - edge - .9 * (1 - smooth(170, 330, knoll))
    }
    const reeds = (x: number, y: number) => {
        const r = noise(x * .009 + 7, y * .009 - 3) * .7 + noise(x * .03 - 11, y * .03) * .3
        return r > .25 ? 2 : r > -.3 ? 1 : 0
    }
    const heightAt = (x: number, y: number) => {
        const dry = DRY_HEIGHT + noise(x * .002, y * .002 + 90) * 4 + noise(x * .01 + 20, y * .01) * 1.2
        // 沼の縁は、乾いた陸からなだらかに水の中へ下る。
        const wet = smooth(-.45, .3, wetness(x, y))
        const ground = dry + (MARSH_FLOOR - dry) * wet
        // 土手道は沼の上に盛った細い道で、乾いた所でも少し高い。
        const bank = smooth(-22, 4, causeway(x, y))
        return ground + (Math.max(ground, DRY_HEIGHT) + CAUSEWAY_RISE - ground) * bank
    }
    return { wetness, causeway, reeds, heightAt, causeways }
}

const marshes = new WeakMap<number[][], Marsh>()

/** その戦場の湿地（湿地の戦場でなければ null）。形はグリッドの中身から決まるので、写したグリッドでも同じになる。 */
export function marshFor(grid: number[][], type: MapType = mapTypeOf(grid)): Marsh | null {
    if (!TERRAIN_PROFILE[type].marsh) return null
    let marsh = marshes.get(grid)
    if (!marsh) marshes.set(grid, marsh = createMarsh(hashString(JSON.stringify(grid)) ^ 0x3a7f21))
    return marsh
}

/** 湿地のマスの種類: 土手道・乾いた陸は undefined、沼は 'marsh'、葦原は 'reeds'、密な葦原は 'denseReeds'。 */
export function marshCell(marsh: Marsh, x: number, y: number): 'marsh' | 'reeds' | 'denseReeds' | undefined {
    if (marsh.causeway(x, y) > 0 || marsh.wetness(x, y) <= 0) return undefined
    const reeds = marsh.reeds(x, y)
    return reeds === 2 ? 'denseReeds' : reeds === 1 ? 'reeds' : 'marsh'
}
