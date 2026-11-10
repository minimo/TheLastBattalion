import * as THREE from 'three'
import type { Army, UnitType } from '../../types/game'
import { FACTION } from './models'
import { createUnitAssetModel as asset, type UnitAsset } from './unitAsset'
import { DIMENSIONS } from '../../game/dimensions'
import humanInfantryAsset from './assets/humanInfantry.json'
import humanArcherAsset from './assets/humanArcher.json'
import humanPikemanAsset from './assets/humanPikeman.json'
import humanCavalryAsset from './assets/humanCavalry.json'
import humanPorterAsset from './assets/humanPorter.json'
import humanEngineerAsset from './assets/humanEngineer.json'
import orcInfantryAsset from './assets/orcInfantry.json'
import orcPikemanAsset from './assets/orcPikeman.json'
import orcEngineerAsset from './assets/orcEngineer.json'
import goblinArcherAsset from './assets/goblinArcher.json'
import goblinPorterAsset from './assets/goblinPorter.json'
import wolfRiderAsset from './assets/wolfRider.json'
import bannerAsset from './assets/banner.json'
import monsterBannerAsset from './assets/monsterBanner.json'
import arrowAsset from './assets/arrow.json'

/**
 * 数千体を描くため、兵士は部位ごとの結合ジオメトリ（頂点カラー）をInstancedMeshで描画する。
 * 部位はピボット（関節位置）からの相対座標で持ち、脚・武器・騎獣の脚を個別に動かす。
 * 形状はBlenderで作って assets/*.json に書き出す（docs/unit-textures.md）。寸法は身長約16で、描画時に縮小する。
 */
export type PartRole = 'body' | 'legL' | 'legR' | 'weapon' | 'carry' | 'nock' | 'mountFront' | 'mountBack'

export interface UnitPart {
    role: PartRole
    pivot: THREE.Vector3
    geometry: THREE.BufferGeometry
    /** 影を落とさない遠景の兵士に使う簡略形状。無い部位は遠景では描かない。 */
    farGeometry?: THREE.BufferGeometry
}

export interface UnitModel {
    parts: UnitPart[]
    /** 描画時の縮尺。 */
    scale: number
}

/** 兵の背丈（メートル、DIMENSIONS.height）。 */
const H = DIMENSIONS.height

/** 武器を持たない騎乗の兵（偵察兵）。騎兵のモデルから武器を外して使う。 */
const unarmed = (model: UnitModel): UnitModel => ({ ...model, parts: model.parts.filter(p => p.role !== 'weapon') })

export function createUnitModels(): Record<Army, Record<UnitType, UnitModel>> {
    return {
        player: {
            infantry: asset(humanInfantryAsset, 'human-infantry', FACTION.player, H.human),
            pikeman: asset(humanPikemanAsset, 'human-pikeman', FACTION.player, H.human),
            archer: asset(humanArcherAsset, 'human-archer', FACTION.player, H.human),
            cavalry: asset(humanCavalryAsset, 'human-cavalry', FACTION.player, H.humanRider),
            supply: asset(humanPorterAsset, 'human-porter', FACTION.player, H.human),
            engineer: asset(humanEngineerAsset, 'human-engineer', FACTION.player, H.human),
            scout: unarmed(asset(humanCavalryAsset, 'human-scout', FACTION.player, H.humanRider)),
        },
        cpu: {
            infantry: asset(orcInfantryAsset, 'orc-infantry', FACTION.cpu, H.orc),
            pikeman: asset(orcPikemanAsset, 'orc-pikeman', FACTION.cpu, H.orc),
            archer: asset(goblinArcherAsset, 'goblin-archer', FACTION.cpu, H.goblin),
            cavalry: asset(wolfRiderAsset, 'wolf-rider', FACTION.cpu, H.wolfRider),
            supply: asset(goblinPorterAsset, 'goblin-porter', FACTION.cpu, H.goblin),
            engineer: asset(orcEngineerAsset, 'orc-engineer', FACTION.cpu, H.orc),
            scout: unarmed(asset(wolfRiderAsset, 'wolf-scout', FACTION.cpu, H.wolfRider)),
        },
    }
}

const propGeometry = (data: UnitAsset, name: string) => asset(data, name, FACTION.player).parts[0]!.geometry

/** 隊長が背負う幟（兵と同じ縮尺のモデル座標、原点は竿の根元）。遠目でも部隊の要とわかるよう兵の倍ほどの高さにする。 */
export function createBannerGeometry() {
    return propGeometry(bannerAsset, 'banner')
}

/** モンスター軍の隊長が背負う幟（原点は竿の根元）。十字の槍に、下端の裂けた赤い布と紋章を吊るす。 */
export function createMonsterBannerGeometry() {
    return propGeometry(monsterBannerAsset, 'monster-banner')
}

/** 飛んでいる矢（+Z が矢じり）。遠目でも見えるよう実寸より太く明るくする。 */
export function createArrowGeometry() {
    return propGeometry(arrowAsset, 'arrow')
}

/** 矢の後ろに伸びる軌跡（+Z の端が矢の位置）。 */
export function createArrowTrailGeometry() {
    const geometry = new THREE.BoxGeometry(.12, .12, 1)
    geometry.translate(0, 0, -.5)
    return geometry
}
