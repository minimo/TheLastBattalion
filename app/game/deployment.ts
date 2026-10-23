import { ARMY_CAP, INITIAL_SQUADS, RESERVES, SIEGE_ATTACKER_POOL, SIEGE_ATTACKER_SQUADS, SIEGE_DEFENDER_RESERVES } from './battleConfig'
import { SQUAD_SIZE } from './formation'
import type { Army, BattleMode, FormationType, UnitType } from '../types/game'

/** 開戦時の編成: 全軍の陣形と、布陣する部隊（兵種と人数）。人数は軍の兵（予備兵）から割り当て、残りが増援になる。 */
export interface DeploymentPlan {
    formation: FormationType
    squads: { type: UnitType; size: number }[]
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

/** 編成のプリセット。兵種の割合で、既定の編成と同じ人数の部隊を組む（標準は既定の編成そのもの）。 */
export const DEPLOYMENT_PRESETS: { key: string; name: string; description: string; formation: FormationType; mix?: Record<UnitType, number> }[] = [
    { key: 'default', name: '標準', description: '既定の編成（横陣）', formation: 'line' },
    { key: 'pike', name: '堅陣', description: '槍兵と歩兵で前線を固める（方円）', formation: 'circle', mix: { infantry: .38, pikeman: .3, archer: .2, cavalry: .04, supply: .04, engineer: .04 } },
    { key: 'archer', name: '弓兵重視', description: '槍兵の壁の後ろから矢を浴びせる（横陣）', formation: 'line', mix: { infantry: .22, pikeman: .2, archer: .4, cavalry: .06, supply: .08, engineer: .04 } },
    { key: 'cavalry', name: '騎兵重視', description: '騎兵を先頭に一気に突き崩す（鋒矢）', formation: 'arrow', mix: { infantry: .36, pikeman: .06, archer: .16, cavalry: .36, supply: .03, engineer: .03 } },
]

export function presetDeployment(key: string, mode: BattleMode, owner: Army): DeploymentPlan {
    const preset = DEPLOYMENT_PRESETS.find(p => p.key === key)
    const base = defaultDeployment(mode, owner)
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

/** 編成を兵種の順に並べ、人数を範囲に収め、兵種ごとの部隊数と布陣できる上限を超えた分の部隊を後ろから削る。 */
export function normalizeDeployment(plan: DeploymentPlan, mode: BattleMode, owner: Army): DeploymentPlan {
    const limit = deployLimit(mode, owner)
    const sorted = UNIT_TYPES.flatMap(type => plan.squads.filter(sq => sq.type === type).slice(0, SQUADS_PER_TYPE_MAX))
    const squads: DeploymentPlan['squads'] = []
    let total = 0
    for (const sq of sorted) {
        const size = Math.max(SQUAD_SIZE_MIN, Math.min(squadSizeMax(sq.type), Math.round(sq.size)))
        if (total + size > limit) continue
        squads.push({ type: sq.type, size })
        total += size
    }
    return { formation: plan.formation, squads }
}
