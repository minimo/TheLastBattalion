import type { Guidance, Guideline, UnitType } from '../types/game'

/** 行動の名前と説明（操作バー・部隊編成・部隊一覧で共通）。 */
export const GUIDELINES: Record<Guideline, { name: string; description: string }> = {
    assault: { name: '攻勢', description: '近い敵の中隊を次々に攻撃し、いなければ敵本陣へ進む' },
    guard: { name: '守備', description: '守る地点に構え、近づいた敵だけを迎え撃つ' },
    escort: { name: '援護', description: '近くの味方の近接の中隊の後ろに付き、近づく敵を射る' },
    skirmish: { name: '遊撃', description: '槍兵を避けて、敵の弓兵・補給兵・工兵や数の減った中隊を狙う' },
    homeGuard: { name: '本陣守備', description: '自陣の近くに控え、砦や陣に近づいた敵だけを追い払う' },
    fortify: { name: '前線の築城', description: '前線の少し後ろに拠点と柵を建て、傷んだら直す' },
    repair: { name: '修理', description: '傷んだ自軍の建設物を、傷みの大きい順に直す' },
    supply: { name: '自動補給', description: '矢の減った弓兵の部隊を探して矢を届ける' },
}

const COMBAT_GUIDELINES: Guideline[] = ['assault', 'guard', 'escort', 'skirmish', 'homeGuard']

/** 部隊が選べる行動（中隊は兵種を問わず戦う行動、工兵は築城と修理、補給兵は自動補給だけ）。 */
export function guidelineOptions(types: UnitType[]): Guideline[] {
    if (types.length && types.every(t => t === 'engineer')) return ['fortify', 'repair']
    if (types.length && types.every(t => t === 'supply')) return ['supply']
    return COMBAT_GUIDELINES
}

/** 兵種ごとの既定の行動。 */
const DEFAULT_GUIDELINE: Record<UnitType, Guideline> = {
    infantry: 'assault', pikeman: 'guard', archer: 'escort', cavalry: 'skirmish', engineer: 'fortify', supply: 'supply',
}
/** 人数が同じ兵種のうち先に選ぶ順（陣の並べ方と同じく、前線の歩兵・槍兵、弓兵、騎兵の順）。 */
const TIE_ORDER: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'engineer', 'supply']

/** 既定の行動: 人数が一番多い兵種の行動（同じ人数なら TIE_ORDER の順）。 */
export function defaultGuideline(squads: { type: UnitType; size: number }[]): Guideline {
    const totals = new Map<UnitType, number>()
    for (const sq of squads) totals.set(sq.type, (totals.get(sq.type) ?? 0) + sq.size)
    let best: UnitType | undefined
    for (const type of TIE_ORDER) if (totals.has(type) && (best === undefined || totals.get(type)! > totals.get(best)!)) best = type
    return best ? DEFAULT_GUIDELINE[best] : 'assault'
}

export const createGuidance = (guideline: Guideline): Guidance => ({ guideline, directive: 'none', guardPoint: null, guardFacing: 0 })
