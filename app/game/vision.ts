import { castleCell } from './castleLayout'
import { FORT_VISION, OUTPOST_VISION, UNIT_VISION, VISION, type VisionRange } from './battleConfig'
import { TILE, TILE_PX } from './constants'
import { getNightAlpha } from './daynight'
import { FORT_STRUCTURES, fortTileAt, gridToLocal, isFortWallCell } from './fortLayout'
import { getCellHeight, getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import type { Army, Construction, FortCell, Fort, Point, Soldier, Squad } from '../types/game'
import type { Battle } from './battle'

const G0 = PLAYABLE_GRID_MIN
/** 視界を記録する地図の1辺のマス数。 */
export const VISION_SIZE = PLAYABLE_GRID_MAX - PLAYABLE_GRID_MIN + 1
const N = VISION_SIZE
const ARMIES: Army[] = ['player', 'cpu']
const ownerCode = (army: Army) => army === 'player' ? 0 : 1
const NO_OWNER = 255

// マスの遮蔽の種類。
const OPEN = 0, WOOD_SPARSE = 1, WOOD_DENSE = 2, FENCE = 3, SOLID = 4
const PEEK_CELLS = Math.round(VISION.fencePeek / TILE_PX)

const isWood = (tile: number) => tile === TILE.WOOD || tile >= 31 && tile <= 41

/** 砦の敷地のマスの遮蔽。柵は奥が少し見え、櫓・城壁・建物は完全に遮る。城の裏手の林は森として扱う。 */
function fortCellKind(fort: Fort, gx: number, gy: number): number | undefined {
    const tile = fortTileAt(fort, gx, gy)
    if (!tile) return undefined
    if (tile === 'open') return OPEN
    const { lx, ly } = gridToLocal(fort, gx, gy)
    if (fort.kind === 'castle') return castleCell(lx, ly) === 'grove' ? WOOD_DENSE : SOLID
    const at = FORT_STRUCTURES.find(s => s.blocking && lx >= s.lx && lx < s.lx + s.w && ly >= s.ly && ly < s.ly + s.h)
    if (at?.kind === 'barricade') return FENCE
    return isFortWallCell(lx, ly) && at?.kind !== 'tower' && at?.kind !== 'gateTower' ? FENCE : SOLID
}

interface VisionSource { army: Army; x: number; y: number; range: number; eye: number }

/** 戦場の遮蔽と、軍ごとの「今見えているマス」の地図。 */
export function createVisionMap(grid: number[][], forts: Fort[]) {
    const ground = new Float32Array(N * N), kinds = new Uint8Array(N * N), owners = new Uint8Array(N * N).fill(NO_OWNER)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const gx = i + G0, gy = j + G0, c = j * N + i
        ground[c] = getCellHeight(grid, gx, gy)
        const tile = getPlayableTile(grid, gx, gy)
        kinds[c] = isWood(tile) ? (tile >= 34 ? WOOD_DENSE : WOOD_SPARSE) : OPEN
        for (const fort of forts) {
            const kind = fortCellKind(fort, gx, gy)
            if (kind === undefined) continue
            kinds[c] = kind
            if (kind >= FENCE) owners[c] = ownerCode(fort.owner)
            break
        }
    }
    return {
        ground, kinds, owners,
        /** 建設物が壊れたときに戻す、元の遮蔽。 */
        baseKinds: kinds.slice(),
        masks: { player: new Uint8Array(N * N), cpu: new Uint8Array(N * N) } as Record<Army, Uint8Array>,
        drafts: { player: new Uint8Array(N * N), cpu: new Uint8Array(N * N) } as Record<Army, Uint8Array>,
        /** 地図を更新するたびに増える（描画側はこれを見てテクスチャを更新する）。 */
        version: 0,
        timer: 0,
        sources: [] as VisionSource[],
        cursor: 0,
        pending: false,
    }
}
export type VisionMap = ReturnType<typeof createVisionMap>

const cellOf = (x: number, y: number) => {
    const i = Math.round(x / TILE_PX) - G0, j = Math.round(y / TILE_PX) - G0
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i
}

/** 完成した建設物の柵を遮蔽に加える（占領されたら持ち主を替える）。 */
export function setVisionWalls(vision: VisionMap, cells: FortCell[], owner: Army) {
    for (const { gx, gy } of cells) {
        const c = cellOf(gx * TILE_PX, gy * TILE_PX)
        if (c < 0) continue
        vision.kinds[c] = FENCE
        vision.owners[c] = ownerCode(owner)
    }
}

/** 切り払ったマスの木を遮蔽から除く。 */
export function clearVisionWood(vision: VisionMap, cells: FortCell[]) {
    const isWoodKind = (kind: number) => kind === WOOD_SPARSE || kind === WOOD_DENSE
    for (const { gx, gy } of cells) {
        const c = cellOf(gx * TILE_PX, gy * TILE_PX)
        if (c < 0) continue
        if (isWoodKind(vision.kinds[c]!)) vision.kinds[c] = OPEN
        if (isWoodKind(vision.baseKinds[c]!)) vision.baseKinds[c] = OPEN
    }
}

export function clearVisionWalls(vision: VisionMap, cells: FortCell[]) {
    for (const { gx, gy } of cells) {
        const c = cellOf(gx * TILE_PX, gy * TILE_PX)
        if (c < 0) continue
        vision.kinds[c] = vision.baseKinds[c]!
        vision.owners[c] = NO_OWNER
    }
}

/** 時間帯に応じた視界の広さ。朝夕は夜の暗さに合わせて少しずつ変わる。 */
export function visionRangeAt(range: VisionRange, dayTime: number) {
    return range.day + (range.night - range.day) * getNightAlpha(dayTime) * 2
}

function collectSources(battle: Battle): VisionSource[] {
    const sources: VisionSource[] = []
    for (const squad of battle.squads) {
        if (!squad.count) continue
        const leader = battle.byId.get(squad.leaderId)
        const at = leader && leader.state !== 'dead' ? leader : squad.center
        sources.push({ army: squad.owner, x: at.x, y: at.y, range: visionRangeAt(UNIT_VISION[squad.owner][squad.type], battle.dayTime), eye: VISION.eye })
    }
    for (const fort of battle.forts) sources.push({ army: fort.owner, x: fort.x, y: fort.y, range: visionRangeAt(FORT_VISION[fort.owner], battle.dayTime), eye: VISION.structureEye })
    for (const site of battle.constructions) {
        if (site.kind === 'outpost' && site.complete) sources.push({ army: site.owner, x: site.center.x, y: site.center.y, range: visionRangeAt(OUTPOST_VISION[site.owner], battle.dayTime), eye: VISION.structureEye })
    }
    return sources
}

/** 視点から放射状に視線を伸ばし、見えるマスを印す。自軍の砦と柵は視線を遮らない。 */
function castSource(vision: VisionMap, source: VisionSource, mask: Uint8Array) {
    const { ground, kinds, owners } = vision
    const i0 = Math.round(source.x / TILE_PX) - G0, j0 = Math.round(source.y / TILE_PX) - G0
    if (i0 < 0 || j0 < 0 || i0 >= N || j0 >= N) return
    const me = ownerCode(source.army)
    const z = ground[j0 * N + i0]! + source.eye
    mask[j0 * N + i0] = 1
    const steps = Math.floor(source.range / TILE_PX)
    const rays = Math.ceil(2 * Math.PI * source.range / TILE_PX * 1.5)
    const { target, treeHeight, fenceHeight, wallHeight, woodDepth } = VISION
    for (let r = 0; r < rays; r++) {
        const angle = r / rays * Math.PI * 2, dx = Math.cos(angle), dy = Math.sin(angle)
        // best: 地形と壁のつくる水平線。canopy / fence: 木と柵のてっぺん（これより上を通る視線は遮られない）。
        let best = -Infinity, canopy = -Infinity, cover = 0, fence = -Infinity, peekUntil = Infinity
        for (let k = 1; k <= steps; k++) {
            const i = Math.round(i0 + dx * k), j = Math.round(j0 + dy * k)
            if (i < 0 || j < 0 || i >= N || j >= N) break
            const c = j * N + i, d = k * TILE_PX, g = ground[c]!
            const kind = kinds[c]!
            const blocking = kind >= FENCE && owners[c] !== me
            const height = blocking ? (kind === FENCE ? fenceHeight : wallHeight) : target
            const slope = (g + height - z) / d
            if (slope >= best && (slope >= canopy || cover <= woodDepth) && (slope >= fence || k <= peekUntil)) mask[c] = 1
            if (kind === WOOD_SPARSE || kind === WOOD_DENSE) {
                canopy = Math.max(canopy, (g + treeHeight - z) / d)
                cover += kind === WOOD_DENSE ? 2 : 1
            } else if (blocking && kind === FENCE) {
                fence = Math.max(fence, slope)
                if (peekUntil === Infinity) peekUntil = k + PEEK_CELLS
            } else if (blocking && slope > best) best = slope
            if (k > 1) { const ridge = (g - z) / d; if (ridge > best) best = ridge }
        }
    }
}

/** 兵は自分のすぐ周りが常に分かる（視点の隊長から隠れていても、目の前の敵には気づく）。 */
function markProximity(soldiers: Soldier[], drafts: Record<Army, Uint8Array>) {
    const reach = VISION.proximityCells
    for (const s of soldiers) {
        if (s.state === 'dead' || s.desertion) continue
        const mask = drafts[s.owner]
        const i = Math.round(s.x / TILE_PX) - G0, j = Math.round(s.y / TILE_PX) - G0
        for (let y = Math.max(0, j - reach); y <= Math.min(N - 1, j + reach); y++) {
            for (let x = Math.max(0, i - reach); x <= Math.min(N - 1, i + reach); x++) mask[y * N + x] = 1
        }
    }
}

/** 地図を切り替え、敵に見えている兵・部隊と、認識された建設物を記す。 */
function finishCycle(battle: Battle, instant: boolean) {
    const { vision, time } = battle
    markProximity(battle.soldiers, vision.drafts)
    for (const army of ARMIES) {
        const shown = vision.masks[army]
        vision.masks[army] = vision.drafts[army]
        vision.drafts[army] = shown
    }
    vision.version++
    vision.pending = false
    for (const squad of battle.squads) squad.seenCount = 0
    const sum = new Map<Squad, { x: number; y: number; n: number }>()
    for (const s of battle.soldiers) {
        if (s.state === 'dead') continue
        const c = cellOf(s.x, s.y)
        const seen = c >= 0 && vision.masks[s.owner === 'player' ? 'cpu' : 'player'][c] === 1
        if (seen) s.spottedUntil = time + VISION.linger
        else if (instant) s.spottedUntil = 0
        const squad = s.spottedUntil > time ? battle.squadById.get(s.squadId) : undefined
        if (!squad) continue
        squad.seenCount++
        if (!seen) continue
        const total = sum.get(squad)
        if (total) { total.x += s.x; total.y += s.y; total.n++ } else sum.set(squad, { x: s.x, y: s.y, n: 1 })
        squad.lastSeenTime = time
    }
    for (const [squad, total] of sum) squad.lastSeen = { x: total.x / total.n, y: total.y / total.n }
    for (const site of battle.constructions) {
        for (const army of ARMIES) {
            if (!site.seenBy[army] && siteInView(battle, site, army)) site.seenBy[army] = true
        }
    }
}

function beginCycle(battle: Battle) {
    const { vision } = battle
    vision.sources = collectSources(battle)
    vision.cursor = 0
    vision.pending = true
    vision.timer = VISION.interval
    for (const army of ARMIES) vision.drafts[army].fill(0)
}

/** 毎ティック、視界の計算を少しずつ進める（全部隊をまとめて計算すると引っかかるので、更新間隔に分けて進める）。 */
export function updateVision(battle: Battle, dt: number) {
    const { vision } = battle
    vision.timer -= dt
    if (!vision.pending) {
        if (vision.timer > 0) return
        beginCycle(battle)
    }
    const quota = Math.ceil(vision.sources.length * Math.min(1, dt / VISION.interval))
    const end = Math.min(vision.sources.length, vision.cursor + quota)
    for (; vision.cursor < end; vision.cursor++) {
        const source = vision.sources[vision.cursor]!
        castSource(vision, source, vision.drafts[source.army])
    }
    if (vision.cursor >= vision.sources.length) finishCycle(battle, false)
}

/** 今すぐ視界を計算し直す（開戦前の配置中は時間が進まないので、見えなくなった敵はすぐ隠す）。 */
export function refreshVision(battle: Battle, instant = true) {
    const { vision } = battle
    beginCycle(battle)
    for (const source of vision.sources) castSource(vision, source, vision.drafts[source.army])
    finishCycle(battle, instant)
}

/** その地点が軍の視界の中か。 */
export function isVisibleAt(vision: VisionMap, army: Army, x: number, y: number) {
    const c = cellOf(x, y)
    return c >= 0 && vision.masks[army][c] === 1
}

/** 敵にとって、その兵が今見えているか。 */
export const isSpotted = (battle: Battle, soldier: Soldier) => soldier.spottedUntil > battle.time

/** 敵にとって、その部隊が今見えているか（1人でも見えていれば見える）。 */
export const isSquadSeen = (squad: Squad) => squad.seenCount > 0

/** 軍から見えている敵の部隊。 */
export function seenEnemySquads(battle: Battle, army: Army) {
    return battle.squads.filter(sq => sq.owner !== army && sq.count > 0 && isSquadSeen(sq))
}

/** 敵の部隊について軍が知っている位置（見えていれば今の位置、見失っていれば最後に見えた地点）。 */
export function knownSquadPosition(squad: Squad): Point {
    return isSquadSeen(squad) ? squad.center : squad.lastSeen ?? squad.center
}

/** 建設物のどこかが軍の今の視界に入っているか。 */
export function siteInView(battle: Battle, site: Construction, army: Army) {
    return site.area.some(({ gx, gy }) => isVisibleAt(battle.vision, army, gx * TILE_PX, gy * TILE_PX))
}

/** 敵の建設物は一度認識したら以後も知っている。 */
export const isSiteKnown = (site: Construction, army: Army) => site.seenBy[army]
