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
 * 人間軍の城は灰色の花崗岩とスレート。魔王軍の城は黒い石の廃城で、屋根は落ち、塔の頂は崩れ、
 * 窓の奥に残り火が灯る。頂には細く高い塔が寄り集まり、まわりを霧が漂う。
 */
export function createCastle(fort: Fort, kit: ModelKit) {
    const { part, bake, cone, surfaces, material, cloth, curveCloth } = kit
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
    const granite = stoneOf(human ? 0xa59f92 : 0x4a4341)
    const graniteDark = stoneOf(human ? 0x857f74 : 0x332d2c)
    const graniteWarm = stoneOf(human ? 0xb0a796 : 0x554a46)
    const houseStones = (human ? [0xa29a8b, 0x958d80, 0xb2aa9b, 0x8a8478] : [0x4d4542, 0x433c3a, 0x564b47]).map(stoneOf)
    const slates = [0x3f444c, 0x4a4f58, 0x52575e].map(material)
    const plaster = material(0xcfc4ad)
    const beam = material(0x4a3a2d)
    const iron = kit.metal(0x46494c)
    const glass = own(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: .35, metalness: .2, emissive: 0xffb560, emissiveIntensity: 0 }))
    // 魔王軍の廃城の窓の奥で、昼も夜も燃える残り火。
    const ember = own(new THREE.MeshStandardMaterial({ color: 0x1c0e09, roughness: .6, emissive: 0xff5a1e, emissiveIntensity: .8 }))
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
    /** 崩れた胸壁: 高さが不揃いで、ところどころ欠けている。 */
    const brokenBattlement = (g: THREE.Group, length: number, y: number, z: number, mat: THREE.Material) => {
        for (let t = -length / 2 + 1.1; t <= length / 2 - 1.1 + .01; t += 3.8) {
            if (random() < .3) continue
            const h = 1.4 + random() * 3.6
            part(g, stoneBox(2.2, h, 1.6), mat, t, y + h / 2, z, 1, 1, 1)
        }
    }
    const banners: THREE.Object3D[] = []
    let mistUpdate: ((time: number) => void) | null = null
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
        // 魔王軍の城壁は、ところどころ上が崩れ落ちている。
        const top = WALL_TOP + surfaceAt(m.x, m.z) * .35 - (!human && random() < .16 ? 3 + random() * 6 : 0)
        place(m.x, 0, m.z, -Math.atan2(b.z - a.z, b.x - a.x), g => {
            // 局所の -Z が外側。裾の張り出し（斜堤）、壁体、石落としの持ち送り、胸壁、内側の歩廊。
            part(g, stoneBox(length, 9 - base, 13), graniteDark, 0, (9 + base) / 2, -.5, 1, 1, 1)
            part(g, stoneBox(length, top - base, 9), granite, 0, (top + base) / 2, 0, 1, 1, 1)
            part(g, stoneBox(length, 2.2, 1.6), graniteDark, 0, top - 2.2, -5, 1, 1, 1)
            for (let t = -length / 2 + 1; t < length / 2; t += 2.6) part(g, stoneBox(.9, 1.6, 1.4), graniteDark, t, top - 3.8, -4.7, 1, 1, 1)
            part(g, stoneBox(length, 2, 1.8), granite, 0, top, -5, 1, 1, 1)
            if (human) crenellate(g, length, top + 1, -5, granite)
            else brokenBattlement(g, length, top + 1, -5, granite)
            part(g, stoneBox(length, .8, 5), graniteDark, 0, top - .4, 1.5, 1, 1, 1)
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
            if (Math.round(t / 12) % 2) part(statics, box, human ? glass : pick([ember, voidMaterial, voidMaterial]), px + nx * .3, S - 8, pz + nz * .3, 1.2, 4, 1.2)
        }
    }
    /** 人間軍の城: 灰色の花崗岩とスレート屋根。頂の本陣は高い棟と中央の塔、細い尖塔。尖塔の頂の高さを返す。 */
    const buildStronghold = () => {
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
        return SPIRE_TOP
    }

    /** 魔王軍の城: 黒い石の廃城。屋根は落ち、塔の頂は崩れ、窓の奥に残り火が灯る。頂の本陣の最も高い所の高さを返す。 */
    const buildRuin = () => {
        /** 窓: 暗い穴か、残り火の灯る窓。dx, dz のどちらかが壁面までの距離。 */
        const opening = (g: THREE.Group, dx: number, y: number, dz: number, h: number) => {
            part(g, box, random() < .22 ? ember : voidMaterial, dx, y, dz, dx ? .3 : 1.8, h, dz ? .3 : 1.8)
        }
        /**
         * 廃塔（角塔か円塔）。裾は広がり、階ごとに帯石と窓。頂は張り出した段の上に不揃いな胸壁が残り、
         * 角の一つに崩れ残った壁が高く突き出す。突き出した壁の頂の高さを返す。
         */
        const ruinTower = (x: number, z: number, width: number, foot: number, top: number, round: boolean, rotation = 0) => {
            const half = width / 2
            const spike = 6 + random() * 12
            place(x, 0, z, rotation, g => {
                if (round) {
                    part(g, stoneCylinder(half * 1.28, 10, half), graniteDark, 0, foot + 5, 0, 1, 1, 1)
                    part(g, stoneCylinder(half, top - foot), granite, 0, (top + foot) / 2, 0, 1, 1, 1)
                } else {
                    part(g, stoneBox(width * 1.25, 10, width * 1.25), graniteDark, 0, foot + 5, 0, 1, 1, 1)
                    part(g, stoneBox(width, top - foot, width), granite, 0, (top + foot) / 2, 0, 1, 1, 1)
                }
                for (let y = foot + 17; y < top - 6; y += 13) {
                    if (round) part(g, stoneCylinder(half + .4, .8), graniteDark, 0, y - 4.5, 0, 1, 1, 1)
                    else part(g, stoneBox(width + .8, .8, width + .8), graniteDark, 0, y - 4.5, 0, 1, 1, 1)
                    for (const [dx, dz] of [[half + .1, 0], [-half - .1, 0], [0, half + .1], [0, -half - .1]] as const) if (random() < .7) opening(g, dx, y, dz, 4.6)
                }
                // 張り出した段と、不揃いな胸壁
                if (round) part(g, stoneCylinder(half + 1.2, 2.4), graniteDark, 0, top + 1.2, 0, 1, 1, 1)
                else part(g, stoneBox(width + 2.4, 2.4, width + 2.4), graniteDark, 0, top + 1.2, 0, 1, 1, 1)
                const edge = half + .6
                const merlons: [number, number, number][] = []
                if (round) {
                    const count = Math.max(6, Math.round(width * .75))
                    for (let k = 0; k < count; k++) { const a = k / count * Math.PI * 2; merlons.push([Math.cos(a) * edge, Math.sin(a) * edge, -a + Math.PI / 2]) }
                } else {
                    for (let t = -edge + 1.1; t <= edge - 1.1 + .01; t += 3.4) merlons.push([t, -edge, 0], [t, edge, 0], [-edge, t, Math.PI / 2], [edge, t, Math.PI / 2])
                }
                for (const [mx, mz, r] of merlons) {
                    if (random() < .3) continue
                    const h = 1.4 + random() * 4
                    part(g, stoneBox(2.2, h, 1.4), granite, mx, top + 2.4 + h / 2, mz, 1, 1, 1).rotation.y = r
                }
                const cx = (random() < .5 ? -1 : 1) * half * .62, cz = (random() < .5 ? -1 : 1) * half * .62
                part(g, stoneBox(width * .36, spike, width * .36), granite, cx, top + 2.4 + spike / 2, cz, 1, 1, 1)
            })
            return top + 2.4 + spike
        }

        // ---- 城壁の塔（角塔と円塔が交互に並び、屋根はない） ----
        CASTLE_TOWER_ANGLES.forEach((d, i) => {
            const a = deg(d)
            const p = castlePoint(castleOutline(a) - .02, a)
            const { x, z } = toLocal(p.lx, p.ly)
            const foot = Math.min(0, surfaceAt(x, z) - 6)
            const top = ruinTower(x, z, 15, foot, 34 + random() * 14, i % 4 < 2, -Math.atan2(z, x))
            if (Math.abs(d) === 58) banner(x, top, z, 10, 6)
        })

        // ---- 正門: 高い角塔に挟まれた門楼。屋根は落ち、落とし格子だけが残る ----
        const gatePoint = castlePoint(castleOutline(0) - .04, 0)
        const gateX = toLocal(gatePoint.lx, gatePoint.ly).x
        const gateHalf = (CASTLE_GATE_HALF + .5) * TILE_PX
        for (const side of [-1, 1]) ruinTower(gateX + 2, side * (gateHalf + 9), 19, Math.min(0, surfaceAt(gateX + 2, side * (gateHalf + 9)) - 6), 50, false)
        place(gateX - 2, 0, 0, 0, g => {
            const width = gateHalf * 2 + 8
            part(g, stoneBox(18, 26, width), granite, 0, 30, 0, 1, 1, 1)
            part(g, box, voidMaterial, 9.1, 21, 0, .3, 7, width - 18)
            for (let t = -width / 2 + 9; t <= width / 2 - 9; t += 3.2) part(g, box, iron, 9.3, 18.5, t, .5, 4.5, .5)
            part(g, box, iron, 9.3, 16.4, 0, .5, .5, width - 18)
            for (let t = -width / 2 + 2; t < width / 2; t += 2.8) part(g, stoneBox(1.4, 1.8, .9), graniteDark, 9.6, 39.5, t, 1, 1, 1)
            part(g, stoneBox(2, 3, width), granite, 9.8, 42, 0, 1, 1, 1)
            for (const t of [-18, -6, 6, 18]) part(g, box, random() < .5 ? ember : voidMaterial, 9.15, 33, t, .3, 4, 1.8)
            // 屋根の落ちた門楼の中の暗がりと、崩れた胸壁
            part(g, box, voidMaterial, -1, 43.1, 0, 14, .2, width - 4)
            const rim = new THREE.Group()
            brokenBattlement(rim, width, 43.5, 0, granite)
            rim.children.forEach(child => { child.position.set(9.8, child.position.y, child.position.x); child.rotation.y = Math.PI / 2 })
            g.add(...rim.children)
        })
        banner(gateX + 2, 56, 0, 14, 9)

        // ---- 山腹の家並み: 屋根の落ちた石の家と、細い廃塔 ----
        for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
            if (castleCell(lx, ly) !== 'house') continue
            const { x: cx, z: cz } = toLocal(lx, ly)
            const x = cx + (random() - .5) * 2, z = cz + (random() - .5) * 2
            const corners = [[-7, -7], [-7, 7], [7, -7], [7, 7]].map(([dx, dz]) => surfaceAt(x + dx!, z + dz!))
            const bottom = Math.min(...corners) - 6, floor = Math.max(...corners)
            const storeys = 2 + Math.floor(random() * 2.2) + (radiusAt(x, z) < .5 ? 1 : 0)
            const top = floor + storeys * 6.2
            const facing = Math.atan2(z, x) + Math.PI / 2 + (random() - .5) * .25
            if (random() < .2) {
                ruinTower(x, z, 8 + random() * 2, bottom, top + 12 + random() * 18, random() < .5, -facing)
                continue
            }
            const width = 12.5 + random() * 3.5, depth = 11 + random() * 3
            const stone = pick(houseStones)
            place(x, 0, z, -facing, g => {
                part(g, stoneBox(width, top - bottom, depth), stone, 0, (top + bottom) / 2, 0, 1, 1, 1)
                part(g, stoneBox(width + .5, .7, depth + .5), graniteDark, 0, floor + 6.2, 0, 1, 1, 1)
                for (let k = 0; k < storeys; k++) {
                    const y = floor + 3.6 + k * 6.2
                    for (const t of width > 14 ? [-width / 3, 0, width / 3] : [-width / 4, width / 4]) {
                        for (const side of [-1, 1]) if (random() < .8) opening(g, t, y, side * (depth / 2 + .1), 2.8)
                    }
                }
                part(g, box, voidMaterial, 0, floor + 2.2, -depth / 2 - .3, 2.6, 4.4, .3)
                // 屋根が落ちて中が見える。壁の上端は崩れて高さが不揃い。
                part(g, box, voidMaterial, 0, top + .05, 0, width - 2.4, .2, depth - 2.4)
                for (const side of [-1, 1]) {
                    for (let t = -width / 2 + 1.5; t < width / 2 - 1; t += 3) {
                        const h = random() * 4.5
                        if (h > .8) part(g, stoneBox(3, h, 1.2), stone, t, top + h / 2, side * (depth / 2 - .6), 1, 1, 1)
                    }
                    const gable = 2 + random() * 6
                    part(g, stoneBox(1.2, gable, depth * (.3 + random() * .4)), stone, side * (width / 2 - .6), top + gable / 2, (random() - .5) * 3, 1, 1, 1)
                }
            })
        }

        // ---- 頂の本陣: 巨大な主塔と、寄り集まる細く高い塔、屋根の落ちた大広間 ----
        const AX = -22
        const KEEP_TOP = S + 88
        // 主塔と、その上に継ぎ足された細い塔（全体の頂点）
        ruinTower(AX + 4, 0, 26, S, KEEP_TOP, false)
        let crown = ruinTower(AX - 1, 4, 12, KEEP_TOP, KEEP_TOP + 40, false)
        // 主塔を囲む塔
        const spires: [number, number, number, number, boolean][] = [
            [AX + 34, -22, 11, 66, true], [AX + 32, 22, 9, 56, false], [AX - 22, -26, 12, 78, false],
            [AX - 42, 28, 10, 64, true], [AX + 40, 2, 13, 48, true], [AX - 70, -20, 9, 58, false],
        ]
        for (const [x, z, width, height, round] of spires) crown = Math.max(crown, ruinTower(x, z, width, S, S + height, round, random() * .4))
        // 主塔から外の塔へ渡る、崩れかけた空中の橋
        strut(new THREE.Vector3(AX + 17, S + 58, -8), new THREE.Vector3(AX + 30, S + 52, -19), 3, 4, graniteDark)
        strut(new THREE.Vector3(AX - 9, S + 64, -13), new THREE.Vector3(AX - 18, S + 60, -21), 3, 4, graniteDark)
        // 屋根の落ちた大広間: 腰壁の上に柱が並び、梁はところどころ落ちて、柱の間から空が透ける。
        const HALL = { x0: AX - 62, x1: AX - 14, half: 12 }
        const hallLength = HALL.x1 - HALL.x0, hallX = (HALL.x0 + HALL.x1) / 2
        for (const side of [-1, 1]) {
            const wz = side * HALL.half
            part(statics, stoneBox(hallLength, 12, 2.4), granite, hallX, S + 10, wz, 1, 1, 1)
            for (let px = HALL.x0; px <= HALL.x1 + .01; px += 8) {
                const top = S + 28 + random() * 12
                part(statics, stoneBox(3.4, top - S - 4, 3.4), granite, px, (top + S + 4) / 2, wz, 1, 1, 1)
                part(statics, stoneBox(2.6, top - S - 6, 2), graniteDark, px, (top + S + 2) / 2, wz + side * 2.4, 1, 1, 1)
                if (px < HALL.x1 && random() < .55) part(statics, stoneBox(8, 3, 2.4), granite, px + 4, S + 30.5, wz, 1, 1, 1)
            }
        }
        // 大広間の裏手の妻壁: 大きな窓の穴が空き、上端は崩れている。
        part(statics, stoneBox(3, 40, HALL.half * 2 + 4), granite, HALL.x0 - 1.5, S + 24, 0, 1, 1, 1)
        for (const face of [-1.6, 1.6]) part(statics, box, voidMaterial, HALL.x0 - 1.5 + face, S + 22, 0, .2, 20, 8)
        for (let t = -HALL.half; t <= HALL.half; t += 3.2) {
            const h = random() * 10
            if (h > 1) part(statics, stoneBox(3, h, 3), granite, HALL.x0 - 1.5, S + 44 + h / 2, t, 1, 1, 1)
        }
        // 裏手の斜面に張り出す高い棟（屋根は落ち、巨大な控え壁が並ぶ）
        const wing = (x0: number, x1: number, z: number, thick: number, top: number, buttresses: number) => {
            const cx = (x0 + x1) / 2, length = x1 - x0, out = Math.sign(z)
            const ground = Math.min(surfaceAt(x0, z), surfaceAt(x1, z), surfaceAt(cx, z + out * thick / 2)) - 8
            part(statics, stoneBox(length, top - ground, thick), granite, cx, (top + ground) / 2, z, 1, 1, 1)
            part(statics, box, voidMaterial, cx, top + .05, z, length - 3, .2, thick - 3)
            for (let t = x0 + 1.5; t < x1 - 1; t += 3) for (const edge of [-1, 1]) {
                const h = random() * 6
                if (h > 1) part(statics, stoneBox(3, h, 1.4), granite, t + 1.5, top + h / 2, z + edge * (thick / 2 - .7), 1, 1, 1)
            }
            for (let i = 0; i <= buttresses; i++) {
                const bx = x0 + 2 + (length - 4) * i / buttresses
                const foot = surfaceAt(bx, z + out * thick) - 6
                part(statics, stoneBox(3.4, top - 4 - foot, 4.5), graniteDark, bx, (top - 4 + foot) / 2, z + out * (thick / 2 + 1.6), 1, 1, 1)
                if (i < buttresses) for (const y of [top - 12, top - 26, top - 40]) if (y > ground + 6) part(statics, box, random() < .3 ? ember : voidMaterial, bx + (length - 4) / buttresses / 2, y, z + out * (thick / 2 + .1), 2, 7, .3)
            }
        }
        wing(-96, -50, -40, 18, S + 30, 5)
        wing(-88, -52, 40, 14, S + 22, 4)
        // 本陣の入口（崩れた二つの小塔に挟まれた門）
        part(statics, stoneBox(16, 22, 8), granite, 10, S + 7, 37, 1, 1, 1)
        for (const dx of [-6.5, 6.5]) ruinTower(10 + dx, 40, 7, S - 4, S + 24 + random() * 6, true)
        part(statics, box, voidMaterial, 10, S + 2, 41.2, 5, 8, .3)
        banner(AX + 4, KEEP_TOP + 2.4, 10, 18, 11)
        return crown
    }
    const crown = human ? buildStronghold() : buildRuin()

    bake(statics)
    temporary.forEach(g => g.dispose())
    group.add(statics)

    // ---- 魔王軍の本陣を包む霧: 柔らかな靄の塊が塔の根元をゆっくり巡る ----
    const mist: { sprite: THREE.Sprite; angle: number; radius: number; speed: number; phase: number; opacity: number }[] = []
    if (!human) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const ctx = canvas.getContext('2d')!
        for (const [bx, by, br] of [[64, 64, 60], [44, 70, 36], [86, 60, 38], [62, 50, 34]] as const) {
            const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, br)
            gradient.addColorStop(0, 'rgba(255,255,255,.55)')
            gradient.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, 128, 128)
        }
        const map = own(new THREE.CanvasTexture(canvas))
        const MIST_CENTER = -28
        for (let i = 0; i < 20; i++) {
            const material = own(new THREE.SpriteMaterial({ map, color: 0xbdb8b4, transparent: true, opacity: 0, depthWrite: false }))
            const sprite = new THREE.Sprite(material)
            const size = 60 + random() * 50
            sprite.scale.set(size, size * .55, 1)
            sprite.position.y = CASTLE_SUMMIT + 4 + random() * 34
            group.add(sprite)
            mist.push({ sprite, angle: i / 20 * Math.PI * 2 + random() * .3, radius: 40 + random() * 34, speed: (.012 + random() * .02) * (i % 2 ? 1 : -1), phase: random() * Math.PI * 2, opacity: .3 + random() * .25 })
        }
        const placeMist = (time: number) => {
            for (const m of mist) {
                const a = m.angle + time * m.speed
                m.sprite.position.x = MIST_CENTER + Math.cos(a) * m.radius * 1.2
                m.sprite.position.z = Math.sin(a) * m.radius
                ;(m.sprite.material as THREE.SpriteMaterial).opacity = m.opacity * (.7 + .3 * Math.sin(time * .35 + m.phase))
            }
        }
        placeMist(0)
        mistUpdate = placeMist
    }

    group.position.set(fort.x, fort.groundHeight, fort.y)
    group.rotation.y = fort.front === 1 ? 0 : Math.PI
    return {
        group,
        /** 本陣の耐久の表示を、本陣の最も高い所の上に出す（本陣の地面からの高さ）。 */
        labelHeight: crown + 8 - S,
        update(time: number) {
            banners.forEach((b, i) => { b.rotation.y = Math.sin(time * 2 + i * 1.3) * .2 })
            mistUpdate?.(time)
        },
        /** 夜（0〜1）には窓に明かりが灯り、廃城の残り火は強まる。 */
        setNight(night: number) {
            const n = Math.max(0, Math.min(1, night))
            glass.emissiveIntensity = n * 1.4
            ember.emissiveIntensity = .8 + n * 1.2
        },
        destroy() {
            group.removeFromParent()
            owned.forEach(item => item.dispose())
        },
    }
}
