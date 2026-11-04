import { canOccupy, enemyOf, orderBuild, orderConstruct, orderOccupy, previewConstruction, type Battle } from './battle'
import { isSiteKnown } from './vision'
import { fortVicinityOf } from './battleConfig'
import { toWorld } from './formation'
import type { Army, Point, Squad } from '../types/game'

/** 拠点を築くとき、自軍の砦の周り・陣から離す距離。近くに建てても前線の足場にならない。 */
const OUTPOST_CLEARANCE = 160
/** 工兵がこの距離内にある、敵の工兵がいない拠点を占領しに行く。 */
const OCCUPY_RADIUS = 400

/**
 * 工兵の築城の判断（魔王軍の指揮官と、人間軍の「前線の築城」の行動で共通）。
 * 建設中・傷んだ建設物を直し、近くの敵の拠点を占領し、自軍の砦と敵本陣の間の前線に拠点を築いて前にバリケードを2つ並べる。
 * search は拠点を探す範囲: reaches は前線の目安（自軍の砦から敵本陣までの割合。前から順に、建てられる場所が見つかるまで試す）、laterals は目安から左右へずらす距離。
 */
export function createEngineerDirector(battle: Battle, owner: Army, search: { reaches: number[]; laterals: number[] } = { reaches: [.45], laterals: [0, 40, -40, 80, -80, 120, -120] }) {
    const { reaches, laterals } = search
    /** 拠点・バリケードの建設地。基準の地点の前方から順に、建てられる場所を探す。 */
    const findSite = (kind: 'outpost' | 'barricade', around: Point, facing: number, offsets: number[][], allowed = (_: Point) => true) => {
        for (const [forward, lateral] of offsets) {
            const point = toWorld(around, facing, forward!, lateral!)
            if (allowed(point) && previewConstruction(battle, owner, kind, point, 'y').valid) return point
        }
        return undefined
    }
    /** 拠点を探す基準の地点と、敵本陣への向き。自軍の砦から敵本陣へ向かう線上の、自軍の砦・陣から離れた所。 */
    const frontline = (ratio: number) => {
        const home = battle.homes[owner], enemy = battle.homes[enemyOf(owner)]
        const facing = Math.atan2(enemy.x - home.x, enemy.y - home.y)
        const fort = battle.forts.find(f => f.owner === owner)
        const reach = (fort ? fortVicinityOf(fort.kind) : 0) + OUTPOST_CLEARANCE
        const forward = Math.max(reach, Math.hypot(enemy.x - home.x, enemy.y - home.y) * ratio)
        const anchor = battle.formations[owner].anchor
        const allowed = (p: Point) => Math.hypot(p.x - home.x, p.y - home.y) >= reach && Math.hypot(p.x - anchor.x, p.y - anchor.y) >= OUTPOST_CLEARANCE
        return { center: toWorld(home, facing, forward, 0), facing, allowed }
    }
    return (engineers: Squad[]) => {
        const own = battle.constructions.filter(c => c.owner === owner)
        for (const squad of engineers) {
            if (squad.order === 'build' || squad.order === 'occupy') continue
            // 建設中のもの、傷んだものから手を付ける。
            const pending = own.find(c => !c.complete || c.hp < c.maxHp * .6)
            if (pending) { orderBuild(battle, squad.id, pending.id); continue }
            // 近くの、敵の工兵がいない拠点を占領する。
            const target = battle.constructions.find(c => isSiteKnown(c, owner) && canOccupy(battle, owner, c) && Math.hypot(c.center.x - squad.center.x, c.center.y - squad.center.y) < OCCUPY_RADIUS)
            if (target) { orderOccupy(battle, squad.id, target.id); continue }
            const outpost = own.find(c => c.kind === 'outpost')
            const front = frontline(reaches[0]!)
            if (!outpost) {
                const offsets = [0, -40, 40, -80, 80, -120].flatMap(f => laterals.map(l => [f, l]))
                for (const ratio of reaches) {
                    const line = frontline(ratio)
                    const point = findSite('outpost', line.center, line.facing, offsets, line.allowed)
                    if (point && orderConstruct(battle, squad.id, 'outpost', point)) { own.push(battle.constructions.at(-1)!); break }
                }
                continue
            }
            if (own.filter(c => c.kind === 'barricade').length < 2) {
                const offsets = [[80, -50], [80, 50], [100, -70], [100, 70], [120, 0]]
                const point = findSite('barricade', outpost.center, front.facing, offsets)
                if (point && orderConstruct(battle, squad.id, 'barricade', point)) own.push(battle.constructions.at(-1)!)
            }
        }
    }
}

/** 「修理」の行動: 建設中の、または傷んだ自軍の建設物を、傷みの大きい順に建てて直す（同じものに工兵が集まってよい）。 */
export function directRepairs(battle: Battle, owner: Army, engineers: Squad[]) {
    const damaged = battle.constructions.filter(c => c.owner === owner && (!c.complete || c.hp < c.maxHp))
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
    const site = damaged[0]
    if (!site) return
    for (const squad of engineers) if (squad.order !== 'build') orderBuild(battle, squad.id, site.id)
}
