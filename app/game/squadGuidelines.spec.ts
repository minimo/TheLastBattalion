import { describe, expect, it } from 'vitest'
import { generateMap } from './mapGenerator'
import { createMulberry32, hashString } from './random'
import { companyPosition, companySquads, createBattle, orderCompany, orderCompanyMove, updateBattle, type Battle } from './battle'
import { createCpuCommander } from './cpuCommander'
import { normalizeDeployment, plannedCompanies, type DeploymentPlan } from './deployment'
import { toWorld } from './formation'
import { defaultGuideline } from './guidelines'
import { createGuidelineDirector, markCommanded, setGuideline } from './squadGuidelines'
import { mapTypeForMode } from './mapType'
import type { Company } from '../types/game'

const makeBattle = (seed: string, plan?: DeploymentPlan) => {
    const { mapGrid } = generateMap(createMulberry32(hashString(seed)), mapTypeForMode('field', 'standard'))
    return createBattle(mapGrid, createMulberry32(hashString(seed) ^ 99), 'field', plan ? { player: plan } : {})
}
const run = (battle: Battle, seconds: number, ...minds: { update(dt: number): void }[]) => {
    for (let t = 0; t < seconds && !battle.winner; t += 1 / 30) { updateBattle(battle, 1 / 30); for (const mind of minds) mind.update(1 / 30) }
}
const playerCompanies = (battle: Battle) => battle.companies.filter(c => c.owner === 'player')
/** 中隊を陣の前へ少しだけ動かす命令を出す（プレイヤーの命令として）。 */
const nudge = (battle: Battle, company: Company) => {
    const formation = battle.formations.player
    const at = companyPosition(battle, company)
    orderCompanyMove(battle, company.id, toWorld(at, formation.facing, 30, 0))
    markCommanded(battle, { companyId: company.id }, 'order')
}

describe('既定の行動', () => {
    it('兵種で決まり、混成の中隊は人数が一番多い兵種の行動、同じ人数なら歩兵・槍兵・弓兵・騎兵の順', () => {
        expect(defaultGuideline([{ type: 'infantry', size: 70 }])).toBe('assault')
        expect(defaultGuideline([{ type: 'pikeman', size: 50 }])).toBe('guard')
        expect(defaultGuideline([{ type: 'archer', size: 60 }])).toBe('escort')
        expect(defaultGuideline([{ type: 'cavalry', size: 35 }])).toBe('skirmish')
        expect(defaultGuideline([{ type: 'engineer', size: 30 }])).toBe('fortify')
        expect(defaultGuideline([{ type: 'supply', size: 20 }])).toBe('supply')
        // 混成（槍50・歩70・弓60）は歩兵、槍弓（槍50×2・弓60）は槍兵、騎弓（騎35・弓60）は弓兵。
        expect(defaultGuideline([{ type: 'pikeman', size: 50 }, { type: 'infantry', size: 70 }, { type: 'archer', size: 60 }])).toBe('assault')
        expect(defaultGuideline([{ type: 'pikeman', size: 50 }, { type: 'pikeman', size: 50 }, { type: 'archer', size: 60 }])).toBe('guard')
        expect(defaultGuideline([{ type: 'cavalry', size: 35 }, { type: 'archer', size: 60 }])).toBe('escort')
        expect(defaultGuideline([{ type: 'pikeman', size: 70 }, { type: 'infantry', size: 70 }])).toBe('assault')
        expect(defaultGuideline([{ type: 'cavalry', size: 60 }, { type: 'archer', size: 60 }])).toBe('escort')
    })

    it('編成で選んだ行動は中隊の小隊でそろい、戦場の中隊に映る。選んでいない中隊・小隊は既定の行動', () => {
        const plan = normalizeDeployment({
            formation: 'line',
            squads: [
                { type: 'infantry', size: 70, company: 1, guideline: 'homeGuard' }, { type: 'infantry', size: 70, company: 1 },
                { type: 'pikeman', size: 50, company: 2 }, { type: 'archer', size: 60, company: 2 },
                { type: 'engineer', size: 30, guideline: 'repair' }, { type: 'engineer', size: 30 }, { type: 'supply', size: 20 },
            ],
        }, 'field', 'player')
        const first = plannedCompanies(plan)[0]!
        expect(first.indices.map(i => plan.squads[i]!.guideline)).toEqual(['homeGuard', 'homeGuard'])
        const battle = makeBattle('123456', plan)
        const [c1, c2] = playerCompanies(battle)
        expect(c1!.guidance.guideline).toBe('homeGuard')
        expect(c2!.guidance.guideline).toBe('escort')
        const loose = battle.squads.filter(sq => sq.owner === 'player' && sq.companyId < 0)
        expect(loose.map(sq => sq.guidance.guideline)).toEqual(['supply', 'repair', 'fortify'])
    })
})

describe('行動に沿って動く', () => {
    it('開戦直後は陣で構え、命令をやり終えた部隊だけが先に行動に沿って動く', () => {
        const battle = makeBattle('123456')
        const director = createGuidelineDirector(battle)
        const [first, second] = playerCompanies(battle).filter(c => c.guidance.guideline === 'assault')
        nudge(battle, first!)
        run(battle, 12, director)
        expect(director.awake).toBe(false)
        expect(first!.guidance.directive).toBe('none')
        expect(companySquads(battle, first!.id).every(sq => sq.order === 'attack')).toBe(true)
        expect(companySquads(battle, second!.id).every(sq => sq.order === 'formation')).toBe(true)
    }, 120000)

    it('命令も敵の接近もなければ人間軍は陣で構えたまま。魔王軍の動きは行動の判断があってもなくても同じ', () => {
        const orders = (withDirector: boolean) => {
            const battle = makeBattle('123456')
            const director = createGuidelineDirector(battle)
            run(battle, 10, ...(withDirector ? [director] : []))
            return { battle, director }
        }
        const { battle, director } = orders(true)
        expect(director.awake).toBe(false)
        expect(battle.squads.filter(sq => sq.owner === 'player' && sq.type !== 'supply').every(sq => sq.order === 'formation')).toBe(true)
        const cpu = (b: Battle) => b.squads.filter(sq => sq.owner === 'cpu').map(sq => `${sq.id}:${sq.order}:${Math.round(sq.center.x)},${Math.round(sq.center.y)}`)
        expect(cpu(battle)).toEqual(cpu(orders(false).battle))
    }, 120000)

    it('敵が近づくと全軍が動き出し、攻勢の中隊は敵を攻める', () => {
        const battle = makeBattle('123456')
        const director = createGuidelineDirector(battle)
        const commander = createCpuCommander(battle)
        for (let t = 0; t < 60 && !director.awake; t += 1) run(battle, 1, director, commander)
        expect(director.awake).toBe(true)
        run(battle, 3, director, commander)
        const assault = playerCompanies(battle).filter(c => c.guidance.guideline === 'assault')
        expect(assault.some(c => companySquads(battle, c.id).some(sq => sq.order === 'attack'))).toBe(true)
    }, 120000)

    it('命令のあいだは行動の判断が手を出さず、「待機」なら次の命令まで行動を止める', () => {
        const battle = makeBattle('123456')
        const director = createGuidelineDirector(battle)
        const [moving, waiting] = playerCompanies(battle).filter(c => c.guidance.guideline === 'assault')
        // 遠くへの移動はやり終えるまで時間がかかる。そのあいだは移動のまま。
        const formation = battle.formations.player
        orderCompanyMove(battle, moving!.id, toWorld(formation.anchor, formation.facing, -250, 0))
        markCommanded(battle, { companyId: moving!.id }, 'order')
        orderCompany(battle, waiting!.id, 'hold')
        markCommanded(battle, { companyId: waiting!.id }, 'wait')
        run(battle, 3, director)
        expect(companySquads(battle, moving!.id).every(sq => sq.order === 'move')).toBe(true)
        expect(moving!.guidance.directive).toBe('order')
        run(battle, 25, director)
        expect(companySquads(battle, waiting!.id).every(sq => sq.order === 'hold')).toBe(true)
        expect(waiting!.guidance.directive).toBe('wait')
    }, 120000)

    it('守備の中隊は守る地点から遠い敵を追わず、着いた所に構え続ける', () => {
        const battle = makeBattle('123456')
        const director = createGuidelineDirector(battle)
        const company = playerCompanies(battle).find(c => c.guidance.guideline === 'guard')!
        nudge(battle, company)
        run(battle, 15, director)
        expect(company.guidance.guardPoint).not.toBeNull()
        expect(companySquads(battle, company.id).every(sq => sq.order === 'move')).toBe(true)
        const post = company.guidance.guardPoint!
        const at = companyPosition(battle, company)
        expect(Math.hypot(at.x - post.x, at.y - post.y)).toBeLessThan(60)
    }, 120000)

    it('行動を変えると、守る地点を選び直す', () => {
        const battle = makeBattle('123456')
        const company = playerCompanies(battle)[0]!
        company.guidance.guardPoint = { x: 1, y: 2 }
        setGuideline(company.guidance, 'guard')
        expect(company.guidance.guideline).toBe('guard')
        expect(company.guidance.guardPoint).toBeNull()
    })
})
