import type { Army, ConstructionKind, FortKind, UnitType } from '../types/game'

export interface UnitStats {
    hp: number
    attack: number
    /** 攻撃間隔（秒）。 */
    cooldown: number
    /** 攻撃射程。近接は体の接触距離に加算する。 */
    range: number
    /** 移動速度 px/秒。地形倍率・時間帯倍率はno-life-kingと同じく掛け合わせる。 */
    speed: number
    /** 敵を発見して追跡を始める距離。 */
    sight: number
    /** 体の半径（押し合い・接触判定）。 */
    radius: number
}

/** 人間軍: 歩兵・槍兵・弓兵・騎兵・補給兵・工兵 / 魔王軍: オーク歩兵・オーク槍兵・ゴブリン弓兵・狼騎兵・ゴブリン運び手・オーク工兵 */
export const UNIT_STATS: Record<Army, Record<UnitType, UnitStats>> = {
    player: {
        infantry: { hp: 110, attack: 12, cooldown: 1.0, range: 1.2, speed: 15, sight: 70, radius: 2.1 },
        pikeman: { hp: 130, attack: 13, cooldown: 1.2, range: 4, speed: 9, sight: 60, radius: 2.2 },
        archer: { hp: 65, attack: 9, cooldown: 1.8, range: 125, speed: 14, sight: 140, radius: 2 },
        cavalry: { hp: 150, attack: 14, cooldown: 1.1, range: 1.6, speed: 45, sight: 100, radius: 3.4 },
        supply: { hp: 70, attack: 3, cooldown: 1.6, range: 1.2, speed: 15, sight: 40, radius: 2.2 },
        engineer: { hp: 90, attack: 6, cooldown: 1.3, range: 1.2, speed: 14, sight: 50, radius: 2.2 },
    },
    cpu: {
        infantry: { hp: 125, attack: 12, cooldown: 1.1, range: 1.2, speed: 13.5, sight: 70, radius: 2.4 },
        pikeman: { hp: 145, attack: 13, cooldown: 1.3, range: 4, speed: 8.5, sight: 60, radius: 2.4 },
        archer: { hp: 55, attack: 8, cooldown: 1.7, range: 115, speed: 15, sight: 130, radius: 1.8 },
        cavalry: { hp: 140, attack: 14, cooldown: 1.0, range: 1.6, speed: 49.5, sight: 100, radius: 3.4 },
        supply: { hp: 60, attack: 2.5, cooldown: 1.6, range: 1.2, speed: 16, sight: 40, radius: 2 },
        engineer: { hp: 100, attack: 7, cooldown: 1.4, range: 1.2, speed: 13, sight: 50, radius: 2.4 },
    },
}

/** 開戦時に砦の前へ布陣する部隊数（片軍）。定員は formation.ts の SQUAD_SIZE。 */
export const INITIAL_SQUADS: Record<UnitType, number> = { infantry: 6, pikeman: 3, archer: 5, cavalry: 4, supply: 2, engineer: 2 }
/** 持ち場を守る兵が敵を追う範囲（持ち場からの距離）。弓兵は射程まで。槍兵は隊列を崩さないよう、ほとんど追わない。 */
export const LEASH: Record<UnitType, number> = { infantry: 45, pikeman: 8, cavalry: 80, archer: 0, supply: 12, engineer: 15 }
/**
 * 部隊のまとまり。兵は隊列のまん中に立つ幟を持つ隊長から（隊列の対角線の半分＋追う範囲×leashShare＋margin）より離れない。
 * 離れた兵は敵に構わず隊長のもとへ戻り、rejoin の割合まで近づいたら戦いに戻る。突撃中の横の広がりも laneShare の割合までに抑える。
 * 戻っている兵が部隊の waitShare の割合を超えたら、隊長は（戦っていなければ）足を止めて待つ。
 */
/**
 * 隊長に付いて歩く隊列。隊長だけが部隊の経路（指示の矢印と同じ経路）をたどり、兵は隊長のまわりの持ち場に付いて歩く。
 * 隊長は leaderPace の速さで歩いて兵が遅れないようにし、持ち場の settle 手前から隊列を持ち場の向きへ回し、arrive より近づいたら兵は本来の持ち場につく。
 * 隊列の向きは隊長の進む向きへ、毎秒 turnRate ラジアンまで回る。
 * 持ち場から lagFree より遅れた兵がいると隊長は歩みを緩め、さらに lagStop 遅れると minPace の速さまで落として待つ。
 */
export const FOLLOW = { leaderPace: .85, arrive: 5, settle: 40, turnRate: 2.5, lagFree: 8, lagStop: 30, minPace: .25 }
export const COHESION = { margin: 16, leashShare: .6, rejoin: .55, laneShare: .6, waitShare: .25 }
/**
 * 魔王軍の忠誠の低い兵（types）の脱走。部隊の人数が編成時の squadBelow の割合を下回り、自分の体力も hpBelow の割合を下回り、
 * 周りの敵が味方の odds 倍を超える劣勢になると、思考のたびに chance の確率（臆病な個体ほど高い）で部隊を離れて敵から逃げ出す。
 * 逃げ出した兵は distance 進むか seconds 秒たつと戦場から消え、撃破ではなく逃走として数える。
 */
export const DESERTION = {
    types: ['infantry', 'archer', 'supply', 'engineer'] as UnitType[],
    squadBelow: .5, hpBelow: .5, odds: 1.2, chance: .12, distance: 160, seconds: 15,
}
/** 開戦後に砦から送り出せる予備兵の総数（片軍）。これが最後の大隊。 */
export const RESERVES = 2500
/** 攻城戦・防衛戦の攻め手の部隊数。砦も増援もないので、守り手より多い兵で攻める。 */
export const SIEGE_ATTACKER_SQUADS: Record<UnitType, number> = { infantry: 10, pikeman: 4, archer: 8, cavalry: 6, supply: 3, engineer: 3 }
/** 攻城戦・防衛戦の攻め手の兵の総数（編成で布陣できる上限。増援がないので全員を開戦時に割り当てられる）。 */
export const SIEGE_ATTACKER_POOL = 2500
/** 攻城戦・防衛戦の守り手の予備兵。 */
export const SIEGE_DEFENDER_RESERVES = 1200
/** 攻城戦・防衛戦で、攻め手が布陣する敵の砦の前面の柵からの距離（px）と、野営地（退却・補給の先）の陣からの後退距離。 */
export const SIEGE_DEPLOY_DISTANCE = 520
export const SIEGE_CAMP_BACK = 120
/** 片軍の同時存在上限。 */
export const ARMY_CAP = 1600
/** 増援の間隔（秒）。1回に1部隊が砦から出撃する。 */
export const REINFORCEMENT_INTERVAL = 9
export const REINFORCEMENT_MIX: Record<UnitType, number> = { infantry: .4, pikeman: .1, archer: .3, cavalry: .12, supply: .05, engineer: .03 }

// ---- 槍兵 ----
export const PIKEMAN = {
    /** 受けるダメージの倍率（盾と鎧で守りが堅い）。 */
    damageTaken: .6,
    /** 敵を押しとどめる間合い（体の半径どうしの和に足す）。槍の穂先で敵を寄せつけない。 */
    wallMargin: .8,
    /** 隊列が進む速さ（兵の速さに対する割合）。遅れた兵が追いつけるよう、兵より少し遅い。 */
    marchPace: .85,
    /** 隊列の向きを変える速さ（ラジアン/秒）と、これより向きがずれていたら止まって向きを変える角度。 */
    turnRate: .9,
    wheelAngle: .5,
    /** 兵が持ち場からこれ以上遅れたら隊列の進みを緩める（px）。遅れが大きいほど遅く、最小で marchMinPace。 */
    lagFrom: 4,
    lagRange: 8,
    marchMinPace: .3,
}

// ---- 矢と補給 ----
/** 弓兵1人が持てる矢。 */
export const ARROWS_PER_ARCHER = 30
/** 部隊の矢がこの割合以下になったら、部隊ごと自陣へ補給に戻る。 */
export const RESUPPLY_THRESHOLD = .05
/** 補給部隊が補給に向かう、矢または体力の割合。 */
export const SUPPORT_THRESHOLD = .6
/** 補給部隊が補給できる距離（部隊の中心どうし）と、1回の補給で満タンにするまでの秒数。 */
/**
 * 中隊の中の連携。中隊で移動・攻撃しているあいだは、行き先（攻撃なら相手）から release より遠い小隊が、いちばん遅い小隊に歩みをそろえる。
 * 弓兵の小隊の guard 以内に敵の小隊が迫ったら、同じ中隊で構えている近接の小隊（歩兵・槍兵・騎兵）のうち一番近い小隊が迎え撃つ。
 * 中隊のどの2小隊も、隊長どうしが「中隊の隊形での持ち場どうしの距離 + leash」より離れる向きには動けない（先へ進もうとする小隊は遅れた小隊を待つ）。
 * 攻撃している小隊は、中隊の中心から「離れてよい距離 + chase」より遠い相手を追わない（中隊の近くの敵へ狙いを替え、いなければその場で構える）。
 */
export const COMPANY = { releaseMove: 40, releaseAttack: 130, guard: 75, leash: 45, chase: 60 }
export const SUPPORT_RANGE = 55
export const SUPPLY_DURATION = 4
/** 補給部隊が自陣へ戻らずに補給できる回数（1回で1部隊を満タンにする）。 */
export const SUPPLY_CHARGES = 4

// ---- 部隊の体力 ----
export const STAMINA = {
    max: 100,
    /** 部隊全員が動き続けたときに1秒で減る量（騎兵は多め）。動いている兵の割合に比例する。 */
    moveCost: .6,
    cavalryMoveCost: .8,
    /** 兵1人が1回攻撃するごとに減る量（弓兵は1射ごと）。 */
    attackCost: .02,
    shotCost: .015,
    /** これを下回ると移動・攻撃が鈍り、0で半分になる。 */
    tiredBelow: 40,
    minFactor: .5,
    /** これ以下になると、部隊ごと自陣へ補給に戻る。 */
    returnBelow: 10,
    /** 自陣で1秒に回復する量。 */
    fortRecovery: 12,
}
/** 自陣での補給の速さ（1人が1秒に受け取る矢）と、補給を受けられる砦の中心からの距離（門の前の陣地まで含む）。 */
export const FORT_REFILL_RATE = 10
export const FORT_REFILL_RANGE = 170

// ---- 工兵の建設物 ----
/**
 * work: 完成までの作業量（工兵1人が1秒で1。橋は床1マスあたり）。hp: 完成時の耐久。
 * 拠点は砦（12×16マス）より小さい7×7マスの柵の陣地で、四方に門がある。
 */
export const CONSTRUCTION: Record<ConstructionKind, { name: string; work: number; hp: number }> = {
    outpost: { name: '拠点', work: 3600, hp: 5000 },
    barricade: { name: 'バリケード', work: 300, hp: 1500 },
    bridge: { name: '橋', work: 180, hp: 2500 },
}
export const OUTPOST_SIZE = 7
export const BARRICADE_LENGTH = 5
/** 架けられる橋の長さ（水のマス数）の上限。橋の幅は2マス。 */
export const BRIDGE_MAX_LENGTH = 9
/** 工兵が作業地点からこの距離内にいれば作業する。修理は1人1秒あたりこの耐久を戻す。 */
export const BUILD_REACH = 5
export const REPAIR_RATE = 1.5
/** 建設物への攻撃の倍率（木の柵は斬っても崩れにくい）。工兵は壊すのが得意。 */
export const CONSTRUCTION_DAMAGE = { melee: .5, arrow: .2, engineer: 3 }
/** 柵に阻まれた兵が、この距離内の敵の柵を自分から壊しにかかる。 */
export const CONSTRUCTION_AUTO_ATTACK = 26
/** 拠点で補給を受けられる、拠点の中心からの距離。 */
export const OUTPOST_REFILL_RANGE = 58

export const FORT_HP = 6000
/** 陣の周り: この内側に入った敵兵を侵入者として迎え撃ち、敵はここに建設できない。城は城壁の外まで含む。 */
export const fortVicinityOf = (kind: FortKind) => kind === 'castle' ? 300 : 190
/** 本陣を攻撃できる距離。 */
export const FORT_ASSAULT_RANGE = 30
export const TOWER = { range: 130, cooldown: 1.3, damage: 13 }

/** 騎兵の突撃: この秒数以上走ってから接敵すると初撃が強化される。 */
export const CHARGE_RUN_TIME = 1.2
export const CHARGE_MULTIPLIER = 2.6
/** 1ティックあたりのA*探索回数の上限（フレーム負荷の平準化）。 */
export const PATH_BUDGET_PER_TICK = 6
export const CORPSE_SECONDS = 7
/** 行軍の横幅（片側、px）と、敵本陣の手前で門へ収束し始める距離。 */
export const LANE_HALF_WIDTH = 170
export const LANE_CONVERGE_DISTANCE = 260
/** 経路追従で目指す、経路上の先読み距離（px）。 */
export const PATH_LOOKAHEAD = 20
/** 矢の水平方向の速さ（px/秒）。 */
export const ARROW_SPEED = 150
/**
 * 兵を狙った矢の狙い。spread: 散らばり（距離に対する割合）で、着弾点は狙った位置から縦横それぞれ ±距離×spread/2 の範囲に散る。
 * 近い敵にはまず当たり、射程の端（約±7px）では外れやすい。狙った兵を外れた矢は、着弾点から strayRadius px 以内の別の敵に strayDamage の割合で当たる。
 */
export const ARROW_AIM = { spread: .12, strayRadius: 2, strayDamage: .5 }
/** 歩兵と槍兵の盾: 向いている方向から左右 arc ラジアン以内で飛んできた矢のダメージを damageTaken 倍にする。側面・背面は守れない。 */
export const SHIELD = { damageTaken: .6, arc: 1.2 }
/** 放物線の頂点の高さ = 基本 + 距離 × 係数（係数0.25で約45度の打ち上げ）。 */
export const ARROW_ARC = { base: 3, perDistance: .22 }
/**
 * 木による遮蔽。狙った兵の足元から射手の方へ depth px までの木のマスごとに、矢がこの確率で木に阻まれる（重なると掛け合わさる）。
 * 例: 密林の中の兵（足元と手前2マスが密林）なら約9割が当たらない。
 */
export const ARROW_COVER = { sparse: .3, dense: .5, depth: 32 }
/** 外れた矢が地面に残る秒数と、残す本数の上限。 */
export const SPENT_ARROW_SECONDS = 2.5
export const SPENT_ARROW_LIMIT = 800
/** 実時間1秒 = ゲーム内30分（no-life-kingと同じ）。 */
export const DAY_MINUTES_PER_SECOND = 30
