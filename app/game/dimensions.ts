/**
 * ゲームの長さの基準。ゲームの座標（px）で 1m がいくつかを決め、兵・マス・建物・戦場の寸法はここからメートルで導く。
 * 1マス（TILE_PX）がちょうど 4m になるよう、1m = 4px とする。
 */
export const METER = 4

/** メートル → ゲームの px。 */
export const m = (meters: number) => meters * METER

/**
 * 実際の寸法（メートル）。ゲームの値はこれを m() で px に直して使う。
 * 兵の大きさから、建物・戦場まで同じ物差しで決める。
 */
export const DIMENSIONS = {
    /** 1マスの一辺。 */
    tile: 4,
    /** 種族ごとの背丈（兜・頭の頂まで）。騎兵は乗り手の頭の高さ。 */
    height: {
        human: 1.75,
        humanRider: 2.4,
        orc: 1.85,
        goblin: 1.5,
        wolfRider: 2.1,
    },
    /** 戦場（両軍の砦を東西の端に置く範囲）の一辺と、その外で部隊が動ける幅。 */
    battlefield: 1050,
    /** 攻防戦で、両軍の陣地の中心どうしの距離。 */
    campDistance: 700,
    /** 開戦時に、陣を砦の正門の柵からこれだけ前に敷く。 */
    gateDeploy: 80,
    /** 攻城戦・防衛戦で、攻め手が布陣する城の正門の柵からの距離と、野営地（退却・補給の先）の陣からの後退距離。 */
    siegeDeploy: 400,
    siegeCampBack: 60,
    playableMargin: 180,
    /** 部隊が動ける範囲の外に、遠景の地形を続ける幅。 */
    landscapeMargin: 266,
    /** 陣地: 柵の丸太の高さ、物見櫓・正門の櫓の見張り台の高さ。 */
    camp: { palisade: 3.6, tower: 6.5, gateTower: 7.5 },
    /** 城の家の1階分の高さ。城の設計図の縮尺はこれから決める。 */
    castleStorey: 3.1,
} as const
