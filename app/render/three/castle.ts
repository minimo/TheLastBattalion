import * as THREE from 'three'
import type { Fort } from '../../types/game'
import {
    CASTLE_DEPTH, CASTLE_GATE_HALF, CASTLE_RADII, CASTLE_SUMMIT, CASTLE_TOWER_ANGLES,
    CASTLE_WIDTH, castleCell, castleOutline, castlePoint, castleRadius, castleRise,
} from '../../game/castleLayout'
import { TILE_PX } from '../../game/constants'
import { FACTION, type ModelKit } from './models'

const CX = (CASTLE_DEPTH - 1) / 2
const CY = (CASTLE_WIDTH - 1) / 2
/** ローカルセル → 城のローカル座標（+X が前面、Z がセルの ly 方向）。 */
const toLocal = (lx: number, ly: number) => ({ x: (lx - CX) * TILE_PX, z: (ly - CY) * TILE_PX })
const surfaceAt = (x: number, z: number) => castleRise(x / TILE_PX + CX, z / TILE_PX + CY)
const radiusAt = (x: number, z: number) => castleRadius(x / TILE_PX + CX, z / TILE_PX + CY)
const deg = (d: number) => d * Math.PI / 180
/** 石積みの模様の大きさ（テクスチャ1枚がこの長さに収まる）。 */
const STONE_TILE = 18

/**
 * 岩山の城。岩山（地形）の裾を城壁と塔が一周して囲み、
 * 斜面には石造りの細長い家がスレート屋根を重ねて頂へ詰め上がる。頂には岩盤から立ち上がる巨大な本陣が建ち、
 * 高い棟と中央の塔、細い尖塔が全体の頂点になる。裏手の斜面には家並みと林、頂の裏手には
 * 斜面に張り出す高い棟と居館がそびえる。
 * 配置（城壁・家・道・本陣）はゲーム側の castleLayout と共有する。
 * 人間軍の城は灰色の花崗岩とスレート、モンスター軍の城は煤けた黒い石と錆色の屋根に骨の飾り。
 */
export function createCastle(fort: Fort, kit: ModelKit) {
    const { part, bake, cone, sphere, surfaces, material, cloth, curveCloth } = kit
    const human = fort.owner === 'player'
    const faction = FACTION[fort.owner]
    const group = new THREE.Group()
    group.name = `${fort.owner}-castle`
    const owned: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(item: T) => { owned.push(item); return item }
    let seed = human ? 17 : 43
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!

    // ---- 材質（花崗岩の濃淡、スレート、木組み、窓） ----
    const stoneOf = (color: number) => { const m = own(surfaces.stone.clone()); m.color.set(color); return m }
    const granite = stoneOf(human ? 0xa59f92 : 0x5b5650)
    const graniteDark = stoneOf(human ? 0x857f74 : 0x45413c)
    const graniteWarm = stoneOf(human ? 0xb0a796 : 0x645c53)
    const houseStones = (human ? [0xa29a8b, 0x958d80, 0xb2aa9b, 0x8a8478] : [0x5e574f, 0x524c46, 0x686058]).map(stoneOf)
    const slates = (human ? [0x3f444c, 0x4a4f58, 0x52575e] : [0x4b2b23, 0x5a3328, 0x3f2620]).map(material)
    const plaster = material(human ? 0xcfc4ad : 0x625a50)
    const beam = material(human ? 0x4a3a2d : 0x2a221e)
    const iron = kit.metal(0x46494c)
    const bone = material(0xe4dac0)
    const glass = own(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: .35, metalness: .2, emissive: human ? 0xffb560 : 0xff7a30, emissiveIntensity: 0 }))
    const voidMaterial = material(0x1b1a19)

    // 石の部材は大きさに合わせてUVを伸ばし、石積みの模様の大きさをそろえる。部材ごとの形は焼き込み後に破棄する。
    const temporary: THREE.BufferGeometry[] = []
    const temp = <T extends THREE.BufferGeometry>(geometry: T) => { temporary.push(geometry); return geometry }
    const stoneBox = (w: number, h: number, d: number) => {
        const geometry = temp(new THREE.BoxGeometry(w, h, d))
        const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
        const uv = geometry.getAttribute('uv')
        for (let i = 0; i < uv.count; i++) {
            const [u, v] = faces[Math.floor(i / 4)]!
            uv.setXY(i, uv.getX(i) * u! / STONE_TILE, uv.getY(i) * v! / STONE_TILE)
        }
        return geometry
    }
    const stoneCylinder = (bottom: number, h: number, top = bottom, sides = 20) => {
        const geometry = temp(new THREE.CylinderGeometry(top, bottom, h, sides, 1))
        const uv = geometry.getAttribute('uv')
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * bottom / STONE_TILE, uv.getY(i) * h / STONE_TILE)
        return geometry
    }
    /** 平面の多角形（x, z）を、bottom から top まで押し出した石の塊。 */
    const stoneSlab = (points: [number, number][], bottom: number, top: number) => {
        const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)))
        const geometry = temp(new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false }))
        geometry.rotateX(-Math.PI / 2)
        geometry.translate(0, bottom, 0)
        const uv = geometry.getAttribute('uv')
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / STONE_TILE, uv.getY(i) / STONE_TILE)
        return geometry
    }
    const gable = new THREE.Shape()
    gable.moveTo(-.5, 0); gable.lineTo(.5, 0); gable.lineTo(0, 1); gable.closePath()
    const prism = temp(new THREE.ExtrudeGeometry(gable, { depth: 1, bevelEnabled: false }))
    prism.translate(0, 0, -.5)
    const octaCone = temp(new THREE.ConeGeometry(1, 1, 8))
    const box = kit.box
    const statics = new THREE.Group()
    /** 一時グループに組み立て、位置・向きを焼き込んで静的な部材へ移す。 */
    const place = (x: number, y: number, z: number, rotation: number, build: (g: THREE.Group) => void) => {
        const holder = new THREE.Group()
        build(holder)
        holder.position.set(x, y, z); holder.rotation.y = rotation; holder.updateMatrix()
        for (const child of [...holder.children]) { child.applyMatrix4(holder.matrix); statics.add(child) }
    }
    /** 2点を結ぶ部材（飛び梁など）。 */
    const strut = (from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, mat: THREE.Material) => {
        const direction = to.clone().sub(from)
        const mesh = part(statics, stoneBox(width, direction.length(), depth), mat, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, 1, 1, 1)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
        return mesh
    }
    /** 胸壁（凸凹）を、ローカルX方向に length だけ並べる。 */
    const crenellate = (g: THREE.Group, length: number, y: number, z: number, mat: THREE.Material) => {
        for (let t = -length / 2 + 1.1; t <= length / 2 - 1.1 + .01; t += 3.8) part(g, stoneBox(2.2, 3, 1.6), mat, t, y + 1.5, z, 1, 1, 1)
    }
    const banners: THREE.Object3D[] = []
    const banner = (x: number, y: number, z: number, height: number, size: number) => {
        part(statics, kit.cylinder, iron, x, y + height / 2, z, .28, height, .28)
        const flag = part(group, curveCloth(size, size * .62), cloth(faction), x + size / 2, y + height - size * .4, z, 1, 1, 1)
        banners.push(flag)
    }

    // ---- 城壁（一周。正門だけ空ける） ----
    const WALL_TOP = 24
    const wallRadius = (a: number) => castleOutline(a) - .04
    const segment = deg(2.5)
    for (let a0 = -Math.PI; a0 < Math.PI - 1e-6; a0 += segment) {
        const a1 = a0 + segment, am = (a0 + a1) / 2
        const mid = castlePoint(wallRadius(am), am)
        if (mid.lx > CX && Math.abs(mid.ly - CY) < CASTLE_GATE_HALF + .5) continue
        const p0 = castlePoint(wallRadius(a0), a0), p1 = castlePoint(wallRadius(a1), a1)
        const a = toLocal(p0.lx, p0.ly), b = toLocal(p1.lx, p1.ly), m = toLocal(mid.lx, mid.ly)
        const length = Math.hypot(b.x - a.x, b.z - a.z) + 1.4
        const base = Math.min(0, surfaceAt(m.x, m.z) - 6)
        const top = WALL_TOP + surfaceAt(m.x, m.z) * .35
        place(m.x, 0, m.z, -Math.atan2(b.z - a.z, b.x - a.x), g => {
            // 局所の -Z が外側。裾の張り出し（斜堤）、壁体、石落としの持ち送り、胸壁、内側の歩廊。
            part(g, stoneBox(length, 9 - base, 13), graniteDark, 0, (9 + base) / 2, -.5, 1, 1, 1)
            part(g, stoneBox(length, top - base, 9), granite, 0, (top + base) / 2, 0, 1, 1, 1)
            part(g, stoneBox(length, 2.2, 1.6), graniteDark, 0, top - 2.2, -5, 1, 1, 1)
            for (let t = -length / 2 + 1; t < length / 2; t += 2.6) part(g, stoneBox(.9, 1.6, 1.4), graniteDark, t, top - 3.8, -4.7, 1, 1, 1)
            part(g, stoneBox(length, 2, 1.8), granite, 0, top, -5, 1, 1, 1)
            crenellate(g, length, top + 1, -5, granite)
            part(g, stoneBox(length, .8, 5), graniteDark, 0, top - .4, 1.5, 1, 1, 1)
            if (!human && random() < .25) part(g, sphere, bone, 0, top + 4.2, -5, .9, 1, .9)
        })
    }

    // ---- 塔（円塔は裾が広がり、石落としと胸壁、いくつかはとんがり屋根） ----
    const tower = (x: number, z: number, radius: number, height: number, roof: boolean) => {
        const ground = Math.min(0, surfaceAt(x, z) - 6)
        part(statics, stoneCylinder(radius * 1.28, 12 - ground, radius), graniteDark, x, (12 + ground) / 2, z, 1, 1, 1)
        part(statics, stoneCylinder(radius, height - 12), granite, x, 12 + (height - 12) / 2, z, 1, 1, 1)
        // 持ち送りの段と、張り出した石落とし
        part(statics, stoneCylinder(radius + .6, 1.4, radius + 1.6), graniteDark, x, height + .4, z, 1, 1, 1)
        part(statics, stoneCylinder(radius + 1.6, 3), granite, x, height + 2.6, z, 1, 1, 1)
        const outward = Math.atan2(z, x)
        for (const y of [height * .35, height * .65]) for (const da of [-.5, 0, .5]) {
            const a = outward + da
            part(statics, box, voidMaterial, x + Math.cos(a) * (radius + .1), y, z + Math.sin(a) * (radius + .1), .5, 3.6, .5)
        }
        if (roof) {
            part(statics, stoneCylinder(radius * .95, 4), granite, x, height + 6, z, 1, 1, 1)
            part(statics, cone, pick(slates), x, height + 8 + radius * 1.1, z, radius * 1.2, radius * 2.2, radius * 1.2)
            part(statics, kit.cylinder, iron, x, height + 9 + radius * 2.3, z, .2, 3, .2)
            return height + 9 + radius * 2.3
        }
        const merlons = Math.round(radius * 1.5)
        for (let k = 0; k < merlons; k++) {
            const a = k / merlons * Math.PI * 2
            const merlon = part(statics, stoneBox(2.2, 3, 1.4), granite, x + Math.cos(a) * (radius + 1), height + 5.6, z + Math.sin(a) * (radius + 1), 1, 1, 1)
            merlon.rotation.y = -a + Math.PI / 2
        }
        if (!human) for (let k = 0; k < 4; k++) part(statics, sphere, bone, x + Math.cos(k * 1.6) * (radius + 1), height + 8, z + Math.sin(k * 1.6) * (radius + 1), .9, 1, .9)
        return height + 5
    }
    for (const d of CASTLE_TOWER_ANGLES) {
        const a = deg(d)
        const p = castlePoint(castleOutline(a) - .02, a)
        const { x, z } = toLocal(p.lx, p.ly)
        const top = tower(x, z, 8.5, Math.abs(d) === 58 ? 33 : 30, Math.abs(d) === 92 || Math.abs(d) === 160)
        if (Math.abs(d) === 58) banner(x, top, z, 10, 6)
    }

    // ---- 正門: 門楼と両脇のとんがり屋根の塔、落とし格子 ----
    const gatePoint = castlePoint(castleOutline(0) - .04, 0)
    const gateX = toLocal(gatePoint.lx, gatePoint.ly).x
    const gateHalf = (CASTLE_GATE_HALF + .5) * TILE_PX
    for (const side of [-1, 1]) tower(gateX + 2, side * (gateHalf + 9), 10.5, 36, true)
    place(gateX - 2, 0, 0, 0, g => {
        const width = gateHalf * 2 + 8
        // 通路の上の門楼。正面にアーチの暗がり、上に石落としと胸壁、背後に急勾配のスレート屋根。
        part(g, stoneBox(18, 26, width), granite, 0, 30, 0, 1, 1, 1)
        part(g, box, voidMaterial, 9.1, 21, 0, .3, 7, width - 18)
        for (let t = -width / 2 + 9; t <= width / 2 - 9; t += 3.2) part(g, box, iron, 9.3, 18.5, t, .5, 4.5, .5)
        part(g, box, iron, 9.3, 16.4, 0, .5, .5, width - 18)
        for (let t = -width / 2 + 2; t < width / 2; t += 2.8) part(g, stoneBox(1.4, 1.8, .9), graniteDark, 9.6, 39.5, t, 1, 1, 1)
        part(g, stoneBox(2, 3, width), granite, 9.8, 42, 0, 1, 1, 1)
        for (const t of [-18, -6, 6, 18]) part(g, box, glass, 9.15, 33, t, .3, 4, 1.8)
        part(g, prism, slates[0]!, -2, 43, 0, 16, 14, width - 4)
        for (const z of [-14, 14]) {
            part(g, stoneBox(4, 6, 3.4), granite, 3.5, 47, z, 1, 1, 1)
            part(g, prism, slates[1]!, 3.5, 50, z, 3.8, 3, 4).rotation.y = Math.PI / 2
            part(g, box, glass, 5.3, 47, z, .2, 3, 1.6)
        }
        part(g, stoneBox(2.4, 10, 2.4), graniteDark, -2, 52, width / 2 - 6, 1, 1, 1)
    })
    if (!human) for (const z of [-16, 0, 16]) part(statics, sphere, bone, gateX + 7.8, 37, z, 1.4, 1.5, 1.4)
    banner(gateX + 2, 56, 0, 14, 9)

    // ---- 山腹の家並み: 石造りの細長い家（3〜4階建て）、急勾配のスレート屋根、屋根窓と煙突 ----
    for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
        if (castleCell(lx, ly) !== 'house') continue
        const { x: cx, z: cz } = toLocal(lx, ly)
        const x = cx + (random() - .5) * 2, z = cz + (random() - .5) * 2
        const corners = [[-7, -7], [-7, 7], [7, -7], [7, 7]].map(([dx, dz]) => surfaceAt(x + dx!, z + dz!))
        const bottom = Math.min(...corners) - 6, floor = Math.max(...corners)
        const storeys = 2 + Math.floor(random() * 2.2) + (radiusAt(x, z) < .5 ? 1 : 0)
        const top = floor + storeys * 6.2
        const width = 12.5 + random() * 3.5, depth = 11 + random() * 3
        const timbered = random() < .22
        const stone = pick(houseStones)
        // 棟は等高線に沿い、正面（局所の -Z）は谷側を向く。
        const facing = Math.atan2(z, x) + Math.PI / 2 + (random() - .5) * .25
        place(x, 0, z, -facing, g => {
            if (timbered) {
                const upper = floor + 6.2
                part(g, stoneBox(width, upper - bottom, depth), stone, 0, (upper + bottom) / 2, 0, 1, 1, 1)
                part(g, box, plaster, 0, (top + upper) / 2, 0, width + .6, top - upper, depth + .6)
                for (let t = -width / 2; t <= width / 2 + .01; t += width / 4) for (const side of [-1, 1]) part(g, box, beam, t, (top + upper) / 2, side * (depth / 2 + .35), .6, top - upper, .25)
                for (let y = upper; y <= top + .01; y += 6.2) for (const side of [-1, 1]) part(g, box, beam, 0, y, side * (depth / 2 + .4), width + .8, .6, .3)
            } else {
                part(g, stoneBox(width, top - bottom, depth), stone, 0, (top + bottom) / 2, 0, 1, 1, 1)
                part(g, stoneBox(width + .5, .7, depth + .5), graniteDark, 0, floor + 6.2, 0, 1, 1, 1)
            }
            // 窓（階ごと）と、谷側の戸口
            for (let k = 0; k < storeys; k++) {
                const y = floor + 3.6 + k * 6.2
                for (const t of width > 14 ? [-width / 3, 0, width / 3] : [-width / 4, width / 4]) {
                    for (const side of [-1, 1]) {
                        if (random() < .15) continue
                        part(g, box, glass, t, y, side * (depth / 2 + .5), 1.6, 2.8, .25)
                        if (!timbered) part(g, box, graniteDark, t, y - 1.7, side * (depth / 2 + .5), 2.2, .4, .5)
                    }
                }
            }
            part(g, box, voidMaterial, 0, floor + 2.2, -depth / 2 - .3, 2.6, 4.4, .3)
            // 屋根（棟は局所X方向）
            const pitch = depth * (.72 + random() * .2)
            const roofMat = pick(slates)
            part(g, prism, roofMat, 0, top, 0, depth + 1.8, pitch, width + 1.4).rotation.y = Math.PI / 2
            // 切妻の煙突
            for (const end of [-1, 1]) if (random() < .55) part(g, stoneBox(2.4, pitch + 4, 2.6), graniteDark, end * (width / 2 - 1.4), top + (pitch + 4) / 2, depth * .1, 1, 1, 1)
            // 谷側の屋根窓
            if (random() < .6) {
                const dx = (random() - .5) * width * .4, dz = -depth / 4, dy = top + pitch * .3
                part(g, stoneBox(3.4, 3.6, 3.4), stone, dx, dy + 1.2, dz, 1, 1, 1)
                part(g, prism, roofMat, dx, dy + 3, dz, 4.2, 2.6, 4)
                part(g, box, glass, dx, dy + 1.2, dz - 1.75, 1.6, 2, .2)
            }
        })
    }

    // ---- 頂の本陣 ----
    const S = CASTLE_SUMMIT
    // 岩盤から立ち上がる巨大な基壇。前半分は本陣の岩盤の楕円、裏手は本陣の敷地へ張り出す。
    const platform: [number, number][] = []
    for (let i = 0; i <= 24; i++) {
        const a = -Math.PI / 2 + i / 24 * Math.PI
        platform.push([Math.cos(a) * .21 * CASTLE_RADII.x * TILE_PX, Math.sin(a) * .21 * CASTLE_RADII.y * TILE_PX])
    }
    platform.push([-70, 52], [-96, 34], [-100, -30], [-74, -54])
    part(statics, stoneSlab(platform, S - 46, S + 4), granite, 0, 0, 0, 1, 1, 1)
    // 基壇の控え壁と、小さな窓
    for (let i = 0; i < platform.length; i++) {
        const [ax, az] = platform[i]!, [bx, bz] = platform[(i + 1) % platform.length]!
        const length = Math.hypot(bx - ax, bz - az)
        if (length < 1) continue
        for (let t = 6; t < length - 3; t += 12) {
            const px = ax + (bx - ax) * t / length, pz = az + (bz - az) * t / length
            // 外向きの法線（中心から離れる側）
            let nx = (bz - az) / length, nz = -(bx - ax) / length
            if (nx * (px + 20) + nz * pz < 0) { nx = -nx; nz = -nz }
            const depth = Math.max(0, S - 4 - surfaceAt(px + nx * 3, pz + nz * 3))
            const pier = part(statics, stoneBox(3, depth + 10, 3), graniteDark, px + nx * 1.2, S + 4 - (depth + 10) / 2, pz + nz * 1.2, 1, 1, 1)
            pier.rotation.y = -Math.atan2(bz - az, bx - ax)
            if (Math.round(t / 12) % 2) part(statics, box, glass, px + nx * .3, S - 8, pz + nz * .3, 1.2, 4, 1.2)
        }
    }
    // 本陣の主棟: 裏手側の長い棟、交差する翼、前面側の高い棟。前面側の棟は背が高く、飛び梁と小尖塔に囲まれる。
    // 主棟は本陣の岩盤の裏手寄りに建て、前庭（歩ける）の上にはみ出さない。
    const AX = -22
    const NAVE_TOP = S + 32, CHOIR_TOP = S + 40
    part(statics, stoneBox(58, NAVE_TOP - S + 4, 22), graniteWarm, AX - 30, (NAVE_TOP + S - 4) / 2, 0, 1, 1, 1)
    part(statics, prism, slates[0]!, AX - 30, NAVE_TOP, 0, 24, 15, 59).rotation.y = Math.PI / 2
    for (let t = AX - 54; t <= AX - 8; t += 8) for (const side of [-1, 1]) {
        part(statics, box, glass, t, S + 20, side * 11.2, 2, 9, .3)
        part(statics, stoneBox(2.6, NAVE_TOP - S - 2, 3.4), graniteDark, t + 4, (NAVE_TOP + S - 2) / 2, side * 12.4, 1, 1, 1)
    }
    // 裏手側の端の正面（破風と小塔）
    part(statics, stoneBox(4, NAVE_TOP - S + 18, 26), granite, AX - 60, (NAVE_TOP + S + 14) / 2, 0, 1, 1, 1)
    part(statics, prism, granite, AX - 60, NAVE_TOP + 7, 0, 4, 12, 26).rotation.y = Math.PI / 2
    for (const side of [-1, 1]) {
        part(statics, stoneCylinder(2.6, NAVE_TOP - S + 14, 2.6, 8), granite, AX - 60, (NAVE_TOP + S + 14) / 2, side * 13.5, 1, 1, 1)
        part(statics, octaCone, slates[1]!, AX - 60, NAVE_TOP + 18, side * 13.5, 3, 9, 3)
    }
    part(statics, box, glass, AX - 62.1, S + 24, 0, .3, 10, 5)
    // 左右へ張り出す翼
    part(statics, stoneBox(18, NAVE_TOP - S + 4, 56), graniteWarm, AX + 4, (NAVE_TOP + S - 4) / 2, 0, 1, 1, 1)
    part(statics, prism, slates[0]!, AX + 4, NAVE_TOP, 0, 20, 14, 57)
    for (const side of [-1, 1]) {
        part(statics, stoneBox(20, 8, 2), granite, AX + 4, NAVE_TOP + 4, side * 28.5, 1, 1, 1)
        part(statics, box, glass, AX + 4, S + 22, side * 28.2, 6, 12, .3)
    }
    // 前面側の高い棟と、多角形の端部
    part(statics, stoneBox(26, CHOIR_TOP - S + 4, 24), graniteWarm, AX + 26, (CHOIR_TOP + S - 4) / 2, 0, 1, 1, 1)
    part(statics, stoneCylinder(13, CHOIR_TOP - S + 4, 13, 8), graniteWarm, AX + 39, (CHOIR_TOP + S - 4) / 2, 0, 1, 1, 1)
    part(statics, prism, slates[0]!, AX + 26, CHOIR_TOP, 0, 26, 16, 27).rotation.y = Math.PI / 2
    part(statics, octaCone, slates[0]!, AX + 39, CHOIR_TOP + 8, 0, 14.5, 16, 14.5)
    // 前面側の棟を囲む控え壁の柱（小尖塔つき）と飛び梁
    const piers: { pier: [number, number]; wall: [number, number] }[] = [
        ...[AX + 18, AX + 30].flatMap(x => [-1, 1].map(side => ({ pier: [x, side * 23] as [number, number], wall: [x, side * 12] as [number, number] }))),
        ...[-60, -30, 0, 30, 60].map(d => ({ pier: [AX + 39 + Math.cos(deg(d)) * 24, Math.sin(deg(d)) * 24] as [number, number], wall: [AX + 39 + Math.cos(deg(d)) * 13, Math.sin(deg(d)) * 13] as [number, number] })),
    ]
    for (const { pier: [px, pz], wall: [wx, wz] } of piers) {
        const foot = Math.min(S, surfaceAt(px, pz))
        part(statics, stoneBox(3.4, CHOIR_TOP - 4 - foot, 3.4), granite, px, (CHOIR_TOP - 4 + foot) / 2, pz, 1, 1, 1)
        part(statics, octaCone, granite, px, CHOIR_TOP, pz, 2, 8, 2)
        strut(new THREE.Vector3(px, CHOIR_TOP - 8, pz), new THREE.Vector3(wx, CHOIR_TOP - 3, wz), 1.4, 2.2, graniteDark)
        part(statics, box, glass, (px + wx * 3) / 4, S + 24, (pz + wz * 3) / 4, 1.8, 14, 1.8)
    }
    // 中央の塔（物見の階と手すり、四隅の小尖塔）
    const TOWER_TOP = S + 66
    part(statics, stoneBox(22, TOWER_TOP - NAVE_TOP + 8, 22), graniteWarm, 4, (TOWER_TOP + NAVE_TOP - 8) / 2, 0, 1, 1, 1)
    for (const [dx, dz] of [[-11.2, 0], [11.2, 0], [0, -11.2], [0, 11.2]] as const) {
        for (const t of [-4.5, 0, 4.5]) part(statics, box, voidMaterial, AX + 4 + dx + (dz ? t : 0), TOWER_TOP - 12, dz + (dx ? t : 0), dx ? .3 : 2.4, 14, dz ? .3 : 2.4)
        part(statics, box, glass, AX + 4 + dx, NAVE_TOP + 14, dz, dx ? .3 : 3, 6, dz ? .3 : 3)
    }
    part(statics, stoneBox(24, 2, 24), graniteDark, AX + 4, TOWER_TOP, 0, 1, 1, 1)
    for (const [dx, dz] of [[-11, -11], [11, -11], [-11, 11], [11, 11]] as const) {
        part(statics, stoneBox(3, 10, 3), granite, AX + 4 + dx, TOWER_TOP + 5, dz, 1, 1, 1)
        part(statics, octaCone, granite, AX + 4 + dx, TOWER_TOP + 15, dz, 2, 10, 2)
    }
    for (let k = -8.75; k <= 8.75; k += 2.5) for (const side of [-1, 1]) {
        part(statics, stoneBox(.8, 2.6, .8), granite, AX + 4 + k, TOWER_TOP + 2.3, side * 11, 1, 1, 1)
        part(statics, stoneBox(.8, 2.6, .8), granite, AX + 4 + side * 11, TOWER_TOP + 2.3, k, 1, 1, 1)
    }
    // 尖塔: 八角の石の物見の階の上に、細く高い尖塔。根元に小破風、稜に沿って突起。
    part(statics, stoneCylinder(8.5, 12, 8, 8), granite, AX + 4, TOWER_TOP + 7, 0, 1, 1, 1)
    for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + Math.PI / 8
        part(statics, box, voidMaterial, AX + 4 + Math.cos(a) * 8.1, TOWER_TOP + 7, Math.sin(a) * 8.1, 1.4, 7, 1.4)
        const gablet = part(statics, prism, granite, AX + 4 + Math.cos(a) * 7.4, TOWER_TOP + 13, Math.sin(a) * 7.4, 5, 5, 1.6)
        gablet.rotation.y = -a + Math.PI / 2
    }
    const SPIRE_TOP = TOWER_TOP + 82
    part(statics, octaCone, slates[2]!, AX + 4, (TOWER_TOP + 13 + SPIRE_TOP) / 2, 0, 7.6, SPIRE_TOP - TOWER_TOP - 13, 7.6)
    for (let y = TOWER_TOP + 22; y < SPIRE_TOP - 8; y += 9) {
        const r = 7.6 * (SPIRE_TOP - y) / (SPIRE_TOP - TOWER_TOP - 13)
        for (let k = 0; k < 8; k++) {
            const a = k / 8 * Math.PI * 2
            part(statics, box, granite, AX + 4 + Math.cos(a) * r, y, Math.sin(a) * r, .7, .9, .7)
        }
    }
    // 裏手の斜面に張り出す三層の高い棟（巨大な控え壁が並ぶ）と、反対側の居館
    const wing = (x0: number, x1: number, z: number, thick: number, top: number, roof: THREE.Material, buttresses: number) => {
        const cx = (x0 + x1) / 2, length = x1 - x0, out = Math.sign(z)
        const ground = Math.min(surfaceAt(x0, z), surfaceAt(x1, z), surfaceAt(cx, z + out * thick / 2)) - 8
        part(statics, stoneBox(length, top - ground, thick), granite, cx, (top + ground) / 2, z, 1, 1, 1)
        part(statics, prism, roof, cx, top, z, thick + 2, thick * .7, length + 1).rotation.y = Math.PI / 2
        for (let i = 0; i <= buttresses; i++) {
            const bx = x0 + 2 + (length - 4) * i / buttresses
            const foot = surfaceAt(bx, z + out * thick) - 6
            part(statics, stoneBox(3.4, top - 4 - foot, 4.5), graniteDark, bx, (top - 4 + foot) / 2, z + out * (thick / 2 + 1.6), 1, 1, 1)
            part(statics, prism, graniteDark, bx, top - 4, z + out * (thick / 2 + 1.6), 3.4, 3, 4.5)
            if (i < buttresses) for (const y of [top - 12, top - 26, top - 40]) if (y > ground + 6) part(statics, box, glass, bx + (length - 4) / buttresses / 2, y, z + out * (thick / 2 + .1), 2, 7, .3)
        }
    }
    wing(-96, -32, -40, 18, S + 30, slates[1]!, 7)
    wing(-88, -36, 40, 14, S + 22, slates[2]!, 5)
    // 本陣の入口（二つの小塔に挟まれた門）。右手の登り道が前庭に出るあたり。
    part(statics, stoneBox(16, 26, 8), granite, 10, S + 9, 37, 1, 1, 1)
    for (const dx of [-6.5, 6.5]) {
        part(statics, stoneCylinder(3.4, 30, 3.4, 10), granite, 10 + dx, S + 11, 40, 1, 1, 1)
        part(statics, octaCone, slates[1]!, 10 + dx, S + 29, 40, 3.8, 6, 3.8)
    }
    part(statics, box, voidMaterial, 10, S + 2, 41.2, 5, 8, .3)
    // 本陣の旗
    banner(AX - 60, NAVE_TOP + 13, 0, 16, 10)
    if (!human) {
        for (let i = 0; i < 8; i++) part(statics, sphere, bone, AX - 56 + i * 7, NAVE_TOP + 1, 12.4, 1.1, 1.2, 1.1)
        for (const [dx, dz] of [[-11, -11], [11, -11], [-11, 11], [11, 11]] as const) part(statics, sphere, bone, AX + 4 + dx, TOWER_TOP + 21, dz, 1.4, 1.6, 1.4)
    }

    bake(statics)
    temporary.forEach(g => g.dispose())
    group.add(statics)


    group.position.set(fort.x, fort.groundHeight, fort.y)
    group.rotation.y = fort.front === 1 ? 0 : Math.PI
    return {
        group,
        /** 本陣の耐久の表示を、尖塔の上に出す（本陣の地面からの高さ）。 */
        labelHeight: SPIRE_TOP + 8 - S,
        update(time: number) {
            banners.forEach((b, i) => { b.rotation.y = Math.sin(time * 2 + i * 1.3) * .2 })
        },
        /** 夜（0〜1）には窓に明かりが灯る。 */
        setNight(night: number) {
            glass.emissiveIntensity = Math.max(0, Math.min(1, night)) * 1.4
        },
        destroy() {
            group.removeFromParent()
            owned.forEach(item => item.dispose())
        },
    }
}
