import { ARMY_CAP, INITIAL_SQUADS, RESERVES, SIEGE_ATTACKER_POOL, SIEGE_ATTACKER_SQUADS, SIEGE_DEFENDER_RESERVES } from './battleConfig'
import { COMPANY_MAX_SQUADS, SQUAD_SIZE } from './formation'
import type { Army, BattleMode, FormationType, UnitType } from '../types/game'

/**
 * 開戦時の編成: 全軍の陣形と、布陣する小隊（兵種と人数）。人数は軍の兵（予備兵）から割り当て、残りが増援になる。
 * company は編成で組んだ中隊の番号（1から）。同じ番号の小隊が1つの中隊になり（兵種を混ぜてよい）、陣でもひとかたまりに並ぶ。
 * company のない小隊は、開戦時に陣で隣り合う同じ兵種の小隊と自動で中隊に分ける。
 */
export interface PlannedSquad { type: UnitType; size: number; company?: number }
export interface DeploymentPlan {
    formation: FormationType
    squads: PlannedSquad[]
}

export const UNIT_TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
/** 編成で決められる1部隊の人数の範囲と刻み。 */
export const SQUAD_SIZE_MIN = 10
export const squadSizeMax = (type: UnitType) => SQUAD_SIZE[type] * 2
export const SQUAD_SIZE_STEP = 5
/** 編成で兵種ごとに布陣できる部隊の数の上限（陣形で10部隊ずつ2列に並ぶ）。 */
export const SQUADS_PER_TYPE_MAX = 20

/** 攻城戦・防衛戦の守り手（砦を持つ側）。攻防戦はどちらも砦を持つ。 */
export const defenderOf = (mode: BattleMode): Army | null => mode === 'siege' ? 'cpu' : mode === 'defense' ? 'player' : null
/** 軍が砦を持つか（砦を持たない攻め手には増援がない）。 */
export const hasFort = (mode: BattleMode, owner: Army) => mode === 'field' || defenderOf(mode) === owner

const squadsOf = (counts: Record<UnitType, number>) =>
    UNIT_TYPES.flatMap(type => Array.from({ length: counts[type] }, () => ({ type, size: SQUAD_SIZE[type] })))
const totalOf = (counts: Record<UnitType, number>) => UNIT_TYPES.reduce((sum, type) => sum + counts[type] * SQUAD_SIZE[type], 0)

/** 既定の編成（横陣。砦を持つ軍は INITIAL_SQUADS、攻め手は SIEGE_ATTACKER_SQUADS）。 */
export function defaultDeployment(mode: BattleMode, owner: Army): DeploymentPlan {
    return { formation: 'line', squads: squadsOf(hasFort(mode, owner) ? INITIAL_SQUADS : SIEGE_ATTACKER_SQUADS) }
}

/** 軍の兵の総数（開戦時に布陣する兵＋砦に残る予備兵）。既定の編成なら、残りが従来の予備兵の数になる。 */
export function armyPool(mode: BattleMode, owner: Army) {
    if (!hasFort(mode, owner)) return SIEGE_ATTACKER_POOL
    return totalOf(INITIAL_SQUADS) + (defenderOf(mode) === owner ? SIEGE_DEFENDER_RESERVES : RESERVES)
}

/** 開戦時に布陣できる兵の上限。砦を持つ軍は同時に戦場に出られる数まで、増援のない攻め手は兵の総数まで。 */
export function deployLimit(mode: BattleMode, owner: Army) {
    return hasFort(mode, owner) ? Math.min(armyPool(mode, owner), ARMY_CAP) : armyPool(mode, owner)
}

export const deployedCount = (plan: DeploymentPlan) => plan.squads.reduce((sum, sq) => sum + sq.size, 0)

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

/** 編成のプリセット。兵種の割合で、既定の編成と同じ人数の部隊を組む（標準は既定の編成そのもの）。 */
export const DEPLOYMENT_PRESETS: { key: string; name: string; description: string; formation: FormationType; mix?: Record<UnitType, number>; companies?: UnitType[][] }[] = [
    { key: 'default', name: '標準', description: '既定の編成（横陣）', formation: 'line' },
    { key: 'pike', name: '堅陣', description: '槍兵と歩兵で前線を固める（方円）', formation: 'circle', mix: { infantry: .38, pikeman: .3, archer: .2, cavalry: .04, supply: .04, engineer: .04 } },
    { key: 'archer', name: '弓兵重視', description: '槍兵の壁の後ろから矢を浴びせる（横陣）', formation: 'line', mix: { infantry: .22, pikeman: .2, archer: .4, cavalry: .06, supply: .08, engineer: .04 } },
    { key: 'cavalry', name: '騎兵重視', description: '騎兵を先頭に一気に突き崩す（鋒矢）', formation: 'arrow', mix: { infantry: .36, pikeman: .06, archer: .16, cavalry: .36, supply: .03, engineer: .03 } },
    {
        key: 'combined', name: '混成中隊', description: '槍・歩・弓を組んだ中隊で戦線を張る（横陣）', formation: 'line',
        companies: [['pikeman', 'infantry', 'archer'], ['pikeman', 'infantry', 'archer'], ['pikeman', 'infantry', 'archer'], ['infantry', 'infantry', 'infantry'], ['archer', 'archer'], ['cavalry', 'cavalry'], ['cavalry', 'cavalry']],
    },
]

export function presetDeployment(key: string, mode: BattleMode, owner: Army): DeploymentPlan {
    const preset = DEPLOYMENT_PRESETS.find(p => p.key === key)
    const base = defaultDeployment(mode, owner)
    if (preset?.companies) {
        // 中隊のひな形どおりに組み、残りの補給兵と工兵は既定の数だけ自動の中隊にする（砦を持たない攻め手は中隊の数を増やす）。
        const repeat = hasFort(mode, owner) ? 1 : Math.max(1, Math.floor(deployLimit(mode, owner) / deployedCount(base)))
        const squads: PlannedSquad[] = []
        for (let r = 0; r < repeat; r++) preset.companies.forEach((types, i) => types.forEach(type => squads.push({ type, size: SQUAD_SIZE[type], company: r * preset.companies!.length + i + 1 })))
        for (const sq of base.squads) if (sq.type === 'supply' || sq.type === 'engineer') squads.push({ type: sq.type, size: sq.size })
        return normalizeDeployment({ formation: preset.formation, squads }, mode, owner)
    }
    if (!preset?.mix) return base
    const total = deployedCount(base)
    const counts = Object.fromEntries(UNIT_TYPES.map(type => [type, Math.min(SQUADS_PER_TYPE_MAX, Math.max(preset.mix![type] > 0 ? 1 : 0, Math.round(total * preset.mix![type] / SQUAD_SIZE[type])))])) as Record<UnitType, number>
    // 端数の切り上げで上限を超えたら、人数の最も多い兵種から1部隊ずつ減らす。
    while (totalOf(counts) > deployLimit(mode, owner)) {
        const most = UNIT_TYPES.reduce((a, b) => counts[b] * SQUAD_SIZE[b] > counts[a] * SQUAD_SIZE[a] ? b : a)
        counts[most]--
    }
    return normalizeDeployment({ formation: preset.formation, squads: squadsOf(counts) }, mode, owner)
}

/**
 * 編成を兵種の順に並べ、人数を範囲に収め、兵種ごとの部隊数と布陣できる上限を超えた分の部隊を後ろから削る。
 * 中隊は1中隊 COMPANY_MAX_SQUADS 小隊・PLANNED_COMPANIES_MAX 中隊までにし（あふれた小隊は自動の中隊へ）、番号を出てくる順に1から振り直す。
 */
export function normalizeDeployment(plan: DeploymentPlan, mode: BattleMode, owner: Army): DeploymentPlan {
    const limit = deployLimit(mode, owner)
    const sorted = UNIT_TYPES.flatMap(type => plan.squads.filter(sq => sq.type === type).slice(0, SQUADS_PER_TYPE_MAX))
    const squads: PlannedSquad[] = []
    // 中隊は元の番号の小さい順に PLANNED_COMPANIES_MAX まで認める。
    const keys = [...new Set(plan.squads.map(sq => sq.company).filter((c): c is number => Number.isInteger(c) && c! > 0))].sort((a, b) => a - b).slice(0, PLANNED_COMPANIES_MAX)
    // 中隊に入れる小隊は編成の元の順で決める（あふれるのは後から加えた小隊）。
    const accepted = new Set<PlannedSquad>(), members = new Map<number, number>()
    for (const sq of plan.squads) {
        const key = sq.company
        if (key === undefined || !keys.includes(key) || !sorted.includes(sq) || (members.get(key) ?? 0) >= COMPANY_MAX_SQUADS) continue
        members.set(key, (members.get(key) ?? 0) + 1)
        accepted.add(sq)
    }
    members.clear()
    let total = 0
    for (const sq of sorted) {
        const size = Math.max(SQUAD_SIZE_MIN, Math.min(squadSizeMax(sq.type), Math.round(sq.size)))
        if (total + size > limit) continue
        const squad: PlannedSquad = { type: sq.type, size }
        if (accepted.has(sq)) {
            squad.company = sq.company
            members.set(sq.company!, (members.get(sq.company!) ?? 0) + 1)
        }
        squads.push(squad)
        total += size
    }
    // 残った中隊の番号を、元の順のまま1から詰める。
    const numbers = new Map([...members.keys()].sort((a, b) => a - b).map((key, i) => [key, i + 1]))
    for (const squad of squads) if (squad.company !== undefined) squad.company = numbers.get(squad.company)
    return { formation: plan.formation, squads }
}
