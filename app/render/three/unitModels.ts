import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Army, UnitType } from '../../types/game'
import { FACTION } from './models'

/**
 * 数千体を描くため、兵士は部位ごとの結合ジオメトリ（頂点カラー）をInstancedMeshで描画する。
 * 部位はピボット（関節位置）からの相対座標で作り、脚・武器・騎獣の脚を個別に動かす。
 * 寸法はno-life-kingの兵士（身長約16）基準で作り、描画時に縮小する。
 */
export type PartRole = 'body' | 'legL' | 'legR' | 'weapon' | 'nock' | 'mountFront' | 'mountBack'

export interface UnitPart {
    role: PartRole
    pivot: THREE.Vector3
    geometry: THREE.BufferGeometry
}

export interface UnitModel {
    parts: UnitPart[]
    /** 描画時の縮尺。 */
    scale: number
}

type Vec = [number, number, number]

const BOX = new THREE.BoxGeometry(1, 1, 1)
const SPHERE = new THREE.SphereGeometry(1, 9, 6)
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 8)
const TAPER = new THREE.CylinderGeometry(.6, 1, 1, 8)
const CONE = new THREE.ConeGeometry(1, 1, 8)
/**
 * 弓の弧。腕のローカル座標では -Y が腕の先（構えると前方）、+Z が上になるので、
 * 弓の両端を ±Z に、膨らみを -Y（前方）に向ける。
 */
const BOW = new THREE.TorusGeometry(1, .05, 4, 14, Math.PI)
BOW.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, -.35, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1))
const color = new THREE.Color()
const matrix = new THREE.Matrix4()
const euler = new THREE.Euler()
const quaternion = new THREE.Quaternion()

/** 頂点カラー付きのプリミティブを1つのジオメトリに結合する。 */
function assemble(build: (add: (shape: THREE.BufferGeometry, hex: number, p: Vec, s: Vec, r?: Vec) => void) => void) {
    const pieces: THREE.BufferGeometry[] = []
    build((shape, hex, p, s, r = [0, 0, 0]) => {
        const g = shape.index ? shape.toNonIndexed() : shape.clone()
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
        matrix.compose(new THREE.Vector3(...p), quaternion.setFromEuler(euler.set(...r)), new THREE.Vector3(...s))
        g.applyMatrix4(matrix)
        color.setHex(hex).convertSRGBToLinear()
        const colors = new Float32Array(g.getAttribute('position').count * 3)
        for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        pieces.push(g)
    })
    const merged = mergeGeometries(pieces)!
    pieces.forEach(p => p.dispose())
    return merged
}

const part = (role: PartRole, pivot: Vec, geometry: THREE.BufferGeometry): UnitPart => ({ role, pivot: new THREE.Vector3(...pivot), geometry })

// ---- 人間軍 ----
const SKIN = 0xd8a986, STEEL = 0xa9b4ba, IRON = 0x6f777b, LEATHER = 0x6e4c32, DARK = 0x2a2a2c, WOOD = 0x8a6a48

function humanLegs(trousers: number, greave: number) {
    return [-1, 1].map(sign => part(sign < 0 ? 'legL' : 'legR', [sign * 1.12, 7.8, 0], assemble(add => {
        add(CYLINDER, trousers, [0, -1.7, 0], [.72, 3.5, .78])
        add(SPHERE, greave, [0, -3.4, .3], [.85, .8, .8])
        add(TAPER, greave, [0, -5.1, 0], [.66, 3.1, .72])
        add(BOX, DARK, [0, -7.05, .5], [1.4, 1.1, 2.5])
    })))
}

function humanHead(add: Parameters<Parameters<typeof assemble>[0]>[0], helmet: number | null, hood: number | null) {
    add(CYLINDER, SKIN, [0, 13.6, 0], [.55, 1.3, .55])
    add(SPHERE, SKIN, [0, 15.1, .12], [1.28, 1.65, 1.2])
    for (const x of [-.5, .5]) add(SPHERE, 0x2b3640, [x, 15.3, 1.22], [.16, .16, .08])
    add(SPHERE, 0xc89676, [0, 14.85, 1.3], [.24, .36, .3])
    if (helmet !== null) {
        add(SPHERE, helmet, [0, 16, -.1], [1.45, 1.15, 1.38])
        add(CYLINDER, helmet, [0, 15.75, -.1], [1.7, .22, 1.62])
        add(BOX, helmet, [0, 15.3, 1.32], [.24, 1.6, .3])
    }
    if (hood !== null) {
        add(SPHERE, hood, [0, 15.6, -.25], [1.55, 1.85, 1.5])
        add(CONE, hood, [0, 15.6, -1.75], [.9, 1.6, .9], [-1.9, 0, 0])
    }
}

function humanInfantry(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, STEEL, [0, 10.5, 0], [2.35, 3, 1.4])
        add(BOX, faction, [0, 9.4, 1.18], [3.1, 4.6, .35])
        add(BOX, faction, [0, 9.2, -1.2], [3.1, 4.4, .3])
        add(BOX, LEATHER, [0, 8.1, 0], [4.3, .65, 2.7])
        humanHead(add, STEEL, null)
        for (const side of [-1, 1]) add(SPHERE, STEEL, [side * 2.1, 12.3, 0], [1.15, .75, 1.45])
        add(CYLINDER, STEEL, [-2.9, 10.1, .3], [.6, 3, .6])
        // 凧型の盾（所属色）
        add(SPHERE, IRON, [-3.3, 8.6, 1.4], [2, 2.9, .4])
        add(SPHERE, faction, [-3.3, 8.6, 1.62], [1.75, 2.6, .25])
        add(SPHERE, 0xd8c27a, [-3.3, 8.8, 1.86], [.45, .45, .2])
    }))
    const weapon = part('weapon', [2.65, 12, 0], assemble(add => {
        add(CYLINDER, STEEL, [.25, -1.4, 0], [.55, 2.6, .55])
        add(CYLINDER, STEEL, [.4, -3.7, 1], [.5, 2.1, .5], [-.55, 0, 0])
        add(SPHERE, SKIN, [.4, -4.4, 1.6], [.55, .6, .55])
        add(BOX, LEATHER, [.4, -3.7, 2], [.45, 2, .45])
        add(BOX, 0xbfa463, [.4, -2.5, 2], [2.6, .35, .55])
        add(BOX, 0xd9e1e5, [.4, 1.5, 2], [.85, 7.5, .22])
        add(CONE, 0xd9e1e5, [.4, 5.7, 2], [.43, 1.2, .12])
    }))
    return { parts: [body, ...humanLegs(0x4d4038, STEEL), weapon], scale: .44 }
}

type Add = Parameters<Parameters<typeof assemble>[0]>[0]

/** 前へ構えた長槍（腕の付け根からのローカル座標、+Z が前）。握る腕と、柄・穂先・房。 */
function pike(add: Add, arm: number, hand: number, shaft: number, head: number, tassel: number) {
    add(CYLINDER, arm, [0, -1.5, .4], [.6, 2.8, .6], [.35, 0, 0])
    add(CYLINDER, arm, [0, -3.2, 1.8], [.5, 2.2, .5], [1.2, 0, 0])
    add(SPHERE, hand, [0, -3.5, 2.9], [.55, .6, .55])
    add(CYLINDER, shaft, [0, -3.5, 5], [.26, 24, .26], [Math.PI / 2, 0, 0])
    add(CONE, head, [0, -3.5, 18], [.5, 2.4, .5], [Math.PI / 2, 0, 0])
    add(BOX, tassel, [0, -3.5, 16.4], [.7, .7, .5])
}

/** 人間軍の槍兵: 重い鎧と大盾、前へ構えた長槍。 */
function humanPikeman(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, STEEL, [0, 10.5, 0], [2.4, 3, 1.45])
        add(BOX, faction, [0, 9.2, 1.2], [3.2, 4.8, .35])
        add(BOX, LEATHER, [0, 8.1, 0], [4.4, .65, 2.8])
        humanHead(add, STEEL, null)
        // 頬当てと兜の飾り
        for (const side of [-1, 1]) add(BOX, STEEL, [side * 1.2, 14.9, .6], [.25, 1.6, 1.2])
        add(BOX, faction, [0, 17.3, -.2], [.3, .8, 2.2])
        for (const side of [-1, 1]) add(SPHERE, STEEL, [side * 2.15, 12.3, 0], [1.25, .8, 1.5])
        add(CYLINDER, STEEL, [-2.9, 10.1, .5], [.6, 3, .6])
        // 体を隠す長方形の大盾（所属色）
        add(BOX, IRON, [-2.9, 8.8, 2], [3.6, 6.4, .45])
        add(BOX, faction, [-2.9, 8.8, 2.25], [3.1, 5.9, .12])
        add(BOX, 0xd8c27a, [-2.9, 8.8, 2.35], [.5, 5.9, .1])
    }))
    const weapon = part('weapon', [2.6, 12, 0], assemble(add => pike(add, STEEL, SKIN, WOOD, 0xd9e1e5, faction)))
    return { parts: [body, ...humanLegs(0x4d4038, STEEL), weapon], scale: .44 }
}

/** 引き絞った弓（握りは手の位置）。弦は弓の両端から引き手（肩の前）へV字に張る。 */
function bow(add: Add, wood: number, string: number, x: number, handY: number, half: number) {
    const depth = half * .35, center = handY + depth
    add(BOW, wood, [x, center, 0], [half, half, half])
    const drawY = handY + half * .85
    for (const side of [-1, 1]) {
        const dy = drawY - center, dz = -side * half
        const length = Math.hypot(dy, dz)
        add(CYLINDER, string, [x, (center + drawY) / 2, side * half / 2], [.04, length, .04], [Math.atan2(dz, dy), 0, 0])
    }
}

/** つがえた矢（弦の位置から握りの先まで、腕の先 = -Y 方向）。 */
function nockedArrow(shaft: number, head: number, fletch: number, x: number, handY: number, half: number) {
    const drawY = handY + half * .85, tipY = handY - 1.3
    return assemble(add => {
        add(CYLINDER, shaft, [x, (drawY + tipY) / 2, 0], [.09, drawY - tipY, .09])
        add(CONE, head, [x, tipY - .3, 0], [.18, .6, .18], [Math.PI, 0, 0])
        add(BOX, fletch, [x, drawY - .45, 0], [.03, .7, .45])
        add(BOX, fletch, [x, drawY - .45, 0], [.45, .7, .03])
    })
}

function humanArcher(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, 0x80603f, [0, 10.4, 0], [2.15, 2.9, 1.3])
        add(BOX, faction, [0, 9.4, 1.08], [2.8, 3.6, .3])
        add(BOX, LEATHER, [0, 8.1, 0], [4, .6, 2.5])
        humanHead(add, null, faction)
        add(BOX, faction, [0, 10.5, -1.35], [3.2, 5.5, .25], [.12, 0, 0])
        // 矢筒
        add(CYLINDER, LEATHER, [1, 11.6, -1.7], [.65, 4.2, .65], [.25, 0, -.35])
        for (const dx of [-.2, .2]) add(CYLINDER, 0xe8e2d0, [1.6 + dx, 14, -2.2], [.08, 1.4, .08], [.25, 0, -.35])
        add(CYLINDER, 0x80603f, [2.7, 10.4, .2], [.55, 3, .55], [0, 0, .15])
    }))
    // 左腕と弓。射撃時に腕を前へ上げ、遠い相手ほど上に向ける。
    const weapon = part('weapon', [-2.5, 12, 0], assemble(add => {
        add(CYLINDER, 0x80603f, [-.1, -1.6, 0], [.55, 3.2, .55])
        add(SPHERE, SKIN, [-.1, -3.4, 0], [.55, .6, .55])
        bow(add, WOOD, 0xe8e2d0, -.1, -3.4, 3.4)
    }))
    const nock = part('nock', [-2.5, 12, 0], nockedArrow(0xd8c39a, 0x9aa3a8, 0xf2f0ea, -.1, -3.4, 3.4))
    return { parts: [body, ...humanLegs(0x5b5037, LEATHER), weapon, nock], scale: .43 }
}

function horse(add: Parameters<Parameters<typeof assemble>[0]>[0], coat: number, caparison: number) {
    add(SPHERE, coat, [0, 10, 0], [2.6, 2.7, 5.6])
    add(CYLINDER, coat, [0, 13.2, 4.8], [1.15, 4.6, 1.45], [.65, 0, 0])
    add(BOX, coat, [0, 15.4, 7.1], [1.25, 1.5, 3.3], [.35, 0, 0])
    for (const x of [-.45, .45]) add(CONE, coat, [x, 16.6, 6], [.25, .9, .25])
    add(BOX, DARK, [0, 14, 4.2], [.4, 4.2, 1.2], [.65, 0, 0])
    add(CYLINDER, DARK, [0, 9.6, -6.1], [.4, 4.6, .4], [-.55, 0, 0])
    // 馬鎧の布（所属色）と鞍
    add(BOX, caparison, [0, 9.2, 0], [5.6, 3.4, 9.2])
    add(BOX, LEATHER, [0, 12.75, -.4], [2.6, .6, 2.8])
}

function mountLegs(coat: number, hoof: number, height: number, spread: number) {
    return assemble(add => {
        for (const x of [-spread, spread]) {
            add(TAPER, coat, [x, -height / 2, 0], [.62, height, .7], [0, 0, Math.PI])
            add(CYLINDER, hoof, [x, -height + .3, .1], [.62, .6, .7])
        }
    })
}

function rider(add: Parameters<Parameters<typeof assemble>[0]>[0], torso: number, faction: number, helmet: number) {
    add(SPHERE, torso, [0, 15.6, 0], [2.2, 2.8, 1.35])
    add(BOX, faction, [0, 14.6, 1.1], [2.9, 3.6, .3])
    for (const side of [-1, 1]) {
        add(CYLINDER, 0x4d4038, [side * 2.4, 12.8, .9], [.7, 3.4, .75], [1.1, 0, side * .25])
        add(BOX, DARK, [side * 2.9, 10.6, 2.1], [1, 2.4, 1.4])
        add(SPHERE, torso, [side * 2, 17.4, 0], [1.05, .7, 1.3])
    }
    add(CYLINDER, SKIN, [0, 18.6, 0], [.55, 1.2, .55])
    add(SPHERE, SKIN, [0, 20, .12], [1.25, 1.6, 1.2])
    add(SPHERE, helmet, [0, 20.9, -.1], [1.42, 1.1, 1.36])
    add(CONE, faction, [0, 22.5, -.1], [.3, 1.4, .3])
    add(CYLINDER, torso, [-2.6, 15.6, .6], [.55, 3, .55], [.5, 0, 0])
}

function humanCavalry(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        horse(add, 0x6b4a32, faction)
        rider(add, STEEL, faction, STEEL)
    }))
    const weapon = part('weapon', [2.5, 17.2, 0], assemble(add => {
        add(CYLINDER, STEEL, [0, -1.3, .6], [.55, 2.6, .55], [.5, 0, 0])
        add(CYLINDER, WOOD, [0, -1.8, 5], [.28, 20, .28], [Math.PI / 2 - .12, 0, 0])
        add(CONE, 0xd9e1e5, [0, -.6, 15.6], [.45, 2, .45], [Math.PI / 2 - .12, 0, 0])
        add(BOX, faction, [0, -.2, 12.2], [.08, 1.3, 2.4])
    }))
    return {
        parts: [body, part('mountFront', [0, 8.2, 3.8], mountLegs(0x6b4a32, DARK, 8.2, 1.4)),
            part('mountBack', [0, 8.2, -3.9], mountLegs(0x6b4a32, DARK, 8.2, 1.4)), weapon],
        scale: .44,
    }
}

// ---- モンスター軍 ----
const ORC = 0x6c8a44, GOBLIN = 0x8b9c4c, BONE = 0xe8dfc6, EYE = 0xff3a1c, RUST = 0x5a4a40

function orcHead(add: Parameters<Parameters<typeof assemble>[0]>[0], skin: number, y: number, ears: number) {
    add(SPHERE, skin, [0, y, .3], [1.5, 1.45, 1.5])
    add(BOX, skin, [0, y - .9, .9], [1.9, .9, 1.4])
    for (const x of [-.55, .55]) {
        add(SPHERE, EYE, [x, y + .25, 1.55], [.22, .18, .12])
        add(CONE, BONE, [x, y - .7, 1.75], [.18, .8, .18])
        add(CONE, skin, [x * 2.8, y + .3, 0], [.35, ears, .35], [0, 0, -Math.sign(x) * 1.25])
    }
    add(BOX, 0x262622, [0, y + .75, 1.2], [1.9, .3, .4])
}

function monsterLegs(skin: number, wrap: number, scale = 1) {
    return [-1, 1].map(sign => part(sign < 0 ? 'legL' : 'legR', [sign * 1.3 * scale, 7.6 * scale, 0], assemble(add => {
        add(CYLINDER, skin, [0, -1.6 * scale, 0], [.85 * scale, 3.4 * scale, .9 * scale])
        add(CYLINDER, wrap, [0, -4.6 * scale, 0], [.75 * scale, 2.6 * scale, .8 * scale])
        add(BOX, skin, [0, -6.85 * scale, .5 * scale], [1.6 * scale, 1 * scale, 2.6 * scale])
    })))
}

function orcInfantry(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, ORC, [0, 10.6, 0], [2.9, 3.2, 1.9])
        add(BOX, RUST, [0, 11, 1.25], [3.6, 3, .5])
        add(BOX, faction, [0, 7.4, 1.05], [3, 2.6, .35])
        add(BOX, faction, [0, 7.4, -1.05], [3, 2.6, .35])
        add(BOX, LEATHER, [0, 8.4, 0], [5, .8, 3.3])
        orcHead(add, ORC, 14.6, 1.1)
        // 棘付きの肩当て
        add(SPHERE, RUST, [-2.5, 12.6, 0], [1.4, .9, 1.6])
        for (const z of [-.6, .6]) add(CONE, BONE, [-2.8, 13.7, z], [.25, 1, .25])
        add(SPHERE, ORC, [2.4, 12.4, 0], [1.1, .9, 1.3])
        add(CYLINDER, ORC, [-3.2, 10.1, .3], [.8, 3, .8])
        // 丸い木盾（所属色の塗り）
        add(CYLINDER, WOOD, [-3.6, 9, 1.4], [2.6, .45, 2.6], [Math.PI / 2, 0, 0])
        add(CYLINDER, faction, [-3.6, 9, 1.68], [1.8, .1, 1.8], [Math.PI / 2, 0, 0])
        add(SPHERE, IRON, [-3.6, 9, 1.8], [.5, .5, .3])
    }))
    const weapon = part('weapon', [2.9, 12, 0], assemble(add => {
        add(CYLINDER, ORC, [.3, -1.5, 0], [.75, 2.8, .75])
        add(CYLINDER, ORC, [.4, -3.8, 1], [.65, 2.1, .65], [-.55, 0, 0])
        add(SPHERE, ORC, [.4, -4.5, 1.6], [.7, .7, .7])
        add(CYLINDER, WOOD, [.4, -1, 2], [.3, 7, .3])
        add(BOX, IRON, [.4, 1.6, 3], [.4, 3, 2.2])
        add(BOX, 0xb9bcb8, [.4, 1.6, 4.1], [.3, 3.2, .3])
    }))
    return { parts: [body, ...monsterLegs(ORC, LEATHER), weapon], scale: .46 }
}

/** モンスター軍の槍兵: 骨の穂先の長槍と、厚板の大盾を持つオーク。 */
function orcPikeman(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, ORC, [0, 10.6, 0], [2.9, 3.2, 1.9])
        add(BOX, RUST, [0, 11, 1.25], [3.8, 3.4, .55])
        add(BOX, faction, [0, 7.4, 1.05], [3, 2.6, .35])
        add(BOX, LEATHER, [0, 8.4, 0], [5, .8, 3.3])
        orcHead(add, ORC, 14.6, 1.1)
        add(SPHERE, RUST, [0, 15.6, 0], [1.6, .9, 1.6])
        for (const side of [-1, 1]) add(SPHERE, RUST, [side * 2.5, 12.6, 0], [1.4, .9, 1.6])
        add(CYLINDER, ORC, [-3.2, 10.1, .5], [.8, 3, .8])
        // 板を打ち付けた大盾（所属色の塗り）
        add(BOX, WOOD, [-3.2, 9, 2.2], [4, 6.6, .55])
        add(BOX, faction, [-3.2, 9, 2.52], [3.2, 2, .12])
        for (const y of [6.6, 11.4]) add(BOX, IRON, [-3.2, y, 2.55], [4.1, .4, .15])
    }))
    const weapon = part('weapon', [2.9, 12, 0], assemble(add => pike(add, ORC, ORC, 0x5d4a35, BONE, faction)))
    return { parts: [body, ...monsterLegs(ORC, LEATHER), weapon], scale: .46 }
}

function goblinArcher(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, GOBLIN, [0, 10.2, 0], [2, 2.7, 1.3])
        add(BOX, 0x5d4a35, [0, 10, 1], [2.6, 3.2, .35])
        add(BOX, faction, [0, 7.6, .9], [2.4, 2.2, .3])
        add(BOX, LEATHER, [0, 8.3, 0], [3.8, .6, 2.4])
        orcHead(add, GOBLIN, 14.2, 2.4)
        add(SPHERE, faction, [0, 15, -.5], [1.6, 1.4, 1.4])
        add(CYLINDER, LEATHER, [1, 11.2, -1.6], [.6, 4, .6], [.25, 0, -.35])
        for (const dx of [-.2, .2]) add(CYLINDER, BONE, [1.6 + dx, 13.6, -2.1], [.08, 1.4, .08], [.25, 0, -.35])
        add(CYLINDER, GOBLIN, [2.5, 10.2, .2], [.5, 2.8, .5], [0, 0, .15])
    }))
    const weapon = part('weapon', [-2.3, 11.6, 0], assemble(add => {
        add(CYLINDER, GOBLIN, [-.1, -1.5, 0], [.5, 3, .5])
        add(SPHERE, GOBLIN, [-.1, -3.2, 0], [.5, .55, .5])
        bow(add, 0x4b3a2a, BONE, -.1, -3.2, 3.1)
    }))
    const nock = part('nock', [-2.3, 11.6, 0], nockedArrow(0x6b5a44, 0x6f6a5e, 0x9c2f22, -.1, -3.2, 3.1))
    return { parts: [body, ...monsterLegs(GOBLIN, 0x5d4a35, .95), weapon, nock], scale: .4 }
}

function wolfRider(faction: number): UnitModel {
    const fur = 0x4f4b47
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, fur, [0, 8.6, 0], [2.6, 2.6, 5.4])
        add(SPHERE, 0x625d57, [0, 9.4, 3.6], [2.5, 2.6, 2.6])
        add(SPHERE, fur, [0, 10.6, 6.6], [1.7, 1.6, 2.1])
        add(BOX, fur, [0, 10, 8.7], [1.1, 1, 2.2])
        add(BOX, DARK, [0, 10.1, 9.8], [.6, .5, .3])
        for (const x of [-.6, .6]) {
            add(SPHERE, EYE, [x, 11.2, 8], [.2, .16, .12])
            add(CONE, fur, [x, 12.4, 6.2], [.4, 1.3, .4])
            add(CONE, BONE, [x * .7, 9.3, 9.4], [.12, .5, .12], [Math.PI, 0, 0])
        }
        add(CONE, fur, [0, 9.4, -6.6], [.8, 4.4, .8], [-2, 0, 0])
        add(BOX, faction, [0, 11, -.3], [5.2, .5, 4])
        add(BOX, BONE, [0, 11.3, -.3], [2.4, .6, 2.6])
        // 騎乗するオーク
        add(SPHERE, ORC, [0, 14.6, 0], [2.3, 2.7, 1.5])
        add(BOX, RUST, [0, 14.8, 1.05], [2.8, 2.4, .4])
        for (const side of [-1, 1]) {
            add(CYLINDER, ORC, [side * 2.4, 11.8, .9], [.8, 3.2, .85], [1.1, 0, side * .25])
            add(BOX, ORC, [side * 2.9, 9.8, 2], [1.1, 2.2, 1.4])
            add(SPHERE, RUST, [side * 2.1, 16.4, 0], [1.1, .75, 1.3])
        }
        orcHead(add, ORC, 18.6, 1.1)
        add(CYLINDER, ORC, [-2.7, 14.6, .6], [.65, 3, .65], [.5, 0, 0])
    }))
    const weapon = part('weapon', [2.6, 16.2, 0], assemble(add => {
        add(CYLINDER, ORC, [0, -1.3, .6], [.65, 2.6, .65], [.5, 0, 0])
        add(CYLINDER, WOOD, [0, -1.8, 4], [.3, 16, .3], [Math.PI / 2 - .15, 0, 0])
        add(CONE, BONE, [0, -.8, 12.4], [.5, 2.2, .5], [Math.PI / 2 - .15, 0, 0])
        add(BOX, faction, [0, -.6, 9.5], [.08, 1.2, 2])
    }))
    return {
        parts: [body, part('mountFront', [0, 7, 3.6], mountLegs(fur, DARK, 7, 1.3)),
            part('mountBack', [0, 7, -3.6], mountLegs(fur, DARK, 7, 1.4)), weapon],
        scale: .44,
    }
}

/** 背中の矢の束（補給兵の荷）。 */
function arrowBundles(add: Add, shaft: number, fletch: number, y: number, z: number) {
    for (const [dx, dz] of [[-.8, 0], [0, -.35], [.8, 0], [-.4, .3], [.4, .3]] as const) {
        add(CYLINDER, shaft, [dx, y + 2, z + dz], [.08, 4, .08], [.08, 0, dx * .08])
        add(BOX, fletch, [dx, y + 3.9, z + dz], [.3, .6, .3])
    }
    add(BOX, LEATHER, [0, y + 1.2, z], [2.6, .35, 1.2])
}

function humanPorter(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, faction, [0, 10.3, 0], [2.2, 2.8, 1.35])
        add(BOX, LEATHER, [0, 10.4, 1.05], [2.4, 3.4, .3])
        add(BOX, LEATHER, [0, 8.1, 0], [4.1, .6, 2.6])
        humanHead(add, null, null)
        // つば付きの布帽子
        add(SPHERE, 0x8a7656, [0, 16.1, 0], [1.4, .8, 1.35])
        add(CYLINDER, 0x8a7656, [0, 15.8, 0], [1.9, .15, 1.9])
        // 背負子と矢の束
        add(BOX, WOOD, [0, 10.6, -1.75], [3.2, 5.2, .5])
        add(BOX, WOOD, [0, 8.2, -2.4], [3.2, .4, 1.4])
        arrowBundles(add, 0xd8c39a, 0xf2f0ea, 8.4, -2.4)
        for (const side of [-1, 1]) add(CYLINDER, faction, [side * 2.5, 10.4, .2], [.55, 3, .55], [0, 0, side * -.12])
    }))
    const weapon = part('weapon', [2.6, 12, 0], assemble(add => {
        add(CYLINDER, faction, [.25, -1.4, 0], [.55, 2.6, .55])
        add(SPHERE, SKIN, [.4, -3, .4], [.5, .55, .5])
        add(CYLINDER, WOOD, [.4, -2.2, 1.6], [.28, 3.6, .28], [-.9, 0, 0])
    }))
    return { parts: [body, ...humanLegs(0x6b5a44, LEATHER), weapon], scale: .42 }
}

function goblinPorter(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, GOBLIN, [0, 10, 0], [2, 2.6, 1.3])
        add(BOX, faction, [0, 7.6, .9], [2.4, 2.2, .3])
        add(BOX, LEATHER, [0, 8.3, 0], [3.8, .6, 2.4])
        orcHead(add, GOBLIN, 14, 2.4)
        // 大きな袋と、はみ出した矢
        add(SPHERE, 0x7d6748, [0, 11.2, -2.6], [2.4, 2.8, 1.9])
        add(BOX, 0x4b3a2a, [0, 13.6, -2.6], [1.2, .5, 1.2])
        arrowBundles(add, 0x6b5a44, 0x9c2f22, 11.6, -2.4)
        for (const side of [-1, 1]) add(CYLINDER, GOBLIN, [side * 2.2, 11.6, -.8], [.5, 3, .5], [.9, 0, side * -.3])
    }))
    const weapon = part('weapon', [2.4, 11.6, 0], assemble(add => {
        add(CYLINDER, GOBLIN, [.2, -1.4, 0], [.5, 2.6, .5])
        add(SPHERE, GOBLIN, [.3, -2.9, .4], [.5, .5, .5])
        add(CYLINDER, BONE, [.3, -2.2, 1.4], [.25, 3, .25], [-.9, 0, 0])
    }))
    return { parts: [body, ...monsterLegs(GOBLIN, 0x5d4a35, .95), weapon], scale: .38 }
}

/** 背負った丸太と杭の束（工兵の荷）。 */
function timberLoad(add: Add, wood: number, rope: number, y: number, z: number) {
    for (const [dx, dy] of [[-.7, 0], [.7, 0], [0, .9]] as const) add(CYLINDER, wood, [dx, y + dy, z], [.55, 6.4, .55], [0, 0, Math.PI / 2 - .12])
    for (const x of [-1.6, 1.6]) add(BOX, rope, [x, y + .4, z], [.25, 2.2, 1.5])
}

/** 人間軍の工兵: 革の前掛けと鉄兜、背に丸太、手に大槌。 */
function humanEngineer(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, 0x7b6a52, [0, 10.4, 0], [2.25, 2.9, 1.4])
        add(BOX, LEATHER, [0, 9.2, 1.1], [3, 4.4, .3])
        add(BOX, faction, [0, 11.6, 1.2], [3.1, 1.2, .25])
        add(BOX, LEATHER, [0, 8.1, 0], [4.3, .65, 2.7])
        humanHead(add, IRON, null)
        // 背負子と丸太
        add(BOX, WOOD, [0, 10.6, -1.7], [3, 4.8, .45])
        timberLoad(add, 0x9a7650, 0x5c4a36, 12.4, -2.4)
        add(CYLINDER, 0x7b6a52, [-2.7, 10.4, .2], [.6, 3, .6], [0, 0, -.15])
        // 腰の工具袋
        add(BOX, LEATHER, [-2, 7.8, .9], [1.2, 1.4, .8])
    }))
    const weapon = part('weapon', [2.65, 12, 0], assemble(add => {
        add(CYLINDER, 0x7b6a52, [.25, -1.4, 0], [.6, 2.6, .6])
        add(CYLINDER, 0x7b6a52, [.4, -3.7, 1], [.5, 2.1, .5], [-.55, 0, 0])
        add(SPHERE, SKIN, [.4, -4.4, 1.6], [.55, .6, .55])
        add(CYLINDER, WOOD, [.4, -1.2, 2], [.3, 8, .3])
        add(BOX, IRON, [.4, 2.8, 2], [1.1, 1.4, 2.8])
    }))
    return { parts: [body, ...humanLegs(0x4d4038, LEATHER), weapon], scale: .44 }
}

/** モンスター軍の工兵: 杭を背負ったオーク。手につるはし。 */
function orcEngineer(faction: number): UnitModel {
    const body = part('body', [0, 0, 0], assemble(add => {
        add(SPHERE, ORC, [0, 10.4, 0], [2.7, 3, 1.8])
        add(BOX, LEATHER, [0, 9.6, 1.2], [3.4, 3.6, .45])
        add(BOX, faction, [0, 7.4, 1.05], [3, 2.4, .35])
        add(BOX, LEATHER, [0, 8.4, 0], [4.8, .8, 3.2])
        orcHead(add, ORC, 14.4, 1.1)
        add(SPHERE, RUST, [0, 15.4, 0], [1.6, .9, 1.6])
        timberLoad(add, 0x5d4a35, BONE, 11.8, -2.4)
        add(CYLINDER, ORC, [-3, 10.1, .3], [.75, 3, .75], [0, 0, -.15])
    }))
    const weapon = part('weapon', [2.8, 12, 0], assemble(add => {
        add(CYLINDER, ORC, [.3, -1.5, 0], [.7, 2.8, .7])
        add(CYLINDER, ORC, [.4, -3.8, 1], [.6, 2.1, .6], [-.55, 0, 0])
        add(SPHERE, ORC, [.4, -4.5, 1.6], [.65, .65, .65])
        add(CYLINDER, WOOD, [.4, -1.2, 2], [.3, 8, .3])
        add(CONE, IRON, [.4, 2.6, 3.3], [.45, 3, .45], [Math.PI / 2 + .3, 0, 0])
        add(CONE, IRON, [.4, 2.6, .7], [.45, 2.2, .45], [-Math.PI / 2 - .3, 0, 0])
    }))
    return { parts: [body, ...monsterLegs(ORC, LEATHER), weapon], scale: .45 }
}

export function createUnitModels(): Record<Army, Record<UnitType, UnitModel>> {
    return {
        player: { infantry: humanInfantry(FACTION.player), pikeman: humanPikeman(FACTION.player), archer: humanArcher(FACTION.player), cavalry: humanCavalry(FACTION.player), supply: humanPorter(FACTION.player), engineer: humanEngineer(FACTION.player) },
        cpu: { infantry: orcInfantry(FACTION.cpu), pikeman: orcPikeman(FACTION.cpu), archer: goblinArcher(FACTION.cpu), cavalry: wolfRider(FACTION.cpu), supply: goblinPorter(FACTION.cpu), engineer: orcEngineer(FACTION.cpu) },
    }
}

/**
 * 隊長が背負う幟（兵と同じ縮尺のモデル座標、原点は背中の竿の付け根）。
 * 縦長の布を竿と上の横木に張り、所属色の地に明るい帯と紋を入れる。遠目でも部隊の要とわかるよう兵の倍ほどの高さにする。
 */
export function createBannerGeometry(faction: number) {
    return assemble(add => {
        add(CYLINDER, 0x4a3524, [0, 15, 0], [.3, 30, .3])
        add(CONE, 0xd8c27a, [0, 30.8, 0], [.45, 1.6, .45])
        add(CYLINDER, 0x4a3524, [3.1, 29.2, 0], [.18, 6.4, .18], [0, 0, Math.PI / 2])
        add(BOX, faction, [3.2, 20.6, 0], [5.6, 16.4, .14])
        add(BOX, 0xf1e4be, [3.2, 27.9, .02], [5.7, 1.6, .18])
        add(SPHERE, 0xf1e4be, [3.2, 21.5, 0], [1.6, 1.6, .2])
        add(SPHERE, faction, [3.2, 21.5, 0], [.9, .9, .26])
    })
}

/** 飛んでいる矢（+Z が矢じり）。遠目でも見えるよう実寸より太く明るくする。 */
export function createArrowGeometry() {
    return assemble(add => {
        add(CYLINDER, 0xe2cfa3, [0, 0, 0], [.16, 4.6, .16], [Math.PI / 2, 0, 0])
        add(CONE, 0xb7c0c5, [0, 0, 2.6], [.3, .7, .3], [Math.PI / 2, 0, 0])
        add(BOX, 0xffffff, [0, 0, -1.95], [.05, .55, .9])
        add(BOX, 0xffffff, [0, 0, -1.95], [.55, .05, .9])
    })
}

/** 矢の後ろに伸びる軌跡（+Z の端が矢の位置）。 */
export function createArrowTrailGeometry() {
    const geometry = new THREE.BoxGeometry(.12, .12, 1)
    geometry.translate(0, 0, -.5)
    return geometry
}
