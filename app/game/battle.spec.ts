import { describe, expect, it } from 'vitest'
import { generateMap } from './mapGenerator'
import { createMulberry32, hashString } from './random'
import {
    cohesionRadius, companyLeader, companyPosition, companySquads, createBattle, isBlocked, moveFormation, orderArmy, orderAttack, orderBuild, orderCompany, orderCompanyAttack, orderCompanyMove, orderConstruct,
    orderDemolish, orderHold, orderMove, orderResupply,
    orderRetreat, previewConstruction, redeployArmy, setFormation, staminaFactor, summarize, updateBattle,
} from './battle'
import { createCpuCommander } from './cpuCommander'
import { axes, COMPANY_MAX_SQUADS, slotOffset, squadBlock, SQUAD_SIZE, toWorld } from './formation'
import { FORT_DEPTH, FORT_WIDTH, isBlockedLocal, localToGrid } from './fortLayout'
import { CASTLE_ASSAULT_CELLS, CASTLE_DEPTH, CASTLE_WIDTH, castleCell, isCastleBlocked } from './castleLayout'
import { findPath } from './pathfinding'
import { TILE_PX } from './constants'
import { ARROWS_PER_ARCHER, CONSTRUCTION, FORT_REFILL_RANGE, INITIAL_SQUADS, PIKEMAN, SHIELD, SIEGE_ATTACKER_SQUADS, STAMINA, SUPPLY_CHARGES, UNIT_STATS } from './battleConfig'
import { TILE } from './constants'
import { getPlayableTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from './playableArea'
import { getTerrainSpeedMultiplier, getTileCost, WATER_SPEED } from './terrain'
import { MAP_TYPES, mapTypeForMode, mapTypeOf } from './mapType'
import { armyPool, defaultDeployment, deployLimit, DEPLOYMENT_PRESETS, normalizeDeployment, plannedCompanies, presetDeployment, type DeploymentPlan } from './deployment'
import type { BattleMode, MapType, UnitType } from '../types/game'

const makeBattle = (seed: string, mode: BattleMode = 'field', mapType: MapType = mapTypeForMode(mode, 'standard'), plan?: DeploymentPlan) => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), mapType)
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), mode, plan ? { player: plan } : {})
}

/**
 * 経路が通れないマスを通らないか（4pxごとに調べる）。findPath は一直線に並ぶ中間点を省くので、
 * 通れる経路でも2点だけになることがある。経路が見つからないときの直線は、ここで柵や壁にかかって失敗する。
 */
const routeIsClear = (battle: ReturnType<typeof makeBattle>, path: { x: number; y: number }[]) => path.every((b, i) => {
    if (i === 0) return true
    const a = path[i - 1]!, steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4))
    for (let k = 0; k <= steps; k++) if (isBlocked(battle.grid, a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps)) return false
    return true
})

describe('砦の配置', () => {
    it('砦の中の通れるマスはすべて正門につながっている', () => {
        const open = new Set<string>()
        for (let lx = 1; lx < FORT_DEPTH - 1; lx++) for (let ly = 1; ly < FORT_WIDTH - 1; ly++) if (!isBlockedLocal(lx, ly)) open.add(`${lx},${ly}`)
        const seen = new Set(['11,7'])
        const queue = [[11, 7]]
        while (queue.length) {
            const [x, y] = queue.pop()!
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = `${x! + dx!},${y! + dy!}`
                if (open.has(k) && !seen.has(k)) { seen.add(k); queue.push([x! + dx!, y! + dy!]) }
            }
        }
        for (const cell of open) expect(seen.has(cell), cell).toBe(true)
    })
})

describe('城の配置', () => {
    const inside = (lx: number, ly: number) => lx >= 0 && lx < CASTLE_DEPTH && ly >= 0 && ly < CASTLE_WIDTH && castleCell(lx, ly) !== 'outside'
    const flood = (start: [number, number], open: (lx: number, ly: number) => boolean, diagonal: boolean) => {
        const seen = new Set([start.join(',')])
        const queue = [start]
        const steps = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]
        while (queue.length) {
            const [x, y] = queue.pop()!
            for (const [dx, dy] of steps) {
                const nx = x + dx!, ny = y + dy!
                if (nx < -2 || ny < -2 || nx > CASTLE_DEPTH + 1 || ny > CASTLE_WIDTH + 1 || seen.has(`${nx},${ny}`) || !open(nx, ny)) continue
                seen.add(`${nx},${ny}`)
                queue.push([nx, ny])
            }
        }
        return seen
    }
    it('城の中の通れるマスはすべて正門につながり、本陣の攻撃地点に届く', () => {
        const passable = (lx: number, ly: number) => !inside(lx, ly) || !isCastleBlocked(castleCell(lx, ly))
        const seen = flood([CASTLE_DEPTH, Math.floor(CASTLE_WIDTH / 2)], passable, false)
        for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
            if (inside(lx, ly) && !isCastleBlocked(castleCell(lx, ly))) expect(seen.has(`${lx},${ly}`), `${lx},${ly}`).toBe(true)
        }
        for (const [lx, ly] of CASTLE_ASSAULT_CELLS) expect(castleCell(lx, ly)).toBe('terrace')
    })
    it('城壁は正門のほかに斜めにもすり抜けられない', () => {
        // 正門を塞ぐと、外から（斜めの移動を含めても）城の中へ入れない。
        const sealed = (lx: number, ly: number) => {
            if (!inside(lx, ly)) return true
            const cell = castleCell(lx, ly)
            return !isCastleBlocked(cell) && cell !== 'gate'
        }
        const outside = flood([-2, -2], sealed, true)
        for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
            if (inside(lx, ly) && !isCastleBlocked(castleCell(lx, ly)) && castleCell(lx, ly) !== 'gate') expect(outside.has(`${lx},${ly}`), `${lx},${ly}`).toBe(false)
        }
    })
})

describe('戦闘', () => {
    // 613061・657675・903052 は戦場の中心が川のマップ（以前は砦を置けずに止まっていた）。
    for (const seed of ['123456', '777777', '424242', '100001', '851651', '795704', '248222', '512108', '587029', '102398', '454739', '999999', '613061', '657675', '903052']) {
        it(`両軍の砦が戦場の左右にほどよい距離で置かれ、互いに行き来できる（SEED ${seed}）`, () => {
            const battle = makeBattle(seed)
            const [human, monster] = battle.forts
            expect(human!.owner).toBe('player')
            expect(human!.x).toBeLessThan(monster!.x - 600)
            expect(Math.hypot(monster!.x - human!.x, monster!.y - human!.y)).toBeLessThan(1350)
            for (const fort of battle.forts) {
                for (const p of fort.assaultPoints) expect(isBlocked(battle.grid, p.x, p.y)).toBe(false)
                const wall = localToGrid(fort, 0, 3)
                expect(isBlocked(battle.grid, wall.gx * TILE_PX, wall.gy * TILE_PX)).toBe(true)
            }
            const path = findPath(battle.grid, human!.assaultPoints[0]!.x, human!.assaultPoints[0]!.y, monster!.assaultPoints[0]!.x, monster!.assaultPoints[0]!.y)
            expect(routeIsClear(battle, path)).toBe(true)
            const total = (Object.keys(INITIAL_SQUADS) as UnitType[]).reduce((sum, type) => sum + INITIAL_SQUADS[type] * SQUAD_SIZE[type], 0)
            const summary = summarize(battle)
            expect(summary.player.total).toBeGreaterThan(total * .9)
            expect(summary.cpu.total).toBeGreaterThan(total * .9)
        })
    }

    it('突撃を命じると両軍がぶつかり、戦死者が出る', () => {
        const battle = makeBattle('123456')
        const commander = createCpuCommander(battle)
        orderArmy(battle, 'player', 'charge')
        for (let t = 0; t < 80 && !battle.winner; t += 1 / 30) { updateBattle(battle, 1 / 30); commander.update(1 / 30) }
        expect(battle.killed.player + battle.killed.cpu).toBeGreaterThan(100)
        for (const s of battle.soldiers) if (s.state !== 'dead') expect(isBlocked(battle.grid, s.x, s.y)).toBe(false)
    }, 120000)
})

describe('部隊', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('すべての兵が同じ兵種の部隊に所属して布陣する', () => {
        const battle = makeBattle('123456')
        const squads = battle.squads.filter(sq => sq.owner === 'player')
        expect(squads).toHaveLength(Object.values(INITIAL_SQUADS).reduce((a, b) => a + b, 0))
        for (const s of battle.soldiers) expect(battle.squadById.get(s.squadId)!.type).toBe(s.type)
    })

    it('隊長が倒れると、最も近い兵が幟を引き継ぐ', () => {
        const battle = makeBattle('123456')
        run(battle, .1)
        const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        const leader = battle.byId.get(squad.leaderId)!
        expect(leader.squadId).toBe(squad.id)
        const nearest = battle.members.get(squad.id)!.filter(s => s !== leader)
            .sort((a, b) => Math.hypot(a.x - leader.x, a.y - leader.y) - Math.hypot(b.x - leader.x, b.y - leader.y))[0]!
        leader.hp = 0; leader.state = 'dead'
        run(battle, 1 / 30)
        expect(squad.leaderId).toBe(nearest.id)
    })

    it('数が減って傷ついた魔王軍の歩兵は、劣勢になると部隊を離れて逃げ出し、離れたら逃走として消える', () => {
        const battle = makeBattle('123456')
        run(battle, .1)
        const squad = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'infantry')!
        const members = battle.members.get(squad.id)!
        members.filter(s => s.id !== squad.leaderId).slice(0, Math.ceil(members.length * .6)).forEach(s => { s.hp = 0; s.state = 'dead'; s.deathTime = battle.time })
        for (const s of members) if (s.state !== 'dead') s.hp = s.maxHp * .3
        // 近くの他の部隊の魔王軍は退けて、味方の少ない劣勢にする。
        for (const s of battle.soldiers) if (s.owner === 'cpu' && s.squadId !== squad.id && Math.hypot(s.x - squad.center.x, s.y - squad.center.y) < 200) { s.state = 'dead'; s.deathTime = battle.time }
        orderHold(battle, squad.id)
        // 人間軍の歩兵2部隊を、魔王軍の部隊のすぐそばへ寄せて囲ませる。
        const enemies = battle.squads.filter(sq => sq.owner === 'player' && sq.type === 'infantry').slice(0, 2)
        for (const enemy of enemies) {
            for (const s of battle.members.get(enemy.id)!) { s.x = squad.center.x - 30 + (battle.random() - .5) * 30; s.y = squad.center.y + (battle.random() - .5) * 40 }
            orderMove(battle, enemy.id, squad.center)
        }
        const deserters = new Set<number>()
        for (let t = 0; t < 4 && !deserters.size; t += 1 / 30) {
            updateBattle(battle, 1 / 30)
            for (const s of battle.soldiers) if (s.desertion && s.state !== 'dead') deserters.add(s.id)
        }
        expect(deserters.size).toBeGreaterThan(0)
        const deserter = battle.byId.get([...deserters][0]!)!
        expect(deserter.squadId).toBe(-1)
        // 部隊の顔ぶれは次のティックで集計し直される。
        run(battle, 1 / 30)
        expect(battle.members.get(squad.id)).not.toContain(deserter)
        run(battle, 16)
        // 逃げた兵は戦場から消え、撃破ではなく魔王軍の逃走に数えられる。
        for (const id of deserters) expect(battle.byId.has(id)).toBe(false)
        expect(battle.deserted.cpu).toBeGreaterThan(0)
        expect(summarize(battle).cpu.deserted).toBe(battle.deserted.cpu)
        expect(battle.deserted.player).toBe(0)
        expect(battle.soldiers.some(s => s.owner === 'player' && s.desertion)).toBe(false)
    })

    it('突撃しても、兵は隊長から離れすぎない', () => {
        const battle = makeBattle('123456')
        const commander = createCpuCommander(battle)
        orderArmy(battle, 'player', 'charge')
        let worst = 0
        // 進軍の間（敵とぶつかって乱戦になる前）を見る。
        for (let t = 0; t < 30 && !battle.winner; t += 1 / 30) {
            updateBattle(battle, 1 / 30); commander.update(1 / 30)
            if (t < 10) continue
            for (const squad of battle.squads) {
                if (squad.owner !== 'player' || squad.order !== 'charge') continue
                const leader = battle.byId.get(squad.leaderId)!
                const radius = cohesionRadius(squad)
                const far = battle.members.get(squad.id)!.filter(s => Math.hypot(s.x - leader.x, s.y - leader.y) > radius * 1.5).length
                worst = Math.max(worst, far / squad.count)
            }
        }
        expect(worst).toBeLessThan(.1)
    }, 120000)

    it('部隊は指定した地点へ移動して構える', () => {
        const battle = makeBattle('424242')
        const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        run(battle, .1)
        const target = { x: squad.center.x + 90, y: squad.center.y + 60 }
        orderMove(battle, squad.id, target)
        // この移動先は登り坂の先にあるので、坂で遅くなる分の時間を見込む。
        run(battle, 35)
        expect(Math.hypot(squad.center.x - target.x, squad.center.y - target.y)).toBeLessThan(20)
        const holding = battle.members.get(squad.id)!.filter(s => s.state === 'hold').length
        expect(holding).toBeGreaterThan(squad.count * .8)
    }, 60000)

    it('陣形を変えて、陣全体を移動できる', () => {
        const battle = makeBattle('777777')
        setFormation(battle, 'player', 'crane')
        const before = { ...battle.formations.player.anchor }
        moveFormation(battle, 'player', { x: before.x + 120, y: before.y })
        run(battle, 25)
        const squads = battle.squads.filter(sq => sq.owner === 'player')
        const cx = squads.reduce((sum, sq) => sum + sq.center.x, 0) / squads.length
        expect(cx).toBeGreaterThan(before.x + 40)
        // 補給部隊は陣形を変えても補給任務を続ける
        expect(squads.every(sq => sq.order === (sq.type === 'supply' ? 'support' : 'formation'))).toBe(true)
    }, 60000)

    it('陣が戦場の端にあっても、持ち場は戦場の中に収まり、両翼の部隊も持ち場に着く', () => {
        // この地形では横陣の右翼の外側の騎兵の持ち場が、そのままだと戦場の外に出る。
        const battle = makeBattle('625612')
        orderArmy(battle, 'cpu', 'hold')
        setFormation(battle, 'player', 'line')
        run(battle, 10)
        const inField = (p: { x: number; y: number }) => [p.x, p.y].every(v => v >= PLAYABLE_GRID_MIN * TILE_PX && v <= PLAYABLE_GRID_MAX * TILE_PX)
        const squads = battle.squads.filter(sq => sq.owner === 'player' && sq.order === 'formation')
        for (const squad of squads) expect(inField(squad.anchor), `${squad.type}${squad.number}`).toBe(true)
        // 右翼の外側の第4騎兵隊は、戦場の端で止まらずに持ち場に着いて構える。
        const cavalry = squads.find(sq => sq.type === 'cavalry' && sq.number === 4)!
        const middle = toWorld(cavalry.anchor, cavalry.facing, -squadBlock(cavalry.type, cavalry.count).depth / 2, 0)
        expect(Math.hypot(cavalry.center.x - middle.x, cavalry.center.y - middle.y)).toBeLessThan(15)
    }, 60000)

    it('指定した敵部隊を攻撃しに向かう', () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        const cavalry = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'cavalry')!
        run(battle, .1)
        const target = battle.squads.filter(sq => sq.owner === 'cpu')
            .sort((a, b) => Math.hypot(a.center.x - cavalry.center.x, a.center.y - cavalry.center.y) - Math.hypot(b.center.x - cavalry.center.x, b.center.y - cavalry.center.y))[0]!
        // 地形に左右されないよう、標的の部隊を騎兵から約250px離れた開けた場所へ移しておく。
        const members = battle.members.get(target.id)!
        const spot = (x: number, y: number) => members.map((_, i) => ({ x: x + (i % 8) * 5, y: y + Math.floor(i / 8) * 5 }))
        const clearLine = (x: number, y: number) => Array.from({ length: 50 }, (_, k) => k / 49)
            .every(t => !isBlocked(battle.grid, cavalry.center.x + (x - cavalry.center.x) * t, cavalry.center.y + (y - cavalry.center.y) * t))
        let placed: { x: number; y: number }[] | undefined
        for (let a = 0; a < Math.PI * 2 && !placed; a += Math.PI / 16) {
            const x = cavalry.center.x + Math.cos(a) * 250, y = cavalry.center.y + Math.sin(a) * 250
            const points = spot(x, y)
            if (points.every(p => !isBlocked(battle.grid, p.x, p.y)) && clearLine(x, y)) placed = points
        }
        expect(placed).toBeDefined()
        members.forEach((s, i) => { s.x = placed![i]!.x; s.y = placed![i]!.y })
        run(battle, .1)
        orderHold(battle, target.id)
        orderAttack(battle, cavalry.id, target.id)
        run(battle, 30)
        const alive = battle.squadById.get(target.id)
        // 標的の部隊に損害を与えている（または壊滅させた）
        expect(alive ? alive.count : 0).toBeLessThan(target.size - 2)
        // 標的を倒したら、その場で待機に切り替わる
        expect(cavalry.order).toBe(alive ? 'attack' : 'hold')
    }, 120000)
})

describe('槍兵', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number, each?: () => void) => {
        for (let t = 0; t < seconds; t += 1 / 30) { updateBattle(battle, 1 / 30); each?.() }
    }
    /** 部隊の中心から distance px 先の、まっすぐ行けて周りも開けた地点。 */
    const openSpot = (battle: ReturnType<typeof makeBattle>, from: { x: number; y: number }, distance: number, start = 0) => {
        for (let a = start; a < start + Math.PI * 2; a += Math.PI / 16) {
            const x = from.x + Math.cos(a) * distance, y = from.y + Math.sin(a) * distance
            const line = Array.from({ length: 60 }, (_, k) => k / 59).every(t => !isBlocked(battle.grid, from.x + (x - from.x) * t, from.y + (y - from.y) * t))
            const area = [-40, -20, 0, 20, 40].every(dx => [-40, -20, 0, 20, 40].every(dy => !isBlocked(battle.grid, x + dx, y + dy)))
            if (line && area) return { x, y }
        }
        return undefined
    }
    /** 兵が隊列の持ち場からずれている距離の平均。 */
    const lagOf = (battle: ReturnType<typeof makeBattle>, squadId: number) => {
        const post = battle.posts.get(squadId)!, members = battle.members.get(squadId)!
        return members.reduce((sum, s) => {
            const o = slotOffset('pikeman', members.length, s.slot)
            const p = toWorld(post.anchor, post.facing, o.forward, o.lateral)
            return sum + Math.hypot(p.x - s.x, p.y - s.y)
        }, 0) / members.length
    }

    it('移動中も進む方向を向いた横隊を崩さずに進み、行き先で構える', () => {
        const battle = makeBattle('424242')
        orderArmy(battle, 'cpu', 'hold')
        const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'pikeman')!
        run(battle, 3)
        // 今の向きから横へそれた方向へ動かし、向きを変えながら進ませる。
        const target = openSpot(battle, squad.center, 100, squad.facing + Math.PI / 2)
        expect(target).toBeDefined()
        orderMove(battle, squad.id, target!)
        const heading = Math.atan2(target!.x - squad.center.x, target!.y - squad.center.y)
        let worst = 0, aligned = false
        // 槍兵は足が遅く、この移動先は丘を越えるので、時間を見込む。
        const ordered = battle.time
        run(battle, 70, () => {
            if (!squad.march?.moving) return
            // 回れ右・向きを変えた直後に隊列を組み直す間（2秒）は除く。
            if (battle.time - ordered > 2) worst = Math.max(worst, lagOf(battle, squad.id))
            const post = battle.posts.get(squad.id)!
            if (Math.abs(Math.atan2(Math.sin(post.facing - heading), Math.cos(post.facing - heading))) < .15) aligned = true
        })
        // 隊列の向きが行き先の方へ向き、兵は隊列の持ち場から大きく離れない
        expect(aligned).toBe(true)
        expect(worst).toBeLessThan(4)
        expect(Math.hypot(squad.center.x - target!.x, squad.center.y - target!.y)).toBeLessThan(15)
        const members = battle.members.get(squad.id)!
        expect(members.filter(s => s.state === 'hold').length).toBeGreaterThan(members.length * .8)
    }, 120000)

    it('敵は槍兵の間合いへ踏み込めず、味方は槍兵の隊列をすり抜けられる', () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        const pike = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'pikeman')!
        const friend = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        const enemy = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'infantry')!
        run(battle, 3)
        orderHold(battle, pike.id)
        // 敵の歩兵を槍兵の前へ並べ、槍兵の隊列の向こうへ進ませる。味方の歩兵は槍兵の隊列の中へ。
        const { fx, fy, rx, ry } = axes(pike.facing)
        const front = toWorld(pike.anchor, pike.facing, 25, 0)
        battle.members.get(enemy.id)!.forEach((s, i) => {
            const p = toWorld(front, pike.facing, Math.floor(i / 10) * 5, (i % 10 - 4.5) * 5)
            s.x = p.x; s.y = p.y
        })
        run(battle, .1)
        const anchor = { ...pike.anchor }
        orderMove(battle, enemy.id, toWorld(anchor, pike.facing, -60, 0))
        orderMove(battle, friend.id, pike.center)
        const pikeR = UNIT_STATS.player.pikeman.radius, enemyR = UNIT_STATS.cpu.infantry.radius
        const halfWidth = squadBlock('pikeman', pike.count).width / 2
        let closest = Infinity, passed = 0
        run(battle, 10, () => {
            for (const p of battle.members.get(pike.id) ?? []) for (const e of battle.members.get(enemy.id) ?? []) {
                closest = Math.min(closest, Math.hypot(p.x - e.x, p.y - e.y))
            }
            // 槍兵の隊列の幅の内側で、前列より後ろへ抜けた敵
            for (const e of battle.members.get(enemy.id) ?? []) {
                const forward = (e.x - anchor.x) * fx + (e.y - anchor.y) * fy, lateral = (e.x - anchor.x) * rx + (e.y - anchor.y) * ry
                if (forward < -2 && Math.abs(lateral) < halfWidth - 6) passed++
            }
        })
        expect(passed).toBe(0)
        expect(closest).toBeGreaterThan(pikeR + enemyR + PIKEMAN.wallMargin - 1)
        // 生き残った敵は隊長の幟のもとで戦い続けるので、退かせてから味方の歩兵が槍兵の隊列の中に収まるのを見る。
        // 隊長は兵が付いて来られるよう抑えて歩き、川を渡って戻る兵もいるので、時間を見込む。
        if (battle.squadById.has(enemy.id)) orderRetreat(battle, enemy.id)
        run(battle, 30)
        expect(Math.hypot(friend.center.x - pike.center.x, friend.center.y - pike.center.y)).toBeLessThan(20)
    }, 120000)
})

describe('矢と補給', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('弓兵は矢を消費し、尽きたら部隊ごと自陣へ戻って補給する', () => {
        const battle = makeBattle('123456')
        const archers = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'archer')!
        run(battle, .1)
        // 矢をほぼ使い切った状態にする
        battle.members.get(archers.id)!.forEach(s => { s.arrows = 0 })
        run(battle, .1)
        expect(archers.order).toBe('resupply')
        run(battle, 60)
        // 自陣で9割以上が満タンになり、陣形に戻っている
        expect(archers.order).toBe('formation')
        const members = battle.members.get(archers.id)!
        expect(members.filter(s => s.arrows > ARROWS_PER_ARCHER - 1).length).toBeGreaterThanOrEqual(members.length * .9)
    }, 120000)

    it('構えた弓兵は、射程の端の敵にも射続ける', () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        const archers = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'archer')!
        const enemy = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'infantry')!
        run(battle, 3)
        orderHold(battle, archers.id)
        // 敵の歩兵を、弓兵の隊長から射程の8割ほど前に並べて構えさせる（歩兵の視界の外なので向かって来ない）。
        const leader = battle.byId.get(archers.leaderId)!
        const front = toWorld(leader, archers.facing, UNIT_STATS.player.archer.range * .8, 0)
        battle.members.get(enemy.id)!.forEach((s, i) => {
            const p = toWorld(front, archers.facing, Math.floor(i / 10) * 5, (i % 10 - 4.5) * 5)
            s.x = p.x; s.y = p.y
        })
        run(battle, .1)
        orderHold(battle, enemy.id)
        const before = new Map(battle.members.get(archers.id)!.map(s => [s.id, s.arrows]))
        run(battle, 8)
        const members = battle.members.get(archers.id)!
        const shooters = members.filter(s => s.arrows < before.get(s.id)! - 2).length
        expect(shooters).toBeGreaterThan(members.length * .7)
    }, 120000)

    for (const type of ['infantry', 'pikeman'] as const) it(`${type === 'infantry' ? '歩兵' : '槍兵'}は正面から飛んできた矢を盾で受け、背後からの矢はそのまま受ける`, () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        run(battle, 8)
        // 持ち場に着いて向きが変わらなくなった兵を選ぶ。
        const headings = new Map(battle.soldiers.map(s => [s.id, s.heading]))
        run(battle, .2)
        const soldier = battle.soldiers.find(s => s.owner === 'cpu' && s.type === type && s.state !== 'dead' && s.heading === headings.get(s.id))!
        expect(soldier).toBeDefined()
        // 兵の向いている方向（front）または真後ろ（back）50px から放たれた矢を、兵の足元に着弾させる。
        const hit = (side: 'front' | 'back') => {
            soldier.hp = 1000
            const sign = side === 'front' ? 1 : -1
            const fromX = soldier.x + Math.sin(soldier.heading) * 50 * sign, fromY = soldier.y + Math.cos(soldier.heading) * 50 * sign
            battle.arrows.push({
                owner: 'player', fromX, fromY, fromZ: 5, peak: 10, toX: soldier.x, toY: soldier.y,
                targetId: soldier.id, constructionId: -1, blocked: false, damage: 10, time: 0, duration: 0,
            })
            updateBattle(battle, 1 / 30)
            return 1000 - soldier.hp
        }
        const front = hit('front'), back = hit('back')
        expect(back).toBeGreaterThan(0)
        expect(front / back).toBeCloseTo(SHIELD.damageTaken, 5)
    }, 120000)

    it('補給を終えたら補給前の指示に戻る', () => {
        const battle = makeBattle('424242')
        const archers = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'archer')!
        run(battle, .1)
        const target = { x: archers.center.x + 60, y: archers.center.y }
        orderMove(battle, archers.id, target)
        battle.members.get(archers.id)!.forEach(s => { s.arrows = 5 })
        orderResupply(battle, archers.id)
        run(battle, 60)
        expect(archers.order).toBe('move')
    }, 120000)

    it('補給部隊が前線の弓兵に矢を届ける', () => {
        const battle = makeBattle('777777')
        orderArmy(battle, 'cpu', 'hold')
        const archers = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'archer')!
        const supply = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'supply')!
        expect(supply.order).toBe('support')
        run(battle, .1)
        // 半分だけ矢が減った状態（自陣へ戻る基準には届かない）
        battle.members.get(archers.id)!.forEach(s => { s.arrows = ARROWS_PER_ARCHER / 2 })
        const before = battle.members.get(archers.id)!.reduce((n, s) => n + s.arrows, 0)
        run(battle, 40)
        const after = battle.members.get(archers.id)!.reduce((n, s) => n + s.arrows, 0)
        expect(archers.order).not.toBe('resupply')
        expect(after).toBeGreaterThan(before + 200)
        // 補給を1回分使っている
        expect(supply.supplies).toBeLessThan(supply.maxSupplies)
    }, 120000)

})

describe('部隊の体力', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('移動で体力を使い、疲れると足が遅くなる', () => {
        const battle = makeBattle('424242')
        const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        run(battle, .1)
        const start = squad.stamina
        orderMove(battle, squad.id, { x: squad.center.x + 120, y: squad.center.y })
        run(battle, 8)
        expect(squad.stamina).toBeLessThan(start)
        expect(staminaFactor(squad)).toBe(1)
        squad.stamina = 0
        expect(staminaFactor(squad)).toBeCloseTo(STAMINA.minFactor)
    }, 60000)

    it('体力が尽きかけたら自陣へ戻って回復し、元の指示に戻る', () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        run(battle, .1)
        squad.stamina = STAMINA.returnBelow - 1
        run(battle, .1)
        expect(squad.order).toBe('resupply')
        // 元の指示に戻った時点の体力を見る（陣へ戻る道のりでまた減るため）。
        let resumed = -1
        for (let t = 0; t < 70 && resumed < 0; t += 1 / 30) {
            updateBattle(battle, 1 / 30)
            if (squad.order === 'formation') resumed = squad.stamina
        }
        expect(resumed).toBeGreaterThan(STAMINA.max - 5)
    }, 120000)

    it('補給部隊は回数を使い切ったら自陣へ戻り、回数を積み直す', () => {
        const battle = makeBattle('777777')
        orderArmy(battle, 'cpu', 'hold')
        const supply = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'supply')!
        const tired = battle.squads.filter(sq => sq.owner === 'player' && sq.type === 'infantry').slice(0, 2)
        run(battle, .1)
        // 補給は残り1回。疲れた部隊が2つあるので、1つ補給したら戻るしかない。
        supply.supplies = 1
        for (const sq of tired) sq.stamina = 30
        // 補給を受けた部隊は体力が戻る（その後また動けば減るので、40秒のうちに戻ったかを見る）
        let rested = false, returned = false
        for (let t = 0; t < 130 && !(rested && returned); t += 1) {
            run(battle, 1)
            rested ||= tired.some(sq => sq.stamina > 95)
            returned ||= supply.order === 'resupply'
        }
        expect(rested).toBe(true)
        expect(returned).toBe(true)
        for (let t = 0; t < 90 && supply.order === 'resupply'; t += 1) run(battle, 1)
        expect(supply.order).toBe('support')
        expect(supply.supplies).toBe(SUPPLY_CHARGES)
    }, 240000)
})

describe('工兵の建設物', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }
    const engineers = (battle: ReturnType<typeof makeBattle>) => battle.squads.filter(sq => sq.owner === 'player' && sq.type === 'engineer')
    const blockedCells = (battle: ReturnType<typeof makeBattle>, cells: { gx: number; gy: number }[]) => cells.map(c => isBlocked(battle.grid, c.gx * TILE_PX, c.gy * TILE_PX))

    it('工兵がバリケードを建てると通れなくなり、壊されると元に戻る', () => {
        const battle = makeBattle('123456')
        orderArmy(battle, 'cpu', 'hold')
        const [engineer] = engineers(battle)
        run(battle, .1)
        expect(orderConstruct(battle, engineer!.id, 'barricade', { x: engineer!.center.x + 80, y: engineer!.center.y })).toBe(true)
        const site = battle.constructions[0]!
        expect(site.walls).toHaveLength(5)
        // 建設中はまだ通れる
        run(battle, 5)
        expect(site.complete).toBe(false)
        expect(blockedCells(battle, site.walls).some(Boolean)).toBe(false)
        for (let t = 0; t < 90 && !site.complete; t += 5) run(battle, 5)
        expect(site.complete).toBe(true)
        expect(blockedCells(battle, site.walls).every(Boolean)).toBe(true)
        // 建て終えた工兵はその場で構える
        run(battle, .1)
        expect(engineer!.order).toBe('hold')
        // 敵の工兵が壊しに来る（守り手のいない場所へ移しておく）
        const enemy = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'engineer')!
        for (const s of battle.soldiers) if (s.owner === 'player') { s.state = 'dead'; s.deathTime = battle.time }
        battle.members.get(enemy.id)!.forEach((s, i) => { s.x = site.center.x + 30 + (i % 6) * 5; s.y = site.center.y + Math.floor(i / 6) * 5 - 10 })
        run(battle, .1)
        orderDemolish(battle, enemy.id, site.id)
        for (let t = 0; t < 120 && battle.constructionById.has(site.id); t += 5) run(battle, 5)
        expect(battle.constructionById.has(site.id)).toBe(false)
        expect(blockedCells(battle, site.walls).some(Boolean)).toBe(false)
    }, 240000)

    it('工兵が川に橋を架けると速く渡れるようになり、壊れると橋の上の兵は川に落ちる', () => {
        const battle = makeBattle('777777')
        orderArmy(battle, 'cpu', 'hold')
        const [first, second] = engineers(battle)
        run(battle, .1)
        const river = { x: 96, y: 592 }
        expect(getPlayableTile(battle.grid, Math.round(river.x / TILE_PX), Math.round(river.y / TILE_PX))).toBe(TILE.WATER)
        expect(orderConstruct(battle, first!.id, 'bridge', river)).toBe(true)
        const site = battle.constructions[0]!
        orderBuild(battle, second!.id, site.id)
        const [a] = site.ends as [{ x: number; y: number }, { x: number; y: number }]
        // 橋の床のマスの移動コスト（川は徒歩で歩いて渡る遅さ、橋は1）
        const deckCost = () => site.deck.map(c => getTileCost(battle.grid, c.gx, c.gy))
        expect(deckCost().every(c => c === 1 / WATER_SPEED.foot)).toBe(true)
        // 長さ5マス・幅2マスの橋は、工兵2部隊でおよそ1分かかる
        run(battle, 20)
        expect(site.complete).toBe(false)
        for (let t = 0; t < 120 && !site.complete; t += 5) run(battle, 5)
        expect(site.complete).toBe(true)
        expect(deckCost().every(c => c === 1)).toBe(true)
        // 橋の上にいた兵は、橋が壊れると川に落ちる
        const infantry = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'infantry')!
        orderMove(battle, infantry.id, site.center)
        run(battle, 40)
        const deck = new Set(site.deck.map(c => `${c.gx},${c.gy}`))
        const onDeck = () => battle.members.get(infantry.id)!.filter(s => deck.has(`${Math.round(s.x / TILE_PX)},${Math.round(s.y / TILE_PX)}`))
        expect(onDeck().length).toBeGreaterThan(5)
        site.hp = 1
        const enemy = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'archer')!
        // 弓兵を置く場所の近くに陣取る自軍の兵（橋へ向かった歩兵を除く）は取り除き、弓兵が橋を狙えるようにする。
        for (const s of battle.soldiers) {
            if (s.owner === 'player' && s.squadId !== infantry.id && Math.hypot(s.x - a.x, s.y - (a.y - 80)) < 120) { s.state = 'dead'; s.deathTime = battle.time }
        }
        battle.members.get(enemy.id)!.forEach((s, i) => { s.x = a.x + (i % 6) * 5 - 15; s.y = a.y - 60 - Math.floor(i / 6) * 5 })
        run(battle, .1)
        orderDemolish(battle, enemy.id, site.id)
        let standing: ReturnType<typeof onDeck> = []
        for (let t = 0; t < 30 && battle.constructionById.has(site.id); t += 1 / 30) { standing = onDeck(); run(battle, 1 / 30) }
        expect(battle.constructionById.has(site.id)).toBe(false)
        expect(standing.some(s => s.state === 'dead')).toBe(true)
        // 崩れたときに橋の上にいた兵は落ちて倒れる（直前に橋から降りた兵は無事）。
        expect(onDeck().every(s => s.state === 'dead')).toBe(true)
        expect(deckCost().every(c => c === 1 / WATER_SPEED.foot)).toBe(true)
    }, 240000)

    it('拠点は時間をかけて建ち、完成すると補給に戻る部隊が拠点で補給する', () => {
        const battle = makeBattle('777777')
        orderArmy(battle, 'cpu', 'hold')
        const [first, second] = engineers(battle)
        run(battle, .1)
        const point = { x: first!.center.x + 60, y: first!.center.y }
        const plan = previewConstruction(battle, 'player', 'outpost', point)
        expect(plan.valid).toBe(true)
        // 拠点は7×7マス（砦の12×16マスより小さい）。外周の柵に四方の門がある
        expect(plan.area).toHaveLength(49)
        expect(plan.walls).toHaveLength(20)
        expect(orderConstruct(battle, first!.id, 'outpost', point)).toBe(true)
        const site = battle.constructions[0]!
        orderBuild(battle, second!.id, site.id)
        // 工兵2部隊（60人）でも1分では建たない
        run(battle, 60)
        expect(site.complete).toBe(false)
        expect(site.progress).toBeGreaterThan(.3)
        for (let t = 0; t < 120 && !site.complete; t += 5) run(battle, 5)
        expect(site.complete).toBe(true)
        expect(site.work).toBe(CONSTRUCTION.outpost.work)
        // 拠点の近くで矢が尽きた弓兵は、砦ではなく拠点で補給して元の指示に戻る
        const archers = battle.squads.find(sq => sq.owner === 'player' && sq.type === 'archer')!
        const station = { x: site.center.x + 150, y: site.center.y + 40 }
        orderMove(battle, archers.id, station)
        for (let t = 0; t < 60 && Math.hypot(archers.center.x - station.x, archers.center.y - station.y) > 30; t += 1) run(battle, 1)
        battle.members.get(archers.id)!.forEach(s => { s.arrows = 0 })
        run(battle, .1)
        expect(archers.order).toBe('resupply')
        expect(archers.depotId).toBe(site.id)
        // 補給の間、砦の補給を受けられる距離には入らない。
        const home = battle.forts.find(f => f.owner === 'player')!
        let nearest = Infinity
        for (let t = 0; t < 60 && archers.order === 'resupply'; t += 1) {
            run(battle, 1)
            nearest = Math.min(nearest, Math.hypot(archers.center.x - home.x, archers.center.y - home.y))
        }
        expect(archers.order).toBe('move')
        expect(nearest).toBeGreaterThan(FORT_REFILL_RANGE)
    }, 240000)

    it('建設物は他の建設物や砦・川と重ねて置けない', () => {
        const battle = makeBattle('777777')
        const [engineer] = engineers(battle)
        const home = battle.forts.find(f => f.owner === 'player')!
        expect(previewConstruction(battle, 'player', 'outpost', home).valid).toBe(false)
        expect(previewConstruction(battle, 'player', 'outpost', { x: 96, y: 592 }).valid).toBe(false)
        expect(previewConstruction(battle, 'player', 'bridge', { x: engineer!.center.x, y: engineer!.center.y }).valid).toBe(false)
        const point = { x: engineer!.center.x + 60, y: engineer!.center.y }
        expect(orderConstruct(battle, engineer!.id, 'outpost', point)).toBe(true)
        expect(previewConstruction(battle, 'player', 'barricade', point).valid).toBe(false)
    })

    it('魔王軍の工兵は拠点を築く', () => {
        const battle = makeBattle('424242')
        const commander = createCpuCommander(battle)
        for (let t = 0; t < 10; t += 1 / 30) { updateBattle(battle, 1 / 30); commander.update(1 / 30) }
        expect(battle.constructions.some(c => c.owner === 'cpu' && c.kind === 'outpost')).toBe(true)
    }, 60000)
})

describe('攻城戦・防衛戦', () => {
    const cases: [BattleMode, 'player' | 'cpu'][] = [['siege', 'cpu'], ['defense', 'player']]
    for (const [mode, defender] of cases) {
        const attacker = defender === 'player' ? 'cpu' : 'player'
        for (const seed of ['123456', '777777', '424242', '851651', '512108', '999999']) {
            it(`${mode}: 守り手だけが砦を持ち、攻め手は砦から離れて布陣する（SEED ${seed}）`, () => {
                const battle = makeBattle(seed, mode)
                expect(battle.forts.map(f => f.owner)).toEqual([defender])
                const fort = battle.forts[0]!
                expect(fort.kind).toBe('castle')
                for (const p of fort.assaultPoints) expect(isBlocked(battle.grid, p.x, p.y)).toBe(false)
                const anchor = battle.formations[attacker].anchor
                const distance = Math.hypot(anchor.x - fort.x, anchor.y - fort.y)
                expect(distance).toBeGreaterThan(550)
                expect(distance).toBeLessThan(1000)
                // 攻め手は砦の方を向く。
                expect(Math.sign(Math.sin(battle.formations[attacker].facing))).toBe(-fort.front)
                const total = (Object.keys(SIEGE_ATTACKER_SQUADS) as UnitType[]).reduce((sum, type) => sum + SIEGE_ATTACKER_SQUADS[type] * SQUAD_SIZE[type], 0)
                const summary = summarize(battle)
                expect(summary[attacker].total).toBe(total)
                expect(summary[attacker].hasFort).toBe(false)
                expect(summary[defender].hasFort).toBe(true)
                // 攻め手の兵は砦まで歩いて行ける。
                const camp = battle.homes[attacker]
                const path = findPath(battle.grid, camp.x, camp.y, fort.assaultPoints[0]!.x, fort.assaultPoints[0]!.y)
                expect(routeIsClear(battle, path)).toBe(true)
            })
        }

        it(`${mode}: 攻め手は全滅で、守り手は砦の陥落で敗北する`, () => {
            const wiped = makeBattle('424242', mode)
            for (const s of wiped.soldiers) if (s.owner === attacker) s.hp = -1, s.state = 'dead'
            updateBattle(wiped, .1)
            updateBattle(wiped, .1)
            expect(wiped.winner).toBe(defender)
            const fallen = makeBattle('424242', mode)
            fallen.forts[0]!.hp = 0
            updateBattle(fallen, .1)
            expect(fallen.winner).toBe(attacker)
        })

        it(`${mode}: 指揮官つきで戦闘を進めても破綻しない`, () => {
            const battle = makeBattle('777777', mode)
            const commander = createCpuCommander(battle)
            orderArmy(battle, 'player', mode === 'siege' ? 'charge' : 'hold')
            for (let t = 0; t < 40; t += .1) { updateBattle(battle, .1); commander.update(.1) }
            const summary = summarize(battle)
            expect(summary.player.total + summary.cpu.total).toBeGreaterThan(0)
            // 退却した攻め手は野営地へ戻る。
            const squad = battle.squads.find(sq => sq.owner === attacker && sq.type === 'infantry')
            if (squad) {
                orderRetreat(battle, squad.id)
                for (let t = 0; t < 5; t += .1) updateBattle(battle, .1)
                expect(squad.order === 'retreat' || squad.order === 'hold').toBe(true)
            }
        }, 120000)
    }
})

describe('川', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('騎兵は0.5倍、騎兵以外は0.2倍の速さで川を歩いて渡れる', () => {
        const battle = makeBattle('777777')
        orderArmy(battle, 'cpu', 'hold')
        run(battle, .1)
        const river = { x: 96, y: 592 }
        expect(getPlayableTile(battle.grid, Math.round(river.x / TILE_PX), Math.round(river.y / TILE_PX))).toBe(TILE.WATER)
        for (const type of ['infantry', 'archer', 'supply', 'engineer'] as const) expect(getTerrainSpeedMultiplier(battle.grid, river.x, river.y, type)).toBe(.2)
        expect(getTerrainSpeedMultiplier(battle.grid, river.x, river.y, 'cavalry')).toBe(.5)
        expect(isBlocked(battle.grid, river.x, river.y)).toBe(false)
        // 橋を架けられる向こう岸どうしを、橋なしで渡らせる
        const [a, b] = previewConstruction(battle, 'player', 'bridge', river).ends as [{ x: number; y: number }, { x: number; y: number }]
        const crossTime = (type: UnitType) => {
            const squad = battle.squads.find(sq => sq.owner === 'player' && sq.type === type)!
            battle.members.get(squad.id)!.forEach((s, i) => { s.x = a.x + (i % 4) * 4 - 6; s.y = a.y + Math.floor(i / 4) * 4 - 6 })
            run(battle, .1)
            orderMove(battle, squad.id, b)
            let t = 0
            for (; t < 90 && Math.hypot(squad.center.x - b.x, squad.center.y - b.y) > 24; t += .5) run(battle, .5)
            return t
        }
        const cavalry = crossTime('cavalry')
        const infantry = crossTime('infantry')
        expect(cavalry).toBeLessThan(90)
        expect(infantry).toBeLessThan(90)
        expect(cavalry).toBeLessThan(infantry)
    }, 240000)
})

describe('地形の種類', () => {
    const seeds = ['123456', '777777', '424242', '851651', '512108', '999999']
    const waterTiles = (grid: number[][]) => grid.flat().filter(t => t === TILE.WATER || t === TILE.BRIDGE).length
    for (const mapType of MAP_TYPES) for (const seed of seeds) {
        it(`${mapType}: 両軍の砦を置けて、互いに行き来できる（SEED ${seed}）`, () => {
            const battle = makeBattle(seed, 'field', mapType)
            expect(mapTypeOf(battle.grid)).toBe(mapType)
            const [human, monster] = battle.forts
            const path = findPath(battle.grid, human!.assaultPoints[0]!.x, human!.assaultPoints[0]!.y, monster!.assaultPoints[0]!.x, monster!.assaultPoints[0]!.y)
            expect(routeIsClear(battle, path)).toBe(true)
        })
    }
    it('草原には水がなく、砂漠の水はオアシスだけで、魔王城付近には必ず川がある', () => {
        for (const seed of seeds) {
            const grid = (type: MapType) => generateMap(createMulberry32(hashString(seed)), type).mapGrid
            expect(waterTiles(grid('meadow'))).toBe(0)
            const desert = grid('desert')
            expect(waterTiles(desert)).toBeGreaterThan(0)
            // オアシスの水は戦場の端に届かない（川ではない）。
            const edge = [...desert[0]!, ...desert[desert.length - 1]!, ...desert.map(row => row[0]!), ...desert.map(row => row[row.length - 1]!)]
            expect(edge.filter(t => t === TILE.WATER).length).toBe(0)
            expect(waterTiles(grid('demonland'))).toBeGreaterThan(0)
        }
    })
    it('攻城戦は魔王城付近、防衛戦は標準の地形で戦う', () => {
        expect(mapTypeForMode('siege', 'desert')).toBe('demonland')
        expect(mapTypeForMode('defense', 'desert')).toBe('standard')
        expect(mapTypeForMode('field', 'desert')).toBe('desert')
    })
})

describe('開戦時の編成', () => {
    const modes: BattleMode[] = ['field', 'siege', 'defense']

    it('既定の編成なら、従来どおりの部隊と予備兵になる', () => {
        const battle = makeBattle('123456', 'field', 'standard', defaultDeployment('field', 'player'))
        expect(battle.formations.player.type).toBe('line')
        expect(battle.squads.filter(sq => sq.owner === 'player')).toHaveLength(Object.values(INITIAL_SQUADS).reduce((a, b) => a + b, 0))
        expect(battle.forts.find(f => f.owner === 'player')!.reserves).toBe(2500)
        expect(battle.forts.find(f => f.owner === 'cpu')!.reserves).toBe(2500)
    })

    it('部隊の兵種と人数・開戦時の陣を決められ、人数は予備兵から差し引かれる', () => {
        const plan: DeploymentPlan = { formation: 'crane', squads: [{ type: 'cavalry', size: 50 }, { type: 'infantry', size: 100 }, { type: 'archer', size: 25 }] }
        const battle = makeBattle('123456', 'field', 'standard', plan)
        expect(battle.formations.player.type).toBe('crane')
        const squads = battle.squads.filter(sq => sq.owner === 'player')
        // 兵種の順に並べ直して布陣する。
        expect(squads.map(sq => [sq.type, sq.size, sq.count])).toEqual([['infantry', 100, 100], ['archer', 25, 25], ['cavalry', 50, 50]])
        expect(battle.forts.find(f => f.owner === 'player')!.reserves).toBe(armyPool('field', 'player') - 175)
        // 魔王軍は既定の編成のまま。
        expect(battle.formations.cpu.type).toBe('line')
        expect(battle.forts.find(f => f.owner === 'cpu')!.reserves).toBe(2500)
    })

    it('人数は範囲に収まり、布陣できる上限を超える部隊は外れる', () => {
        for (const mode of modes) {
            const plan = normalizeDeployment({ formation: 'line', squads: Array.from({ length: 60 }, () => ({ type: 'infantry' as const, size: 999 })) }, mode, 'player')
            expect(plan.squads.every(sq => sq.size === SQUAD_SIZE.infantry * 2)).toBe(true)
            expect(plan.squads.reduce((sum, sq) => sum + sq.size, 0)).toBeLessThanOrEqual(deployLimit(mode, 'player'))
            expect(normalizeDeployment({ formation: 'line', squads: [{ type: 'archer', size: 1 }] }, mode, 'player').squads[0]!.size).toBe(10)
        }
    })

    it('プリセットはどの戦場でも布陣できる上限に収まり、全兵種を含む', () => {
        for (const mode of modes) for (const preset of DEPLOYMENT_PRESETS) {
            const plan = presetDeployment(preset.key, mode, 'player')
            expect(plan.formation).toBe(preset.formation)
            expect(plan.squads.reduce((sum, sq) => sum + sq.size, 0)).toBeLessThanOrEqual(deployLimit(mode, 'player'))
            expect(new Set(plan.squads.map(sq => sq.type)).size).toBe(6)
        }
        expect(presetDeployment('default', 'siege', 'player')).toEqual(defaultDeployment('siege', 'player'))
    })

    it('開戦前に編成し直すと、人間軍だけが布陣し直し、予備兵も変わる', () => {
        const battle = makeBattle('123456')
        const cpuSoldiers = battle.soldiers.filter(s => s.owner === 'cpu')
        redeployArmy(battle, 'player', { formation: 'scale', squads: [{ type: 'pikeman', size: 80 }, { type: 'pikeman', size: 40 }] })
        const squads = battle.squads.filter(sq => sq.owner === 'player')
        expect(squads.map(sq => [sq.number, sq.size, sq.count])).toEqual([[1, 80, 80], [2, 40, 40]])
        expect(battle.soldiers.filter(s => s.owner === 'player')).toHaveLength(120)
        expect(battle.soldiers.filter(s => s.owner === 'cpu')).toEqual(cpuSoldiers)
        expect(battle.formations.player.type).toBe('scale')
        expect(battle.forts.find(f => f.owner === 'player')!.reserves).toBe(armyPool('field', 'player') - 120)
        updateBattle(battle, .1)
        expect(battle.squads.filter(sq => sq.owner === 'player').every(sq => sq.count === sq.size)).toBe(true)
    })

    it('攻城戦の人間軍は2,500人まで布陣できる', () => {
        expect(armyPool('siege', 'player')).toBe(2500)
        expect(deployLimit('siege', 'player')).toBe(2500)
        const plan: DeploymentPlan = { formation: 'line', squads: [...Array.from({ length: 20 }, () => ({ type: 'infantry' as const, size: 100 })), ...Array.from({ length: 5 }, () => ({ type: 'pikeman' as const, size: 100 }))] }
        expect(normalizeDeployment(plan, 'siege', 'player').squads).toHaveLength(25)
        expect(normalizeDeployment({ ...plan, squads: [...plan.squads, { type: 'archer', size: 10 }] }, 'siege', 'player').squads).toHaveLength(25)
        const battle = makeBattle('123456', 'siege', undefined, plan)
        expect(summarize(battle).player.total).toBe(2500)
    })

    it('攻城戦の攻め手は編成どおりに布陣する（増援なし）', () => {
        const plan = presetDeployment('cavalry', 'siege', 'player')
        const battle = makeBattle('123456', 'siege', undefined, plan)
        expect(battle.formations.player.type).toBe('arrow')
        expect(summarize(battle).player.total).toBe(plan.squads.reduce((sum, sq) => sum + sq.size, 0))
    })
})

describe('中隊', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('開戦時、どの小隊も同じ兵種の隣り合う小隊と中隊を組む', () => {
        const battle = makeBattle('123456')
        for (const owner of ['player', 'cpu'] as const) {
            const squads = battle.squads.filter(sq => sq.owner === owner)
            for (const squad of squads) expect(battle.companyById.get(squad.companyId)?.squadIds).toContain(squad.id)
            for (const company of battle.companies.filter(c => c.owner === owner)) {
                const members = companySquads(battle, company.id)
                expect(members.length).toBeGreaterThan(0)
                expect(members.length).toBeLessThanOrEqual(COMPANY_MAX_SQUADS)
                expect(new Set(members.map(sq => sq.type)).size).toBe(1)
            }
            // 歩兵6小隊は3小隊ずつの2中隊。両翼の騎兵は左右で別の中隊になる。
            const companiesOf = (type: UnitType) => battle.companies.filter(c => c.owner === owner && companySquads(battle, c.id)[0]!.type === type)
            expect(companiesOf('infantry').map(c => c.squadIds.length)).toEqual([3, 3])
            expect(companiesOf('cavalry')).toHaveLength(2)
        }
        expect(battle.companies.filter(c => c.owner === 'player').map(c => c.number)).toEqual(battle.companies.filter(c => c.owner === 'player').map((_, i) => i + 1))
    })

    it('中隊を動かすと、小隊は横に並んで同じ向きで構える', () => {
        const battle = makeBattle('424242')
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        const squads = companySquads(battle, company.id)
        // ほかの部隊の間を抜ける押し合いは見ないので、中隊の兵だけを残す。
        for (const s of battle.soldiers) if (s.owner === 'player' && !company.squadIds.includes(s.squadId)) { s.state = 'dead'; s.deathTime = battle.time }
        run(battle, .1)
        // 中隊からまっすぐ川を渡らずに行ける開けた地点へ動かす。
        const from = { x: squads.reduce((sum, sq) => sum + sq.center.x, 0) / squads.length, y: squads.reduce((sum, sq) => sum + sq.center.y, 0) / squads.length }
        const clear = (p: { x: number; y: number }, reach: number) => [-1, -.5, 0, .5, 1].every(dy => [-1, -.5, 0, .5, 1].every(dx => battle.paths.passable(p.x + dx * reach, p.y + dy * reach)))
        const dry = (p: { x: number; y: number }) => clear(p, 100)
            && Array.from({ length: 21 }, (_, i) => i / 20).every(t => clear({ x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t }, 30))
        const point = Array.from({ length: 48 }, (_, i) => {
            const angle = (i % 16) / 16 * Math.PI * 2, distance = 100 + Math.floor(i / 16) * 40
            return { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance }
        }).find(dry)!
        orderCompanyMove(battle, company.id, point)
        expect(squads.every(sq => sq.order === 'move')).toBe(true)
        expect(new Set(squads.map(sq => sq.facing.toFixed(6))).size).toBe(1)
        // 小隊の持ち場は互いに重ならず、まん中が指定地点に来る。
        const facing = squads[0]!.facing
        const { rx, ry } = axes(facing)
        const laterals = squads.map(sq => (sq.anchor.x - point.x) * rx + (sq.anchor.y - point.y) * ry).sort((a, b) => a - b)
        for (let i = 1; i < laterals.length; i++) expect(laterals[i]! - laterals[i - 1]!).toBeGreaterThanOrEqual(squadBlock('infantry', 70).width)
        expect(Math.abs(laterals[0]! + laterals.at(-1)!)).toBeLessThan(1)
        run(battle, 45)
        for (const squad of squads) {
            const post = toWorld(squad.anchor, squad.facing, -squadBlock(squad.type, squad.count).depth / 2, 0)
            expect(Math.hypot(squad.center.x - post.x, squad.center.y - post.y)).toBeLessThan(25)
        }
    }, 60000)

    it('中隊での攻撃は、敵の中隊のうち各小隊に最も近い小隊を狙う', () => {
        const battle = makeBattle('123456')
        run(battle, .1)
        const own = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        const enemy = battle.companies.find(c => c.owner === 'cpu' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        orderCompanyAttack(battle, own.id, { companyId: enemy.id })
        for (const squad of companySquads(battle, own.id)) {
            expect(squad.order).toBe('attack')
            const nearest = companySquads(battle, enemy.id).sort((a, b) => Math.hypot(a.center.x - squad.center.x, a.center.y - squad.center.y) - Math.hypot(b.center.x - squad.center.x, b.center.y - squad.center.y))[0]!
            expect(squad.targetSquadId).toBe(nearest.id)
        }
    })

    it('中隊への突撃に補給部隊と工兵は加わらない', () => {
        const battle = makeBattle('123456')
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'engineer')!
        orderCompany(battle, company.id, 'charge')
        expect(companySquads(battle, company.id).every(sq => sq.order === 'formation')).toBe(true)
        orderCompany(battle, company.id, 'hold')
        expect(companySquads(battle, company.id).every(sq => sq.order === 'hold')).toBe(true)
    })

    it('増援の小隊は陣にいる同じ兵種の中隊に加わり、全滅した小隊は中隊から外れる', () => {
        const battle = makeBattle('123456')
        run(battle, 9.2)
        const added = battle.squads.filter(sq => sq.owner === 'player').at(-1)!
        const company = battle.companyById.get(added.companyId)!
        expect(company.squadIds).toContain(added.id)
        expect(company.squadIds.length).toBeLessThanOrEqual(COMPANY_MAX_SQUADS)
        expect(companySquads(battle, company.id).every(sq => sq.type === added.type)).toBe(true)
        for (const s of battle.members.get(added.id)!) { s.hp = 0; s.state = 'dead'; s.deathTime = battle.time }
        run(battle, 1 / 30)
        expect(battle.companyById.get(added.companyId)?.squadIds ?? []).not.toContain(added.id)
        expect(battle.companies.every(c => c.squadIds.length > 0)).toBe(true)
    })

    it('開戦前に編成し直すと、中隊も組み直す', () => {
        const battle = makeBattle('123456')
        redeployArmy(battle, 'player', { formation: 'line', squads: Array.from({ length: 8 }, () => ({ type: 'archer' as const, size: 60 })) })
        const companies = battle.companies.filter(c => c.owner === 'player')
        expect(companies.map(c => c.squadIds.length)).toEqual([4, 4])
        expect(companies.map(c => c.number)).toEqual([1, 2])
    })
})

describe('編成で組む中隊', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }
    /** 槍・歩・弓の混成中隊と、槍・騎の中隊を組み、残りは自動の中隊にする編成。 */
    const mixedPlan = (): DeploymentPlan => ({
        formation: 'line',
        squads: [
            { type: 'archer', size: 60, company: 5 }, { type: 'pikeman', size: 50, company: 5 }, { type: 'infantry', size: 70, company: 5 },
            { type: 'pikeman', size: 50, company: 9 }, { type: 'cavalry', size: 35, company: 9 },
            { type: 'infantry', size: 70 }, { type: 'infantry', size: 70 }, { type: 'archer', size: 60 },
        ],
    })

    it('編成の中隊は1中隊4小隊までにし、番号を元の順に1から詰める', () => {
        const plan = normalizeDeployment({ formation: 'line', squads: [...mixedPlan().squads, ...Array.from({ length: 4 }, () => ({ type: 'infantry' as const, size: 70, company: 5 }))] }, 'field', 'player')
        const companies = plannedCompanies(plan)
        expect(companies.map(c => c.company)).toEqual([1, 2])
        expect(companies[0]!.indices).toHaveLength(4)
        expect(companies[1]!.indices.map(i => plan.squads[i]!.type).sort()).toEqual(['cavalry', 'pikeman'])
        // あふれた歩兵は自動の中隊の側に残る。
        expect(plan.squads.filter(sq => sq.company === undefined && sq.type === 'infantry')).toHaveLength(5)
    })

    it('組んだ中隊は兵種を混ぜたまま布陣し、陣でひとかたまりに並ぶ（槍兵が前、弓兵が後ろ）', () => {
        const battle = makeBattle('123456', 'field', undefined, mixedPlan())
        run(battle, .1)
        const planned = battle.companies.filter(c => c.owner === 'player' && c.planned)
        expect(planned.map(c => c.number)).toEqual([1, 2])
        const mixed = companySquads(battle, planned[0]!.id)
        expect(mixed.map(sq => sq.type).sort()).toEqual(['archer', 'infantry', 'pikeman'])
        const facing = battle.formations.player.facing
        const { fx, fy } = axes(facing)
        const forward = (sq: (typeof mixed)[number]) => sq.center.x * fx + sq.center.y * fy
        const pike = mixed.find(sq => sq.type === 'pikeman')!, infantry = mixed.find(sq => sq.type === 'infantry')!, archer = mixed.find(sq => sq.type === 'archer')!
        expect(forward(pike)).toBeGreaterThan(forward(infantry))
        expect(forward(infantry)).toBeGreaterThan(forward(archer))
        // 中隊の小隊は互いに近く（ほかの中隊の小隊をはさまない）。
        for (const a of mixed) for (const b of mixed) expect(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)).toBeLessThan(110)
        // 組まなかった小隊は自動の中隊（同じ兵種だけ）になる。
        for (const company of battle.companies.filter(c => c.owner === 'player' && !c.planned)) expect(new Set(companySquads(battle, company.id).map(sq => sq.type)).size).toBe(1)
    })

    it('混成中隊のプリセットで、中隊を組んだ編成になる', () => {
        for (const mode of ['field', 'siege'] as const) {
            const plan = presetDeployment('combined', mode, 'player')
            expect(plannedCompanies(plan).length).toBeGreaterThanOrEqual(7)
            const battle = makeBattle('123456', mode, undefined, plan)
            expect(battle.companies.filter(c => c.owner === 'player' && c.planned).length).toBe(plannedCompanies(plan).length)
            expect(battle.squads.filter(sq => sq.owner === 'player').every(sq => battle.companyById.has(sq.companyId))).toBe(true)
        }
    })

    it('中隊で動くと、速い小隊は一番遅い小隊に歩みをそろえる', () => {
        const battle = makeBattle('123456', 'field', undefined, mixedPlan())
        run(battle, .1)
        const company = battle.companies.find(c => c.owner === 'player' && c.planned && companySquads(battle, c.id).some(sq => sq.type === 'cavalry'))!
        const [pike, cavalry] = ['pikeman', 'cavalry'].map(t => companySquads(battle, company.id).find(sq => sq.type === t)!)
        const at = { x: battle.formations.player.anchor.x, y: battle.formations.player.anchor.y + 200 }
        orderCompanyMove(battle, company.id, at)
        run(battle, 1 / 30)
        expect(battle.stride.get(cavalry!.id)).toBeLessThan(.5)
        expect(battle.stride.get(pike!.id) ?? 1).toBeCloseTo(1)
        // 小隊に個別の指示を出した中隊はそろえない。
        company.together = false
        run(battle, 1 / 30)
        expect(battle.stride.has(cavalry!.id)).toBe(false)
    })

    it('弓兵に敵の小隊が迫ると、同じ中隊で構えている近接の小隊が迎え撃つ', () => {
        const battle = makeBattle('123456', 'field', undefined, mixedPlan())
        run(battle, .1)
        const company = battle.companies.find(c => c.owner === 'player' && c.planned && companySquads(battle, c.id).some(sq => sq.type === 'archer'))!
        orderCompany(battle, company.id, 'hold')
        const archer = companySquads(battle, company.id).find(sq => sq.type === 'archer')!
        const enemy = battle.squads.find(sq => sq.owner === 'cpu' && sq.type === 'infantry')!
        for (const s of battle.members.get(enemy.id)!) { s.x = archer.center.x + (battle.random() - .5) * 20; s.y = archer.center.y + 40 + (battle.random() - .5) * 20 }
        run(battle, 1 / 30)
        const guards = companySquads(battle, company.id).filter(sq => sq.type !== 'archer')
        expect(guards.some(sq => sq.order === 'attack' && sq.targetSquadId === enemy.id)).toBe(true)
        expect(archer.order).toBe('hold')
    })
})

describe('中隊のまとまり', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }
    /** 中隊の小隊のうち、同じ中隊のほかの小隊から一番離れている小隊の、一番近い仲間までの距離。 */
    const spread = (battle: ReturnType<typeof makeBattle>, companyId: number) => {
        // 陣形の持ち場へ向かう小隊（砦から順に出てくる増援）は、持ち場がもともと隣り合うので数えない。
        const squads = companySquads(battle, companyId).filter(sq => !sq.detached && sq.type !== 'supply' && sq.type !== 'engineer' && sq.order !== 'formation')
        if (squads.length < 2) return 0
        return Math.max(...squads.map(a => Math.min(...squads.filter(b => b !== a).map(b => Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)))))
    }

    it('本隊から離れた小隊は、敵に構わず本隊へ戻り、近づいたら元の指示に戻る', () => {
        const battle = makeBattle('424242')
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        run(battle, .1)
        orderCompany(battle, company.id, 'hold')
        const [stray] = companySquads(battle, company.id)
        for (const s of battle.members.get(stray!.id)!) s.x += 160 * Math.sin(battle.formations.player.facing)
        run(battle, 1 / 30)
        expect(stray!.rejoin).not.toBeNull()
        expect(stray!.order).toBe('hold')
        // 小隊は振り向いた兵が付いて来るのを待ちながら歩くので、戻りきるまで少しかかる。
        run(battle, 40)
        expect(stray!.rejoin).toBeNull()
        expect(spread(battle, company.id)).toBeLessThan(110)
    }, 60000)

    it('攻撃している小隊は、本隊から遠く離れた相手を追わない', () => {
        const battle = makeBattle('424242')
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        run(battle, .1)
        orderCompany(battle, company.id, 'hold')
        const [chaser] = companySquads(battle, company.id)
        const far = battle.squads.find(sq => sq.owner === 'cpu')!
        orderAttack(battle, chaser!.id, far.id)
        run(battle, 1 / 30)
        expect(chaser!.order === 'hold' || (chaser!.order === 'attack' && chaser!.targetSquadId !== far.id)).toBe(true)
    })

    it('プレイヤーが個別に切り離した小隊は、本隊へ戻らない', () => {
        const battle = makeBattle('424242')
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id)[0]!.type === 'infantry')!
        run(battle, .1)
        orderCompany(battle, company.id, 'hold')
        const [stray] = companySquads(battle, company.id)
        stray!.detached = true
        for (const s of battle.members.get(stray!.id)!) s.x += 160 * Math.sin(battle.formations.player.facing)
        run(battle, 1 / 30)
        expect(stray!.rejoin).toBeNull()
    })

    it('全軍突撃で戦っても、中隊の小隊は中隊から大きく離れない', () => {
        const battle = makeBattle('123456')
        const commander = createCpuCommander(battle)
        orderArmy(battle, 'player', 'charge')
        let worst = 0
        for (let t = 0; t < 60 && !battle.winner; t += 1 / 30) {
            updateBattle(battle, 1 / 30); commander.update(1 / 30)
            if (Math.round(t * 30) % 30 === 0) for (const c of battle.companies.filter(c => c.owner === 'player')) worst = Math.max(worst, spread(battle, c.id))
        }
        expect(worst).toBeLessThan(200)
    }, 120000)
})

describe('中隊長', () => {
    const run = (battle: ReturnType<typeof makeBattle>, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) updateBattle(battle, 1 / 30) }

    it('中隊のまん中の小隊の隊長が中隊長を兼ね、中隊の位置は中隊長の位置になる', () => {
        const battle = makeBattle('123456')
        run(battle, .1)
        for (const company of battle.companies) {
            const head = companyLeader(battle, company)!
            expect(head).toBeDefined()
            expect(company.squadIds).toContain(company.leaderSquadId)
            expect(battle.squadById.get(company.leaderSquadId)!.leaderId).toBe(head.id)
            expect(companyPosition(battle, company)).toBe(head)
        }
        // 3小隊が横に並ぶ歩兵の中隊では、まん中の小隊。
        const infantry = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id).length === 3 && companySquads(battle, c.id)[0]!.type === 'infantry')!
        const { rx, ry } = axes(battle.formations.player.facing)
        const order = companySquads(battle, infantry.id).sort((a, b) => (a.center.x * rx + a.center.y * ry) - (b.center.x * rx + b.center.y * ry))
        expect(infantry.leaderSquadId).toBe(order[1]!.id)
    })

    it('中隊長の小隊が全滅したり切り離されたりしたら、残りの小隊から選び直す', () => {
        const battle = makeBattle('123456')
        run(battle, .1)
        const company = battle.companies.find(c => c.owner === 'player' && companySquads(battle, c.id).length === 3)!
        const first = company.leaderSquadId
        for (const s of battle.members.get(first)!) { s.hp = 0; s.state = 'dead'; s.deathTime = battle.time }
        run(battle, 1 / 30)
        expect(company.leaderSquadId).not.toBe(first)
        expect(company.squadIds).toContain(company.leaderSquadId)
        const second = company.leaderSquadId
        battle.squadById.get(second)!.detached = true
        run(battle, 1 / 30)
        expect(company.leaderSquadId).not.toBe(second)
    })
})

describe('開戦前の中隊の位置', () => {
    it('時間が止まっている開戦前でも、中隊の位置は中隊の小隊のまん中にあり、中隊どうしで重ならない', () => {
        const battle = makeBattle('123456')
        const at = battle.companies.filter(c => c.owner === 'player').map(c => {
            const squads = companySquads(battle, c.id)
            const p = companyPosition(battle, c)
            // 中隊長を出す小隊の兵のまん中。
            const members = battle.members.get(c.leaderSquadId)!
            const cx = members.reduce((sum, s) => sum + s.x, 0) / members.length, cy = members.reduce((sum, s) => sum + s.y, 0) / members.length
            expect(squads.map(sq => sq.id)).toContain(c.leaderSquadId)
            expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThan(1)
            return p
        })
        for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i]!.x - at[j]!.x, at[i]!.y - at[j]!.y)).toBeGreaterThan(20)
        // 編成し直しても同じ。
        redeployArmy(battle, 'player', presetDeployment('combined', 'field', 'player'))
        const points = battle.companies.filter(c => c.owner === 'player').map(c => companyPosition(battle, c))
        for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThan(20)
    })
})
