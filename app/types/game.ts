/** player = 人間軍、cpu = モンスター軍。昼夜補正（daynight.ts）はno-life-kingと同じ所有者区分を使う。 */
export type Owner = 'player' | 'cpu' | 'neutral'
export type Army = Exclude<Owner, 'neutral'>
export type Rank = 1 | 2 | 3

export interface Point {
    x: number
    y: number
}

/** no-life-kingのマップ生成が返す拠点。地形を同一に再現するため型ごと維持する。 */
export interface Base {
    id: string
    owner: Owner
    rank: Rank
    production: number
    productionCap: number
    growthRate: number
    isCore: boolean
    isCamp?: boolean
    x: number
    y: number
    radius: number
}

export type UnitType = 'infantry' | 'pikeman' | 'archer' | 'cavalry' | 'supply' | 'engineer'

export type SoldierState = 'advance' | 'hold' | 'fight' | 'assault' | 'flee' | 'dead'

export interface Soldier {
    id: number
    owner: Army
    type: UnitType
    squadId: number
    /** 部隊内の持ち場の番号（前列から詰めて振り直す）。 */
    slot: number
    x: number
    y: number
    hp: number
    maxHp: number
    state: SoldierState
    /** 向き（ラジアン）。atan2(dx, dy) で +Y 方向が0。 */
    heading: number
    moving: boolean
    /** 共有される読み取り専用の経路。 */
    path: Point[]
    pathIndex: number
    /** 経路の目的地キー。異なる目的地が必要になったら経路を取り直す。 */
    pathGoal: string
    targetId: number
    thinkTimer: number
    attackTimer: number
    /** 攻撃モーションの残り時間（秒）。 */
    swing: number
    /** 連続して走った時間。騎兵の突撃判定に使う。 */
    runTime: number
    fleeTimer: number
    /** 個体差。思考の間隔・攻撃性・士気に影響する。 */
    courage: number
    elapsedTime: number
    deathTime: number
    /** 移動が詰まった時間。壁沿いで詰まったら経路探索に切り替える。 */
    stuckTime: number
    /** 追跡中に壁を迂回するため、経路探索で移動する残り時間。 */
    detour: number
    /** 行軍時の横列の位置（経路からの横ずれ、px）。軍が一列縦隊にならず横に広がって進む。 */
    lane: number
    /** 持ち場まで直進できるか（思考時に判定）。できなければ経路に沿って向かう。 */
    routeDirect: boolean
    /** 直前のティックからの移動速度（px/秒）。弓兵が着弾点を予測するのに使う。 */
    vx: number
    vy: number
    /** 弓兵が弓を構える仰角（ラジアン）。遠い相手ほど上に向ける。 */
    aim: number
    /** 所持している矢（弓兵のみ。他の兵種は0）。 */
    arrows: number
    maxArrows: number
    /** 攻撃している敵の建設物（なければ-1）。 */
    constructionId: number
}

/**
 * 部隊への指示。
 * formation: 全軍の陣形の持ち場につく / move: 指定地点へ移動して構える / hold: その場で構える
 * attack: 指定した敵部隊を攻撃 / charge: 各兵が自由に戦い敵本陣へ突撃 / retreat: 自陣へ退却
 * resupply: 自陣（または最寄りの拠点）へ戻って補給し、終わったら元の指示に戻る / support: 補給部隊が味方の部隊へ矢と体力を届ける
 * build: 工兵が建設物を建てる・直す / demolish: 指定した敵の建設物を壊す
 */
export type SquadOrder = 'formation' | 'move' | 'hold' | 'attack' | 'charge' | 'retreat' | 'resupply' | 'support' | 'build' | 'demolish'

export type FormationType = 'line' | 'crane' | 'scale' | 'circle' | 'arrow'

export interface Squad {
    id: number
    owner: Army
    type: UnitType
    /** 兵種ごとの通し番号（第n歩兵隊）。 */
    number: number
    order: SquadOrder
    /** 持ち場の前列中央と向き（formation/move/hold）。 */
    anchor: Point
    facing: number
    /** 持ち場までの経路キー。 */
    goalKey: string
    targetSquadId: number
    /** 毎ティック集計する重心と人数。 */
    center: Point
    count: number
    /** 編成時の人数。 */
    size: number
    /** 部隊の矢の残りと上限（弓兵、毎ティック集計）。 */
    arrows: number
    maxArrows: number
    /** 部隊の体力（0〜100）。移動と攻撃で減り、補給で回復する。減ると移動も攻撃も鈍る。 */
    stamina: number
    /** 補給部隊が補給できる残り回数と上限。尽きたら自陣へ戻って補充する。 */
    supplies: number
    maxSupplies: number
    /** 補給部隊が今まさに補給している部隊（1回分を使った相手）。 */
    servingId: number
    /** 建てている（build）・壊しに行く（demolish）建設物。 */
    constructionId: number
    /** 補給を受けに戻る先。-1は自陣の砦、それ以外は自軍の拠点のID。 */
    depotId: number
    /**
     * 槍兵の部隊が隊列を保って進むときの、隊列の前列中央と向き（行き先へ向かって動く）。
     * 兵は各自の持ち場ではなく、ここを基準にした持ち場へ向かうので、横隊を崩さずに進む。
     */
    march: { x: number; y: number; facing: number; moving: boolean } | null
    /** 補給に戻る前の指示（補給が終わったら戻す）。 */
    resume: { order: SquadOrder; anchor: Point; facing: number; targetSquadId: number; constructionId: number } | null
}

/** 工兵が建てる建設物。outpost: 拠点（補給できる小さな陣地） / barricade: バリケード / bridge: 橋 */
export type ConstructionKind = 'outpost' | 'barricade' | 'bridge'
/** バリケードが並ぶ向き（x: 東西、y: 南北）。橋は渡る向き。 */
export type ConstructionAxis = 'x' | 'y'

export interface ConstructionPlan {
    kind: ConstructionKind
    owner: Army
    axis: ConstructionAxis
    /** 完成すると通行不可になるマス（拠点の柵・バリケード）。 */
    walls: FortCell[]
    /** 完成すると渡れるようになるマス（橋の床）。 */
    deck: FortCell[]
    /** 敷地全体（他の建設物との重なりを調べる）。 */
    area: FortCell[]
    center: Point
    /** 橋の両岸のマスの中心。 */
    ends: Point[]
    valid: boolean
    /** 建てられない理由（表示用）。 */
    reason: string
}

export interface Construction extends ConstructionPlan {
    id: number
    /** 建設の進み具合（0〜1）。1で完成し、地形に反映される。 */
    progress: number
    /** 完成までに要る作業量（工兵1人が1秒で1）。 */
    work: number
    hp: number
    maxHp: number
    complete: boolean
    /** 工兵が作業に立つ地点と、そこへ向かう経路の目的地。 */
    workPoints: Point[]
    approach: Point
    /** 拠点の内側（補給を受ける兵が集まる地点）。 */
    interior: Point[]
    /** 今のティックで作業している工兵の数（表示用）。 */
    workers: number
}

export interface ArmyFormation {
    type: FormationType
    /** 陣の前列中央と向き。 */
    anchor: Point
    facing: number
    version: number
}

export interface Arrow {
    owner: Army
    fromX: number
    fromY: number
    /** 放つ高さ（地面から）。 */
    fromZ: number
    /** 放物線の頂点の高さ（始点と終点を結ぶ線からの高さ）。 */
    peak: number
    toX: number
    toY: number
    targetId: number
    /** 建設物を狙った矢（兵ではなく建設物に当たる）。 */
    constructionId: number
    /** 木に阻まれた矢（誰にも当たらず、木の根元に落ちる）。 */
    blocked: boolean
    damage: number
    time: number
    duration: number
}

/** 外れて地面に刺さった矢（描画用、しばらくして消える）。 */
export interface SpentArrow {
    x: number
    y: number
    /** 刺さった向き（水平方向）と、地面に対する傾き。 */
    yaw: number
    pitch: number
    time: number
}

export interface FortCell {
    gx: number
    gy: number
}

/** 砦の種類。camp: ベースキャンプ型の陣地（攻防戦） / castle: 岩山の城（攻城戦・防衛戦の守り手）。 */
export type FortKind = 'camp' | 'castle'

export interface Fort {
    id: string
    owner: Army
    kind: FortKind
    /** 前面（敵側）の向き。+1 は +X 方向、-1 は -X 方向。 */
    front: 1 | -1
    originGx: number
    originGy: number
    /** 砦中心のワールド座標。 */
    x: number
    y: number
    /** 地形の平坦化に使う地面の高さ（描画用）。 */
    groundHeight: number
    hp: number
    maxHp: number
    /** 本陣（キャンプの司令天幕、城の頂の本陣の建物）の中心と、本陣の建物の半径（この外側から攻撃できる）。 */
    core: Point
    coreRadius: number
    /** 本陣を攻撃する兵が集まる地点。 */
    assaultPoints: Point[]
    towers: { x: number; y: number; cooldown: number }[]
    spawnTimer: number
    /** 残りの予備兵。尽きると増援は来ない。 */
    reserves: number
}

/**
 * 戦場の種類。field: 攻防戦（両軍が砦を持つ） / siege: 攻城戦（人間軍がモンスター軍の砦を攻める） / defense: 防衛戦（人間軍が砦を守る）。
 * 攻城戦・防衛戦では攻め手は砦を持たず、全滅すると敗北する。
 */
export type BattleMode = 'field' | 'siege' | 'defense'

/** 軍の本拠地（退却・補給に戻る先）。砦を持つ軍は砦、砦を持たない攻め手は後方の野営地。 */
export type Home = Pick<Fort, 'owner' | 'front' | 'x' | 'y' | 'core' | 'assaultPoints'>

export type GameStatus = 'title' | 'playing' | 'paused' | 'gameover'

export interface ArmySummary {
    infantry: number
    pikeman: number
    archer: number
    cavalry: number
    total: number
    fortHp: number
    fortMaxHp: number
    supply: number
    engineer: number
    killed: number
    reserves: number
    /** 砦を持っているか（攻城戦・防衛戦の攻め手は持たない）。 */
    hasFort: boolean
}
