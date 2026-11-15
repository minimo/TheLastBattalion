import {
    companyPosition, companySquads, enemyOf, orderCompany, orderCompanyAttack, orderCompanyMove, orderHold, orderMove, orderResupply, orderSupport, squadPosition, type Battle,
} from './battle'
import { createEngineerDirector, directRepairs, WIDE_OUTPOST_SEARCH } from './engineers'
import { isSupportType, squadBlock, toWorld } from './formation'
import { UNIT_STATS, UNIT_VISION } from './battleConfig'
import { knownSquadPosition, seenEnemySquads, visionRangeAt } from './vision'
import type { Army, Company, Directive, Guidance, Guideline, Point, Squad } from '../types/game'

const THINK_INTERVAL = 2.5
/** 開戦後、敵の部隊が自軍のどこかの部隊からこの距離に入ったら、全軍が行動に沿って動き出す。 */
const WAKE_DISTANCE = 250
/** 守備: 守る地点からこの距離の敵だけを迎え撃つ。 */
const GUARD_RADIUS = 150
/** 守備: 迎え撃った相手が守る地点からこれより離れたら、追わずに守る地点へ戻る。 */
const GUARD_PURSUIT = GUARD_RADIUS + 60
/** 本陣守備: 砦・陣からこの距離に入った敵を追い払い、これより遠くへ追ったら陣へ戻る。 */
const HOME_RADIUS = 300
const HOME_PURSUIT = 420
/** 援護: 付いている中隊の後ろに、この距離だけ空けて並ぶ。付いている中隊から相手がこれより離れたら、追わずに後ろへ戻る。 */
const ESCORT_BEHIND = 70
const ESCORT_PURSUIT = 200
/** 援護: 付く地点がこれより動いたら付き直す。 */
const ESCORT_SHIFT = 40
/** 遊撃: 敵の槍兵がこの距離にいる相手は狙わない。 */
const SKIRMISH_PIKE_AVOID = 90
/** 遊撃: 兵がこの割合を切ったら下がって立て直す（立て直したあとの兵の数から数え直す）。 */
const SKIRMISH_FALLBACK = .5
/** 偵察: 敵を自分の視界のこの割合の距離から見張る。これより近い割合まで近づかれたら、見張る距離まで下がる。 */
const SCOUT_WATCH = .75
const SCOUT_TOO_CLOSE = .5
/** 偵察: 見張る地点がこれより動いたら移り直す。 */
const SCOUT_SHIFT = 60
/** 偵察兵の小隊が下がり始める、敵の弓兵の射程の手前の余裕（px）。 */
const SCOUT_FLEE_MARGIN = 15
/** 偵察兵の小隊が、近づいた敵から下がるかを調べる間隔（秒）。行動の判断の間隔より短くして、すぐ下がる。 */
const SCOUT_ALERT_INTERVAL = .5
/** 偵察兵の小隊が下がり始める、敵の小隊との距離。弓兵はその射程の手前、ほかの兵種はその半分。 */
const scoutFleeDistance = (enemy: Squad) => {
    const archer = UNIT_STATS[enemy.owner].archer.range + SCOUT_FLEE_MARGIN
    return enemy.type === 'archer' ? archer : archer / 2
}
/** 行き先にこの距離まで来たら、着いたとみなす。 */
const ARRIVE = 45

const MELEE = new Set(['infantry', 'pikeman', 'cavalry'])
const isFighter = (sq: Squad) => !isSupportType(sq.type)
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** 行動に沿って動く部隊: 中隊、または中隊に入らない小隊（工兵・補給兵・偵察兵）。 */
interface Unit { guidance: Guidance; squads: Squad[]; company?: Company }

function unitsOf(battle: Battle, owner: Army): Unit[] {
    const units: Unit[] = []
    for (const company of battle.companies) {
        if (company.owner !== owner) continue
        const squads = companySquads(battle, company.id)
        if (squads.length) units.push({ guidance: company.guidance, squads, company })
    }
    for (const squad of battle.squads) if (squad.owner === owner && !battle.companyById.has(squad.companyId)) units.push({ guidance: squad.guidance, squads: [squad] })
    return units
}

/**
 * プレイヤーが部隊へ命令を出したことを記す（命令をやり終えるまで、行動の判断は手を出さない）。「待機」なら次の命令まで行動を止める。
 * target は中隊、中隊に入らない小隊、または軍のすべての部隊。
 */
export function markCommanded(battle: Battle, target: { companyId: number } | { squadId: number } | { army: Army }, directive: Exclude<Directive, 'none'>) {
    const units = 'army' in target ? unitsOf(battle, target.army).map(u => u.guidance)
        : 'companyId' in target ? [battle.companyById.get(target.companyId)?.guidance]
        : [battle.squadById.get(target.squadId)?.guidance]
    for (const guidance of units) if (guidance) guidance.directive = directive
}

/** 部隊の行動を変える。守る地点は選び直す（今いる所を守る）。 */
export function setGuideline(guidance: Guidance, guideline: Guideline) {
    guidance.guideline = guideline
    guidance.guardPoint = null
}

/**
 * 部隊の行動（人間軍）。魔王軍の指揮官と同じく、部隊単位で既存の指示を出す（中隊のまとまりの決まりはそのまま効く）。
 * - プレイヤーの命令が優先。命令をやり終えたら行動に戻る（「待機」は次の命令まで行動を止める）。補給に戻っている部隊は補給を終えるまで待つ
 * - 開戦直後は陣で構え、敵の部隊が近づいたら全軍が動き出す（偵察は開戦してすぐ動き出す）。それより前でも、命令をやり終えた部隊はその部隊だけ行動に沿って動く
 * scoutsOnly なら偵察兵の小隊だけを動かす（魔王軍の指揮官が偵察兵に使う）。
 */
export function createGuidelineDirector(battle: Battle, owner: Army = 'player', scoutsOnly = false) {
    let awake = false
    let timer = 0
    let alertTimer = 0
    /** 動き出す前に命令をやり終えて、先に行動に沿って動いている部隊。 */
    const released = new WeakSet<Guidance>()
    /** 援護で付いている中隊と、付いた地点。 */
    const escorts = new WeakMap<Guidance, { companyId: number; point: Point }>()
    /** 偵察で、向かっている見張りの地点。 */
    const lookouts = new WeakMap<Guidance, Point>()
    /** 待機に入って、進んでいる途中の移動を止めた部隊（ほかの行動に変えたら外す）。 */
    const standing = new WeakSet<Guidance>()
    /** 遊撃・偵察で、下がって立て直す目安にする兵の数（最後に立て直した時の数）。 */
    const strength = new WeakMap<Guidance, number>()
    const fortify = createEngineerDirector(battle, owner, WIDE_OUTPOST_SEARCH)

    /** 見えている敵の小隊（視界の外の敵は判断に使わない）。 */
    const enemies = () => seenEnemySquads(battle, owner)
    const nearest = (from: Point, list: Squad[], radius = Infinity) => {
        let best: Squad | undefined, bestDistance = radius
        for (const sq of list) {
            const d = distance(sq.center, from)
            if (d < bestDistance) { bestDistance = d; best = sq }
        }
        return best
    }
    const positionOf = (unit: Unit) => unit.company ? companyPosition(battle, unit.company) : squadPosition(battle, unit.squads[0]!)
    /** 中隊長の小隊の向き。 */
    const facingOf = (unit: Unit) => (unit.squads.find(sq => sq.id === unit.company?.leaderSquadId) ?? unit.squads[0]!).facing
    /** 小隊が持ち場（移動・陣形の行き先）に着いたか。 */
    const arrived = (sq: Squad) => {
        const depth = squadBlock(sq.type, Math.max(1, sq.count)).depth
        const middle = toWorld(sq.anchor, sq.facing, -depth / 2, 0)
        return distance(sq.center, middle) < ARRIVE || distance(squadPosition(battle, sq), middle) < ARRIVE
    }
    /** 命令をやり終えたか（みな構えたか、行き先に着いた。突撃・攻撃・建設・退却・補給の途中ならまだ）。 */
    const finished = (unit: Unit) => unit.squads.every(sq => sq.order === 'hold' || sq.order === 'support' || ((sq.order === 'move' || sq.order === 'formation') && arrived(sq)))
    const targetOf = (sq: Squad) => sq.order === 'attack' ? battle.squadById.get(sq.targetSquadId) : undefined

    /** 敵の小隊を攻撃する。中隊ごと、相手の中隊のうち各小隊に近い小隊へ（whole でなければその小隊だけへ）。 */
    const attack = (unit: Unit, enemy: Squad, whole = true) => {
        if (!unit.company) return
        const company = battle.companyById.get(enemy.companyId)
        orderCompanyAttack(battle, unit.company.id, whole && company ? { companyId: company.id } : { squadId: enemy.id })
    }
    const moveTo = (unit: Unit, point: Point, facing: number) => {
        if (unit.company) orderCompanyMove(battle, unit.company.id, point, facing)
        else for (const sq of unit.squads) orderMove(battle, sq.id, point, facing)
    }

    /** 守る地点（まだなければ今いる所。行き先へ向かっている途中なら、着くまで決めない）。 */
    const guardPointOf = (unit: Unit) => {
        const guidance = unit.guidance
        if (guidance.guardPoint) return guidance.guardPoint
        if (unit.squads.some(sq => (sq.order === 'move' || sq.order === 'formation') && !arrived(sq))) return undefined
        guidance.guardPoint = { ...positionOf(unit) }
        guidance.guardFacing = facingOf(unit)
        return guidance.guardPoint
    }

    /** 守備: 守る地点の近くの敵だけを迎え撃ち、遠くまで追ったら戻る。 */
    const guard = (unit: Unit, fighters: Squad[]) => {
        const post = guardPointOf(unit)
        if (!post) return
        const threat = nearest(post, enemies(), GUARD_RADIUS)
        const engaged = fighters.filter(sq => sq.order === 'attack')
        if (threat) {
            if (!engaged.length || engaged.some(sq => { const t = targetOf(sq); return !t || distance(knownSquadPosition(t), post) > GUARD_PURSUIT })) attack(unit, threat)
            return
        }
        const away = distance(positionOf(unit), post) > ARRIVE * 2
        if (engaged.length || (away && !fighters.every(sq => sq.order === 'move'))) moveTo(unit, post, unit.guidance.guardFacing)
    }

    /** 攻勢: 一番近い敵の中隊を攻撃する。いなければ敵本陣へ突撃する。 */
    const assault = (unit: Unit, fighters: Squad[]) => {
        if (fighters.every(sq => targetOf(sq))) return
        const enemy = nearest(positionOf(unit), enemies())
        if (enemy) attack(unit, enemy)
        else if (!fighters.every(sq => sq.order === 'charge')) orderCompany(battle, unit.company!.id, 'charge')
    }

    /** 援護: 一番近い味方の近接の中隊の後ろ（敵と反対の側）に付く。射撃は兵がそれぞれ判断する。付く中隊がなければ守備と同じ。 */
    const escort = (unit: Unit, fighters: Squad[]) => {
        const self = unit.company!
        const valid = (c: Company | undefined): c is Company => !!c && c.owner === owner && c.id !== self.id && c.guidance.guideline !== 'escort'
            && companySquads(battle, c.id).some(sq => MELEE.has(sq.type) && sq.count > 0)
        let ally = battle.companyById.get(escorts.get(unit.guidance)?.companyId ?? -1)
        if (!valid(ally)) {
            const here = positionOf(unit)
            ally = undefined
            let best = Infinity
            for (const c of battle.companies) {
                if (!valid(c)) continue
                const d = distance(companyPosition(battle, c), here)
                if (d < best) { best = d; ally = c }
            }
        }
        if (!ally) { escorts.delete(unit.guidance); guard(unit, fighters); return }
        const at = companyPosition(battle, ally)
        // 後ろは、付いている中隊から見て一番近い敵と反対の側（敵がいなければ中隊の向きの後ろ）。
        const foe = nearest(at, enemies())
        const allyHead = battle.squadById.get(ally.leaderSquadId)
        const facing = foe ? Math.atan2(foe.center.x - at.x, foe.center.y - at.y) : allyHead?.facing ?? facingOf(unit)
        const depth = Math.max(...companySquads(battle, ally.id).map(sq => squadBlock(sq.type, Math.max(1, sq.count)).depth))
        const point = toWorld(at, facing, -(depth / 2 + ESCORT_BEHIND), 0)
        const engaged = fighters.filter(sq => sq.order === 'attack')
        const chasing = engaged.some(sq => { const t = targetOf(sq); return !t || distance(knownSquadPosition(t), at) > ESCORT_PURSUIT })
        const last = escorts.get(unit.guidance)
        const shifted = !last || last.companyId !== ally.id || distance(last.point, point) > ESCORT_SHIFT
        if (chasing || (!engaged.length && (shifted || !fighters.every(sq => sq.order === 'move')))) {
            moveTo(unit, point, facing)
            escorts.set(unit.guidance, { companyId: ally.id, point })
        }
    }

    /** 兵が半分を切ったら、補給に戻って立て直す（立て直したあとの兵の数から数え直す）。戻ったら true。 */
    const fallBack = (unit: Unit, fighters: Squad[]) => {
        const count = fighters.reduce((sum, sq) => sum + sq.count, 0)
        const base = strength.get(unit.guidance) ?? fighters.reduce((sum, sq) => sum + sq.size, 0)
        if (count >= base * SKIRMISH_FALLBACK) return false
        strength.set(unit.guidance, count)
        if (unit.company) orderCompany(battle, unit.company.id, 'resupply')
        else for (const sq of fighters) orderResupply(battle, sq.id)
        return true
    }

    /** 遊撃: 槍兵を避けて、弓兵・補給兵・工兵や数の減った敵を狙う。兵が半分を切ったら下がって立て直す。 */
    const skirmish = (unit: Unit, fighters: Squad[]) => {
        if (fallBack(unit, fighters)) return
        const foes = enemies()
        const pikes = foes.filter(sq => sq.type === 'pikeman')
        const exposed = (sq: Squad) => sq.type !== 'pikeman' && !pikes.some(p => distance(p.center, sq.center) < SKIRMISH_PIKE_AVOID)
        const current = fighters.map(targetOf)
        if (current.every(t => t && exposed(t))) return
        const here = positionOf(unit)
        const prey = nearest(here, foes.filter(sq => exposed(sq) && (sq.type === 'archer' || sq.type === 'supply' || sq.type === 'engineer' || sq.count < sq.size * .5)))
            ?? nearest(here, foes.filter(exposed))
        if (prey) attack(unit, prey, false)
        else guard(unit, fighters)
    }

    /**
     * 偵察: 敵陣の方向へ進み、自分の目で見えた一番近い敵を、視界の端に近い距離から見張る（自分からは攻めない）。
     * 近づかれたら見張る距離まで下がる。見える敵がいなければ、敵陣を見張る所まで進む。兵が半分を切ったら下がって立て直す。
     * 中隊のほか、偵察兵の小隊もこの行動で動く。
     */
    /** 偵察兵の小隊から下がり始める距離（scoutFleeDistance）に入った、見えている敵の小隊のうち一番近いもの。 */
    const threatTo = (here: Point) => {
        let best: Squad | undefined, bestDistance = Infinity
        for (const sq of enemies()) {
            const d = distance(knownSquadPosition(sq), here)
            if (d <= scoutFleeDistance(sq) && d < bestDistance) { bestDistance = d; best = sq }
        }
        return best
    }

    const scout = (unit: Unit, fighters: Squad[]) => {
        if (fallBack(unit, fighters)) return
        const here = positionOf(unit)
        const sight = Math.max(...fighters.map(sq => visionRangeAt(UNIT_VISION[owner][sq.type], battle.dayTime, battle.weather)))
        // 偵察兵の小隊は、下がり始める距離（scoutFleeDistance）に入った敵から下がる。中隊は視界の SCOUT_TOO_CLOSE の割合より近い敵から下がる。
        const threat = unit.company ? undefined : threatTo(here)
        const foe = threat ?? nearest(here, enemies(), sight)
        const watched = foe ? knownSquadPosition(foe) : battle.homes[enemyOf(owner)]
        const away = distance(here, watched)
        const toward = Math.atan2(watched.x - here.x, watched.y - here.y)
        // 見えている敵との間がほどよければ、その場で止まって見張り続ける。
        const settled = foe && (unit.company ? away >= sight * SCOUT_TOO_CLOSE : !threat) && !fighters.some(sq => sq.order === 'attack')
        if (settled && fighters.every(sq => sq.order !== 'move' || arrived(sq))) return
        const point = settled ? here : toWorld(watched, toward, -sight * SCOUT_WATCH, 0)
        const last = lookouts.get(unit.guidance)
        if (last && distance(last, point) < SCOUT_SHIFT && fighters.every(sq => sq.order === 'move')) return
        moveTo(unit, point, toward)
        lookouts.set(unit.guidance, point)
    }

    /**
     * 待機（偵察兵）: 自分からは動かず、その場に留まって見張る。偵察で進んでいる途中に待機へ変えたら、その場で止まる。
     * 見えている敵に下がり始める距離（scoutFleeDistance）まで近づかれたら、偵察と同じく見張る距離（視界の SCOUT_WATCH）まで下がって、そこで留まる。
     */
    const standby = (unit: Unit) => {
        if (!standing.has(unit.guidance)) {
            for (const sq of unit.squads) if (sq.order === 'move') orderHold(battle, sq.id)
            standing.add(unit.guidance)
        }
        const here = positionOf(unit)
        const sight = Math.max(...unit.squads.map(sq => visionRangeAt(UNIT_VISION[owner][sq.type], battle.dayTime, battle.weather)))
        const foe = threatTo(here)
        if (!foe) return
        const at = knownSquadPosition(foe)
        const away = Math.atan2(here.x - at.x, here.y - at.y)
        const point = toWorld(at, away, sight * SCOUT_WATCH, 0)
        // 下がっている途中なら、行き先が大きく変わるまで指示し直さない。
        const last = lookouts.get(unit.guidance)
        if (last && distance(last, point) < SCOUT_SHIFT && unit.squads.every(sq => sq.order === 'move')) return
        moveTo(unit, point, away + Math.PI)
        lookouts.set(unit.guidance, point)
    }

    /** 本陣守備: 陣の持ち場に控え、砦・陣に近づいた敵を追い払う。遠くまで追ったら陣に戻る。 */
    const homeGuard = (unit: Unit, fighters: Squad[]) => {
        const home = battle.homes[owner], anchor = battle.formations[owner].anchor
        const near = (p: Point, radius: number) => distance(p, anchor) < radius || distance(p, home) < radius
        const engaged = fighters.filter(sq => sq.order === 'attack')
        if (engaged.length && engaged.every(sq => { const t = targetOf(sq); return t && near(knownSquadPosition(t), HOME_PURSUIT) })) return
        const threat = nearest(positionOf(unit), enemies().filter(sq => near(sq.center, HOME_RADIUS)))
        if (threat) attack(unit, threat)
        else if (!fighters.every(sq => sq.order === 'formation')) orderCompany(battle, unit.company!.id, 'formation')
    }

    const act = (unit: Unit) => {
        const guideline = unit.guidance.guideline
        if (guideline === 'standby') { standby(unit); return }
        standing.delete(unit.guidance)
        if (guideline === 'supply') { for (const sq of unit.squads) if (sq.type === 'supply' && sq.order !== 'support') orderSupport(battle, sq.id); return }
        if (guideline === 'fortify') { fortify(unit.squads.filter(sq => sq.type === 'engineer')); return }
        if (guideline === 'repair') { directRepairs(battle, owner, unit.squads.filter(sq => sq.type === 'engineer')); return }
        // 偵察兵の小隊は戦わずに偵察だけをする。
        if (!unit.company) {
            const scouts = unit.squads.filter(sq => sq.type === 'scout')
            if (guideline === 'scout' && scouts.length) scout(unit, scouts)
            return
        }
        const fighters = unit.squads.filter(isFighter)
        if (!fighters.length) return
        if (guideline === 'assault') assault(unit, fighters)
        else if (guideline === 'guard') guard(unit, fighters)
        else if (guideline === 'escort') escort(unit, fighters)
        else if (guideline === 'skirmish') skirmish(unit, fighters)
        else if (guideline === 'scout') scout(unit, fighters)
        else homeGuard(unit, fighters)
    }

    return {
        /** 全軍が行動に沿って動き出したか。 */
        get awake() { return awake },
        update(dt: number) {
            // 偵察兵の小隊は、近づいた敵から下がるかを行動の判断より短い間隔で調べる。
            alertTimer -= dt
            if (alertTimer <= 0) {
                alertTimer = SCOUT_ALERT_INTERVAL
                for (const unit of unitsOf(battle, owner)) {
                    const { guideline, directive } = unit.guidance
                    if (unit.company || directive !== 'none' || (guideline !== 'scout' && guideline !== 'standby')) continue
                    if (!unit.squads.every(sq => sq.type === 'scout' && sq.order !== 'resupply')) continue
                    if (threatTo(positionOf(unit))) act(unit)
                }
            }
            timer -= dt
            if (timer > 0) return
            timer = THINK_INTERVAL
            if (!awake) {
                const foes = enemies()
                awake = battle.squads.some(sq => sq.owner === owner && sq.count > 0 && foes.some(e => distance(e.center, sq.center) < WAKE_DISTANCE))
            }
            for (const unit of unitsOf(battle, owner)) {
                if (scoutsOnly && !unit.squads.every(sq => sq.type === 'scout')) continue
                const guidance = unit.guidance
                if (guidance.directive === 'wait') continue
                if (guidance.directive === 'order') {
                    if (!finished(unit)) continue
                    // 命令をやり終えたら行動に戻る。移動・陣形のあとは、着いた所を守る地点にする。
                    guidance.directive = 'none'
                    // 待機の部隊は、やり終えた命令の移動を止め直さない（行き先の手前で止まらないように）。
                    standing.add(guidance)
                    guidance.guardPoint = null
                    released.add(guidance)
                }
                // 偵察だけは、敵が近づくのを待たずに開戦してすぐ動き出す（偵察から待機に変えたら、すぐ止まる）。
                if (!awake && !released.has(guidance) && guidance.guideline !== 'scout' && guidance.guideline !== 'standby') continue
                if (unit.squads.some(sq => sq.order === 'resupply')) continue
                act(unit)
            }
        },
    }
}
export type GuidelineDirector = ReturnType<typeof createGuidelineDirector>
