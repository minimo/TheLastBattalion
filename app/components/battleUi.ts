import type { Army, ConstructionKind, SquadOrder, UnitType } from '~/types/game'

/** 戦闘画面の表示名と、部隊への指示の並び（操作バー・長押しメニュー・部隊一覧で共通）。 */
export const ARMY_NAME: Record<Army, string> = { player: '人間軍', cpu: '魔王軍' }
// 魔王軍も種族は出さず、人間軍と同じ兵種名で示す。
const TYPE_LABEL: Record<UnitType, string> = { infantry: '歩兵', pikeman: '槍兵', archer: '弓兵', cavalry: '騎兵', supply: '補給兵', engineer: '工兵' }
export const UNIT_NAME: Record<Army, Record<UnitType, string>> = { player: TYPE_LABEL, cpu: TYPE_LABEL }
export const UNIT_TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
export const ORDER_NAME: Record<SquadOrder, string> = { formation: '陣形', move: '移動', hold: '待機', attack: '攻撃', charge: '突撃', retreat: '退却', resupply: '補給中', support: '補給', build: '建設', demolish: '破壊', occupy: '占領' }
export const TIRED_BELOW = 40

export const squadName = (squad: { owner: Army; type: UnitType; number: number }) => `第${squad.number}${UNIT_NAME[squad.owner][squad.type]}小隊`
export const companyName = (company: { number: number }) => `第${company.number}中隊`
/** 中隊の兵種の並び（例「歩兵・弓兵」）。 */
export const companyTypes = (company: { owner: Army; types: UnitType[] }) => company.types.map(t => UNIT_NAME[company.owner][t]).join('・')

/** 矢・体力・補給のどれかが心もとない部隊。 */
export const squadNeedsCare = (squad: { stamina: number; arrows: number; maxArrows: number; supplies: number; maxSupplies: number }) =>
  squad.stamina < TIRED_BELOW || (squad.maxArrows > 0 && squad.arrows < squad.maxArrows * .25) || (squad.maxSupplies > 0 && squad.supplies === 0)

/** public/icons/command/ のアイコン名。 */
export type CommandIcon = 'army' | 'squads' | 'pause' | 'play' | 'speed' | 'view' | 'menu' | 'charge' | 'hold' | 'formation' | 'retreat'
  | 'resupply' | 'support' | 'outpost' | 'barricade' | 'bridge' | 'rotate' | 'close'

export type SquadAction = { key: string; label: string; icon: CommandIcon; order?: SquadOrder; build?: ConstructionKind }
const BUILD_ACTIONS: SquadAction[] = [
  { key: 'build:outpost', build: 'outpost', label: '拠点', icon: 'outpost' },
  { key: 'build:barricade', build: 'barricade', label: '柵', icon: 'barricade' },
  { key: 'build:bridge', build: 'bridge', label: '橋', icon: 'bridge' },
]
/** 部隊への指示。どの部隊も補給に戻れ、補給部隊は突撃の代わりに自動補給、工兵は突撃の代わりに建設。 */
export const squadActions = (type: UnitType): SquadAction[] => [
  ...(type === 'engineer' ? BUILD_ACTIONS
    : [type === 'supply' ? { key: 'support', order: 'support' as const, label: '自動補給', icon: 'support' as const } : { key: 'charge', order: 'charge' as const, label: '突撃', icon: 'charge' as const }]),
  { key: 'hold', order: 'hold', label: '待機', icon: 'hold' },
  { key: 'formation', order: 'formation', label: '陣形に戻る', icon: 'formation' },
  { key: 'retreat', order: 'retreat', label: '退却', icon: 'retreat' },
  { key: 'resupply', order: 'resupply', label: '補給に戻る', icon: 'resupply' },
]

/** 中隊への指示。補給部隊と工兵だけの中隊は突撃せず、補給部隊がいれば自動補給も出せる。 */
export const companyActions = (types: UnitType[]): SquadAction[] => [
  ...(types.some(t => t !== 'supply' && t !== 'engineer') ? [{ key: 'charge', order: 'charge' as const, label: '突撃', icon: 'charge' as const }] : []),
  ...(types.includes('supply') ? [{ key: 'support', order: 'support' as const, label: '自動補給', icon: 'support' as const }] : []),
  { key: 'hold', order: 'hold', label: '待機', icon: 'hold' },
  { key: 'formation', order: 'formation', label: '陣形に戻る', icon: 'formation' },
  { key: 'retreat', order: 'retreat', label: '退却', icon: 'retreat' },
  { key: 'resupply', order: 'resupply', label: '補給に戻る', icon: 'resupply' },
]

export const ARMY_ACTIONS: { order: 'charge' | 'hold' | 'retreat'; label: string }[] = [
  { order: 'charge', label: '全軍突撃' }, { order: 'hold', label: '全軍待機' }, { order: 'retreat', label: '全軍退却' },
]
