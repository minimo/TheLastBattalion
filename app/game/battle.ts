import { TILE, TILE_PX, TILE_VARIANT } from './constants'
import { getTimeDecayMultiplier, getTimeSpeedMultiplier } from './daynight'
import { getTerrainSpeedMultiplier, getTileCost, mobilityOf } from './terrain'
import { BATTLEFIELD_MAX, BATTLEFIELD_MIN, clearConstructionTiles, getPlayableLandscape, getPlayableTile, placeForts, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN, PLAYABLE_MAX, PLAYABLE_MIN, registerForts, setConstructionTile } from './playableArea'
import { cellPoint, constructionWorkSite, planConstruction } from './construction'
import { createFortGeometry, fortCenter, fortDims, fortFootprint, localToWorld } from './fortLayout'
import { CASTLE_CORE_RADIUS } from './castleLayout'
import { createSpatialHash } from './spatialHash'
import { createPathService } from './pathService'
import { axes, COMPANY_MAX_SQUADS, groupCompanies, joinsCompany, layoutCompany, layoutFormationWithCompanies, slotOffset, squadBlock, SQUAD_SIZE, toWorld, type FormationMember } from './formation'
import { armyPool, defaultDeployment, defenderOf, deployedCount, normalizeDeployment, plannedCompanies, type DeploymentPlan } from './deployment'
import {
    ARMY_CAP, ARROW_AIM, ARROW_ARC, COHESION, FOLLOW, ARROW_COVER, ARROW_SPEED, CHARGE_MULTIPLIER, CHARGE_RUN_TIME, CORPSE_SECONDS, DAY_MINUTES_PER_SECOND, FORT_ASSAULT_RANGE,
    FORT_HP, fortVicinityOf, LANE_CONVERGE_DISTANCE, LANE_HALF_WIDTH, LEASH, PATH_BUDGET_PER_TICK, PATH_LOOKAHEAD,
    REINFORCEMENT_INTERVAL, REINFORCEMENT_MIX, SPENT_ARROW_LIMIT, ARROWS_PER_ARCHER, FORT_REFILL_RANGE,
    FORT_REFILL_RATE, RESUPPLY_THRESHOLD, STAMINA, SUPPLY_CHARGES, SUPPLY_DURATION, SUPPORT_RANGE, SUPPORT_THRESHOLD, SHIELD, SPENT_ARROW_SECONDS, TOWER, UNIT_STATS,
    BUILD_REACH, CONSTRUCTION, CONSTRUCTION_AUTO_ATTACK, CONSTRUCTION_DAMAGE, OUTPOST_GUARD_RANGE, OUTPOST_OCCUPY_WORK, OUTPOST_REFILL_RANGE, OUTPOST_SIZE, REPAIR_RATE,
    SIEGE_CAMP_BACK, SIEGE_DEPLOY_DISTANCE, PIKEMAN, DESERTION, COMPANY,
} from './battleConfig'
import type {
    Army, ArmyFormation, ArmySummary, Arrow, BattleMode, Company, Construction, Home, ConstructionAxis, ConstructionKind, FormationType, Fort, Point, Soldier, SpentArrow, Squad, SquadOrder, UnitType,
} from '../types/game'

const ARMIES: Army[] = ['player', 'cpu']
const TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
export const enemyOf = (owner: Army): Army => owner === 'player' ? 'cpu' : 'player'
const clampLane = (lane: number) => Math.max(-LANE_HALF_WIDTH, Math.min(LANE_HALF_WIDTH, lane))

/** 部隊が構える持ち場（陣形の割り当て、または移動・待機の指示先）。 */
interface SquadPost { anchor: Point; facing: number; goal: Point; goalKey: string }

/**
 * 戦場を作る。plans は軍ごとの開戦時の編成（省略した軍は既定の編成）。
 * 編成の部隊の人数は軍の兵から割り当て、残りが砦の予備兵（増援）になる。
 */
export function createBattle(grid: number[][], random: () => number = Math.random, mode: BattleMode = 'field', plans: Partial<Record<Army, DeploymentPlan>> = {}) {
    const landscape = getPlayableLandscape(grid)
    // 攻城戦・防衛戦では守り手だけが砦を持つ。
    const defender = defenderOf(mode)
    const deployments = Object.fromEntries(ARMIES.map(army => {
        const plan = plans[army] ? normalizeDeployment(plans[army]!, mode, army) : undefined
        return [army, plan?.squads.length ? plan : defaultDeployment(mode, army)]
    })) as Record<Army, DeploymentPlan>
    // 攻城戦・防衛戦の守り手の砦は、岩山の城。
    const forts: Fort[] = placeForts(grid, defender ? [defender] : ARMIES, defender ? 'castle' : 'camp').map(site => {
        const center = fortCenter(site)
        const geometry = createFortGeometry(site)
        // Level the camp at the average height of its footprint.
        const area = fortFootprint(site)
        let sum = 0, count = 0
        for (let y = area.minY; y <= area.maxY; y += TILE_PX) for (let x = area.minX; x <= area.maxX; x += TILE_PX) { sum += landscape.heightAt(x, y); count++ }
        return {
            id: `${site.owner}-fort`, owner: site.owner, kind: site.kind, front: site.front, originGx: site.originGx, originGy: site.originGy,
            x: center.x, y: center.y, groundHeight: Math.max(8, Math.min(70, sum / count)),
            hp: FORT_HP, maxHp: FORT_HP,
            core: geometry.core, coreRadius: site.kind === 'castle' ? CASTLE_CORE_RADIUS : 0, assaultPoints: geometry.assaultPoints,
            towers: geometry.towers.map(t => ({ ...t, cooldown: random() * TOWER.cooldown })),
            spawnTimer: REINFORCEMENT_INTERVAL, reserves: armyPool(mode, site.owner) - deployedCount(deployments[site.owner]),
        }
    })
    clearConstructionTiles(grid)
    registerForts(grid, forts)
    // 開戦時の陣は砦の正門前、敵の方を向く。
    const formations = {} as Record<Army, ArmyFormation>
    for (const fort of forts) {
        const wallX = localToWorld(fort, fortDims(fort.kind).depth - 1, 0).x
        formations[fort.owner] = { type: 'line', anchor: { x: wallX + fort.front * 190, y: fort.y }, facing: frontFacing(fort.front), version: 0 }
    }
    const homes = Object.fromEntries(forts.map(fort => [fort.owner, fort as Home])) as Record<Army, Home>
    const battle = {
        grid,
        mode,
        forts,
        /** 退却・補給に戻る本拠地（砦、または砦を持たない攻め手の野営地）。 */
        homes,
        soldiers: [] as Soldier[],
        byId: new Map<number, Soldier>(),
        squads: [] as Squad[],
        squadById: new Map<number, Squad>(),
        /** 部隊ごとの生存兵（毎ティック集計）。 */
        members: new Map<number, Soldier[]>(),
        /** 部隊ごとの持ち場（毎ティック算出）。 */
        posts: new Map<number, SquadPost | undefined>(),
        /** 部隊ごとの隊列の進む向き（隊長の進む向きへ少しずつ回す）。 */
        travel: new Map<number, number>(),
        /** 部隊ごとの隊長の歩く速さの倍率（遅れた兵がいると緩める、毎ティック算出）。 */
        pace: new Map<number, number>(),
        /** 中隊で動いている小隊の、いちばん遅い小隊に歩みをそろえる速さの倍率（毎ティック算出。そろえなければ無い）。 */
        stride: new Map<number, number>(),
        /** ドラッグ中の矢印の下見のために登録した、経路の目標。 */
        previewGoal: '',
        /** 小隊ごとの、中隊のほかの小隊の隊長の位置（毎ティックの初め）と、そこから離れてよい距離（毎ティック算出）。 */
        tether: new Map<number, { anchor: Point; limit: number }[]>(),
        formations,
        /** 川の中のマス（"gx,gy"）から最寄りの岸へのずれ。持ち場を岸へ寄せるのに使う。地形が変わったら捨てる。 */
        shoreShift: new Map<string, Point>(),
        formationCache: { player: { key: '', slots: new Map() }, cpu: { key: '', slots: new Map() } } as Record<Army, { key: string; slots: Map<number, { anchor: Point; facing: number }> }>,
        /** 中隊（隣り合う数個の小隊のまとまり）。 */
        companies: [] as Company[],
        companyById: new Map<number, Company>(),
        nextCompanyId: 1,
        companyNumbers: { player: 0, cpu: 0 } as Record<Army, number>,
        squadNumbers: Object.fromEntries(ARMIES.map(army => [army, Object.fromEntries(TYPES.map(type => [type, 0]))])) as Record<Army, Record<UnitType, number>>,
        /** 工兵の建設物（建設中を含む）。 */
        constructions: [] as Construction[],
        constructionById: new Map<number, Construction>(),
        nextConstructionId: 1,
        arrows: [] as Arrow[],
        spentArrows: [] as SpentArrow[],
        dayTime: 360,
        time: 0,
        nextId: 1,
        nextSquadId: 1,
        winner: null as Army | null,
        killed: { player: 0, cpu: 0 } as Record<Army, number>,
        /** 軍ごとの、戦場から逃げ去った兵の数（撃破には数えない）。 */
        deserted: { player: 0, cpu: 0 } as Record<Army, number>,
        hash: createSpatialHash(),
        paths: createPathService(grid),
        /** 自陣の周りに侵入している敵兵（守備隊の判断に使う）。 */
        intruders: { player: [] as Soldier[], cpu: [] as Soldier[] } as Record<Army, Soldier[]>,
        random,
    }
    if (defender) deploySiege(battle, forts[0]!)
    for (const home of Object.values(homes)) home.assaultPoints.forEach((p, i) => battle.paths.addGoal(fortGoalKey(home.owner, i), p))
    for (const army of ARMIES) deployArmy(battle, army, deployments[army])
    return battle
}
export type Battle = ReturnType<typeof createBattle>

/** 軍の砦（攻城戦・防衛戦の攻め手は持たない）。 */
const fortOf = (battle: Battle, owner: Army): Fort | undefined => battle.forts.find(f => f.owner === owner)
/** 砦の前面（+1: +X方向）の向き。 */
const frontFacing = (front: 1 | -1) => front === 1 ? Math.PI / 2 : -Math.PI / 2

/**
 * 攻城戦・防衛戦の攻め手の布陣: 守り手の砦の正門から少し離れた、開けていて砦まで歩いて行ける場所に、砦の方を向いて陣を敷く。
 * 陣の後方を野営地とし、退却・補給はそこへ戻る。
 */
function deploySiege(battle: Battle, fort: Fort) {
    const attacker = enemyOf(fort.owner)
    const wallX = localToWorld(fort, fortDims(fort.kind).depth - 1, 0).x
    const gate = snapToPassable(battle, createFortGeometry(fort).frontGate)
    const reachable = reachableCells(battle, gate)
    const reach = (p: Point) => reachable.has(`${Math.round(p.x / TILE_PX)},${Math.round(p.y / TILE_PX)}`)
    let best = { x: wallX + fort.front * SIEGE_DEPLOY_DISTANCE, y: fort.y }, bestScore = Infinity
    for (let forward = SIEGE_DEPLOY_DISTANCE - 120; forward <= SIEGE_DEPLOY_DISTANCE + 120; forward += 40) {
        for (let lateral = -240; lateral <= 240; lateral += 60) {
            const p = { x: wallX + fort.front * forward, y: fort.y + lateral }
            if (p.x < BATTLEFIELD_MIN + 120 || p.x > BATTLEFIELD_MAX - 120 || p.y < BATTLEFIELD_MIN + 120 || p.y > BATTLEFIELD_MAX - 120 || !reach(p)) continue
            // 陣を敷く広さ（前後・左右）に川や崖が少なく、予定の距離に近く、砦の正面に近いほどよい。
            let rough = 0
            for (let dy = -150; dy <= 150; dy += 25) for (let dx = -80; dx <= 80; dx += 20) if (!reach({ x: p.x + dx, y: p.y + dy })) rough++
            const score = rough + Math.abs(forward - SIEGE_DEPLOY_DISTANCE) / 40 + Math.abs(lateral) / 60
            if (score < bestScore) { bestScore = score; best = p }
        }
    }
    const facing = frontFacing(fort.front === 1 ? -1 : 1)
    battle.formations[attacker] = { type: 'line', anchor: best, facing, version: 0 }
    // 野営地は陣の後方。兵が集まる地点を周りに散らす。
    const camp = snapToPassable(battle, toWorld(best, facing, -SIEGE_CAMP_BACK, 0))
    const rally = Array.from({ length: 8 }, (_, i) => {
        const a = i / 8 * Math.PI * 2
        const p = { x: camp.x + Math.cos(a) * 18, y: camp.y + Math.sin(a) * 18 }
        return reach(p) ? p : camp
    })
    battle.homes[attacker] = { owner: attacker, front: fort.front === 1 ? -1 : 1, x: camp.x, y: camp.y, core: camp, assaultPoints: rally }
}

/** 地点から歩いて行けるマス（"gx,gy"）。 */
function reachableCells(battle: Battle, from: Point) {
    const start = { gx: Math.round(from.x / TILE_PX), gy: Math.round(from.y / TILE_PX) }
    const seen = new Set([`${start.gx},${start.gy}`])
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
        const { gx, gy } = queue[i]!
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const key = `${gx + dx},${gy + dy}`
            if (seen.has(key) || !battle.paths.passable((gx + dx) * TILE_PX, (gy + dy) * TILE_PX)) continue
            seen.add(key)
            queue.push({ gx: gx + dx, gy: gy + dy })
        }
    }
    return seen
}
/** 砦の攻撃地点（＝退却時の集合地点）への経路キー。 */
const fortGoalKey = (owner: Army, slot: number) => `fort:${owner}:${slot}`

export const isBlocked = (grid: number[][], x: number, y: number) =>
    !Number.isFinite(getTileCost(grid, Math.round(x / TILE_PX), Math.round(y / TILE_PX)))
/** 立ち止まれる陸地でない（川・柵）。 */
const blocked = (battle: Battle, x: number, y: number) => !battle.paths.passable(x, y)
/** 踏み込めない（柵）。川は遅くなるだけで歩いて渡れる。 */
const impassable = (battle: Battle, x: number, y: number) => !battle.paths.walkable(x, y)

/** 2点間の直線が川や柵にかからないか（6px間隔で調べる）。かかるなら経路に従い、渡るか迂回するかを経路選びに任せる。 */
function isClearLine(battle: Battle, x0: number, y0: number, x1: number, y1: number) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6))
    for (let i = 1; i <= steps; i++) if (blocked(battle, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)) return false
    return true
}

/** 川の中の地点を、最寄りの岸へ寄せる。マスごとのずれを覚えておき、同じマスの兵は並びを保ったまま寄る。 */
function toShore(battle: Battle, p: Point): Point {
    if (!blocked(battle, p.x, p.y)) return p
    const gx = Math.round(p.x / TILE_PX), gy = Math.round(p.y / TILE_PX), key = `${gx},${gy}`
    let shift = battle.shoreShift.get(key)
    if (!shift) {
        // 岸のマスの中心へのずれにして、マスの中での位置を保ったまま岸のマスに収める。
        const q = snapToPassable(battle, { x: gx * TILE_PX, y: gy * TILE_PX })
        shift = { x: (Math.round(q.x / TILE_PX) - gx) * TILE_PX, y: (Math.round(q.y / TILE_PX) - gy) * TILE_PX }
        battle.shoreShift.set(key, shift)
    }
    return { x: p.x + shift.x, y: p.y + shift.y }
}

/** 通行不可の地点を、最寄りの通行可能な地点へ寄せる。 */
function snapToPassable(battle: Battle, point: Point): Point {
    // 動ける範囲の外は、まず範囲の端へ寄せる（遠い外でも、近くの外と同じく端に止まる）。
    const p = { x: Math.max(FIELD_MIN, Math.min(FIELD_MAX, point.x)), y: Math.max(FIELD_MIN, Math.min(FIELD_MAX, point.y)) }
    if (!blocked(battle, p.x, p.y)) return p
    for (let ring = 1; ring < 20; ring++) for (let i = 0; i < ring * 8; i++) {
        const a = i / (ring * 8) * Math.PI * 2
        const q = { x: p.x + Math.cos(a) * ring * TILE_PX / 2, y: p.y + Math.sin(a) * ring * TILE_PX / 2 }
        if (!blocked(battle, q.x, q.y)) return q
    }
    return { x: p.x, y: p.y }
}

const goalKeyOf = (prefix: string, point: Point) => `${prefix}:${Math.round(point.x)},${Math.round(point.y)}`

/** 地点への経路キーを作り、目的地からのコスト場を用意する。 */
function goalFor(battle: Battle, prefix: string, point: Point, previous?: string) {
    const key = goalKeyOf(prefix, point)
    if (previous && previous !== key && !previous.startsWith('fort:')) battle.paths.dropGoal(previous)
    battle.paths.addGoal(key, point)
    return key
}

// ---- 工兵の建設物 ----

const buildGoalKey = (site: Construction) => `build:${site.id}`
const depotGoalKey = (site: Construction) => `depot:${site.id}`
/** 工兵が建設物の作業地点に立って働く指示（建設・修理と、敵の拠点の占領）。 */
const worksAtSite = (order: SquadOrder) => order === 'build' || order === 'occupy'

/** 建設物のマスのうち、地点に最も近いマスの中心。all=falseなら攻撃できるマス（柵か橋の床）だけを見る。 */
function nearestCell(site: Construction, point: Point, all = false): Point {
    const cells = all ? site.area : site.walls.length ? site.walls : site.deck
    let best = site.center, bestDistance = Infinity
    for (const cell of cells) {
        const p = cellPoint(cell)
        const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
        if (d < bestDistance) { bestDistance = d; best = p }
    }
    return best
}

/** 完成した建設物を地形に反映する（柵は通行不可、橋は渡れる）。柵の上にいた兵は外へ出す。 */
function completeConstruction(battle: Battle, site: Construction) {
    site.complete = true
    site.progress = 1
    for (const c of site.walls) setConstructionTile(battle.grid, c.gx, c.gy, TILE.WALL)
    for (const c of site.deck) setConstructionTile(battle.grid, c.gx, c.gy, TILE.BRIDGE)
    battle.paths.refresh([...site.walls, ...site.deck])
    battle.shoreShift.clear()
    for (const s of battle.soldiers) {
        if (s.state === 'dead') continue
        s.path = []; s.pathGoal = ''
        if (impassable(battle, s.x, s.y)) { const p = snapToPassable(battle, s); s.x = p.x; s.y = p.y }
    }
    if (site.kind === 'outpost') battle.paths.addGoal(depotGoalKey(site), site.center)
}

/** 建設物を取り除き、地形を元に戻す。壊れた橋の上にいた兵は川に落ちる。 */
function destroyConstruction(battle: Battle, site: Construction) {
    battle.constructions = battle.constructions.filter(c => c !== site)
    battle.constructionById.delete(site.id)
    battle.paths.dropGoal(buildGoalKey(site))
    battle.paths.dropGoal(depotGoalKey(site))
    if (!site.complete) return
    for (const c of [...site.walls, ...site.deck]) setConstructionTile(battle.grid, c.gx, c.gy, undefined)
    battle.paths.refresh([...site.walls, ...site.deck])
    battle.shoreShift.clear()
    const deck = new Set(site.deck.map(c => `${c.gx},${c.gy}`))
    for (const s of battle.soldiers) {
        if (s.state === 'dead') continue
        s.path = []; s.pathGoal = ''
        if (deck.has(`${Math.round(s.x / TILE_PX)},${Math.round(s.y / TILE_PX)}`)) damageSoldier(battle, s, Infinity)
    }
}

function damageConstruction(battle: Battle, site: Construction, amount: number) {
    site.hp -= amount
    if (site.hp <= 0 && battle.constructionById.has(site.id)) destroyConstruction(battle, site)
}

/** 拠点の持ち主の工兵が拠点にいるか（いる間は敵に占領されない）。 */
function outpostGuarded(battle: Battle, site: Construction) {
    let guarded = false
    battle.hash.forEachNear(site.center.x, site.center.y, OUTPOST_GUARD_RANGE, s => {
        if (s.owner === site.owner && s.type === 'engineer' && s.state !== 'dead' && !s.desertion
            && Math.hypot(s.x - site.center.x, s.y - site.center.y) <= OUTPOST_GUARD_RANGE) guarded = true
    })
    return guarded
}

/** 工兵が占領できる敵の拠点か（完成していて、持ち主の工兵がいない）。 */
export function canOccupy(battle: Battle, army: Army, site: Construction) {
    return site.kind === 'outpost' && site.complete && site.owner !== army && !outpostGuarded(battle, site)
}

/** 占領した拠点を自軍のものにする。前の持ち主の部隊は、ここで補給を受けられなくなる。 */
function occupyOutpost(battle: Battle, site: Construction) {
    site.owner = enemyOf(site.owner)
    site.occupation = 0
    for (const squad of battle.squads) {
        if (squad.owner !== site.owner && squad.depotId === site.id) squad.depotId = nearestDepot(battle, squad.owner, squad.center)
    }
}

/** 工兵の作業で建設を進め（完成したら地形に反映）、完成後は修理する。手付かずの建設予定地は片付ける。敵の工兵が占領を進め、終えたら拠点を奪う。 */
function updateConstructions(battle: Battle, dt: number) {
    for (const site of [...battle.constructions]) {
        if (site.occupiers > 0) {
            if (!outpostGuarded(battle, site)) {
                site.occupation = Math.min(1, site.occupation + site.occupiers * dt / OUTPOST_OCCUPY_WORK)
                if (site.occupation >= 1 - 1e-9) occupyOutpost(battle, site)
            }
        } else if (site.occupation > 0 && !battle.squads.some(sq => sq.owner !== site.owner && sq.constructionId === site.id && (sq.order === 'occupy' || sq.resume?.order === 'occupy'))) {
            // 占領に当たる工兵がいなくなったら、占領は初めからやり直し。
            site.occupation = 0
        }
        if (site.workers > 0) {
            if (!site.complete) {
                const done = Math.min(1 - site.progress, site.workers * dt / site.work)
                site.progress += done
                site.hp = Math.min(site.maxHp, site.hp + site.maxHp * .9 * done)
                if (site.progress >= 1 - 1e-9) completeConstruction(battle, site)
            } else site.hp = Math.min(site.maxHp, site.hp + site.workers * REPAIR_RATE * dt)
        }
        if (site.progress <= 0 && !battle.squads.some(sq => sq.constructionId === site.id && (sq.order === 'build' || sq.resume?.order === 'build'))) {
            destroyConstruction(battle, site)
        }
    }
}

/** 自陣の砦（野営地）と、自軍の完成した拠点のうち、地点に最も近い補給先（-1は砦・野営地）。 */
function nearestDepot(battle: Battle, owner: Army, from: Point) {
    const home = battle.homes[owner]
    let best = -1, bestDistance = Math.hypot(home.x - from.x, home.y - from.y)
    for (const site of battle.constructions) {
        if (site.owner !== owner || site.kind !== 'outpost' || !site.complete) continue
        const d = Math.hypot(site.center.x - from.x, site.center.y - from.y)
        if (d < bestDistance) { bestDistance = d; best = site.id }
    }
    return best
}

/** 部隊が補給を受ける場所（中心と、補給を受けられる距離）。拠点が壊れていれば砦。 */
export function depotOf(battle: Battle, squad: Squad) {
    const site = squad.depotId >= 0 ? battle.constructionById.get(squad.depotId) : undefined
    if (site?.complete && site.owner === squad.owner) return { x: site.center.x, y: site.center.y, range: OUTPOST_REFILL_RANGE, site }
    const home = battle.homes[squad.owner]
    return { x: home.x, y: home.y, range: FORT_REFILL_RANGE, site: undefined }
}

export function spawnSoldier(battle: Battle, squad: Squad, x: number, y: number, lane = 0): Soldier {
    const stats = UNIT_STATS[squad.owner][squad.type]
    const arrows = squad.type === 'archer' ? ARROWS_PER_ARCHER : 0
    const soldier: Soldier = {
        id: battle.nextId++, owner: squad.owner, type: squad.type, squadId: squad.id, slot: (battle.members.get(squad.id)?.length ?? 0),
        x, y, hp: stats.hp, maxHp: stats.hp, state: 'advance',
        heading: squad.facing, moving: false,
        path: [], pathIndex: 0, pathGoal: '', targetId: -1,
        thinkTimer: battle.random() * .5, attackTimer: battle.random() * stats.cooldown, swing: 0, runTime: 0, fleeTimer: 0,
        courage: .75 + battle.random() * .5, elapsedTime: battle.random() * 10, deathTime: 0, stuckTime: 0, detour: 0, lane, routeDirect: true, vx: 0, vy: 0, aim: 0, arrows, maxArrows: arrows,
        constructionId: -1, regroup: false, desertion: null,
    }
    battle.soldiers.push(soldier)
    battle.byId.set(soldier.id, soldier)
    if (!battle.members.has(squad.id)) battle.members.set(squad.id, [])
    battle.members.get(squad.id)!.push(soldier)
    squad.count = battle.members.get(squad.id)!.length
    return soldier
}

function createSquad(battle: Battle, owner: Army, type: UnitType, size: number, order: SquadOrder): Squad {
    const formation = battle.formations[owner]
    const squad: Squad = {
        id: battle.nextSquadId++, owner, type, number: ++battle.squadNumbers[owner][type], companyId: -1, order,
        anchor: { ...formation.anchor }, facing: formation.facing, goalKey: '', targetSquadId: -1,
        center: { ...formation.anchor }, count: 0, size, leaderId: -1, arrows: 0, maxArrows: 0, resume: null,
        stamina: STAMINA.max, supplies: type === 'supply' ? SUPPLY_CHARGES : 0, maxSupplies: type === 'supply' ? SUPPLY_CHARGES : 0, servingId: -1,
        constructionId: -1, depotId: -1, march: null, arriving: false,
    }
    battle.squads.push(squad)
    battle.squadById.set(squad.id, squad)
    battle.members.set(squad.id, [])
    return squad
}

/** 開戦時、全軍が編成の陣形で砦の正門前（攻め手は敵の砦から離れた陣）に布陣する。 */
function deployArmy(battle: Battle, owner: Army, plan: DeploymentPlan) {
    battle.formations[owner].type = plan.formation
    const created = plan.squads.map(({ type, size }) => createSquad(battle, owner, type, size, 'formation'))
    // 編成で組んだ中隊を作り、残りの小隊は陣で隣り合う同じ兵種の小隊と中隊にまとめる（工兵と補給兵は中隊に入れない）。
    for (const { indices } of plannedCompanies(plan)) createCompany(battle, owner, indices.map(i => created[i]!), true)
    const rest = created.filter(sq => sq.companyId < 0 && joinsCompany(sq.type))
    const layout = layoutWithCompanies(battle, battle.formations[owner].type, created, true)
    for (const ids of groupCompanies(rest.map(memberOf), layout)) createCompany(battle, owner, ids.map(id => battle.squadById.get(id)!))
    const slots = formationSlots(battle, owner)
    const formation = battle.formations[owner]
    for (const squad of battle.squads.filter(sq => sq.owner === owner)) {
        const post = slots.get(squad.id)!
        squad.anchor = post.anchor; squad.facing = post.facing
        for (let i = 0; i < squad.size; i++) {
            const offset = slotOffset(squad.type, squad.size, i)
            let p = toWorld(post.anchor, post.facing, offset.forward + (battle.random() - .5) * 1.2, offset.lateral + (battle.random() - .5) * 1.2)
            // Shift troops standing in water or on walls to the nearest open ground.
            p = snapToPassable(battle, p)
            const { rx, ry } = axes(formation.facing)
            spawnSoldier(battle, squad, p.x, p.y, clampLane((p.x - formation.anchor.x) * rx + (p.y - formation.anchor.y) * ry))
        }
        // 補給部隊は陣の最後尾から、自動で弓兵への補給を始める。
        if (squad.type === 'supply') squad.order = 'support'
    }
    // 開戦前（部隊編成の間）は時間が止まっていて毎ティックの集計が走らないので、布陣した兵から小隊の中心と中隊長を決めておく。
    for (const squad of battle.squads) {
        const members = battle.members.get(squad.id)
        if (squad.owner !== owner || !members?.length) continue
        squad.center = { x: members.reduce((sum, s) => sum + s.x, 0) / members.length, y: members.reduce((sum, s) => sum + s.y, 0) / members.length }
    }
    for (const company of battle.companies) if (company.owner === owner) chooseCompanyLeader(battle, company, companySquads(battle, company.id))
}

const memberOf = (sq: Squad): FormationMember => ({ id: sq.id, type: sq.type, size: sq.size })

/**
 * 小隊を陣に並べた持ち場（陣の前列中央からの相対位置）。中隊の小隊は中隊のかたまりで並べ、同じ中隊の小隊が陣の離れた所（両翼の左右など）に分かれないようにする。
 * plannedOnly なら編成で組んだ中隊だけをかたまりにする（開戦時、残りの小隊を自動で中隊に分ける前）。
 */
function layoutWithCompanies(battle: Battle, type: FormationType, squads: Squad[], plannedOnly = false) {
    const singles: FormationMember[] = [], blocks = new Map<number, FormationMember[]>()
    for (const sq of squads) {
        const company = battle.companyById.get(sq.companyId)
        // かたまりのIDは小隊のIDと重ならないよう負にする。
        if (company && (company.planned || !plannedOnly)) {
            if (!blocks.has(-company.id)) blocks.set(-company.id, [])
            blocks.get(-company.id)!.push(memberOf(sq))
        } else singles.push(memberOf(sq))
    }
    // 陣に1小隊しかいない中隊は、かたまりにしなくてよい。
    for (const [id, list] of blocks) if (list.length === 1 && !battle.companyById.get(-id)!.planned) { singles.push(list[0]!); blocks.delete(id) }
    return layoutFormationWithCompanies(type, singles, blocks)
}

function createCompany(battle: Battle, owner: Army, squads: Squad[], planned = false): Company {
    const company: Company = { id: battle.nextCompanyId++, owner, number: ++battle.companyNumbers[owner], squadIds: squads.map(sq => sq.id), planned, together: false, leaderSquadId: -1, layout: {} }
    for (const squad of squads) squad.companyId = company.id
    layoutCompanyOf(battle, company)
    battle.companies.push(company)
    battle.companyById.set(company.id, company)
    return company
}

/** 中隊の隊形での小隊の持ち場を決め直す（小隊どうしが離れてよい距離の元）。 */
function layoutCompanyOf(battle: Battle, company: Company) {
    const squads = company.squadIds.map(id => battle.squadById.get(id)).filter((sq): sq is Squad => !!sq)
    const slots = layoutCompany(squads.map(sq => ({ id: sq.id, type: sq.type, size: sq.size })))
    company.layout = Object.fromEntries([...slots].map(([id, { forward, lateral }]) => [id, { forward, lateral }]))
}

/**
 * 増援の小隊を中隊に入れる。同じ兵種だけの中隊（編成で組んだ中隊も。兵種を混ぜた中隊には入れない）で、空きがあり、全員が陣形の持ち場へ向かっている（増援と同じ所へ行く）中隊があればそこへ、
 * なければ新しい中隊を組む。工兵と補給兵は中隊に入れない。
 */
function joinCompany(battle: Battle, squad: Squad) {
    if (!joinsCompany(squad.type)) return
    const company = battle.companies.find(c => {
        if (c.owner !== squad.owner || c.squadIds.length >= COMPANY_MAX_SQUADS) return false
        return c.squadIds.every(id => { const sq = battle.squadById.get(id); return sq && sq.type === squad.type && sq.order === squad.order && sq.order === 'formation' })
    })
    if (!company) { createCompany(battle, squad.owner, [squad]); return }
    company.squadIds.push(squad.id)
    squad.companyId = company.id
    squad.arriving = true
    layoutCompanyOf(battle, company)
}

/** 開戦前（部隊編成の画面）に、軍の部隊を編成し直して布陣し直す。人数を割り当てた残りが砦の予備兵になる。 */
export function redeployArmy(battle: Battle, owner: Army, plan: DeploymentPlan) {
    const deployment = normalizeDeployment(plan, battle.mode, owner)
    if (!deployment.squads.length) return
    for (const squad of battle.squads.filter(sq => sq.owner === owner)) {
        battle.squadById.delete(squad.id)
        battle.members.delete(squad.id)
        battle.posts.delete(squad.id)
    }
    battle.squads = battle.squads.filter(sq => sq.owner !== owner)
    for (const company of battle.companies) if (company.owner === owner) battle.companyById.delete(company.id)
    battle.companies = battle.companies.filter(c => c.owner !== owner)
    battle.companyNumbers[owner] = 0
    for (const s of battle.soldiers) if (s.owner === owner) battle.byId.delete(s.id)
    battle.soldiers = battle.soldiers.filter(s => s.owner !== owner)
    for (const type of TYPES) battle.squadNumbers[owner][type] = 0
    battle.formationCache[owner].key = ''
    const fort = fortOf(battle, owner)
    if (fort) fort.reserves = armyPool(battle.mode, owner) - deployedCount(deployment)
    deployArmy(battle, owner, deployment)
    battle.hash.rebuild(battle.soldiers)
}

/** 全軍の陣形に加わっている部隊の持ち場。部隊の顔ぶれか陣形が変わったときだけ計算し直す。 */
function formationSlots(battle: Battle, owner: Army) {
    const formation = battle.formations[owner]
    const members = battle.squads.filter(sq => sq.owner === owner && sq.order === 'formation')
    const key = `${formation.type}:${formation.version}:${members.map(sq => `${sq.id}/${sq.companyId}`).join(',')}`
    const cache = battle.formationCache[owner]
    if (cache.key === key) return cache.slots
    const layout = layoutWithCompanies(battle, formation.type, members)
    const posts = [...layout].map(([id, slot]) => {
        const squad = battle.squadById.get(id)!
        return { id, squad, anchor: toWorld(formation.anchor, formation.facing, slot.forward, slot.lateral), facing: formation.facing + slot.facing }
    })
    // 陣が戦場の端にあると両翼などの持ち場が戦場の外に出て、その部隊がたどり着けずに動かなくなる。
    // まず陣ごと平行にずらして戦場に収め、それでも収まらない（陣が戦場より広い）持ち場は陣の中心へ寄せる。
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
    for (const post of posts) for (const p of blockCorners(post.anchor, post.facing, post.squad)) {
        left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y)
    }
    const shift = { x: fieldShift(left, right), y: fieldShift(top, bottom) }
    cache.slots = new Map(posts.map(post => {
        const anchor = { x: post.anchor.x + shift.x, y: post.anchor.y + shift.y }
        return [post.id, { anchor: fitInField(formation.anchor, anchor, post.facing, post.squad), facing: post.facing }]
    }))
    cache.key = key
    return cache.slots
}

/** 戦場（経路を探せる範囲）の端。 */
const FIELD_MIN = PLAYABLE_GRID_MIN * TILE_PX, FIELD_MAX = PLAYABLE_GRID_MAX * TILE_PX
const inField = (p: Point) => p.x >= FIELD_MIN && p.x <= FIELD_MAX && p.y >= FIELD_MIN && p.y <= FIELD_MAX

/** 持ち場（前列中央）に組んだ部隊の隊列の四隅。 */
function blockCorners(anchor: Point, facing: number, squad: Squad) {
    const { width, depth } = squadBlock(squad.type, Math.max(1, squad.size))
    return [[0, -.5], [0, .5], [-1, -.5], [-1, .5]].map(([f, l]) => toWorld(anchor, facing, f! * depth, l! * width))
}

/** min〜max の幅を戦場の中へ収めるずらし量（戦場より広ければ、はみ出しの少ない側へ寄せない）。 */
function fieldShift(min: number, max: number) {
    if (min < FIELD_MIN && max > FIELD_MAX) return 0
    if (min < FIELD_MIN) return Math.min(FIELD_MIN - min, FIELD_MAX - max)
    if (max > FIELD_MAX) return Math.max(FIELD_MAX - max, FIELD_MIN - min)
    return 0
}

/** 持ち場の隊列が戦場の外へはみ出すなら、陣の中心へ向かって寄せて収める。 */
function fitInField(center: Point, anchor: Point, facing: number, squad: Squad): Point {
    const fits = (p: Point) => blockCorners(p, facing, squad).every(inField)
    if (fits(anchor)) return anchor
    for (let t = .05; t < 1; t += .05) {
        const p = { x: anchor.x + (center.x - anchor.x) * t, y: anchor.y + (center.y - anchor.y) * t }
        if (fits(p)) return p
    }
    return { ...center }
}

function formationGoalKey(battle: Battle, owner: Army) {
    return goalFor(battle, `formation:${owner}`, battle.formations[owner].anchor)
}

// ---- 指示 ----

function resetMembers(battle: Battle, squad: Squad, dropTargets: boolean) {
    for (const s of battle.members.get(squad.id) ?? []) {
        s.pathGoal = ''
        s.thinkTimer = Math.min(s.thinkTimer, .1)
        if (dropTargets) { s.targetId = -1; s.constructionId = -1 }
        if (s.state === 'flee' && squad.order !== 'retreat') s.state = 'advance'
    }
}

/**
 * 移動・攻撃・破壊の指示で小隊に決まること（指示・持ち場・向き・相手、経路の目標 goal）。
 * 指示を出す関数（orderMove など）と、ドラッグ中の矢印の下見（previewCompanyRoute）が同じものを使う。
 */
type OrderPlan = Pick<Squad, 'order' | 'anchor'> & Partial<Pick<Squad, 'facing' | 'targetSquadId' | 'constructionId'>> & { goal: Point }

function movePlan(battle: Battle, squad: Squad, point: Point, facing?: number): OrderPlan {
    const target = snapToPassable(battle, point)
    const f = facing ?? Math.atan2(target.x - squad.center.x, target.y - squad.center.y)
    // 指定地点を部隊の中心にする（持ち場の原点は前列中央）。
    const depth = squadBlock(squad.type, Math.max(1, squad.count)).depth
    return { order: 'move', facing: f, anchor: toWorld(target, f, depth / 2, 0), goal: target }
}

function attackPlan(battle: Battle, target: Squad): OrderPlan {
    const anchor = snapToPassable(battle, target.center)
    return { order: 'attack', targetSquadId: target.id, anchor, goal: anchor }
}

function demolishPlan(battle: Battle, squad: Squad, site: Construction): OrderPlan {
    const anchor = snapToPassable(battle, nearestCell(site, squad.center, true))
    return { order: 'demolish', constructionId: site.id, anchor, goal: anchor }
}

/** 指示を小隊に当て、経路の目標を用意する。 */
function applyPlan(battle: Battle, squad: Squad, { goal, ...plan }: OrderPlan) {
    Object.assign(squad, plan)
    squad.goalKey = goalFor(battle, `squad:${squad.id}`, goal, squad.goalKey)
}

/** 指定地点へ移動して構える。向きは進む方向。 */
export function orderMove(battle: Battle, squadId: number, point: Point, facing?: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad) return
    applyPlan(battle, squad, movePlan(battle, squad, point, facing))
    resetMembers(battle, squad, false)
}

/** その場で構える。 */
export function orderHold(battle: Battle, squadId: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad) return
    const depth = squadBlock(squad.type, Math.max(1, squad.count)).depth
    const center = snapToPassable(battle, squad.center)
    squad.order = 'hold'
    squad.anchor = toWorld(center, squad.facing, depth / 2, 0)
    squad.goalKey = goalFor(battle, `squad:${squad.id}`, center, squad.goalKey)
    resetMembers(battle, squad, false)
}

export function orderAttack(battle: Battle, squadId: number, targetSquadId: number) {
    const squad = battle.squadById.get(squadId), target = battle.squadById.get(targetSquadId)
    if (!squad || !target || target.owner === squad.owner) return
    applyPlan(battle, squad, attackPlan(battle, target))
    resetMembers(battle, squad, true)
}

/** 各兵が自由に戦いながら敵本陣へ突撃する。今の横の広がりを保って進む。 */
export function orderCharge(battle: Battle, squadId: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad) return
    squad.order = 'charge'
    const formation = battle.formations[squad.owner]
    const { rx, ry } = axes(formation.facing)
    for (const s of battle.members.get(squad.id) ?? []) s.lane = clampLane((s.x - formation.anchor.x) * rx + (s.y - formation.anchor.y) * ry)
    resetMembers(battle, squad, false)
}

/** 自陣へ退く。中隊の小隊は中隊から離れないので、中隊ごと退く。 */
export function orderRetreat(battle: Battle, squadId: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad) return
    squad.order = 'retreat'
    resetMembers(battle, squad, true)
    for (const mate of companySquads(battle, squad.companyId)) if (mate.order !== 'retreat') orderRetreat(battle, mate.id)
}

export function orderFormation(battle: Battle, squadId: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad) return
    squad.order = 'formation'
    // 持ち場はすぐに陣形の中の位置へ移す（一時停止中でも指示の矢印が行き先を指すように）。
    const slot = formationSlots(battle, squad.owner).get(squad.id)
    if (slot) { squad.anchor = slot.anchor; squad.facing = slot.facing }
    resetMembers(battle, squad, false)
}

/**
 * 部隊ごと自陣（自陣より近い自軍の拠点があればそこ）へ戻って矢・体力（補給部隊は補給回数も）を回復し、
 * 終わったら今の指示に戻る。中隊の小隊は中隊から離れないので、中隊ごと同じ補給先へ戻り、みな終えてから指示に戻る。
 */
export function orderResupply(battle: Battle, squadId: number, depotId?: number) {
    const squad = battle.squadById.get(squadId)
    if (!squad || squad.order === 'resupply') return
    squad.resume = squad.order === 'retreat' ? null
        : { order: squad.order, anchor: { ...squad.anchor }, facing: squad.facing, targetSquadId: squad.targetSquadId, constructionId: squad.constructionId }
    squad.order = 'resupply'
    squad.depotId = depotId ?? nearestDepot(battle, squad.owner, squad.center)
    resetMembers(battle, squad, true)
    for (const mate of companySquads(battle, squad.companyId)) orderResupply(battle, mate.id, squad.depotId)
}

/** 工兵に建設物を建てさせる（建設中なら続きを、完成していて傷んでいれば修理を）。 */
export function orderBuild(battle: Battle, squadId: number, constructionId: number) {
    const squad = battle.squadById.get(squadId), site = battle.constructionById.get(constructionId)
    if (!squad || squad.type !== 'engineer' || !site || site.owner !== squad.owner) return
    squad.order = 'build'
    squad.constructionId = site.id
    // 橋は工兵のいる側の岸で作業する（別の岸から来た部隊のために作業地点を選び直す）。
    if (site.kind === 'bridge' && !site.complete) Object.assign(site, constructionWorkSite(site, squad.center, (x, y) => battle.paths.passable(x, y)))
    battle.paths.addGoal(buildGoalKey(site), site.approach)
    resetMembers(battle, squad, true)
}

/** 工兵に敵の拠点を占領させる（拠点の内側で作業する）。持ち主の工兵がいる拠点は占領できない。 */
export function orderOccupy(battle: Battle, squadId: number, constructionId: number) {
    const squad = battle.squadById.get(squadId), site = battle.constructionById.get(constructionId)
    if (!squad || squad.type !== 'engineer' || !site || !canOccupy(battle, squad.owner, site)) return
    squad.order = 'occupy'
    squad.constructionId = site.id
    battle.paths.addGoal(buildGoalKey(site), site.approach)
    resetMembers(battle, squad, true)
}

/** 指定した場所に建設物を置いて、工兵に建てさせる。建てられない場所ならfalse。 */
export function orderConstruct(battle: Battle, squadId: number, kind: ConstructionKind, point: Point, axis: ConstructionAxis = 'y') {
    const squad = battle.squadById.get(squadId)
    if (!squad || squad.type !== 'engineer') return false
    const plan = planConstruction(battle, squad.owner, kind, point, axis)
    if (!plan.valid) return false
    const site: Construction = {
        ...plan, id: battle.nextConstructionId++, progress: 0, work: CONSTRUCTION[kind].work * (kind === 'bridge' ? plan.deck.length : 1),
        hp: CONSTRUCTION[kind].hp * .1, maxHp: CONSTRUCTION[kind].hp, complete: false, workers: 0, occupation: 0, occupiers: 0,
        ...constructionWorkSite(plan, squad.center, (x, y) => battle.paths.passable(x, y)),
    }
    battle.constructions.push(site)
    battle.constructionById.set(site.id, site)
    orderBuild(battle, squad.id, site.id)
    return true
}

/** 指定した敵の建設物を壊しに行く。 */
export function orderDemolish(battle: Battle, squadId: number, constructionId: number) {
    const squad = battle.squadById.get(squadId), site = battle.constructionById.get(constructionId)
    if (!squad || !site || site.owner === squad.owner) return
    applyPlan(battle, squad, demolishPlan(battle, squad, site))
    resetMembers(battle, squad, true)
}

/** 地点の近く（radius以内）にある建設物。 */
export function constructionNear(battle: Battle, point: Point, radius: number) {
    let best: Construction | undefined, bestDistance = radius
    for (const site of battle.constructions) {
        const p = nearestCell(site, point, true)
        const d = Math.hypot(p.x - point.x, p.y - point.y)
        if (d < bestDistance) { bestDistance = d; best = site }
    }
    return best
}

/** 建設地を下見する（表示用）。 */
export function previewConstruction(battle: Battle, owner: Army, kind: ConstructionKind, point: Point, axis: ConstructionAxis = 'y') {
    return planConstruction(battle, owner, kind, point, axis)
}

/** 補給部隊に、味方の部隊へ矢と体力を届けさせる。部隊を指定しなければ、不足の大きい部隊を自分で探す。 */
export function orderSupport(battle: Battle, squadId: number, targetSquadId = -1) {
    const squad = battle.squadById.get(squadId)
    if (!squad || squad.type !== 'supply') return
    const target = battle.squadById.get(targetSquadId)
    squad.order = 'support'
    squad.targetSquadId = target && target.owner === squad.owner && target.type !== 'supply' ? target.id : -1
    resetMembers(battle, squad, true)
}

/** 補給を終えた部隊を、補給に戻る前の指示に戻す。 */
function resumeOrder(battle: Battle, squad: Squad) {
    const resume = squad.resume
    squad.resume = null
    if (!resume) { orderHold(battle, squad.id); return }
    if (resume.order === 'attack') {
        if (battle.squadById.has(resume.targetSquadId)) orderAttack(battle, squad.id, resume.targetSquadId)
        else orderHold(battle, squad.id)
    } else if (resume.order === 'formation') orderFormation(battle, squad.id)
    else if (resume.order === 'charge') orderCharge(battle, squad.id)
    else if (resume.order === 'support') orderSupport(battle, squad.id, resume.targetSquadId)
    else if (resume.order === 'build' && battle.constructionById.has(resume.constructionId)) orderBuild(battle, squad.id, resume.constructionId)
    else if (resume.order === 'demolish' && battle.constructionById.has(resume.constructionId)) orderDemolish(battle, squad.id, resume.constructionId)
    else if (resume.order === 'occupy' && battle.constructionById.has(resume.constructionId)) orderOccupy(battle, squad.id, resume.constructionId)
    else if (resume.order === 'move' || resume.order === 'hold') {
        // 持ち場（とその経路キー）は補給中も保っているので、そのまま戻る。
        squad.order = resume.order
        squad.anchor = resume.anchor
        squad.facing = resume.facing
        resetMembers(battle, squad, false)
    } else orderHold(battle, squad.id)
}

/** 全軍の陣形を変え、すべての部隊を陣に戻す（補給中の部隊と、補給に当たっている補給部隊・建設中の工兵はそのまま）。 */
export function setFormation(battle: Battle, owner: Army, type: FormationType) {
    const formation = battle.formations[owner]
    formation.type = type
    formation.version++
    for (const squad of battle.squads) {
        if (squad.owner !== owner || squad.order === 'resupply' || squad.order === 'support' || worksAtSite(squad.order)) continue
        orderFormation(battle, squad.id)
    }
}

/** 陣全体を移動する。向きは敵軍（いなければ敵本陣）の方。 */
export function moveFormation(battle: Battle, owner: Army, point: Point) {
    const formation = battle.formations[owner]
    const target = snapToPassable(battle, point)
    let ex = 0, ey = 0, n = 0
    for (const s of battle.soldiers) if (s.owner !== owner && s.state !== 'dead') { ex += s.x; ey += s.y; n++ }
    const enemy = n ? { x: ex / n, y: ey / n } : battle.homes[enemyOf(owner)].core
    const previous = formationGoalKey(battle, owner)
    formation.anchor = target
    if (Math.hypot(enemy.x - target.x, enemy.y - target.y) > 1) formation.facing = Math.atan2(enemy.x - target.x, enemy.y - target.y)
    formation.version++
    const key = formationGoalKey(battle, owner)
    if (key !== previous) battle.paths.dropGoal(previous)
    for (const squad of battle.squads) if (squad.owner === owner && squad.order === 'formation') resetMembers(battle, squad, false)
}

// ---- 中隊への指示 ----

/** 中隊の小隊どうしが離れてよい距離（隊長どうし）。中隊の隊形での持ち場どうしの距離に COMPANY.leash を足す。 */
function pairLimit(company: Company, a: number, b: number) {
    const p = company.layout[a], q = company.layout[b]
    return (p && q ? Math.hypot(p.forward - q.forward, p.lateral - q.lateral) : 0) + COMPANY.leash
}

/**
 * 中隊の小隊を中隊から離さない（指示・兵種・中隊長かどうかを問わず、例外はない）。
 * 中隊のどの2小隊も、隊長どうしが pairLimit より離れる向きには動けない（holdTether）。先へ進もうとする小隊は、遅れた小隊が追いつくまでそこで待つ。
 * ここでは、毎ティックの初めの隊長の位置を、ほかの小隊の兵が測る基準として控える。増援は中隊に着いた（どの小隊とも pairLimit 以内になった）ら決まりに入る。
 * 攻撃している小隊は、中隊から遠い相手を追わない。
 */
function keepTogether(battle: Battle, company: Company, squads: Squad[]) {
    const at = new Map(squads.map(sq => { const { x, y } = squadPosition(battle, sq); return [sq, { x, y }] }))
    for (const sq of squads) {
        if (!sq.arriving) continue
        const p = at.get(sq)!
        if (squads.every(other => other === sq || other.arriving || Math.hypot(at.get(other)!.x - p.x, at.get(other)!.y - p.y) <= pairLimit(company, sq.id, other.id))) sq.arriving = false
    }
    const tied = squads.filter(sq => !sq.arriving)
    if (tied.length < 2) return
    for (const sq of tied) battle.tether.set(sq.id, tied.filter(other => other !== sq).map(other => ({ anchor: at.get(other)!, limit: pairLimit(company, sq.id, other.id) })))
    // 攻撃している小隊は、中隊の中心から（離れてよい距離 + chase）より遠い相手を追わない。中隊の近くの敵へ狙いを替え、いなければその場で構える。
    // 中隊ごと攻撃を命じられ、戦う小隊がみなそろって向かっているときは、中隊ごと進むので遠い相手でも追う。
    const fighters = tied.filter(sq => sq.type !== 'supply' && sq.type !== 'engineer' && sq.order !== 'resupply')
    if (company.together && fighters.length && fighters.every(sq => sq.order === 'attack')) return
    const center ={ x: tied.reduce((sum, sq) => sum + at.get(sq)!.x, 0) / tied.length, y: tied.reduce((sum, sq) => sum + at.get(sq)!.y, 0) / tied.length }
    for (const sq of tied) {
        if (sq.order !== 'attack') continue
        const target = battle.squadById.get(sq.targetSquadId)
        const reach = Math.max(...battle.tether.get(sq.id)!.map(t => t.limit)) + COMPANY.chase
        if (!target || Math.hypot(target.center.x - center.x, target.center.y - center.y) <= reach) continue
        let closer: Squad | undefined, closest = reach
        for (const enemy of battle.squads) {
            if (enemy.owner === sq.owner || !enemy.count) continue
            const d = Math.hypot(enemy.center.x - center.x, enemy.center.y - center.y)
            if (d < closest) { closest = d; closer = enemy }
        }
        if (closer) orderAttack(battle, sq.id, closer.id)
        else orderHold(battle, sq.id)
    }
}

/**
 * 中隊のほかの小隊の隊長から、離れてよい距離より離れる向きへ動こうとした兵を引き止める（縁に沿う歩みと、近づく歩みはそのまま）。
 * 小隊長は離れてよい距離まで、兵は小隊長から離れてよい距離をさらに足した所まで。x, y は動く前の位置。
 */
function holdTether(battle: Battle, s: Soldier, x: number, y: number) {
    const tether = battle.tether.get(s.squadId)
    if (!tether || s.desertion) return
    const squad = battle.squadById.get(s.squadId)!
    const extra = s.id === squad.leaderId ? 0 : cohesionRadius(squad)
    const allowed = tether.map(({ anchor, limit }) => Math.max(limit + extra, Math.hypot(x - anchor.x, y - anchor.y)))
    const over = () => tether.some(({ anchor }, i) => Math.hypot(s.x - anchor.x, s.y - anchor.y) > allowed[i]! + .01)
    if (!over()) return
    // 越えた相手ごとに、その縁へ戻す。それでもどれかを越えるなら、動く前の位置に留める。
    tether.forEach(({ anchor }, i) => {
        const d = Math.hypot(s.x - anchor.x, s.y - anchor.y)
        if (d > allowed[i]!) { s.x = anchor.x + (s.x - anchor.x) * allowed[i]! / d; s.y = anchor.y + (s.y - anchor.y) * allowed[i]! / d }
    })
    if (over() || impassable(battle, s.x, s.y)) { s.x = x; s.y = y }
    s.moving = Math.hypot(s.x - x, s.y - y) > .01
    // 縁で足止めされた兵は構えた扱いにし、通る兵に道を譲る（門や狭い道をふさがない）。
    if (!s.moving && s.state === 'advance') s.state = 'hold'
}

/** 小隊が進む速さ（兵種の速さ×時間帯×体力。槍兵は隊列の進む速さ、ほかは隊長の歩く速さ）。中隊の足並みをそろえるのに使う。 */
function squadSpeed(battle: Battle, squad: Squad) {
    const base = UNIT_STATS[squad.owner][squad.type].speed * (squad.type === 'pikeman' ? PIKEMAN.marchPace : FOLLOW.leaderPace)
    return base * getTimeSpeedMultiplier(squad.owner, battle.dayTime) * staminaFactor(squad)
}

/**
 * 中隊の中の連携（毎ティック）。
 * - 中隊の小隊がみな同じ移動・攻撃の指示で動いているあいだは、まだ行き先から遠い小隊が、そのうちいちばん遅い小隊に歩みをそろえる
 * - 弓兵の小隊に敵の小隊が迫ったら、同じ中隊で構えている近接の小隊のうち、敵に一番近い小隊が迎え撃つ
 */
function updateCompanies(battle: Battle) {
    battle.stride.clear()
    battle.tether.clear()
    for (const company of battle.companies) {
        const squads = companySquads(battle, company.id)
        chooseCompanyLeader(battle, company, squads)
        keepTogether(battle, company, squads)
        if (squads.length < 2) continue
        const order = squads[0]!.order
        if (company.together && (order === 'move' || order === 'attack') && squads.every(sq => sq.order === order)) {
            const release = order === 'move' ? COMPANY.releaseMove : COMPANY.releaseAttack
            const marching = squads.filter(sq => {
                const at = squadPosition(battle, sq), goal = order === 'move' ? battle.posts.get(sq.id)?.goal ?? sq.anchor : sq.anchor
                return Math.hypot(goal.x - at.x, goal.y - at.y) > release
            })
            if (marching.length > 1) {
                const slowest = Math.min(...marching.map(sq => squadSpeed(battle, sq)))
                for (const sq of marching) battle.stride.set(sq.id, Math.min(battle.stride.get(sq.id) ?? 1, slowest / Math.max(.01, squadSpeed(battle, sq))))
            }
        }
        const archers = squads.filter(sq => sq.type === 'archer')
        const guards = squads.filter(sq => (sq.type === 'infantry' || sq.type === 'pikeman' || sq.type === 'cavalry') && (sq.order === 'move' || sq.order === 'hold') && !(company.together && sq.order === 'move' && battle.stride.has(sq.id)))
        if (!archers.length || !guards.length) continue
        let threat: Squad | undefined, threatDistance: number = COMPANY.guard
        for (const enemy of battle.squads) {
            if (enemy.owner === company.owner || !enemy.count) continue
            for (const archer of archers) {
                const d = Math.hypot(enemy.center.x - archer.center.x, enemy.center.y - archer.center.y)
                if (d < threatDistance) { threatDistance = d; threat = enemy }
            }
        }
        if (!threat) continue
        const guard = guards.reduce((a, b) => Math.hypot(b.center.x - threat!.center.x, b.center.y - threat!.center.y) < Math.hypot(a.center.x - threat!.center.x, a.center.y - threat!.center.y) ? b : a)
        orderAttack(battle, guard.id, threat.id)
    }
}

/** 中隊の小隊。 */
export function companySquads(battle: Battle, companyId: number): Squad[] {
    return (battle.companyById.get(companyId)?.squadIds ?? []).map(id => battle.squadById.get(id)).filter((sq): sq is Squad => !!sq)
}

/** 中隊の位置（小隊の隊長の幟の位置の、人数で重みを付けた平均）。 */
export function companyPosition(battle: Battle, company: Company): Point {
    const head = companyLeader(battle, company)
    if (head) return head
    // 隊長が決まる前（開戦前）は、中隊長を出す小隊の中心（隊長はそこに立つ）。
    const leaderSquad = battle.squadById.get(company.leaderSquadId)
    if (leaderSquad?.companyId === company.id) return leaderSquad.center
    let x = 0, y = 0, n = 0
    for (const squad of companySquads(battle, company.id)) {
        const at = squadPosition(battle, squad), w = Math.max(1, squad.count)
        x += at.x * w; y += at.y * w; n += w
    }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 }
}

/** 中隊長（中隊のまん中の小隊の隊長。小隊長と同じく、中隊の中心にいて押すと中隊を選べるだけのユニット）。 */
export function companyLeader(battle: Battle, company: Company): Soldier | undefined {
    const squad = battle.squadById.get(company.leaderSquadId)
    return squad && squad.companyId === company.id ? leaderOf(battle, squad) : undefined
}

/**
 * 中隊長を出す小隊を決める。今の小隊がいなくなったら、中隊のまん中に一番近い小隊に替える。
 * 補給部隊と工兵は、ほかの兵種の小隊がいれば選ばない。
 */
function chooseCompanyLeader(battle: Battle, company: Company, squads: Squad[]) {
    const current = battle.squadById.get(company.leaderSquadId)
    const candidates = squads.filter(sq => sq.type !== 'supply' && sq.type !== 'engineer')
    const pool = candidates.length ? candidates : squads
    if (current && current.companyId === company.id && pool.includes(current)) return
    if (!pool.length) { company.leaderSquadId = -1; return }
    const cx = pool.reduce((sum, sq) => sum + sq.center.x, 0) / pool.length, cy = pool.reduce((sum, sq) => sum + sq.center.y, 0) / pool.length
    company.leaderSquadId = pool.reduce((a, b) => Math.hypot(b.center.x - cx, b.center.y - cy) < Math.hypot(a.center.x - cx, a.center.y - cy) ? b : a).id
}

/** 中隊の小隊のうち、地点に最も近い小隊（中隊を狙う指示で、各小隊が向かう相手）。 */
export function nearestCompanySquad(battle: Battle, companyId: number, from: Point): Squad | undefined {
    let best: Squad | undefined, bestDistance = Infinity
    for (const squad of companySquads(battle, companyId)) {
        const d = Math.hypot(squad.center.x - from.x, squad.center.y - from.y)
        if (d < bestDistance) { bestDistance = d; best = squad }
    }
    return best
}

/**
 * 中隊ごと指定地点へ移動して構える。小隊は中隊の隊形（横陣の並べ方）を組み、地点を中隊長の小隊のまん中にする。向きは進む方向。
 * 建設中の工兵と補給に当たっている補給部隊・補給中の小隊は今の仕事を続ける。
 */
export function orderCompanyMove(battle: Battle, companyId: number, point: Point) {
    const moves = companyMoves(battle, companyId, point)
    if (!moves.size) return
    battle.companyById.get(companyId)!.together = true
    for (const [squad, { point, facing }] of moves) orderMove(battle, squad.id, point, facing)
}

/** 中隊ごとの移動で、各小隊へ出す移動の指示（行き先の小隊のまん中と向き）。動かない小隊（建設中の工兵など）は含まない。 */
function companyMoves(battle: Battle, companyId: number, point: Point) {
    const moves = new Map<Squad, { point: Point; facing: number }>()
    const squads = companySquads(battle, companyId).filter(sq => !worksAtSite(sq.order) && sq.order !== 'resupply' && !(sq.type === 'supply' && sq.order === 'support'))
    if (!squads.length) return moves
    const target = snapToPassable(battle, point)
    let cx = 0, cy = 0
    for (const squad of squads) { cx += squad.center.x; cy += squad.center.y }
    cx /= squads.length; cy /= squads.length
    const facing = Math.hypot(target.x - cx, target.y - cy) > 1 ? Math.atan2(target.x - cx, target.y - cy) : squads[0]!.facing
    const slots = layoutCompany(squads.map(sq => ({ id: sq.id, type: sq.type, size: Math.max(1, sq.count) })))
    // 持ち場は小隊の前列中央なので、小隊のまん中へ直す。
    const middle = (squad: Squad) => {
        const slot = slots.get(squad.id)
        return slot && { forward: slot.forward - squadBlock(squad.type, Math.max(1, squad.count)).depth / 2, lateral: slot.lateral, facing: slot.facing }
    }
    // 地点には中隊長の小隊のまん中を置き（矢印は中隊長の幟から引くので、矢印の先が指した地点に合う）、ほかの小隊は隊形どおりにその周りへ並べる。
    const head = squads.find(sq => sq.id === battle.companyById.get(companyId)?.leaderSquadId)
    const origin = (head && middle(head)) ?? { forward: 0, lateral: 0 }
    for (const squad of squads) {
        const m = middle(squad)
        if (m) moves.set(squad, { point: toWorld(target, facing, m.forward - origin.forward, m.lateral - origin.lateral), facing: facing + m.facing })
    }
    return moves
}

export type CompanyRouteCommand = { order: string; point?: Point; targetSquadId?: number; targetCompanyId?: number; constructionId?: number }

/**
 * 中隊への指示を出したら引かれる、中隊長の小隊の経路（ドラッグ中の矢印の下見）。指示を出したあとの矢印（squadRoute）と同じ計算で、部隊は変えない。
 * 中隊長の小隊が動かない指示ならundefined。
 */
export function previewCompanyRoute(battle: Battle, companyId: number, command: CompanyRouteCommand): Point[] | undefined {
    const company = battle.companyById.get(companyId)
    const head = company && battle.squadById.get(company.leaderSquadId)
    if (!head) return undefined
    /** 指示を出したら小隊に決まることを当てた仮の小隊で、指示を出したあとの矢印（squadRoute）と同じ経路を引く。 */
    const route = (plan: OrderPlan | Pick<Squad, 'order'>) => {
        const planned: Squad = { ...head, ...plan }
        if ('goal' in plan) {
            // 指示を出すと登録される経路の目標を、下見のうちに作っておく（前の下見の目標は、使う小隊がいなければ捨てる）。
            planned.goalKey = goalKeyOf(`squad:${head.id}`, plan.goal)
            if (planned.goalKey !== battle.previewGoal) {
                if (battle.previewGoal && !battle.squads.some(sq => sq.goalKey === battle.previewGoal)) battle.paths.dropGoal(battle.previewGoal)
                battle.paths.addGoal(planned.goalKey, plan.goal)
                battle.previewGoal = planned.goalKey
            }
        }
        const destination = orderDestination(battle, planned)
        return destination ? routeFor(battle, head, planned, destination) : undefined
    }
    if (command.order === 'attack') {
        if (head.type === 'supply' || head.type === 'engineer' || head.order === 'resupply') return undefined
        const enemy = command.targetCompanyId !== undefined ? nearestCompanySquad(battle, command.targetCompanyId, head.center) : battle.squadById.get(command.targetSquadId ?? -1)
        return enemy ? route(attackPlan(battle, enemy)) : undefined
    }
    if (command.order === 'demolish') {
        const site = battle.constructionById.get(command.constructionId ?? -1)
        if (!site || head.order === 'resupply') return undefined
        return route(demolishPlan(battle, head, site))
    }
    if (command.order === 'retreat') return route({ order: 'retreat' })
    if (command.order === 'charge') {
        if (head.type === 'supply' || head.type === 'engineer' || head.order === 'resupply') return undefined
        return route({ order: 'charge' })
    }
    if (command.order !== 'move' || !command.point) return undefined
    const move = companyMoves(battle, companyId, command.point).get(head)
    return move ? route(movePlan(battle, head, move.point, move.facing)) : undefined
}

/** 中隊の各小隊で、敵の小隊（または敵の中隊のうち各小隊に最も近い小隊）を攻撃する。補給部隊と工兵は加わらない。 */
export function orderCompanyAttack(battle: Battle, companyId: number, target: { squadId?: number; companyId?: number }) {
    const company = battle.companyById.get(companyId)
    if (company) company.together = true
    for (const squad of companySquads(battle, companyId)) {
        if (squad.type === 'supply' || squad.type === 'engineer' || squad.order === 'resupply') continue
        const enemy = target.companyId !== undefined ? nearestCompanySquad(battle, target.companyId, squad.center) : battle.squadById.get(target.squadId ?? -1)
        if (enemy) orderAttack(battle, squad.id, enemy.id)
    }
}

export type CompanyOrder = 'charge' | 'hold' | 'formation' | 'retreat' | 'resupply' | 'support'

/** 中隊の小隊へまとめて指示する。突撃に補給部隊と工兵は加わらず、自動補給は補給部隊だけが受ける。 */
export function orderCompany(battle: Battle, companyId: number, order: CompanyOrder) {
    const company = battle.companyById.get(companyId)
    if (company) company.together = false
    for (const squad of companySquads(battle, companyId)) {
        if (order === 'charge') { if (squad.type !== 'supply' && squad.type !== 'engineer' && squad.order !== 'resupply') orderCharge(battle, squad.id) }
        else if (order === 'hold') orderHold(battle, squad.id)
        else if (order === 'formation') orderFormation(battle, squad.id)
        else if (order === 'retreat') orderRetreat(battle, squad.id)
        else if (order === 'resupply') orderResupply(battle, squad.id)
        else if (squad.type === 'supply') orderSupport(battle, squad.id)
    }
}

/** 中隊の各小隊で、指定した敵の建設物を壊しに行く。 */
export function orderCompanyDemolish(battle: Battle, companyId: number, constructionId: number) {
    const company = battle.companyById.get(companyId)
    if (company) company.together = false
    for (const squad of companySquads(battle, companyId)) if (squad.order !== 'resupply') orderDemolish(battle, squad.id, constructionId)
}

export type ArmyOrder = 'charge' | 'hold' | 'retreat'

export function orderArmy(battle: Battle, owner: Army, order: ArmyOrder) {
    for (const company of battle.companies) if (company.owner === owner) company.together = false
    for (const squad of battle.squads) {
        if (squad.owner !== owner) continue
        // 補給部隊と工兵は突撃に加わらず、補給中の部隊は補給を続ける。
        if (order === 'charge' && (squad.type === 'supply' || squad.type === 'engineer' || squad.order === 'resupply')) continue
        if (order === 'charge') orderCharge(battle, squad.id)
        else if (order === 'hold') orderHold(battle, squad.id)
        else orderRetreat(battle, squad.id)
    }
}

// ---- 戦闘 ----

function damageSoldier(battle: Battle, target: Soldier, amount: number, attacker?: Soldier, arrowFrom?: Point) {
    if (target.state === 'dead') return
    // 時間帯の被ダメージ補正（no-life-kingの減衰倍率: 昼の魔王軍×1.5、夜の人間×1.3）。槍兵は守りが堅く、歩兵と槍兵は正面からの矢を盾で受ける。
    const shield = (target.type === 'infantry' || target.type === 'pikeman') && arrowFrom && shieldFaces(target, arrowFrom) ? SHIELD.damageTaken : 1
    target.hp -= amount * getTimeDecayMultiplier(target.owner, battle.dayTime) * (target.type === 'pikeman' ? PIKEMAN.damageTaken : 1) * shield
    if (target.hp <= 0) {
        target.hp = 0
        target.state = 'dead'
        target.deathTime = battle.time
        target.moving = false
        battle.killed[enemyOf(target.owner)]++
        return
    }
    // 攻撃された兵は、近ければ反撃相手として考え直す。
    if (attacker && target.targetId === -1 && target.state !== 'flee') target.thinkTimer = 0
}

/** 兵が from の方を向いているか（盾で受けられる向きか）。 */
function shieldFaces(s: Soldier, from: Point) {
    const dx = from.x - s.x, dy = from.y - s.y
    const distance = Math.hypot(dx, dy)
    return distance > 0 && (Math.sin(s.heading) * dx + Math.cos(s.heading) * dy) / distance >= Math.cos(SHIELD.arc)
}

/** 体力による移動・攻撃の倍率。基準を下回ると鈍り、0で最小になる。 */
export function staminaFactor(squad: Squad | undefined) {
    if (!squad || squad.stamina >= STAMINA.tiredBelow) return 1
    return STAMINA.minFactor + (1 - STAMINA.minFactor) * Math.max(0, squad.stamina) / STAMINA.tiredBelow
}

/** 攻撃で部隊の体力を使う。 */
function spendStamina(battle: Battle, s: Soldier, amount: number) {
    const squad = battle.squadById.get(s.squadId)
    if (squad) squad.stamina = Math.max(0, squad.stamina - amount)
}

function moveToward(battle: Battle, s: Soldier, tx: number, ty: number, dt: number, speedScale = 1): boolean {
    const dx = tx - s.x, dy = ty - s.y
    const distance = Math.hypot(dx, dy)
    if (distance < .01) return true
    const stats = UNIT_STATS[s.owner][s.type]
    // no-life-kingと同じく、地形倍率×時間帯倍率で速度を決める（加えて坂の勾配）。
    let terrain = getTerrainSpeedMultiplier(battle.grid, s.x, s.y, s.type)
    if (terrain === 0) terrain = .4 // 押し出されて柵際に入ったときは抜け出させる
    // 坂は登りで大きく、下りで少し遅くなる。
    terrain *= battle.paths.slopeSpeed(s.x, s.y, dx, dy)
    const speed = stats.speed * terrain * getTimeSpeedMultiplier(s.owner, battle.dayTime) * speedScale * staminaFactor(battle.squadById.get(s.squadId))
    const step = Math.min(distance, speed * dt)
    const nx = s.x + dx / distance * step, ny = s.y + dy / distance * step
    const ox = s.x, oy = s.y
    if (!impassable(battle, nx, ny)) { s.x = nx; s.y = ny }
    else if (!impassable(battle, nx, s.y)) s.x = nx
    else if (!impassable(battle, s.x, ny)) s.y = ny
    const progress = Math.hypot(s.x - ox, s.y - oy)
    s.stuckTime = progress < step * .3 ? s.stuckTime + dt : Math.max(0, s.stuckTime - dt * 2)
    s.heading = Math.atan2(dx, dy)
    s.moving = true
    s.runTime = speedScale >= 1 ? s.runTime + dt : 0
    return distance <= step + .01
}

/** A*経路に沿って目的地へ向かう。経路が届くまでは直進する。 */
function followPath(battle: Battle, s: Soldier, goal: Point, goalKey: string, dt: number, speedScale = 1, lane = s.lane) {
    if (s.pathGoal !== goalKey || s.path.length === 0) {
        const path = battle.paths.request(s.x, s.y, goal, goalKey, mobilityOf(s.type))
        if (path) { s.path = path; s.pathIndex = 0; s.pathGoal = goalKey }
        else { s.path = []; s.pathGoal = '' }
    }
    if (s.path.length === 0) return moveToward(battle, s, goal.x, goal.y, dt, speedScale)
    const next = s.path[s.pathIndex + 1]
    if (!next) return moveToward(battle, s, goal.x, goal.y, dt, speedScale)
    // 経路上の自分の位置から少し先の点を、自分の列の分だけ経路と直角にずらして目指す。
    // 目的地や自陣の近くでは列を詰め、ずらした先までの直線が川や柵にかかるなら経路側へ寄せる。
    const prev = s.path[s.pathIndex]!
    const dx = next.x - prev.x, dy = next.y - prev.y
    const length = Math.hypot(dx, dy) || 1
    const along = ((s.x - prev.x) * dx + (s.y - prev.y) * dy) / length
    // ウェイポイント到達で次へ（横にずれていても、経路方向に通り過ぎたら到達とみなす）
    if (along >= length - 2 || Math.hypot(next.x - s.x, next.y - s.y) < 4) { s.pathIndex++; return false }
    const ahead = Math.min(length, Math.max(0, along) + PATH_LOOKAHEAD)
    const cx = prev.x + dx / length * ahead, cy = prev.y + dy / length * ahead
    const home = battle.homes[s.owner]
    const taper = Math.max(0, Math.min(1, Math.hypot(goal.x - s.x, goal.y - s.y) / LANE_CONVERGE_DISTANCE,
        (Math.hypot(home.x - s.x, home.y - s.y) - 130) / 120))
    let tx = cx, ty = cy
    for (const share of [1, .5, .25]) {
        const offset = lane * taper * share
        const ox = cx - dy / length * offset, oy = cy + dx / length * offset
        if (isClearLine(battle, s.x, s.y, ox, oy)) { tx = ox; ty = oy; break }
    }
    moveToward(battle, s, tx, ty, dt, speedScale)
    // 押し流されて経路から大きく外れたら取り直す。
    if (s.stuckTime > 1.5) { s.path = []; s.pathGoal = ''; s.stuckTime = 0 }
    return false
}

/**
 * 部隊が今の指示で実際にたどる経路（表示用）。兵士のfollowPathと同じ目的地・コスト場を使い、
 * 最後に表示上の行き先 destination へつなぐ。
 */
export function squadRoute(battle: Battle, squad: Squad, destination: Point): Point[] {
    return routeFor(battle, squad, squad, destination)
}

/** 小隊の今の指示の行き先（矢印の先。指示を出したあとの矢印と、ドラッグ中の下見で共通）。 */
export function orderDestination(battle: Battle, squad: Squad): Point | undefined {
    if (squad.order === 'attack') { const target = battle.squadById.get(squad.targetSquadId); return target && squadPosition(battle, target) }
    if (squad.order === 'charge') return battle.homes[enemyOf(squad.owner)].core
    if (squad.order === 'resupply') {
        const depot = depotOf(battle, squad)
        return depot.site ? depot.site.center : battle.homes[squad.owner].core
    }
    if (squad.order === 'retreat') return battle.homes[squad.owner].core
    if (worksAtSite(squad.order) || squad.order === 'demolish') return battle.constructionById.get(squad.constructionId)?.center
    if (squad.order === 'support' && battle.squadById.has(squad.targetSquadId)) return squadPosition(battle, battle.squadById.get(squad.targetSquadId)!)
    // 持ち場の原点は前列中央なので、部隊の中心へ戻して示す。
    return toWorld(squad.anchor, squad.facing, -squadBlock(squad.type, Math.max(1, squad.count)).depth / 2, 0)
}

/** 部隊が order の指示（持ち場 anchor・経路の目標 goalKey・建設物 constructionId）で進む経路。 */
function routeFor(battle: Battle, squad: Squad, plan: { order: SquadOrder; anchor?: Point; goalKey?: string; constructionId?: number }, destination: Point): Point[] {
    const { order } = plan, anchor = plan.anchor ?? squad.anchor, goalKey = plan.goalKey ?? squad.goalKey
    const from = squadPosition(battle, squad)
    const route = (goal: Point, goalKey: string) => {
        if (isClearLine(battle, from.x, from.y, goal.x, goal.y)) return [from, goal]
        const path = battle.paths.request(from.x, from.y, goal, goalKey, mobilityOf(squad.type))
        return path ? [from, ...path.slice(1)] : [from, goal]
    }
    /** 突撃・退却の兵は砦の攻撃地点へ分かれて向かうので、部隊に一番近い攻撃地点を代表にする。 */
    const fortRoute = (fort: Home) => {
        const best = nearestAssault(fort, from)
        return route(fort.assaultPoints[best]!, fortGoalKey(fort.owner, best))
    }
    // 持ち場（battle.posts）は次の更新まで前の指示のまま残る（一時停止中はずっと）ので、経路の目標は今の指示から求める。
    let points: Point[]
    const site = battle.constructionById.get(plan.constructionId ?? squad.constructionId)
    if (order === 'retreat') points = fortRoute(battle.homes[squad.owner])
    else if (order === 'resupply') {
        const depot = depotOf(battle, squad).site
        points = depot ? route(depot.center, depotGoalKey(depot)) : fortRoute(battle.homes[squad.owner])
    } else if (order === 'charge') points = fortRoute(battle.homes[enemyOf(squad.owner)])
    else if (order === 'attack' || order === 'demolish') points = route(anchor, goalKey)
    else if (order === 'formation') points = route(battle.formations[squad.owner].anchor, formationGoalKey(battle, squad.owner))
    else if (worksAtSite(order)) points = site ? route(site.approach, buildGoalKey(site)) : [from]
    else points = route(battle.paths.passable(anchor.x, anchor.y) ? anchor : snapToPassable(battle, anchor), goalKey)
    return joinDestination(points, destination)
}

/**
 * 経路の終わりを行き先 destination へつなぐ。経路の目標（持ち場は小隊の前列、急な斜面ではずらした所）は行き先の先や脇にあることがあるので、
 * 経路の終わりの方で行き先に一番近い所で切ってからつなぎ、行き先を通り越して戻る・回り込む矢印にしない。
 */
function joinDestination(points: Point[], destination: Point): Point[] {
    const end = points.at(-1)!
    const reach = Math.hypot(destination.x - end.x, destination.y - end.y) * 2 + TILE_PX
    let keep = points.length, cut = end, best = Math.hypot(destination.x - end.x, destination.y - end.y), walked = 0
    for (let i = points.length - 1; i > 0 && walked <= reach; i--) {
        const a = points[i - 1]!, b = points[i]!
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
        const t = length > 0 ? Math.max(0, Math.min(1, ((destination.x - a.x) * dx + (destination.y - a.y) * dy) / (length * length))) : 0
        const p = { x: a.x + dx * t, y: a.y + dy * t }
        const d = Math.hypot(destination.x - p.x, destination.y - p.y)
        if (d < best - .01) { best = d; keep = i; cut = p }
        walked += length
    }
    const joined = points.slice(0, keep)
    const last = joined.at(-1)!
    if (Math.hypot(cut.x - last.x, cut.y - last.y) > 1) joined.push(cut)
    if (Math.hypot(destination.x - cut.x, destination.y - cut.y) > 1) joined.push(destination)
    return joined
}

/** 兵士の持ち場のワールド座標。持ち場のない指示（突撃・攻撃・退却）ならundefined。 */
function slotPosition(battle: Battle, s: Soldier, squad: Squad): Point | undefined {
    const post = battle.posts.get(squad.id)
    if (!post) return undefined
    // 工兵は建設物の周りの作業地点（占領なら拠点の内側）が持ち場。
    if (worksAtSite(squad.order)) {
        const site = battle.constructionById.get(squad.constructionId)
        return site ? site.workPoints[s.slot % site.workPoints.length] : undefined
    }
    const offset = slotOffset(squad.type, Math.max(1, squad.count), s.slot)
    // 川は渡れるが、川の中では構えず岸に並ぶ。
    return toShore(battle, toWorld(post.anchor, post.facing, offset.forward, offset.lateral))
}

/** 隊列のまん中の持ち場の番号（隊長の持ち場）。 */
function centerSlot(type: UnitType, count: number) {
    const { cols, rows } = squadBlock(type, Math.max(1, count))
    const row = Math.floor((rows - 1) / 2)
    // 最後の列が欠けていても、埋まっている持ち場を選ぶ。
    return Math.min(count - 1, row * cols + Math.floor((cols - 1) / 2))
}

/**
 * 隊長が進んでいる間に兵が付く、隊長のまわりの持ち場（隊長を隊列のまん中に置いた位置）。
 * 隊長だけが部隊の経路をたどり、兵は隊列を保ったまま隊長に付いて歩くので、部隊は指示の矢印どおりにまとまって進む。
 * 隊長が持ち場に着いたら、また隊長自身・持ち場へ向かう槍兵・建設・帰り着く先の近くの退却と補給ではundefined。
 */
function escortPoint(battle: Battle, s: Soldier, squad: Squad): Point | undefined {
    if (s.id === squad.leaderId || squad.march || worksAtSite(squad.order)) return undefined
    const leader = leaderOf(battle, squad)
    if (!leader) return undefined
    // 退却・補給は、帰り着く先の近くまで隊長に付いて行き、そこからは門や陣地の中へ散る。
    const depot = squad.order === 'resupply' ? depotOf(battle, squad) : squad.order === 'retreat' ? battle.homes[s.owner] : undefined
    if (depot && Math.hypot(depot.x - leader.x, depot.y - leader.y) < cohesionRadius(squad) * 1.5) return undefined
    const count = Math.max(1, squad.count)
    const middle = slotOffset(squad.type, count, centerSlot(squad.type, count))
    const post = battle.posts.get(squad.id)
    // 持ち場へ向かう槍兵は、隊長ではなく隊列（march）ごと進む。
    if (post && squad.type === 'pikeman') return undefined
    let facing = battle.travel.get(squad.id) ?? squad.facing
    if (post) {
        // 隊長の持ち場（川の中なら岸へ寄せた位置）。
        const own = slotPosition(battle, leader, squad) ?? leader
        const remaining = Math.hypot(own.x - leader.x, own.y - leader.y)
        if (remaining < FOLLOW.arrive) return undefined
        // 着く手前で隊列を持ち場の向きへ回し、着いたらそのまま構えられるようにする。
        facing = post.facing + angleDiff(facing, post.facing) * Math.min(1, (remaining - FOLLOW.arrive) / FOLLOW.settle)
    }
    const mine = slotOffset(squad.type, count, s.slot)
    return toWorld(leader, facing, mine.forward - middle.forward, mine.lateral - middle.lateral)
}

/** 隊長のまわりの持ち場へ付いて歩く。持ち場が川や柵の中なら、隊長のもとへ寄る。 */
function followLeader(battle: Battle, s: Soldier, squad: Squad, escort: Point, dt: number) {
    const leader = leaderOf(battle, squad)!
    const blocked = impassable(battle, escort.x, escort.y)
    const tx = blocked ? leader.x : escort.x, ty = blocked ? leader.y : escort.y
    const distance = Math.hypot(tx - s.x, ty - s.y)
    const facing = battle.travel.get(squad.id) ?? squad.facing
    if (distance <= 1.5 || (blocked && distance < 10)) {
        s.state = leader.moving ? 'advance' : 'hold'
        s.heading = facing; s.runTime = 0
        return
    }
    s.state = 'advance'
    if (s.routeDirect || distance < 30) {
        // 隊長が歩いていれば隊長と同じ速さに遅れの分を足して並び、止まっていれば近いほどゆっくり寄せる。
        const scale = leader.moving ? FOLLOW.leaderPace + distance / 8 : Math.max(.4, distance / 6)
        moveToward(battle, s, tx, ty, dt, Math.min(1, scale))
        if (distance < 6 && leader.moving) s.heading = facing
    } else {
        const gx = Math.round(leader.x / TILE_PX / 4) * 4, gy = Math.round(leader.y / TILE_PX / 4) * 4
        const goal = snapToPassable(battle, { x: gx * TILE_PX, y: gy * TILE_PX })
        followPath(battle, s, goal, `cell:${gx},${gy}`, dt, 1, 0)
    }
}

/** 砦の攻撃地点のうち、from に一番近いもの（部隊の隊長が向かう先）。 */
function nearestAssault(fort: Home, from: Point) {
    let best = 0
    fort.assaultPoints.forEach((p, i) => {
        const q = fort.assaultPoints[best]!
        if (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(q.x - from.x, q.y - from.y)) best = i
    })
    return best
}

/** 部隊の位置（隊長の幟の位置。隊長がいなければ兵の重心）。ラベルと指示の矢印はここから出す。 */
export function squadPosition(battle: Battle, squad: Squad): Point {
    return leaderOf(battle, squad) ?? squad.center
}

/** 部隊の幟を持つ隊長（倒れていればundefined）。 */
const leaderOf = (battle: Battle, squad: Squad) => {
    const leader = battle.byId.get(squad.leaderId)
    return leader && leader.state !== 'dead' ? leader : undefined
}

/** 兵が隊長から離れてよい距離。隊長は隊列のまん中にいるので、隊列の対角線の半分に、敵を追う範囲とゆとりを足す。 */
export function cohesionRadius(squad: Squad) {
    const { width, depth } = squadBlock(squad.type, Math.max(1, squad.count))
    return Math.hypot(width, depth) / 2 + LEASH[squad.type] * COHESION.leashShare + COHESION.margin
}

/** 持ち場なしで進む兵の横の列。隊長の列から離れすぎないように抑える。 */
function marchLane(battle: Battle, s: Soldier, squad: Squad) {
    const leader = leaderOf(battle, squad)
    // 隊長は経路の上をそのまま歩く（指示の矢印と同じ道）。
    if (leader === s) return 0
    if (!leader) return s.lane
    const spread = cohesionRadius(squad) * COHESION.laneShare
    return leader.lane + Math.max(-spread, Math.min(spread, s.lane - leader.lane))
}

/**
 * 隊長から離れすぎた兵は、敵に構わず隊長のもとへ戻る。十分に近づいたら戦いに戻る。戻っている最中ならtrue。
 * 工兵の建設と、本拠地（補給先）に着いてからの退却・補給では、兵は決まった場所に散るので見ない。
 */
function regroup(battle: Battle, s: Soldier, squad: Squad, dt: number) {
    const leader = s.id === squad.leaderId || worksAtSite(squad.order) ? undefined : leaderOf(battle, squad)
    const radius = cohesionRadius(squad)
    const depot = squad.order === 'resupply' ? depotOf(battle, squad) : squad.order === 'retreat' ? battle.homes[s.owner] : undefined
    if (!leader || (depot && Math.hypot(depot.x - s.x, depot.y - s.y) < radius)) { s.regroup = false; return false }
    const distance = Math.hypot(leader.x - s.x, leader.y - s.y)
    if (!s.regroup && distance > radius) {
        s.regroup = true
        s.targetId = -1; s.constructionId = -1; s.detour = 0; s.pathGoal = ''
        s.routeDirect = isClearLine(battle, s.x, s.y, leader.x, leader.y)
    } else if (s.regroup && distance < radius * COHESION.rejoin) {
        s.regroup = false
        s.pathGoal = ''
        s.thinkTimer = Math.min(s.thinkTimer, .05)
    }
    if (!s.regroup) return false
    // 逃げていた兵も、部隊を離れてまでは逃げない。
    s.state = 'advance'
    // 直進できるかは思考のときに調べておく。回り道の目的地は4マス単位に丸め、隊長が少し動くたびに経路を取り直さない。
    if (s.routeDirect) moveToward(battle, s, leader.x, leader.y, dt)
    else {
        const gx = Math.round(leader.x / TILE_PX / 4) * 4, gy = Math.round(leader.y / TILE_PX / 4) * 4
        const goal = snapToPassable(battle, { x: gx * TILE_PX, y: gy * TILE_PX })
        followPath(battle, s, goal, `cell:${gx},${gy}`, dt, 1, 0)
    }
    return true
}

/** 隊長が足を止めて部隊を待つか（隊長のもとへ戻っている兵や遅れている兵が多いとき）。槍兵は隊列ごと遅れた兵を待つので見ない。 */
function waitsForSquad(battle: Battle, s: Soldier, squad: Squad) {
    if (s.id !== squad.leaderId || squad.type === 'pikeman') return false
    const members = battle.members.get(squad.id) ?? []
    // 戻っている兵のほか、隊列から遅れている兵も数える。
    const far = cohesionRadius(squad) * .7
    let behind = 0
    for (const o of members) if (o.regroup || Math.hypot(o.x - s.x, o.y - s.y) > far) behind++
    return behind > members.length * COHESION.waitShare
}

const leashOf = (s: Soldier) => s.type === 'archer' ? UNIT_STATS[s.owner].archer.range + 5 : LEASH[s.type]

/**
 * 兵が狙う建設物: 壊す指示の建設物が視界にあればそれを、なければ行く手をふさぐ目の前の敵の柵（完成したもの）。
 * 持ち場がある兵は、持ち場の近くの柵だけを相手にする。
 */
function constructionTarget(battle: Battle, s: Soldier, squad: Squad, slot: Point | undefined, sight: number) {
    if (squad.order === 'demolish') {
        const site = battle.constructionById.get(squad.constructionId)
        if (site && site.owner !== s.owner) {
            const p = nearestCell(site, s)
            if (Math.hypot(p.x - s.x, p.y - s.y) <= sight) return site
        }
    }
    for (const site of battle.constructions) {
        if (site.owner === s.owner || !site.complete || !site.walls.length) continue
        if (Math.hypot(site.center.x - s.x, site.center.y - s.y) > 90) continue
        const p = nearestCell(site, s)
        if (Math.hypot(p.x - s.x, p.y - s.y) - TILE_PX / 2 > CONSTRUCTION_AUTO_ATTACK) continue
        if (slot && Math.hypot(p.x - slot.x, p.y - slot.y) > leashOf(s) + TILE_PX) continue
        return site
    }
    return undefined
}

/** 各兵士が独立して周囲を見て、狙う敵・守るか退くかを決める。持ち場があれば、その近くの敵だけを相手にする。goal は今歩いて向かう先。 */
function think(battle: Battle, s: Soldier, squad: Squad, slot: Point | undefined, goal = slot) {
    if (s.regroup) {
        const leader = leaderOf(battle, squad)
        if (leader) s.routeDirect = isClearLine(battle, s.x, s.y, leader.x, leader.y)
        s.targetId = -1; s.constructionId = -1
        return
    }
    if (squad.order === 'retreat' || squad.order === 'resupply') { s.targetId = -1; s.constructionId = -1; return }
    // 矢のない弓兵は射撃できないので、敵を狙わない。
    if (s.type === 'archer' && s.arrows <= 0) { s.targetId = -1; s.constructionId = -1; return }
    const stats = UNIT_STATS[s.owner][s.type]
    const leash = leashOf(s)
    // 攻撃・破壊を指示された相手は遠くからでも見つけて向かう。
    const sight = squad.order === 'attack' || squad.order === 'demolish' ? stats.sight * 1.6 : stats.sight
    // 隊長以外の兵は、隊長から離れすぎずに戦える敵だけを相手にする。
    const leader = s.id === squad.leaderId ? undefined : leaderOf(battle, squad)
    // 弓兵はその場から射るので、射程の分だけ遠くの敵まで狙える。
    const reach = cohesionRadius(squad) * .85 + (s.type === 'archer' ? stats.range : 0)
    let best: Soldier | undefined
    let bestScore = Infinity
    let allies = 0, enemies = 0, ex = 0, ey = 0
    const sight2 = sight * sight
    battle.hash.forEachNear(s.x, s.y, sight, o => {
        if (o === s) return
        const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy
        if (d2 > sight2) return
        // 逃げ出した兵は味方に数えない。
        if (o.owner === s.owner) { if (!o.desertion) allies++; return }
        enemies++; ex += o.x; ey += o.y
        const isOrderedTarget = squad.order === 'attack' && o.squadId === squad.targetSquadId
        if (!isOrderedTarget && d2 > stats.sight * stats.sight) return
        if (slot && Math.hypot(o.x - slot.x, o.y - slot.y) > leash) return
        if (leader && Math.hypot(o.x - leader.x, o.y - leader.y) > reach) return
        let score = Math.sqrt(d2)
        // 騎兵は弓兵を、弓兵は迫る騎兵を優先する。今の標的は少し優先して目移りを抑える。
        if (s.type === 'cavalry' && o.type === 'archer') score *= .6
        if (s.type === 'archer' && o.type === 'cavalry') score *= .8
        if (o.id === s.targetId) score *= .8
        if (isOrderedTarget) score *= .5
        if (score < bestScore) { bestScore = score; best = o }
    })
    // 突撃中の兵は、自陣への侵入者がいれば引き返して守る。
    if (!best && squad.order === 'charge') {
        const home = battle.homes[s.owner]
        const intruders = battle.intruders[s.owner]
        if (intruders.length && Math.hypot(s.x - home.x, s.y - home.y) < 420 * s.courage) {
            for (const o of intruders) {
                if (leader && Math.hypot(o.x - leader.x, o.y - leader.y) > reach) continue
                const d = Math.hypot(o.x - s.x, o.y - s.y)
                if (d < bestScore) { bestScore = d; best = o }
            }
        }
    }
    // 忠誠の低い魔王軍の兵は、部隊が減り、自分も傷ついて劣勢になると、部隊を見捨てて敵から逃げ出す。
    if (deserts(battle, s, squad, allies, enemies)) { desert(battle, s, Math.atan2(s.x - ex / enemies, s.y - ey / enemies)); return }
    // 士気: 傷ついて劣勢なら退却する（臆病な個体ほど早い）。幟を持つ隊長は退かない。
    if (s.state !== 'flee' && s.id !== squad.leaderId && s.hp < s.maxHp * .35 && enemies > allies * 1.6 + 2 && battle.random() > s.courage * .75) {
        s.state = 'flee'
        s.fleeTimer = 3 + battle.random() * 3
        s.targetId = -1
        s.pathGoal = ''
        return
    }
    // 近くに敵兵がいなければ、建設物を壊しにかかる（建設中の工兵は作業を続ける）。
    const site = !worksAtSite(squad.order) && (!best || bestScore > 30) ? constructionTarget(battle, s, squad, slot, sight) : undefined
    if (site) best = undefined
    const previous = s.targetId, previousSite = s.constructionId
    s.targetId = best ? best.id : -1
    s.constructionId = site ? site.id : -1
    if (s.targetId !== previous || s.constructionId !== previousSite) { s.pathGoal = ''; s.detour = 0 }
    // 持ち場まで直進できるかを、ここで判定しておく（毎ティック調べると重い）。
    if (goal) s.routeDirect = Math.hypot(goal.x - s.x, goal.y - s.y) < 60 || isClearLine(battle, s.x, s.y, goal.x, goal.y)
}

/** 兵が部隊を見捨てて逃げ出すか（魔王軍の忠誠の低い兵種だけ。幟を持つ隊長は逃げない）。臆病な個体ほど逃げやすい。 */
function deserts(battle: Battle, s: Soldier, squad: Squad, allies: number, enemies: number) {
    if (s.owner !== 'cpu' || !DESERTION.types.includes(s.type) || s.id === squad.leaderId) return false
    if (squad.count >= squad.size * DESERTION.squadBelow || s.hp >= s.maxHp * DESERTION.hpBelow) return false
    if (enemies <= allies * DESERTION.odds) return false
    return battle.random() < DESERTION.chance * (2 - s.courage)
}

/** 部隊を離れ、heading の向き（敵から離れる向き）へ逃げ出す。 */
function desert(battle: Battle, s: Soldier, heading: number) {
    s.squadId = -1
    s.desertion = { x: s.x, y: s.y, heading: heading + (battle.random() - .5) * .6, time: battle.time }
    s.state = 'flee'
    s.targetId = -1; s.constructionId = -1; s.regroup = false
    s.path = []; s.pathGoal = ''; s.stuckTime = 0
}

/** 逃げ出した兵は敵から離れる向きへ走り、十分に離れたら（戦場の端に着いても）戦場から消える。消えた兵は撃破ではなく逃走として数える。 */
function updateDeserter(battle: Battle, s: Soldier, dt: number) {
    const run = s.desertion!
    s.elapsedTime += dt
    s.swing = 0
    s.moving = false
    const gone = Math.hypot(s.x - run.x, s.y - run.y) >= DESERTION.distance || battle.time - run.time >= DESERTION.seconds
    const tx = Math.max(PLAYABLE_MIN, Math.min(PLAYABLE_MAX, s.x + Math.sin(run.heading) * 30))
    const ty = Math.max(PLAYABLE_MIN, Math.min(PLAYABLE_MAX, s.y + Math.cos(run.heading) * 30))
    if (gone || Math.hypot(tx - s.x, ty - s.y) < 1) {
        // 倒れた兵と同じく片付けの対象にし、すぐに戦場から取り除く。
        s.state = 'dead'
        s.deathTime = -Infinity
        battle.deserted[s.owner]++
        return
    }
    moveToward(battle, s, tx, ty, dt)
    // 川や柵に阻まれたら、向きを変えて逃げ道を探す。
    if (s.stuckTime > .5) { run.heading += (battle.random() < .5 ? -1 : 1) * (.6 + battle.random() * .8); s.stuckTime = 0 }
}

function attack(battle: Battle, s: Soldier, target: Soldier) {
    const stats = UNIT_STATS[s.owner][s.type]
    let damage = stats.attack * (.8 + battle.random() * .4) * staminaFactor(battle.squadById.get(s.squadId))
    spendStamina(battle, s, s.type === 'archer' ? STAMINA.shotCost : STAMINA.attackCost)
    if (s.type === 'archer') {
        if (s.arrows <= 0) return
        s.arrows--
        // 弓の位置（体の少し前）から、相手の着弾時の位置を狙って放つ。遠いほど散らばる。
        const forward = { x: Math.sin(s.heading) * 1.6, y: Math.cos(s.heading) * 1.6 }
        launchArrow(battle, s.owner, s.x + forward.x, s.y + forward.y, 5.2, target, damage, ARROW_AIM.spread)
        s.swing = .7
        return
    }
    // 騎兵の突撃は、槍を構えた槍兵には効かない。
    if (s.type === 'cavalry' && s.runTime > CHARGE_RUN_TIME && target.type !== 'pikeman') damage *= CHARGE_MULTIPLIER
    s.runTime = 0
    s.swing = .45
    damageSoldier(battle, target, damage, s)
}

/** 放物線の矢を放つ。着弾までの時間から相手の位置を予測し、そこへ届くように撃つ。建設物を狙うときは constructionId を渡す。 */
function launchArrow(battle: Battle, owner: Army, x: number, y: number, z: number, target: Pick<Soldier, 'id' | 'x' | 'y' | 'vx' | 'vy'>, damage: number, spreadRate: number, constructionId = -1) {
    let tx = target.x, ty = target.y, flight = 0
    for (let i = 0; i < 2; i++) {
        flight = .15 + Math.hypot(tx - x, ty - y) / ARROW_SPEED
        tx = target.x + target.vx * flight; ty = target.y + target.vy * flight
    }
    const distance = Math.hypot(tx - x, ty - y)
    const spread = distance * spreadRate
    let toX = tx + (battle.random() - .5) * spread, toY = ty + (battle.random() - .5) * spread
    // 兵を狙った矢は、相手の手前の木に阻まれることがある。阻まれた矢はその木の根元に落ちる。
    const block = constructionId < 0 ? coverBlock(battle, x, y, tx, ty) : undefined
    if (block) { flight *= Math.hypot(block.x - x, block.y - y) / Math.max(1, distance); toX = block.x; toY = block.y }
    battle.arrows.push({
        owner, fromX: x, fromY: y, fromZ: z, peak: ARROW_ARC.base + distance * ARROW_ARC.perDistance,
        toX, toY, targetId: block ? -1 : target.id, constructionId, blocked: !!block, damage, time: 0, duration: flight,
    })
}

/** 木のマスが矢を阻む確率（木でなければ0）。 */
function treeCover(battle: Battle, x: number, y: number) {
    const tile = getPlayableTile(battle.grid, Math.round(x / TILE_PX), Math.round(y / TILE_PX))
    if (tile === TILE_VARIANT.WOOD_DENSE_MIN || tile === TILE_VARIANT.WOOD_DENSE_MAX) return ARROW_COVER.dense
    if (tile === TILE.WOOD || tile >= TILE_VARIANT.WOOD_SPARSE_MIN && tile <= TILE_VARIANT.WOOD_SPARSE_MAX) return ARROW_COVER.sparse
    return 0
}

/** 着弾点 (tx, ty) から射手の方へ遮蔽の深さまで木を調べ、矢が木に阻まれたらその地点を返す。射手の足元の木は数えない。 */
function coverBlock(battle: Battle, x: number, y: number, tx: number, ty: number): Point | undefined {
    const distance = Math.hypot(tx - x, ty - y)
    const reach = Math.min(ARROW_COVER.depth, distance - TILE_PX)
    for (let d = 0; d <= reach; d += TILE_PX) {
        const px = tx + (x - tx) * d / Math.max(1, distance), py = ty + (y - ty) * d / Math.max(1, distance)
        const cover = treeCover(battle, px, py)
        if (cover && battle.random() < cover) return { x: px, y: py }
    }
    return undefined
}

/** 建設物を攻撃する（弓兵は矢を射かける）。工兵は解体が得意で、同じ軍の歩兵の CONSTRUCTION_DAMAGE.engineer 倍の速さで壊す。 */
function attackConstruction(battle: Battle, s: Soldier, site: Construction, point: Point) {
    const stats = UNIT_STATS[s.owner][s.type]
    const roll = (.8 + battle.random() * .4) * staminaFactor(battle.squadById.get(s.squadId))
    const base = stats.attack * roll
    spendStamina(battle, s, s.type === 'archer' ? STAMINA.shotCost : STAMINA.attackCost)
    if (s.type === 'archer') {
        if (s.arrows <= 0) return
        s.arrows--
        launchArrow(battle, s.owner, s.x, s.y, 5.2, { id: -1, x: point.x, y: point.y, vx: 0, vy: 0 }, base * CONSTRUCTION_DAMAGE.arrow, .03, site.id)
        s.swing = .7
        return
    }
    s.swing = .45
    const infantry = UNIT_STATS[s.owner].infantry
    // 工兵の1振りは、歩兵が工兵の攻撃の間隔のあいだに壊す量の CONSTRUCTION_DAMAGE.engineer 倍。
    const damage = s.type === 'engineer'
        ? infantry.attack * CONSTRUCTION_DAMAGE.melee / infantry.cooldown * stats.cooldown * CONSTRUCTION_DAMAGE.engineer * roll
        : base * CONSTRUCTION_DAMAGE.melee
    damageConstruction(battle, site, damage)
}

/** 放物線の頂点の高さに合わせた打ち上げ角。 */
const launchPitch = (distance: number) => Math.atan2(4 * (ARROW_ARC.base + distance * ARROW_ARC.perDistance), Math.max(1, distance))

function updateSoldier(battle: Battle, s: Soldier, dt: number) {
    if (s.desertion) { updateDeserter(battle, s, dt); return }
    const stats = UNIT_STATS[s.owner][s.type]
    const squad = battle.squadById.get(s.squadId)!
    const escort = escortPoint(battle, s, squad)
    // 敵を追う範囲は本来の持ち場から測る（持ち場のない指示なら隊長のまわりの持ち場から）。歩く先は隊長のまわりの持ち場。
    const slot = slotPosition(battle, s, squad) ?? escort
    /** 隊長は兵が付いて来られるよう、少し抑えて歩く。 */
    const pace = s.id === squad.leaderId && !squad.march ? (battle.pace.get(squad.id) ?? FOLLOW.leaderPace) * (battle.stride.get(squad.id) ?? 1) : 1
    s.elapsedTime += dt
    s.attackTimer -= dt
    s.swing = Math.max(0, s.swing - dt)
    s.thinkTimer -= dt
    s.moving = false
    if (s.thinkTimer <= 0) {
        think(battle, s, squad, slot, escort ?? slot)
        s.thinkTimer = (.22 + battle.random() * .3) / s.courage
        if (s.desertion) return
    }
    if (regroup(battle, s, squad, dt)) return
    // 敵が砦を持たなければ（攻城戦・防衛戦の守り手）、突撃は敵の野営地へ向かう。
    const home = battle.homes[s.owner], enemyFort = fortOf(battle, enemyOf(s.owner)), enemyHome = battle.homes[enemyOf(s.owner)]
    if (s.state === 'flee' || squad.order === 'retreat' || squad.order === 'resupply') {
        const rally = s.id === squad.leaderId ? nearestAssault(home, s) : s.id % home.assaultPoints.length
        if (s.state === 'flee') {
            s.fleeTimer -= dt
            if (s.fleeTimer <= 0) { s.state = 'advance'; s.pathGoal = '' }
        } else s.state = 'advance'
        if (escort && s.state !== 'flee') { followLeader(battle, s, squad, escort, dt); return }
        // 補給に戻った兵は、陣地（拠点）で矢を受け取り終えたらその場で待つ（門を通り抜けなくてよい）。
        const depot = squad.order === 'resupply' && s.state !== 'flee' ? depotOf(battle, squad) : undefined
        if (depot && s.arrows >= s.maxArrows - .01 && Math.hypot(depot.x - s.x, depot.y - s.y) < depot.range) { s.state = 'hold'; return }
        if (depot?.site) {
            // 拠点では門から入って、内側に散らばって待つ。
            const site = depot.site
            const spot = site.interior[s.id % site.interior.length]!
            const inside = (OUTPOST_SIZE - 1) / 2 * TILE_PX
            if (Math.abs(site.center.x - s.x) < inside && Math.abs(site.center.y - s.y) < inside) {
                if (Math.hypot(spot.x - s.x, spot.y - s.y) > 3) moveToward(battle, s, spot.x, spot.y, dt, .8)
            } else followPath(battle, s, site.center, depotGoalKey(site), dt, 1, 0)
            return
        }
        // 自陣へ戻るときは横に広がらず、門へ向かって列を詰める（進む向きが逆なので行軍の列は使わない）。
        if (Math.hypot(home.assaultPoints[rally]!.x - s.x, home.assaultPoints[rally]!.y - s.y) > 6) followPath(battle, s, home.assaultPoints[rally]!, fortGoalKey(s.owner, rally), dt, 1, 0)
        return
    }
    let target = s.targetId >= 0 ? battle.byId.get(s.targetId) : undefined
    if (target && target.state === 'dead') { target = undefined; s.targetId = -1; s.thinkTimer = Math.min(s.thinkTimer, .05) }
    if (target && s.type === 'archer' && s.arrows <= 0) { target = undefined; s.targetId = -1 }
    // 持ち場から離れすぎたら敵を追うのをやめて戻る。部隊が付いて来る隊長は、深追いしない。
    if (target && slot && Math.hypot(slot.x - s.x, slot.y - s.y) > leashOf(s) * (s.id === squad.leaderId ? 1 : 1.8)) { target = undefined; s.targetId = -1; s.pathGoal = '' }
    if (target) {
        s.state = 'fight'
        const targetStats = UNIT_STATS[target.owner][target.type]
        const distance = Math.hypot(target.x - s.x, target.y - s.y)
        const reach = s.type === 'archer' ? stats.range : stats.range + stats.radius + targetStats.radius
        if (s.type === 'archer') s.aim = distance <= reach ? launchPitch(distance) : 0
        if (s.type === 'archer' && target.type !== 'archer' && distance < 22) {
            // 弓兵は近づかれたら下がって距離を取る。
            moveToward(battle, s, s.x - (target.x - s.x) / distance * 12, s.y - (target.y - s.y) / distance * 12, dt, .8)
            s.heading = Math.atan2(target.x - s.x, target.y - s.y)
        } else if (distance <= reach) {
            s.heading = Math.atan2(target.x - s.x, target.y - s.y)
            if (s.attackTimer <= 0) {
                attack(battle, s, target)
                s.attackTimer = stats.cooldown * (.85 + battle.random() * .3)
            }
        } else if (s.detour > 0 || s.stuckTime > .6) {
            // 柵に阻まれたら、相手のいるセルまでA*で迂回する。
            if (s.detour <= 0) { s.detour = 3; s.pathGoal = '' }
            s.detour -= dt
            const gx = Math.round(target.x / TILE_PX), gy = Math.round(target.y / TILE_PX)
            followPath(battle, s, { x: gx * TILE_PX, y: gy * TILE_PX }, `cell:${gx},${gy}`, dt)
        } else {
            // no-life-kingの追跡と同じく、経路を離れて敵へ直進する。
            moveToward(battle, s, target.x, target.y, dt)
        }
        return
    }
    // 占領して自軍のものになった拠点は、もう壊さない。
    const found = s.constructionId >= 0 ? battle.constructionById.get(s.constructionId) : undefined
    const site = found?.owner !== s.owner ? found : undefined
    if (s.constructionId >= 0 && !site) { s.constructionId = -1; s.thinkTimer = Math.min(s.thinkTimer, .05) }
    if (site) {
        // 建設物の最も近いマス（柵・橋の床）へ寄って壊す。
        s.state = 'fight'
        const p = nearestCell(site, s)
        const distance = Math.hypot(p.x - s.x, p.y - s.y)
        const reach = s.type === 'archer' ? stats.range : stats.range + stats.radius + TILE_PX / 2 + 1
        if (s.type === 'archer') s.aim = distance <= reach ? launchPitch(distance) : 0
        if (distance <= reach) {
            s.heading = Math.atan2(p.x - s.x, p.y - s.y)
            if (s.attackTimer <= 0) {
                attackConstruction(battle, s, site, p)
                s.attackTimer = stats.cooldown * (.85 + battle.random() * .3)
            }
        } else if (s.detour > 0 || s.stuckTime > .6) {
            if (s.detour <= 0) { s.detour = 3; s.pathGoal = '' }
            s.detour -= dt
            const goal = snapToPassable(battle, p)
            followPath(battle, s, goal, `cell:${Math.round(goal.x / TILE_PX)},${Math.round(goal.y / TILE_PX)}`, dt)
        } else moveToward(battle, s, p.x, p.y, dt)
        return
    }
    if (enemyFort && Math.hypot(enemyFort.core.x - s.x, enemyFort.core.y - s.y) <= enemyFort.coreRadius + FORT_ASSAULT_RANGE + stats.range) {
        s.state = 'assault'
        s.heading = Math.atan2(enemyFort.core.x - s.x, enemyFort.core.y - s.y)
        if (s.attackTimer <= 0 && enemyFort.hp > 0) {
            enemyFort.hp = Math.max(0, enemyFort.hp - stats.attack * (.8 + battle.random() * .4) * staminaFactor(squad))
            spendStamina(battle, s, STAMINA.attackCost)
            s.swing = s.type === 'archer' ? .7 : .45
            s.attackTimer = stats.cooldown * (.85 + battle.random() * .3)
        }
        return
    }
    if (waitsForSquad(battle, s, squad)) { s.state = 'hold'; return }
    if (escort) { followLeader(battle, s, squad, escort, dt); return }
    if (slot) {
        // 持ち場へ向かい、着いたら部隊の向きで構える。
        const post = battle.posts.get(squad.id)!
        const distance = Math.hypot(slot.x - s.x, slot.y - s.y)
        // 進んでいる隊列の槍兵は、動く持ち場に付いて前を向いたまま歩く。
        if (squad.march?.moving) {
            s.state = 'advance'
            if (s.routeDirect) {
                // 遅れを取り戻すときも、槍を隊列の進む方向へ向けたまま歩く。
                moveToward(battle, s, slot.x, slot.y, dt)
                s.heading = post.facing
            } else followPath(battle, s, post.goal, post.goalKey, dt)
            // ゆっくり進む隊列では1回の歩みがごくわずかで、持ち場に着いたとみなされて足が止まる回がある。隊列が進む間は歩き続ける。
            s.moving = true
            return
        }
        // 構えた兵は押し合いで少しずれても動かない（足踏みしないよう判定に幅を持たせる）。
        if (distance <= (s.state === 'hold' ? BUILD_REACH : 1.5)) {
            s.state = 'hold'; s.heading = post.facing; s.runTime = 0
            if (worksAtSite(squad.order)) work(battle, s, squad)
            return
        }
        s.state = 'advance'
        if (s.routeDirect) moveToward(battle, s, slot.x, slot.y, dt, (distance < 8 ? .6 : 1) * pace)
        else if (s.id === squad.leaderId) followPath(battle, s, post.goal, post.goalKey, dt, pace, 0)
        else {
            const { rx, ry } = axes(post.facing)
            s.lane = clampLane((slot.x - post.goal.x) * rx + (slot.y - post.goal.y) * ry)
            followPath(battle, s, post.goal, post.goalKey, dt)
        }
        return
    }
    s.state = 'advance'
    if (squad.order === 'attack' || squad.order === 'demolish') {
        followPath(battle, s, squad.anchor, squad.goalKey, dt, pace, marchLane(battle, s, squad))
        return
    }
    // 隊長は表示の経路と同じく一番近い攻撃地点へ、隊長を失った兵はそれぞれの攻撃地点へ向かう。
    const assault = s.id === squad.leaderId ? nearestAssault(enemyHome, s) : s.id % enemyHome.assaultPoints.length
    followPath(battle, s, enemyHome.assaultPoints[assault]!, fortGoalKey(enemyHome.owner, assault), dt, pace, marchLane(battle, s, squad))
}

/** 作業地点に着いた工兵が、槌を振るって建設・修理（占領）を進める。 */
function work(battle: Battle, s: Soldier, squad: Squad) {
    const site = battle.constructionById.get(squad.constructionId)
    const occupying = squad.order === 'occupy' && site?.owner !== squad.owner
    if (!site || (!occupying && site.complete && site.hp >= site.maxHp)) return
    const p = nearestCell(site, s)
    if (Math.hypot(p.x - s.x, p.y - s.y) > 1) s.heading = Math.atan2(p.x - s.x, p.y - s.y)
    if (occupying) site.occupiers += staminaFactor(squad)
    else site.workers += staminaFactor(squad)
    if (s.attackTimer <= 0) { s.swing = .45; s.attackTimer = .9 + battle.random() * .5 }
}

/**
 * 押し合い: 重なった兵を離す。柵には押し込まない。
 * 槍兵は味方とは押し合わずにすり抜けさせ、敵は槍の間合いの外へ押し返して通さない（槍兵は押されない）。
 */
function separate(battle: Battle, s: Soldier) {
    const r = UNIT_STATS[s.owner][s.type].radius
    const leaderId = battle.squadById.get(s.squadId)?.leaderId
    let px = 0, py = 0, wx = 0, wy = 0
    battle.hash.forEachNear(s.x, s.y, r + 3.5 + PIKEMAN.wallMargin, o => {
        if (o === s) return
        // 歩いている隊長は自分の部隊の兵には押されない（兵が道を譲る）。押し戻されると部隊ごと進めなくなる。
        if (s.id === leaderId && s.state === 'advance' && o.squadId === s.squadId) return
        const pike = s.type === 'pikeman' || o.type === 'pikeman'
        if (pike && o.owner === s.owner) return
        // 敵の槍兵には押されず（槍兵どうしは押し合う）、敵の槍兵の間合いへは踏み込めない。
        if (pike && s.type === 'pikeman' && o.type !== 'pikeman') return
        const wall = pike && o.type === 'pikeman' && s.type !== 'pikeman'
        const min = r + UNIT_STATS[o.owner][o.type].radius + (wall ? PIKEMAN.wallMargin : 0)
        const dx = s.x - o.x, dy = s.y - o.y, d2 = dx * dx + dy * dy
        if (d2 >= min * min) return
        const d = Math.sqrt(d2) || .01
        if (wall) {
            // 騎兵の勢いでも抜けられないよう、重なった分をまるごと押し返す。
            wx += (d2 ? dx / d : Math.cos(s.id)) * (min - d)
            wy += (d2 ? dy / d : Math.sin(s.id)) * (min - d)
            return
        }
        // 構えている兵は、動いている兵に道を譲る（譲った兵は後で持ち場へ戻る）。動いている兵はあまり押し返されない。
        let share = s.state === 'hold' && o.state !== 'hold' ? .9 : s.state !== 'hold' && o.state === 'hold' ? .1 : .5
        // 移動中の味方どうしは軽く押し合うだけにして、すれ違えるようにする（狭い道での行き違いの詰まりを防ぐ）。
        if (o.owner === s.owner && s.moving && o.moving) share *= .3
        // 歩いている隊長には兵が道を譲る（構えている隊長の脇は、兵が押し合わずにすり抜ける）。
        if (o.id === leaderId && o.moving && o.state === 'advance') share = 1
        const push = (min - d) * share
        px += (d2 ? dx / d : Math.cos(s.id)) * push
        py += (d2 ? dy / d : Math.sin(s.id)) * push
    })
    if (!px && !py && !wx && !wy) return
    const limit = 1.2
    const len = Math.hypot(px, py)
    if (len > limit) { px *= limit / len; py *= limit / len }
    // 味方との押し合いで、敵の槍兵の間合いの中へは押し込まれない。
    const wallLength0 = Math.hypot(wx, wy)
    if (wallLength0) {
        const along = (px * wx + py * wy) / wallLength0
        if (along < 0) { px -= wx / wallLength0 * along; py -= wy / wallLength0 * along }
    }
    const wallLimit = 4
    const wallLength = Math.hypot(wx, wy)
    if (wallLength > wallLimit) { wx *= wallLimit / wallLength; wy *= wallLimit / wallLength }
    px += wx; py += wy
    const nx = Math.max(PLAYABLE_MIN, Math.min(PLAYABLE_MAX, s.x + px)), ny = Math.max(PLAYABLE_MIN, Math.min(PLAYABLE_MAX, s.y + py))
    if (!impassable(battle, nx, ny)) { s.x = nx; s.y = ny }
}

function nearestEnemy(battle: Battle, owner: Army, x: number, y: number, radius: number) {
    let best: Soldier | undefined
    let bestD = radius * radius
    battle.hash.forEachNear(x, y, radius, o => {
        if (o.owner === owner) return
        const d = (o.x - x) ** 2 + (o.y - y) ** 2
        if (d < bestD) { bestD = d; best = o }
    })
    return best as Soldier | undefined
}

function updateArrows(battle: Battle, dt: number) {
    const spent = battle.spentArrows
    if (spent.length && (battle.time - spent[0]!.time > SPENT_ARROW_SECONDS || spent.length > SPENT_ARROW_LIMIT)) {
        battle.spentArrows = spent.filter((a, i) => battle.time - a.time <= SPENT_ARROW_SECONDS && i >= spent.length - SPENT_ARROW_LIMIT)
    }
    const arrows = battle.arrows
    for (let i = arrows.length - 1; i >= 0; i--) {
        const arrow = arrows[i]!
        arrow.time += dt
        if (arrow.time < arrow.duration) continue
        const site = arrow.constructionId >= 0 ? battle.constructionById.get(arrow.constructionId) : undefined
        const target = battle.byId.get(arrow.targetId)
        if (site) damageConstruction(battle, site, arrow.damage)
        else if (arrow.blocked) { /* 木に阻まれた矢は誰にも当たらない */ }
        else if (target && target.state !== 'dead' && Math.hypot(target.x - arrow.toX, target.y - arrow.toY) < 5) damageSoldier(battle, target, arrow.damage, undefined, { x: arrow.fromX, y: arrow.fromY })
        else {
            const stray = nearestEnemy(battle, arrow.owner, arrow.toX, arrow.toY, ARROW_AIM.strayRadius)
            if (stray) damageSoldier(battle, stray, arrow.damage * ARROW_AIM.strayDamage, undefined, { x: arrow.fromX, y: arrow.fromY })
            else {
                // 外れた矢は飛んできた向きのまま地面に刺さる。
                const dx = arrow.toX - arrow.fromX, dy = arrow.toY - arrow.fromY
                const distance = Math.hypot(dx, dy)
                battle.spentArrows.push({ x: arrow.toX, y: arrow.toY, yaw: Math.atan2(dx, dy), pitch: Math.atan2(4 * arrow.peak, Math.max(1, distance)), time: battle.time })
            }
        }
        arrows[i] = arrows[arrows.length - 1]!
        arrows.pop()
    }
}

/** 部隊の中で、足りない兵へ順に矢を配る。配れた本数を返す。 */
function giveArrows(members: Soldier[], amount: number) {
    let given = 0
    for (const s of members) {
        if (given >= amount) break
        const take = Math.min(s.maxArrows - s.arrows, amount - given)
        if (take > 0) { s.arrows += take; given += take }
    }
    return given
}

/** 部隊の不足の度合い（矢と体力のうち大きい方、0〜1）。 */
const shortage = (squad: Squad) => Math.max(squad.maxArrows > 0 ? 1 - squad.arrows / squad.maxArrows : 0, 1 - squad.stamina / STAMINA.max)

/** 補給: 矢切れ・体力切れの部隊を自陣へ戻して回復させ、補給部隊が前線の部隊へ矢と体力を届ける。 */
/** 補給に戻った部隊が、補給を終えたか（8割5分の兵の矢が満タンで、体力も回復した）。 */
function restocked(battle: Battle, squad: Squad) {
    const members = battle.members.get(squad.id) ?? []
    return members.filter(s => s.arrows >= s.maxArrows - .01).length >= members.length * .85 && squad.stamina >= STAMINA.max - .5
}

function updateSupplies(battle: Battle, dt: number) {
    for (const squad of battle.squads) {
        const members = battle.members.get(squad.id)!
        if (squad.order === 'resupply') {
            // 向かっていた拠点が壊れた（敵に占領された）ら、改めて最寄りの補給先へ。
            const site = squad.depotId >= 0 ? battle.constructionById.get(squad.depotId) : undefined
            if (squad.depotId >= 0 && (!site?.complete || site.owner !== squad.owner)) squad.depotId = nearestDepot(battle, squad.owner, squad.center)
            const depot = depotOf(battle, squad)
            if (Math.hypot(depot.x - squad.center.x, depot.y - squad.center.y) > depot.range + 40) continue
            // 砦の陣地（拠点）に戻った兵から矢を受け取り、部隊の体力も回復する。補給部隊は補給回数を積み直す。
            // 8割5分が満タンになったら、遅れている兵にも配って元の指示へ（混雑で取り残された数人を待ち続けないため）。
            for (const s of members) if (Math.hypot(depot.x - s.x, depot.y - s.y) < depot.range) s.arrows = Math.min(s.maxArrows, s.arrows + FORT_REFILL_RATE * dt)
            squad.stamina = Math.min(STAMINA.max, squad.stamina + STAMINA.fortRecovery * dt)
            squad.supplies = squad.maxSupplies
            // 中隊の小隊は、中隊でみな補給を終えてから指示に戻る。
            if (restocked(battle, squad) && companySquads(battle, squad.companyId).every(mate => mate.order !== 'resupply' || restocked(battle, mate))) {
                for (const s of members) s.arrows = s.maxArrows
                squad.stamina = STAMINA.max
                resumeOrder(battle, squad)
            }
            continue
        }
        if (squad.order === 'retreat') continue
        // 矢か体力が尽きかけたら、部隊ごと自陣へ戻る。
        if (squad.maxArrows > 0 && squad.arrows <= squad.maxArrows * RESUPPLY_THRESHOLD) { orderResupply(battle, squad.id); continue }
        if (squad.stamina <= STAMINA.returnBelow) { orderResupply(battle, squad.id); continue }
        if (squad.type !== 'supply' || squad.order !== 'support') continue
        // 届け先: 補給中の部隊、指定された部隊、なければ不足が大きく近い味方の部隊。
        let target = battle.squadById.get(squad.targetSquadId)
        const serving = target && squad.servingId === target.id
        if (!target || target.order === 'resupply' || (!serving && shortage(target) < .02)) {
            target = undefined
            squad.servingId = -1
            if (squad.supplies > 0) {
                let best = Infinity
                for (const other of battle.squads) {
                    if (other.owner !== squad.owner || other.type === 'supply' || other.order === 'resupply' || other.order === 'retreat') continue
                    const need = shortage(other)
                    if (need < 1 - SUPPORT_THRESHOLD) continue
                    const score = -need + Math.hypot(other.center.x - squad.center.x, other.center.y - squad.center.y) / 1500
                    if (score < best) { best = score; target = other }
                }
            }
            squad.targetSquadId = target?.id ?? -1
        }
        // 補給回数を使い切り、今の補給も終えたら自陣へ戻って積み直す。
        if (!target && squad.supplies <= 0) { orderResupply(battle, squad.id); continue }
        if (!target) {
            // 届け先がなければ、全軍の陣の後ろに控える。
            const formation = battle.formations[squad.owner]
            const rest = snapToPassable(battle, toWorld(formation.anchor, formation.facing, -110, 0))
            if (Math.hypot(rest.x - squad.anchor.x, rest.y - squad.anchor.y) > 40) {
                squad.anchor = rest; squad.facing = formation.facing
                squad.goalKey = goalFor(battle, `squad:${squad.id}`, rest, squad.goalKey)
            }
            continue
        }
        // 届け先の部隊のすぐ後ろ（自陣側）に付き、近ければ補給する。
        const behind = snapToPassable(battle, toWorld(target.center, target.facing, -squadBlock(target.type, Math.max(1, target.count)).depth / 2 - 14, 0))
        if (Math.hypot(behind.x - squad.anchor.x, behind.y - squad.anchor.y) > 30) {
            squad.anchor = behind; squad.facing = target.facing
            squad.goalKey = goalFor(battle, `squad:${squad.id}`, behind, squad.goalKey)
        }
        if (Math.hypot(target.center.x - squad.center.x, target.center.y - squad.center.y) > SUPPORT_RANGE) continue
        if (squad.servingId !== target.id) {
            // 補給を始めた時点で1回分を使う。
            if (squad.supplies <= 0) { squad.targetSquadId = -1; continue }
            squad.supplies--
            squad.servingId = target.id
        }
        // SUPPLY_DURATION 秒かけて、矢と体力を満タンにする。
        const targetMembers = battle.members.get(target.id)!
        giveArrows(targetMembers, target.maxArrows * dt / SUPPLY_DURATION)
        target.stamina = Math.min(STAMINA.max, target.stamina + STAMINA.max * dt / SUPPLY_DURATION)
        if (target.stamina >= STAMINA.max - .01 && targetMembers.every(s => s.arrows >= s.maxArrows - .01)) {
            squad.servingId = -1
            squad.targetSquadId = -1
        }
    }
}

/** 部隊の人数・重心を集計し、持ち場を求める。全滅した部隊は解散する。 */
function updateSquads(battle: Battle, dt: number) {
    battle.members.clear()
    for (const s of battle.soldiers) {
        if (s.state === 'dead' || s.desertion) continue
        let list = battle.members.get(s.squadId)
        if (!list) battle.members.set(s.squadId, list = [])
        list.push(s)
    }
    battle.squads = battle.squads.filter(squad => {
        const list = battle.members.get(squad.id)
        if (list?.length) return true
        battle.squadById.delete(squad.id)
        battle.travel.delete(squad.id); battle.pace.delete(squad.id)
        if (squad.goalKey) battle.paths.dropGoal(squad.goalKey)
        const company = battle.companyById.get(squad.companyId)
        if (company) company.squadIds = company.squadIds.filter(id => id !== squad.id)
        return false
    })
    // 小隊がすべて全滅した中隊は解散する。
    if (battle.companies.some(c => !c.squadIds.length)) {
        battle.companies = battle.companies.filter(c => {
            if (c.squadIds.length) return true
            battle.companyById.delete(c.id)
            return false
        })
    }
    for (const squad of battle.squads) {
        const list = battle.members.get(squad.id)!
        // 欠員が出たら前列から詰め直す。
        if (list.length !== squad.count) {
            list.sort((a, b) => a.slot - b.slot)
            list.forEach((s, i) => { s.slot = i })
        }
        squad.count = list.length
        let x = 0, y = 0, arrows = 0, maxArrows = 0
        for (const s of list) { x += s.x; y += s.y; arrows += s.arrows; maxArrows += s.maxArrows }
        squad.center = { x: x / list.length, y: y / list.length }
        squad.arrows = arrows; squad.maxArrows = maxArrows
        // 幟を持つ隊長が倒れたら、倒れた場所に最も近い兵が引き継ぐ（編成したてなら部隊の中心に最も近い兵）。
        const leader = battle.byId.get(squad.leaderId)
        if (!leader || leader.state === 'dead') {
            const from = leader ?? squad.center
            let best = list[0]!, bestDistance = Infinity
            for (const s of list) {
                const d = (s.x - from.x) ** 2 + (s.y - from.y) ** 2
                if (d < bestDistance) { bestDistance = d; best = s }
            }
            squad.leaderId = best.id
        }
        // 隊長は隊列のまん中の持ち場に立ち、部隊の兵が隊長を囲む。
        const head = battle.byId.get(squad.leaderId)!
        const middle = centerSlot(squad.type, list.length)
        if (head.slot !== middle) {
            const other = list.find(s => s.slot === middle)
            if (other) other.slot = head.slot
            head.slot = middle
        }
        let travel = battle.travel.get(squad.id) ?? squad.facing
        if (Math.hypot(head.vx, head.vy) > 4) {
            const turn = FOLLOW.turnRate * dt
            travel += Math.max(-turn, Math.min(turn, angleDiff(Math.atan2(head.vx, head.vy), travel)))
        }
        battle.travel.set(squad.id, travel)
        // 隊列の持ち場から一番遅れている兵の遅れに合わせて、隊長の歩みを緩める（戦っている兵は、隊長の近くの敵としか戦わないので見ない）。
        // 行き先のすぐ近くでは、兵はそれぞれの持ち場に集まるので待たない。
        const own = slotOffset(squad.type, list.length, head.slot)
        const post = battle.posts.get(squad.id)
        const goal = post && slotPosition(battle, head, squad)
        const arriving = goal && Math.hypot(goal.x - head.x, goal.y - head.y) < FOLLOW.settle
        let lag = 0
        for (const s of list) {
            if (arriving) break
            if (s.state === 'fight' || s.state === 'assault') continue
            const o = slotOffset(squad.type, list.length, s.slot)
            lag = Math.max(lag, Math.hypot(s.x - head.x, s.y - head.y) - Math.hypot(o.forward - own.forward, o.lateral - own.lateral))
        }
        battle.pace.set(squad.id, FOLLOW.leaderPace * Math.max(FOLLOW.minPace, Math.min(1, 1 - (lag - FOLLOW.lagFree) / FOLLOW.lagStop)))
    }
    updateCompanies(battle)
    updateSupplies(battle, dt)
    for (const squad of battle.squads) {
        if (squad.order === 'attack') {
            const target = battle.squadById.get(squad.targetSquadId)
            if (!target) orderHold(battle, squad.id)
            else if (Math.hypot(target.center.x - squad.anchor.x, target.center.y - squad.anchor.y) > 40) {
                squad.anchor = snapToPassable(battle, target.center)
                squad.goalKey = goalFor(battle, `squad:${squad.id}`, squad.anchor, squad.goalKey)
            }
        }
        // 建て終えた（直し終えた）工兵と、壊す相手がなくなった部隊はその場で構える。
        if (squad.order === 'build') {
            const site = battle.constructionById.get(squad.constructionId)
            if (!site || (site.complete && site.hp >= site.maxHp)) orderHold(battle, squad.id)
        }
        // 占領を終えた工兵は、拠点が傷んでいれば続けて直す。拠点が壊れた・占領できなくなったら構える。
        if (squad.order === 'occupy') {
            const site = battle.constructionById.get(squad.constructionId)
            if (site?.owner === squad.owner && site.hp < site.maxHp) orderBuild(battle, squad.id, site.id)
            else if (!site || !site.complete || site.owner === squad.owner) orderHold(battle, squad.id)
        }
        // 壊す相手がなくなった（占領して自軍のものになった）部隊も構える。
        if (squad.order === 'demolish' && battle.constructionById.get(squad.constructionId)?.owner !== enemyOf(squad.owner)) orderHold(battle, squad.id)
        if (squad.order === 'retreat') {
            // 自陣に戻ったら正門の内側（野営地）で構える。
            const home = battle.homes[squad.owner]
            if (Math.hypot(home.core.x - squad.center.x, home.core.y - squad.center.y) < 70) {
                squad.facing = frontFacing(home.front)
                orderHold(battle, squad.id)
            }
        }
    }
    battle.posts.clear()
    for (const army of ARMIES) {
        const slots = formationSlots(battle, army)
        const goal = battle.formations[army].anchor
        const goalKey = formationGoalKey(battle, army)
        for (const squad of battle.squads) {
            if (squad.owner !== army) continue
            if (squad.order === 'formation') {
                const post = slots.get(squad.id)
                if (!post) continue
                squad.anchor = post.anchor; squad.facing = post.facing
                battle.posts.set(squad.id, { anchor: post.anchor, facing: post.facing, goal, goalKey })
            } else if (worksAtSite(squad.order)) {
                const site = battle.constructionById.get(squad.constructionId)
                if (site) battle.posts.set(squad.id, { anchor: site.center, facing: squad.facing, goal: site.approach, goalKey: buildGoalKey(site) })
            } else if (squad.order === 'move' || squad.order === 'hold' || squad.order === 'support') {
                battle.posts.set(squad.id, { anchor: squad.anchor, facing: squad.facing, goal: battle.paths.passable(squad.anchor.x, squad.anchor.y) ? squad.anchor : snapToPassable(battle, squad.anchor), goalKey: squad.goalKey })
            } else if (squad.order === 'attack' && squad.type === 'pikeman') {
                // 槍兵は攻撃でも隊列を崩さず、相手の部隊へ向かって横隊のまま押し出す。
                const facing = Math.hypot(squad.anchor.x - squad.center.x, squad.anchor.y - squad.center.y) > 4
                    ? Math.atan2(squad.anchor.x - squad.center.x, squad.anchor.y - squad.center.y) : squad.facing
                battle.posts.set(squad.id, { anchor: squad.anchor, facing, goal: squad.anchor, goalKey: squad.goalKey })
            }
        }
    }
    // 槍兵の部隊は、持ち場へ向かって隊列ごと進む。
    for (const squad of battle.squads) {
        if (squad.type !== 'pikeman') continue
        const post = battle.posts.get(squad.id)
        if (!post || worksAtSite(squad.order)) { squad.march = null; continue }
        battle.posts.set(squad.id, advanceMarch(battle, squad, post, dt))
    }
}

/** 隊列（前列中央と向き）に対する今の位置から、前にいる兵から一列分ずつ取り、各列は左から順に持ち場を振り直す。 */
function assignSlotsByPosition(squad: Squad, members: Soldier[]) {
    const march = squad.march!
    const { cols } = squadBlock(squad.type, Math.max(1, members.length))
    const { fx, fy, rx, ry } = axes(march.facing)
    const forward = new Map(members.map(s => [s, (s.x - march.x) * fx + (s.y - march.y) * fy]))
    const lateral = new Map(members.map(s => [s, (s.x - march.x) * rx + (s.y - march.y) * ry]))
    members.sort((a, b) => forward.get(b)! - forward.get(a)!)
    for (let i = 0; i < members.length; i += cols) {
        const row = members.slice(i, i + cols).sort((a, b) => lateral.get(a)! - lateral.get(b)!)
        row.forEach((s, k) => { s.slot = i + k; members[i + k] = s })
    }
}

/** 角度の差を -π〜π に収める。 */
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/**
 * 槍兵の隊列を持ち場へ進める。隊列（前列中央と向き）は進む方向を向いた横隊のまま動き、兵はそこを基準にした持ち場に付いて歩く。
 * 遅れた兵が多いと隊列の歩みを緩め、向きを大きく変えるときは止まってから向きを変える。後ろへ向き直るときは、その場で回れ右をする。
 * 返すのは、兵が今向かう持ち場（隊列の位置と向き）。
 */
function advanceMarch(battle: Battle, squad: Squad, post: SquadPost, dt: number): SquadPost {
    const members = battle.members.get(squad.id) ?? []
    const { rows, spacing, width } = squadBlock(squad.type, Math.max(1, squad.count))
    const half = (rows - 1) * spacing / 2
    const pace = UNIT_STATS[squad.owner][squad.type].speed * getTimeSpeedMultiplier(squad.owner, battle.dayTime) * staminaFactor(squad)
    // 隊列がなければ（突撃・退却などのあと）、今の部隊の位置から組み直す。
    if (!squad.march) {
        const facing = Math.hypot(post.anchor.x - squad.center.x, post.anchor.y - squad.center.y) > 25
            ? Math.atan2(post.anchor.x - squad.center.x, post.anchor.y - squad.center.y) : post.facing
        squad.march = { ...toWorld(squad.center, facing, half, 0), facing, moving: true }
        assignSlotsByPosition(squad, members)
    }
    const march = squad.march
    const remaining = Math.hypot(post.anchor.x - march.x, post.anchor.y - march.y)
    // 進む先: まっすぐ行ければ持ち場へ、川や柵にかかるなら経路の次の地点へ。
    let tx = post.anchor.x, ty = post.anchor.y
    if (remaining > 1 && !isClearLine(battle, march.x, march.y, tx, ty)) {
        const path = battle.paths.request(march.x, march.y, post.goal, post.goalKey, 'foot')
        const next = path?.[1] ?? path?.[0]
        if (next) { tx = next.x; ty = next.y }
    }
    const step = Math.hypot(tx - march.x, ty - march.y)
    // 遠くへ進むときは進む方向を向き、近くでの小さな移動は向きを変えずに歩く。
    const want = remaining > 25 && step > .5 ? Math.atan2(tx - march.x, ty - march.y) : post.facing
    let diff = angleDiff(want, march.facing)
    if (Math.abs(diff) > 2.3) {
        // 回れ右: 向きを反転し、最後列を新しい前列にする（兵は今の位置のまま、新しい向きで持ち場を振り直す）。
        const back = toWorld(march, march.facing, -2 * half, 0)
        march.x = back.x; march.y = back.y; march.facing += Math.PI
        assignSlotsByPosition(squad, members)
        diff = angleDiff(want, march.facing)
    }
    if (Math.abs(diff) > .01) {
        // 隊列の中心を軸に向きを変える。両端の兵が付いて来られる速さまでしか回らない。
        const center = toWorld(march, march.facing, -half, 0)
        const turn = Math.min(PIKEMAN.turnRate, pace / Math.max(1, width / 2)) * dt
        march.facing += Math.max(-turn, Math.min(turn, diff))
        const front = toWorld(center, march.facing, half, 0)
        march.x = front.x; march.y = front.y
    }
    if (remaining > 1 && Math.abs(diff) <= PIKEMAN.wheelAngle) {
        // 兵の遅れ（持ち場からの距離。遅れている方から5%の兵の値）が大きいほど歩みを緩める。足場の悪い兵も置いていかない。
        const lags = members.map(s => {
            const offset = slotOffset(squad.type, members.length, s.slot)
            const p = toWorld(march, march.facing, offset.forward, offset.lateral)
            return Math.hypot(p.x - s.x, p.y - s.y)
        }).sort((a, b) => a - b)
        const lag = lags[Math.floor(lags.length * .95)] ?? 0
        const cohesion = Math.max(PIKEMAN.marchMinPace, Math.min(1, 1 - (lag - PIKEMAN.lagFrom) / PIKEMAN.lagRange))
        const dx = tx - march.x, dy = ty - march.y
        let terrain = getTerrainSpeedMultiplier(battle.grid, march.x, march.y, squad.type) || .4
        terrain *= battle.paths.slopeSpeed(march.x, march.y, dx, dy)
        const speed = pace * PIKEMAN.marchPace * cohesion * terrain * (battle.stride.get(squad.id) ?? 1)
        const move = Math.min(step, speed * dt)
        if (step > .01) { march.x += dx / step * move; march.y += dy / step * move }
    }
    march.moving = remaining > 1 || Math.abs(angleDiff(post.facing, march.facing)) > .02
    if (!march.moving) { march.x = post.anchor.x; march.y = post.anchor.y; march.facing = post.facing }
    return { anchor: { x: march.x, y: march.y }, facing: march.facing, goal: post.goal, goalKey: post.goalKey }
}

/** 部隊ごとの増援を砦から送り出す。人間軍（と攻城戦で砦を守る魔王軍）の増援は陣に加わり、それ以外の魔王軍は突撃する。 */
function updateForts(battle: Battle, dt: number, alive: Record<Army, number>) {
    for (const fort of battle.forts) {
        for (const tower of fort.towers) {
            tower.cooldown -= dt
            if (tower.cooldown > 0) continue
            const target = nearestEnemy(battle, fort.owner, tower.x, tower.y, TOWER.range)
            tower.cooldown = TOWER.cooldown * (.8 + battle.random() * .4)
            if (!target) continue
            launchArrow(battle, fort.owner, tower.x, tower.y, 20, target, TOWER.damage, .03)
        }
        fort.spawnTimer -= dt
        if (fort.spawnTimer > 0) continue
        fort.spawnTimer = REINFORCEMENT_INTERVAL
        let roll = battle.random(), type: UnitType = 'infantry'
        for (const t of TYPES) { roll -= REINFORCEMENT_MIX[t]; if (roll < 0) { type = t; break } }
        const count = Math.max(0, Math.min(SQUAD_SIZE[type], ARMY_CAP - alive[fort.owner], fort.reserves))
        if (count < 5) continue
        fort.reserves -= count
        const squad = createSquad(battle, fort.owner, type, count, type === 'supply' ? 'support' : fort.owner === 'player' || type === 'engineer' || battle.mode === 'siege' ? 'formation' : 'charge')
        joinCompany(battle, squad)
        const geometry = createFortGeometry(fort)
        const cells = type === 'cavalry' ? geometry.mountedSpawns : geometry.footSpawns
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.floor(battle.random() * cells.length)]!
            spawnSoldier(battle, squad, cell.x + (battle.random() - .5) * 10, cell.y + (battle.random() - .5) * 10, (battle.random() - .5) * LANE_HALF_WIDTH * 1.4)
        }
    }
}

export function updateBattle(battle: Battle, dt: number) {
    if (battle.winner) return
    battle.time += dt
    battle.dayTime = (battle.dayTime + dt * DAY_MINUTES_PER_SECOND) % 1440
    battle.hash.rebuild(battle.soldiers)
    battle.paths.process(PATH_BUDGET_PER_TICK)
    for (const site of battle.constructions) { site.workers = 0; site.occupiers = 0 }
    updateSquads(battle, dt)
    const alive = { player: 0, cpu: 0 }
    for (const army of ARMIES) battle.intruders[army].length = 0
    for (const s of battle.soldiers) {
        // 逃げ出した兵はもう軍に数えない。
        if (s.state === 'dead' || s.desertion) continue
        alive[s.owner]++
        const enemyFort = fortOf(battle, enemyOf(s.owner))
        if (enemyFort && Math.hypot(s.x - enemyFort.x, s.y - enemyFort.y) < fortVicinityOf(enemyFort.kind)) battle.intruders[enemyFort.owner].push(s)
    }
    for (const s of battle.soldiers) {
        if (s.state === 'dead') continue
        const x = s.x, y = s.y
        updateSoldier(battle, s, dt)
        separate(battle, s)
        holdTether(battle, s, x, y)
        // 速度はなめらかにならして持つ（押し合いの小刻みな動きで予測がぶれないように）。
        if (dt > 0) { s.vx += ((s.x - x) / dt - s.vx) * .3; s.vy += ((s.y - y) / dt - s.vy) * .3 }
    }
    // 移動で部隊の体力を使う（動いている兵の割合に比例）。
    for (const squad of battle.squads) {
        const members = battle.members.get(squad.id)
        if (!members?.length) continue
        let moving = 0
        for (const s of members) if (s.moving) moving++
        const cost = squad.type === 'cavalry' ? STAMINA.cavalryMoveCost : STAMINA.moveCost
        squad.stamina = Math.max(0, squad.stamina - cost * moving / members.length * dt)
    }
    updateArrows(battle, dt)
    updateConstructions(battle, dt)
    updateForts(battle, dt, alive)
    // 倒れた兵はしばらく戦場に残してから片付ける。
    if (battle.soldiers.some(s => s.state === 'dead' && battle.time - s.deathTime > CORPSE_SECONDS)) {
        battle.soldiers = battle.soldiers.filter(s => {
            const keep = s.state !== 'dead' || battle.time - s.deathTime <= CORPSE_SECONDS
            if (!keep) battle.byId.delete(s.id)
            return keep
        })
    }
    for (const fort of battle.forts) if (fort.hp <= 0) battle.winner = enemyOf(fort.owner)
    // 砦を持たない攻め手は、全滅したら敗北する。
    for (const army of ARMIES) if (!fortOf(battle, army) && alive[army] === 0) battle.winner = enemyOf(army)
}

export function summarize(battle: Battle): Record<Army, ArmySummary> {
    const result = Object.fromEntries(ARMIES.map(army => {
        const fort = fortOf(battle, army)
        return [army, {
            infantry: 0, pikeman: 0, archer: 0, cavalry: 0, supply: 0, engineer: 0, total: 0, fortHp: fort?.hp ?? 0, fortMaxHp: fort?.maxHp ?? 1,
            killed: battle.killed[army], deserted: battle.deserted[army], reserves: fort?.reserves ?? 0, hasFort: !!fort,
        }]
    })) as Record<Army, ArmySummary>
    for (const s of battle.soldiers) {
        if (s.state === 'dead' || s.desertion) continue
        result[s.owner][s.type]++
        result[s.owner].total++
    }
    return result
}
