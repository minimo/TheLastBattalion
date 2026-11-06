/** player = 人間軍、cpu = 魔王軍。昼夜補正（daynight.ts）はno-life-kingと同じ所有者区分を使う。 */
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
    /** 歩いた道のり（px）。足の運びはこれに合わせる。 */
    gait: number
    /** 弓兵が弓を構える仰角（ラジアン）。遠い相手ほど上に向ける。 */
    aim: number
    /** 所持している矢（弓兵のみ。他の兵種は0）。 */
    arrows: number
    maxArrows: number
    /** 敵に見えている期限（ゲーム内の時刻）。これを過ぎた兵は敵から見えない。 */
    spottedUntil: number
    /** 敵に一度でも発見されたか。 */
    discovered: boolean
    /** 攻撃している敵の建設物（なければ-1）。 */
    constructionId: number
    /** 隊長から離れすぎて、隊長のもとへ戻っている最中か。 */
    regroup: boolean
    /** 閉じ込められていて、柵をすり抜けて進んでいるか（道のつながっていない所へ合流するときの特例）。 */
    slip: boolean
    /** 部隊を見捨てて逃げ出した兵の、逃げ始めた地点・向き・時刻（逃げていなければnull）。逃げ出した兵は部隊に属さない（squadId は -1）。 */
    desertion: { x: number; y: number; heading: number; time: number } | null
}

/**
 * 部隊への指示。
 * formation: 全軍の陣形の持ち場につく / move: 指定地点へ移動して構える / hold: その場で構える
 * attack: 指定した敵部隊を攻撃 / charge: 各兵が自由に戦い敵本陣へ突撃 / retreat: 自陣へ退却
 * resupply: 自陣（または最寄りの拠点）へ戻って補給し、終わったら元の指示に戻る / support: 補給部隊が味方の部隊へ矢と体力を届ける
 * build: 工兵が建設物を建てる・直す / demolish: 指定した敵の建設物を壊す / occupy: 工兵が敵の拠点を占領して自軍の拠点にする
 */
export type SquadOrder = 'formation' | 'move' | 'hold' | 'attack' | 'charge' | 'retreat' | 'resupply' | 'support' | 'build' | 'demolish' | 'occupy'

export type FormationType = 'line' | 'crane' | 'scale' | 'circle' | 'arrow'

/**
 * 部隊の行動（人間軍）。命令のないとき、部隊はこれに沿って動く。中隊は中隊ごと、中隊に入らない工兵・補給兵は小隊ごとに持つ。
 * assault: 攻勢 / guard: 守備 / escort: 援護 / skirmish: 遊撃 / homeGuard: 本陣守備 / fortify: 前線の築城 / repair: 修理 / supply: 自動補給
 */
export type Guideline = 'assault' | 'guard' | 'escort' | 'skirmish' | 'homeGuard' | 'fortify' | 'repair' | 'supply'

/** 部隊がプレイヤーの命令で動いているか。none: 行動に沿って動く / order: 命令をやり終えるまで行動の判断は手を出さない / wait: 「待機」で、次の命令まで行動を止める。 */
export type Directive = 'none' | 'order' | 'wait'

/** 行動に沿って動く部隊（中隊、または中隊に入らない小隊）が持つもの。 */
export interface Guidance {
    guideline: Guideline
    directive: Directive
    /** 守備で守る地点と向き（最初は陣形の持ち場、移動の命令のあとは着いた地点。まだ決まっていなければnull）。 */
    guardPoint: Point | null
    guardFacing: number
}

/** 小隊（兵種ごとの部隊）。いくつかの小隊で中隊を組む。 */
export interface Squad {
    /** 敵に見えている兵の数（0なら敵からこの部隊は見えない）。 */
    seenCount: number
    /** 敵が最後にこの部隊を見た地点と時刻（まだ見られていなければ null と 0）。 */
    lastSeen: Point | null
    lastSeenTime: number
    /** 開戦前にプレイヤーが置いた、小隊のまん中（中隊に入らない小隊だけ。置いていなければ null）。陣を動かすまでの持ち場に使う。 */
    placed: Point | null
    id: number
    owner: Army
    type: UnitType
    /** 兵種ごとの通し番号（第n歩兵小隊）。 */
    number: number
    /** 属する中隊（Company）のID。 */
    companyId: number
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
    /** 自軍の幟を持つ隊長の兵。部隊の兵は隊長から一定以上離れない。倒れたら最も近い兵が引き継ぐ。 */
    leaderId: number
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
    /** 砦から出た増援が、加わる中隊にまだ着いていないか（着くまでは中隊の小隊どうしの距離の決まりに入らない）。 */
    arriving: boolean
    /** 行動（中隊に入らない小隊だけが使う。中隊の小隊は中隊の行動に従う）。 */
    guidance: Guidance
    /** 補給に戻る前の指示（補給が終わったら戻す）。 */
    resume: { order: SquadOrder; anchor: Point; facing: number; targetSquadId: number; constructionId: number } | null
}

/** 中隊: 隣り合う数個の小隊のまとまり。指示は中隊ごとにまとめて出せる（各小隊はそれぞれの指示でも動ける）。 */
export interface Company {
    id: number
    owner: Army
    /** 軍ごとの通し番号（第n中隊）。 */
    number: number
    /** 属する小隊のID（全滅した小隊は外す）。 */
    squadIds: number[]
    /** 編成で組んだ中隊か。組んだ中隊は兵種を混ぜてよく、陣でもひとかたまりに並ぶ（自動の中隊は小隊ごとに兵種の場所へ並ぶ）。 */
    planned: boolean
    /** 中隊ごとの移動・攻撃を受けて、中隊で足並みをそろえて動いているか（小隊に個別の指示を出すとやめる）。 */
    together: boolean
    /** 中隊長を出す小隊（中隊のまん中の小隊。その小隊の隊長が中隊長を兼ね、中隊の幟を背負う。いなくなったら選び直す）。 */
    leaderSquadId: number
    /** 中隊の隊形での小隊の持ち場（小隊ID → 前方・右手の位置）。小隊どうしが離れてよい距離の元になる。組んだとき・加わったときに決める。 */
    layout: Record<number, { forward: number; lateral: number }>
    /** 開戦前にプレイヤーが置いた、中隊のかたまりのまん中（置いていなければ null）。陣を動かすまでの持ち場に使う。 */
    placed: Point | null
    /** 行動。 */
    guidance: Guidance
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
    /** 軍ごとの、この建設物を認識しているか（一度認識したら以後も表示する）。 */
    seenBy: Record<Army, boolean>
    /** 敵の工兵による占領の進み具合（0〜1）。1で拠点が敵のものになる。 */
    occupation: number
    /** 今のティックで占領の作業をしている敵の工兵の数。 */
    occupiers: number
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
 * 戦場の種類。field: 攻防戦（両軍が砦を持つ） / siege: 攻城戦（人間軍が魔王軍の砦を攻める） / defense: 防衛戦（人間軍が砦を守る）。
 * 攻城戦・防衛戦では攻め手は砦を持たず、全滅すると敗北する。
 */
export type BattleMode = 'field' | 'siege' | 'defense'

/** 地形の種類。standard: 標準 / meadow: 草原 / forest: 森林 / snowfield: 雪原 / greatRiver: 大河 / marsh: 湿地 / desert: 砂漠 / wasteland: 荒野 / demonland: 魔王城付近。 */
export type MapType = 'standard' | 'meadow' | 'forest' | 'snowfield' | 'greatRiver' | 'marsh' | 'desert' | 'wasteland' | 'demonland'

/** 開戦の時刻。dawn: 夜明け / noon: 昼 / dusk: 日没 / midnight: 深夜。 */
export type StartTime = 'dawn' | 'noon' | 'dusk' | 'midnight'

/** 戦場の天候（戦闘中は変わらない）。clear: 晴れ / cloudy: 曇り / rain: 雨 / fog: 濃霧。 */
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog'
/** 開戦設定で選ぶ天候。auto: おまかせ（SEED から決める）。 */
export type WeatherChoice = Weather | 'auto'

/** 軍の本拠地（退却・補給に戻る先）。砦を持つ軍は砦、砦を持たない攻め手は後方の野営地。 */
export type Home = Pick<Fort, 'owner' | 'front' | 'x' | 'y' | 'core' | 'assaultPoints'>

/** deploying: 戦場に入って部隊編成をしている（開戦前で時間は進まない）。 */
export type GameStatus = 'title' | 'deploying' | 'playing' | 'paused' | 'gameover'

export type DiscoveredCount = Record<UnitType | 'total', number>

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
    /** 部隊を見捨てて戦場から逃げ去った自軍の兵の数。 */
    deserted: number
    reserves: number
    /** 砦を持っているか（攻城戦・防衛戦の攻め手は持たない）。 */
    hasFort: boolean
    /** 兵が敵に一人でも発見されたことがあるか。 */
    found: boolean
    /** 敵に一度でも発見された、今も生きている自軍の兵の数（total が総数、ほかは兵種ごと）。 */
    discovered: DiscoveredCount
}
