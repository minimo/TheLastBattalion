import { orderArmy, orderAttack, orderBuild, orderCharge, orderConstruct, orderFormation, orderRetreat, previewConstruction, setFormation, type Battle } from './battle'
import { fortVicinityOf } from './battleConfig'
import { FORMATIONS, toWorld } from './formation'
import type { Point, Squad } from '../types/game'

const THINK_INTERVAL = 2.5
/** 砦を守るときに迎え撃つ、敵部隊と砦・陣との距離。これより遠くへ追った部隊は陣に戻す。 */
const DEFEND_RADIUS = 300
const PURSUIT_RADIUS = 420
/** 拠点を築くとき、自軍の砦の周り・陣から離す距離。近くに建てても前線の足場にならない。 */
const OUTPOST_CLEARANCE = 160

/**
 * 魔王軍の指揮官。プレイヤーと同じく部隊単位で指示を出す。
 * 陣を組んで待ち、時機を見て全軍突撃。消耗した部隊は下げ、立て直したら再び突撃させる。
 * 工兵は自軍の砦と敵本陣の間の前線に拠点を築いて前にバリケードを並べ、傷んだ建設物を直す。
 * 攻城戦で砦を守るときは打って出ず、陣や砦に迫った敵部隊を迎え撃つ。
 */
export function createCpuCommander(battle: Battle) {
    // 開戦時の陣形はランダム
    setFormation(battle, 'cpu', FORMATIONS[Math.floor(battle.random() * FORMATIONS.length)]!.type)
    const defending = battle.mode === 'siege'
    let charged = false
    const chargeAt = 12 + battle.random() * 14
    let timer = 0
    const holdSince = new Map<number, number>()

    /** 拠点・バリケードの建設地。基準の地点の前方から順に、建てられる場所を探す。 */
    const findSite = (kind: 'outpost' | 'barricade', around: Point, facing: number, offsets: number[][], allowed = (_: Point) => true) => {
        for (const [forward, lateral] of offsets) {
            const point = toWorld(around, facing, forward!, lateral!)
            if (allowed(point) && previewConstruction(battle, 'cpu', kind, point, 'y').valid) return point
        }
        return undefined
    }
    /** 拠点を探す基準の地点と、敵本陣への向き。自軍の砦から敵本陣へ向かう線上の、自軍の砦・陣から離れた所。 */
    const frontline = () => {
        const home = battle.homes.cpu, enemy = battle.homes.player
        const facing = Math.atan2(enemy.x - home.x, enemy.y - home.y)
        const fort = battle.forts.find(f => f.owner === 'cpu')
        const reach = (fort ? fortVicinityOf(fort.kind) : 0) + OUTPOST_CLEARANCE
        const forward = Math.max(reach, Math.hypot(enemy.x - home.x, enemy.y - home.y) * .45)
        const anchor = battle.formations.cpu.anchor
        const allowed = (p: Point) => Math.hypot(p.x - home.x, p.y - home.y) >= reach && Math.hypot(p.x - anchor.x, p.y - anchor.y) >= OUTPOST_CLEARANCE
        return { center: toWorld(home, facing, forward, 0), facing, allowed }
    }
    const directEngineers = (engineers: Squad[]) => {
        const own = battle.constructions.filter(c => c.owner === 'cpu')
        for (const squad of engineers) {
            if (squad.order === 'build') continue
            // 建設中のもの、傷んだものから手を付ける。
            const pending = own.find(c => !c.complete || c.hp < c.maxHp * .6)
            if (pending) { orderBuild(battle, squad.id, pending.id); continue }
            const outpost = own.find(c => c.kind === 'outpost')
            const front = frontline()
            if (!outpost) {
                const offsets = [0, -40, 40, -80, 80, -120].flatMap(f => [0, 40, -40, 80, -80, 120, -120].map(l => [f, l]))
                const point = findSite('outpost', front.center, front.facing, offsets, front.allowed)
                if (point && orderConstruct(battle, squad.id, 'outpost', point)) own.push(battle.constructions.at(-1)!)
                continue
            }
            if (own.filter(c => c.kind === 'barricade').length < 2) {
                const offsets = [[80, -50], [80, 50], [100, -70], [100, 70], [120, 0]]
                const point = findSite('barricade', outpost.center, front.facing, offsets)
                if (point && orderConstruct(battle, squad.id, 'barricade', point)) own.push(battle.constructions.at(-1)!)
            }
        }
    }
    /** 砦と陣に近い敵部隊へ、近い部隊から向かわせる。遠くまで追った部隊は陣に戻す。 */
    const defend = () => {
        const formation = battle.formations.cpu
        const fort = battle.homes.cpu
        const near = (p: Point, radius: number) =>
            Math.hypot(p.x - formation.anchor.x, p.y - formation.anchor.y) < radius || Math.hypot(p.x - fort.x, p.y - fort.y) < radius
        const threats = battle.squads.filter(sq => sq.owner === 'player' && near(sq.center, DEFEND_RADIUS))
        for (const squad of battle.squads) {
            if (squad.owner !== 'cpu' || squad.type === 'supply' || squad.type === 'engineer' || squad.order === 'resupply') continue
            if (squad.order === 'attack') {
                const target = battle.squadById.get(squad.targetSquadId)
                if (!target || !near(target.center, PURSUIT_RADIUS)) orderFormation(battle, squad.id)
                continue
            }
            if (squad.order !== 'formation' && squad.order !== 'hold') continue
            // 消耗した部隊は砦に下げ、そのまま守らせる。
            if (squad.count < squad.size * .2) { if (squad.order === 'formation') orderRetreat(battle, squad.id); continue }
            let best: Squad | undefined, bestDistance = Infinity
            for (const threat of threats) {
                const d = Math.hypot(threat.center.x - squad.center.x, threat.center.y - squad.center.y)
                if (d < bestDistance) { bestDistance = d; best = threat }
            }
            if (best && bestDistance < DEFEND_RADIUS) orderAttack(battle, squad.id, best.id)
        }
    }
    return {
        update(dt: number) {
            timer -= dt
            if (timer > 0) return
            timer = THINK_INTERVAL
            const formation = battle.formations.cpu
            directEngineers(battle.squads.filter(sq => sq.owner === 'cpu' && sq.type === 'engineer' && sq.order !== 'resupply'))
            if (defending) { defend(); return }
            if (!charged) {
                // 敵が陣に迫るか、時間が来たら突撃する。
                const threatened = battle.soldiers.some(s => s.owner === 'player' && s.state !== 'dead'
                    && Math.hypot(s.x - formation.anchor.x, s.y - formation.anchor.y) < 260)
                if (threatened || battle.time >= chargeAt) { orderArmy(battle, 'cpu', 'charge'); charged = true }
                return
            }
            for (const squad of battle.squads) {
                // 補給部隊・工兵と補給中の部隊は、それぞれの役目に任せる。
                if (squad.owner !== 'cpu' || squad.type === 'supply' || squad.type === 'engineer' || squad.order === 'resupply') continue
                if (squad.order === 'charge' && squad.count < squad.size * .2) orderRetreat(battle, squad.id)
                else if (squad.order === 'hold' || squad.order === 'formation') {
                    const since = holdSince.get(squad.id) ?? battle.time
                    holdSince.set(squad.id, since)
                    if (battle.time - since > 12) { orderCharge(battle, squad.id); holdSince.delete(squad.id) }
                }
            }
        },
    }
}
export type CpuCommander = ReturnType<typeof createCpuCommander>
