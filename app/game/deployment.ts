import { ARMY_BUDGET, ARMY_CAP, INITIAL_SQUADS, SIEGE_ATTACKER_BUDGET, SIEGE_ATTACKER_POOL, SIEGE_ATTACKER_SQUADS, SIEGE_DEFENDER_BUDGET, UNIT_COST } from './battleConfig'
import { COMPANY_MAX_SQUADS, FORMATIONS, joinsCompany, SQUAD_SIZE } from './formation'
import { defaultGuideline, guidelineOptions } from './guidelines'
import type { Army, BattleMode, FormationType, Guideline, UnitType } from '../types/game'

/**
 * 開戦時の編成: 全軍の陣形と、布陣する小隊（兵種と人数）。兵は兵種ごとの予算（UNIT_COST）を軍の予算から支払って布陣し、残った予算が増援になる。
 * company は編成で組んだ中隊の番号（1から）。同じ番号の小隊が1つの中隊になり（兵種を混ぜてよい）、陣でもひとかたまりに並ぶ。
 * 歩兵・槍兵・弓兵・騎兵の小隊は必ず中隊に入る（編成を整えるときに、中隊のない小隊は同じ兵種ごとに中隊へまとめる）。工兵・補給兵・偵察兵は中隊に入らない。
 * guideline は選んだ行動（中隊はその小隊がみな同じ行動を持つ）。なければ既定の行動。
 */
export interface PlannedSquad { type: UnitType; size: number; company?: number; guideline?: Guideline }
export interface DeploymentPlan {
    formation: FormationType
    squads: PlannedSquad[]
}

export const UNIT_TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer', 'scout']
/** 編成で決められる1部隊の人数の範囲と刻み。ふつうは10人〜定員の2倍を5人刻みで、偵察兵は1〜5人を1人刻みで決める。 */
export const squadSizeMin = (type: UnitType) => type === 'scout' ? 1 : 10
export const squadSizeMax = (type: UnitType) => type === 'scout' ? SQUAD_SIZE.scout : SQUAD_SIZE[type] * 2
export const squadSizeStep = (type: UnitType) => type === 'scout' ? 1 : 5
/** 編成で兵種ごとに布陣できる部隊の数の上限（陣形で10部隊ずつ2列に並ぶ）。 */
export const SQUADS_PER_TYPE_MAX = 20

/** 攻城戦・防衛戦の守り手（砦を持つ側）。攻防戦はどちらも砦を持つ。 */
export const defenderOf = (mode: BattleMode): Army | null => mode === 'siege' ? 'cpu' : mode === 'defense' ? 'player' : null
/** 軍が砦を持つか（砦を持たない攻め手には増援がない）。 */
export const hasFort = (mode: BattleMode, owner: Army) => mode === 'field' || defenderOf(mode) === owner

const squadsOf = (counts: Record<UnitType, number>) =>
    UNIT_TYPES.flatMap(type => Array.from({ length: counts[type] }, () => ({ type, size: SQUAD_SIZE[type] })))

/** 既定の編成（横陣。砦を持つ軍は INITIAL_SQUADS、攻め手は SIEGE_ATTACKER_SQUADS）。 */
export function defaultDeployment(mode: BattleMode, owner: Army): DeploymentPlan {
    return normalizeDeployment({ formation: 'line', squads: squadsOf(hasFort(mode, owner) ? INITIAL_SQUADS : SIEGE_ATTACKER_SQUADS) }, mode, owner)
}

/** 魔王軍の編成。既定の編成を、ランダムな陣形で布陣する。 */
export function cpuDeployment(mode: BattleMode, random: () => number): DeploymentPlan {
    return { ...defaultDeployment(mode, 'cpu'), formation: FORMATIONS[Math.floor(random() * FORMATIONS.length)]!.type }
}

/** 軍の予算。布陣する兵と増援に使う（砦を持たない攻め手は増援がないので、布陣に使わなかった分は戦場に出ない）。 */
export function armyBudget(mode: BattleMode, owner: Army) {
    if (!hasFort(mode, owner)) return SIEGE_ATTACKER_BUDGET
    return defenderOf(mode) === owner ? SIEGE_DEFENDER_BUDGET : ARMY_BUDGET
}

/** 開戦時に布陣できる人数の上限。砦を持つ軍は同時に戦場に出られる数まで。 */
export function deployLimit(mode: BattleMode, owner: Army) {
    return hasFort(mode, owner) ? ARMY_CAP : SIEGE_ATTACKER_POOL
}

export const squadCost = (type: UnitType, size: number) => size * UNIT_COST[type]
export const deployedCount = (plan: DeploymentPlan) => plan.squads.reduce((sum, sq) => sum + sq.size, 0)
/** 編成の布陣にかかる予算。 */
export const deployedCost = (plan: DeploymentPlan) => plan.squads.reduce((sum, sq) => sum + squadCost(sq.type, sq.size), 0)

/** 編成で組める中隊の数の上限。 */
export const PLANNED_COMPANIES_MAX = 20

/** 編成で中隊を組むときのひな形（兵種の並び）。 */
export const COMPANY_TEMPLATES: { key: string; name: string; description: string; types: UnitType[] }[] = [
    { key: 'mixed', name: '混成', description: '槍兵が前を守り、歩兵が戦い、弓兵が後ろから射る', types: ['pikeman', 'infantry', 'archer'] },
    { key: 'pike-archer', name: '槍弓', description: '槍兵の壁の後ろから弓兵が射る', types: ['pikeman', 'pikeman', 'archer'] },
    { key: 'infantry', name: '歩兵', description: '歩兵3小隊の近接の主力', types: ['infantry', 'infantry', 'infantry'] },
    { key: 'archer', name: '弓兵', description: '弓兵3小隊で矢を浴びせる', types: ['archer', 'archer', 'archer'] },
    { key: 'cavalry', name: '騎兵', description: '騎兵2小隊の遊撃隊', types: ['cavalry', 'cavalry'] },
    { key: 'escort', name: '騎弓', description: '騎兵が弓兵を守る（足は弓兵にそろう）', types: ['cavalry', 'archer'] },
]

/** 編成で組んだ中隊ごとの小隊（編成の中の位置）。中隊の番号の順。 */
export function plannedCompanies(plan: DeploymentPlan) {
    const companies = new Map<number, number[]>()
    plan.squads.forEach((sq, index) => {
        if (sq.company === undefined) return
        if (!companies.has(sq.company)) companies.set(sq.company, [])
        companies.get(sq.company)!.push(index)
    })
    return [...companies].sort((a, b) => a[0] - b[0]).map(([company, indices]) => ({ company, indices }))
}

/** 編成の中隊（小隊の位置）または中隊に入らない小隊（1つの位置）の行動。選んでいなければ既定の行動。 */
export function plannedGuideline(plan: DeploymentPlan, indices: number[]): Guideline {
    const squads = indices.map(i => plan.squads[i]!)
    const chosen = squads.find(sq => sq.guideline)?.guideline
    return chosen && guidelineOptions(squads.map(sq => sq.type)).includes(chosen) ? chosen : defaultGuideline(squads)
}

/**
 * 編成のプリセット（兵の構成）。中隊の並びと、中隊に入らない小隊の数で決める（標準は既定の編成そのもの）。
 * どれも標準の編成とほぼ同じ予算で組んであり、布陣の規模（DEPLOYMENT_SCALES）に合わせて伸び縮みする。
 */
export const DEPLOYMENT_PRESETS: { key: string; name: string; description: string; formation: FormationType; companies?: UnitType[][]; support?: Partial<Record<UnitType, number>> }[] = [
    { key: 'default', name: '標準', description: '既定の編成（横陣）', formation: 'line' },
    {
        key: 'pike', name: '堅陣', description: '槍兵と歩兵で前線を固める（方円）', formation: 'circle',
        companies: [['pikeman', 'pikeman', 'pikeman'], ['pikeman', 'pikeman', 'infantry'], ['pikeman', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry'], ['archer', 'archer', 'archer'], ['cavalry', 'cavalry']],
        support: { supply: 2, engineer: 2, scout: 1 },
    },
    {
        key: 'archer', name: '弓兵重視', description: '槍兵の壁の後ろから矢を浴びせる（横陣）', formation: 'line',
        companies: [['pikeman', 'pikeman', 'archer'], ['pikeman', 'pikeman', 'archer'], ['pikeman', 'pikeman', 'archer'], ['archer', 'archer', 'archer'], ['archer', 'archer'], ['infantry', 'infantry', 'infantry'], ['cavalry']],
        support: { supply: 3, engineer: 1, scout: 1 },
    },
    {
        key: 'cavalry', name: '騎兵重視', description: '少数の騎兵を先頭に一気に突き崩す（鋒矢）', formation: 'arrow',
        companies: [['cavalry', 'cavalry', 'cavalry', 'cavalry'], ['cavalry', 'cavalry', 'cavalry', 'cavalry'], ['cavalry', 'cavalry'], ['infantry', 'infantry', 'infantry'], ['archer', 'archer'], ['pikeman']],
        support: { supply: 2, engineer: 1, scout: 1 },
    },
    {
        key: 'combined', name: '混成中隊', description: '槍・歩・弓を組んだ中隊で戦線を張る（横陣）', formation: 'line',
        companies: [['pikeman', 'infantry', 'archer'], ['pikeman', 'infantry', 'archer'], ['pikeman', 'infantry', 'archer'], ['infantry', 'infantry', 'infantry'], ['archer', 'archer'], ['cavalry', 'cavalry'], ['cavalry', 'cavalry']],
        support: { supply: 2, engineer: 2, scout: 1 },
    },
    {
        key: 'horde', name: '大軍', description: '安い歩兵を多く並べ、数で押す（横陣）', formation: 'line',
        companies: [['infantry', 'infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry', 'infantry'], ['pikeman', 'pikeman', 'pikeman'], ['archer', 'archer', 'archer'], ['cavalry']],
        support: { supply: 2, engineer: 1, scout: 1 },
    },
]

/**
 * 布陣の規模。開戦時の布陣に、標準の編成の何倍の予算を使うか（残りの予算は予備になり、増援に使われる）。
 * 増援のない攻め手は規模を選ばず、いつも予算のすべてを布陣に使う。
 */
export type DeploymentScale = 'light' | 'standard' | 'full'
export const DEPLOYMENT_SCALES: { key: DeploymentScale; name: string; description: string; factor: number }[] = [
    { key: 'light', name: '控えめ', description: '布陣を小さくし、予備を厚く残す', factor: .7 },
    { key: 'standard', name: '標準', description: '標準の編成と同じ予算で布陣する', factor: 1 },
    { key: 'full', name: '全力', description: '開戦から多くの兵を出す（予備は減る）', factor: 1.4 },
]

/**
 * プリセットの構成を、規模に合う予算で組む。
 * 構成を予算に合わせて伸び縮みさせるときは、まず構成ごと繰り返して小隊を増やし（兵種ごとの小隊と中隊の数の上限まで）、残りは小隊の人数で合わせる。
 * 布陣できる人数の上限にかかるときは、兵種の割合を保ったまま人数を抑える。
 */
export function presetDeployment(key: string, mode: BattleMode, owner: Army, scale: DeploymentScale = 'standard'): DeploymentPlan {
    const preset = DEPLOYMENT_PRESETS.find(p => p.key === key)
    const base = defaultDeployment(mode, owner)
    const block: PlannedSquad[] = preset?.companies
        ? [
            ...preset.companies.flatMap((types, i) => types.map(type => ({ type, size: SQUAD_SIZE[type], company: i + 1 }))),
            ...UNIT_TYPES.flatMap(type => Array.from({ length: preset.support?.[type] ?? 0 }, () => ({ type, size: SQUAD_SIZE[type] }))),
        ]
        : base.squads
    const budget = armyBudget(mode, owner), limit = deployLimit(mode, owner)
    const target = hasFort(mode, owner) ? Math.min(budget, Math.round(deployedCost(base) * DEPLOYMENT_SCALES.find(s => s.key === scale)!.factor)) : budget
    const blockPlan = { formation: 'line' as FormationType, squads: block }
    const companyCount = Math.max(1, ...block.map(sq => sq.company ?? 0))
    const mostSquads = Math.max(...UNIT_TYPES.map(type => block.filter(sq => sq.type === type).length))
    const factor = target / deployedCost(blockPlan)
    const repeat = Math.max(1, Math.min(Math.floor(factor), Math.floor(PLANNED_COMPANIES_MAX / companyCount), Math.floor(SQUADS_PER_TYPE_MAX / mostSquads)))
    const stretch = Math.min(factor / repeat, limit / (deployedCount(blockPlan) * repeat))
    const squads: PlannedSquad[] = []
    for (let r = 0; r < repeat; r++) for (const sq of block) {
        const step = squadSizeStep(sq.type)
        const size = Math.max(squadSizeMin(sq.type), Math.min(squadSizeMax(sq.type), Math.round(sq.size * stretch / step) * step))
        squads.push(sq.company === undefined ? { type: sq.type, size } : { type: sq.type, size, company: r * companyCount + sq.company })
    }
    // 人数の丸めで予算か人数の上限を超えたら、人数の最も多い小隊から少しずつ減らす。
    const plan = { formation: preset?.formation ?? base.formation, squads }
    while (deployedCost(plan) > target || deployedCount(plan) > limit) {
        const most = squads.filter(sq => sq.size > squadSizeMin(sq.type)).reduce<PlannedSquad | null>((a, b) => a && a.size >= b.size ? a : b, null)
        if (!most) break
        most.size -= squadSizeStep(most.type)
    }
    return normalizeDeployment(plan, mode, owner)
}

/**
 * 編成を兵種の順に並べ、人数を範囲に収め、兵種ごとの部隊数と、布陣できる人数の上限・軍の予算を超えた分の部隊を後ろから削る。
 * 中隊は1中隊 COMPANY_MAX_SQUADS 小隊・PLANNED_COMPANIES_MAX 中隊までにし（工兵・補給兵・偵察兵は中隊に入れない）、番号を出てくる順に1から振り直す。
 * 中隊に入っていない歩兵・槍兵・弓兵・騎兵の小隊は、兵種ごとに COMPANY_MAX_SQUADS 小隊以下の同じくらいの数の中隊にまとめて、組んだ中隊の後ろに加える
 * （中隊の数の上限で入らない小隊は削る）。
 */
export function normalizeDeployment(plan: DeploymentPlan, mode: BattleMode, owner: Army): DeploymentPlan {
    const limit = deployLimit(mode, owner), budget = armyBudget(mode, owner)
    const sorted = UNIT_TYPES.flatMap(type => plan.squads.filter(sq => sq.type === type).slice(0, SQUADS_PER_TYPE_MAX))
    const squads: PlannedSquad[] = []
    // 中隊は元の番号の小さい順に PLANNED_COMPANIES_MAX まで認める。
    const keys = [...new Set(plan.squads.map(sq => sq.company).filter((c): c is number => Number.isInteger(c) && c! > 0))].sort((a, b) => a - b).slice(0, PLANNED_COMPANIES_MAX)
    // 中隊に入れる小隊は編成の元の順で決める（あふれるのは後から加えた小隊）。
    const accepted = new Set<PlannedSquad>(), members = new Map<number, number>()
    for (const sq of plan.squads) {
        const key = sq.company
        if (key === undefined || !keys.includes(key) || !joinsCompany(sq.type) || !sorted.includes(sq) || (members.get(key) ?? 0) >= COMPANY_MAX_SQUADS) continue
        members.set(key, (members.get(key) ?? 0) + 1)
        accepted.add(sq)
    }
    members.clear()
    let total = 0, cost = 0
    for (const sq of sorted) {
        const size = Math.max(squadSizeMin(sq.type), Math.min(squadSizeMax(sq.type), Math.round(sq.size)))
        if (total + size > limit || cost + squadCost(sq.type, size) > budget) continue
        const squad: PlannedSquad = { type: sq.type, size }
        if (sq.guideline) squad.guideline = sq.guideline
        if (accepted.has(sq)) {
            squad.company = sq.company
            members.set(sq.company!, (members.get(sq.company!) ?? 0) + 1)
        }
        squads.push(squad)
        total += size
        cost += squadCost(sq.type, size)
    }
    // 中隊に入っていない歩兵・槍兵・弓兵・騎兵の小隊を、兵種ごとに中隊へまとめる。
    let next = Math.max(0, ...members.keys()) + 1
    for (const type of UNIT_TYPES.filter(joinsCompany)) {
        const loose = squads.filter(sq => sq.type === type && sq.company === undefined)
        const count = Math.ceil(loose.length / COMPANY_MAX_SQUADS)
        for (let i = 0; i < count; i++) {
            const group = loose.slice(Math.round(i * loose.length / count), Math.round((i + 1) * loose.length / count))
            if (members.size >= PLANNED_COMPANIES_MAX) { for (const sq of group) squads.splice(squads.indexOf(sq), 1); continue }
            for (const sq of group) sq.company = next
            members.set(next++, group.length)
        }
    }
    // 残った中隊の番号を、元の順のまま1から詰める。
    const numbers = new Map([...members.keys()].sort((a, b) => a - b).map((key, i) => [key, i + 1]))
    for (const squad of squads) if (squad.company !== undefined) squad.company = numbers.get(squad.company)
    // 中隊の行動は中隊の小隊でそろえる（加えたばかりの小隊にも、中隊で選んだ行動を持たせる）。
    for (const { indices } of plannedCompanies({ formation: plan.formation, squads })) {
        const chosen = indices.map(i => squads[i]!.guideline).find(g => g)
        for (const i of indices) { if (chosen) squads[i]!.guideline = chosen; else delete squads[i]!.guideline }
    }
    return { formation: plan.formation, squads }
}
