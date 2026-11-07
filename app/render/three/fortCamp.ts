import * as THREE from 'three'
import type { Fort } from '../../types/game'
import { FORT_DEPTH, FORT_STRUCTURES, FORT_WIDTH, isFortWallCell, type FortStructure } from '../../game/fortLayout'
import { TILE_PX } from '../../game/constants'
import { FACTION, type ModelKit } from './models'

/** セル中心のローカル座標。+X が前面（敵側）。 */
const cx = (lx: number) => (lx - (FORT_DEPTH - 1) / 2) * TILE_PX
const cz = (ly: number) => (ly - (FORT_WIDTH - 1) / 2) * TILE_PX

/**
 * ベースキャンプ型の砦。柵・門・物見櫓・本陣・兵舎・厩舎・射場・物資置き場・井戸・焚き火・バリケードで構成する。
 * 配置はゲーム側の fortLayout と共有し、柵や施設の位置が通行不可セルと一致する。
 */
export function createFortCamp(fort: Fort, kit: ModelKit) {
    const { part, bake, box, cone, sphere, surfaces, material, cloth, curveCloth, track } = kit
    const human = fort.owner === 'player'
    const faction = FACTION[fort.owner]
    const group = new THREE.Group()
    group.name = `${fort.owner}-camp`
    const lowCylinder = track(new THREE.CylinderGeometry(1, 1, 1, 8))
    const pyramid = track(new THREE.ConeGeometry(1, 1, 4))
    pyramid.rotateY(Math.PI / 4)
    const gable = new THREE.Shape()
    gable.moveTo(-.5, 0); gable.lineTo(.5, 0); gable.lineTo(0, 1); gable.closePath()
    const prism = track(new THREE.ExtrudeGeometry(gable, { depth: 1, bevelEnabled: false }))
    prism.translate(0, 0, -.5)

    const timber = human ? surfaces.wood : material(0x4c3d31)
    const darkTimber = material(human ? 0x5d4733 : 0x2f2621)
    const canvas = cloth(human ? 0xe5dcc5 : 0x8d6a4c)
    const canvasAlt = cloth(human ? 0xcfc3a5 : 0x6d4c3a)
    const trim = cloth(faction)
    const bone = material(0xe4dac0)
    const iron = kit.metal(0x5a5f62)
    const straw = material(0xc9ad62)
    const dirt = material(human ? 0x76684d : 0x6b5c48)
    const stone = surfaces.stone

    /** 一時グループに組み立て、位置・向きを焼き込んで本体へ移す。 */
    const place = (x: number, z: number, rotation: number, build: (g: THREE.Group) => void) => {
        const temp = new THREE.Group()
        build(temp)
        temp.position.set(x, 0, z); temp.rotation.y = rotation; temp.updateMatrix()
        for (const child of [...temp.children]) { child.applyMatrix4(temp.matrix); group.add(child) }
    }
    let seed = fort.owner === 'player' ? 11 : 29
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

    // 踏み固められた地面
    part(group, box, dirt, 0, .1, 0, FORT_DEPTH * TILE_PX, .3, FORT_WIDTH * TILE_PX)
    part(group, box, dirt, cx(FORT_DEPTH + 1), .1, cz(7.5), TILE_PX * 4, .25, TILE_PX * 6)

    // ---- 柵（盛り土＋尖った丸太） ----
    for (let lx = 0; lx < FORT_DEPTH; lx++) for (let ly = 0; ly < FORT_WIDTH; ly++) {
        if (!isFortWallCell(lx, ly)) continue
        if (FORT_STRUCTURES.some(s => (s.kind === 'tower' || s.kind === 'gateTower') && s.lx === lx && s.ly === ly)) continue
        const alongZ = lx === 0 || lx === FORT_DEPTH - 1
        // Sign of the outward normal along the segment's local X (side walls are turned 90°).
        const o = alongZ ? (lx === 0 ? -1 : 1) : (ly === 0 ? 1 : -1)
        place(cx(lx), cz(ly), alongZ ? 0 : Math.PI / 2, g => {
            part(g, box, dirt, 0, 1.2, 0, 9, 2.6, TILE_PX + .2)
            for (let t = -7.2; t <= 7.2; t += 1.8) {
                const h = 10 + random() * 2.5
                const stake = part(g, lowCylinder, timber, .6 * o, 2 + h / 2, t, .85, h, .85)
                stake.rotation.z = -.08 * o
                part(g, cone, timber, stake.position.x - Math.sin(stake.rotation.z) * h / 2, 2 + h + .9, t, .85, 1.8, .85)
            }
            for (const y of [5, 9]) part(g, box, darkTimber, -.4 * o, y, 0, .5, .6, TILE_PX)
            // 内側の足場
            part(g, box, timber, -3.2 * o, 5.5, 0, 2.4, .5, TILE_PX)
            if (!human && (lx + ly) % 3 === 0) part(g, sphere, bone, .6 * o, 14.4, 0, 1, 1.1, 1)
        })
    }

    // ---- 物見櫓 ----
    const tower = (lx: number, ly: number, tall: number) => place(cx(lx), cz(ly), 0, g => {
        part(g, box, stone, 0, 1.5, 0, 12, 3, 12)
        for (const x of [-4, 4]) for (const z of [-4, 4]) {
            const post = part(g, lowCylinder, timber, x, tall / 2 + 2, z, .8, tall, .8)
            post.rotation.set(z * -.012, 0, x * .012)
        }
        for (const y of [7, 13]) for (const side of [-1, 1]) {
            part(g, box, darkTimber, side * 4, y, 0, .5, .5, 8.5)
            part(g, box, darkTimber, 0, y, side * 4, 8.5, .5, .5)
        }
        part(g, box, timber, 0, tall + 2, 0, 11.5, .9, 11.5)
        for (const side of [-1, 1]) {
            part(g, box, timber, side * 5.5, tall + 4, 0, .4, 3.4, 11.5)
            part(g, box, timber, 0, tall + 4, side * 5.5, 11.5, 3.4, .4)
        }
        for (const x of [-5.4, 5.4]) for (const z of [-5.4, 5.4]) part(g, lowCylinder, timber, x, tall + 6, z, .35, 5, .35)
        part(g, pyramid, human ? material(0x6a4a37) : canvasAlt, 0, tall + 11, 0, 9, 5, 9)
        // はしご
        part(g, box, darkTimber, -5.2, tall / 2 + 2, -1, .3, tall, .3)
        part(g, box, darkTimber, -5.2, tall / 2 + 2, 1, .3, tall, .3)
        for (let y = 4; y < tall + 2; y += 2.2) part(g, box, darkTimber, -5.2, y, 0, .25, .25, 2)
        if (!human) for (const x of [-5.4, 5.4]) part(g, sphere, bone, x, tall + 9.3, -5.4, .9, 1, .9)
        part(g, lowCylinder, iron, 0, tall + 16, 0, .15, 6, .15)
    })
    for (const s of FORT_STRUCTURES) if (s.kind === 'tower') tower(s.lx, s.ly, 16)
    for (const s of FORT_STRUCTURES) if (s.kind === 'gateTower') tower(s.lx, s.ly, 19)

    // ---- 正門と通用門 ----
    const gateX = cx(FORT_DEPTH - 1), gateZ = (cz(7) + cz(8)) / 2
    part(group, box, darkTimber, gateX, 23.5, gateZ, 2.4, 2.2, TILE_PX * 2 + 10)
    part(group, box, trim, gateX + 1.3, 19.5, gateZ, .2, 6, 12)
    for (const side of [-1, 1]) {
        // 内側に開いた門扉
        const door = part(group, box, timber, gateX - 7, 7.5, gateZ + side * 12, 14, 13, 1)
        door.rotation.y = side * .25
    }
    if (!human) for (const z of [-10, 0, 10]) part(group, sphere, bone, gateX + 1.5, 26, gateZ + z, 1.3, 1.4, 1.3)
    for (const ly of [0, FORT_WIDTH - 1]) {
        const z = cz(ly), x = (cx(5) + cx(6)) / 2
        for (const dx of [-14, 14]) part(group, lowCylinder, timber, x + dx, 8, z, 1.1, 16, 1.1)
        part(group, box, darkTimber, x, 15.5, z, 30, 1.4, 1.6)
    }

    // ---- 施設 ----
    const center = (s: FortStructure) => ({ x: cx(s.lx + (s.w - 1) / 2), z: cz(s.ly + (s.h - 1) / 2), w: s.w * TILE_PX, d: s.h * TILE_PX })
    const banners: THREE.Object3D[] = []
    const flames: THREE.Mesh[] = []
    const sparks: { mesh: THREE.Mesh; x: number; z: number; phase: number }[] = []
    const glows: THREE.Mesh[] = []
    const glowFire = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    const flameMaterial = createFlameMaterial()
    const flamePlane = track(new THREE.PlaneGeometry(1, 1))
    flamePlane.translate(0, .5, 0)
    const sparkMaterial = glowFire(0xffc060, 1)
    const groundGlowMaterial = createGroundGlowMaterial()
    const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xd8461a })
    const charcoal = material(0x231a16)
    const flameMaterials = [flameMaterial, sparkMaterial, groundGlowMaterial]
    const disc = track(new THREE.CircleGeometry(1, 24))
    disc.rotateX(-Math.PI / 2)
    let labelHeight = 40

    for (const s of FORT_STRUCTURES) {
        const { x, z, w, d } = center(s)
        if (s.kind === 'command') {
            labelHeight = 56
            const gold = kit.metal(0xd1b46a)
            const rope = material(0xb9a57c)
            const wall = human ? canvas : canvasAlt
            const roofCloth = human ? trim : canvas
            /** 方形の本陣。基壇・天幕の壁・屋根の半幅と高さ。 */
            const floor = 1.4, deck = 29, half = 22, wallTop = 16, eave = 26, roofHeight = 19
            const apex = wallTop + roofHeight
            /** 2点を結ぶ細い棒（綱など）。 */
            const strut = (g: THREE.Group, mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, r: number) => {
                const line = part(g, lowCylinder, mat, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, r, from.distanceTo(to), r)
                line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
            }
            place(x, z, 0, g => {
                part(g, box, dirt, 0, .3, 0, w + 4, .4, d + 4)
                // 方形の木の基壇と正面の段
                part(g, box, darkTimber, 0, floor / 2, 0, deck * 2, floor, deck * 2)
                part(g, box, timber, 0, floor + .05, 0, deck * 2 - 2, .1, deck * 2 - 2)
                part(g, box, darkTimber, deck + 1.5, .45, 0, 3, .9, 16)
                // 天幕の壁。四隅の柱と、各面の縦縞
                part(g, box, wall, 0, (floor + wallTop) / 2, 0, half * 2, wallTop - floor, half * 2)
                for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, lowCylinder, timber, sx * half, (floor + wallTop) / 2, sz * half, .8, wallTop - floor, .8)
                for (let side = 0; side < 4; side++) {
                    const a = side * Math.PI / 2
                    for (let t = -15; t <= 15; t += 7.5) {
                        if (side === 0 && Math.abs(t) < 5) continue // 入口
                        const nx = Math.cos(a), nz = Math.sin(a)
                        part(g, box, roofCloth, nx * (half + .1) - nz * t, (floor + wallTop) / 2 - .1, nz * (half + .1) + nx * t, .3, wallTop - floor - .2, 2.4).rotation.y = -a
                    }
                    const band = part(g, box, gold, Math.cos(a) * (half + .2), wallTop - .5, Math.sin(a) * (half + .2), .4, .6, half * 2 + .8)
                    band.rotation.y = -a
                }
                // 張り出した方形屋根と、軒先から垂れる房飾り
                part(g, pyramid, roofCloth, 0, wallTop + roofHeight / 2, 0, eave * Math.SQRT2, roofHeight, eave * Math.SQRT2)
                for (let side = 0; side < 4; side++) {
                    const a = side * Math.PI / 2, nx = Math.cos(a), nz = Math.sin(a)
                    for (let t = -eave + 1.5, i = 0; t <= eave - 1.5; t += 3, i++) {
                        part(g, cone, i % 2 ? wall : gold, nx * (eave - .4) - nz * t, wallTop - .6, nz * (eave - .4) + nx * t, .9, 1.6, .9).rotation.x = Math.PI
                    }
                }
                // 屋根の頂の宝珠
                part(g, sphere, gold, 0, apex + .6, 0, 1.2, 1.2, 1.2)
                part(g, lowCylinder, iron, 0, apex + 3.6, 0, .18, 6, .18)
                // 入口：幕を束ねた戸口と、柱で支えた張り出し屋根
                part(g, box, material(0x2b2420), half, floor + 5, 0, .4, 10, 7)
                for (const side of [-1, 1]) {
                    part(g, box, canvasAlt, half + .3, floor + 5, side * 4.3, .3, 10, 1.8).rotation.x = side * .12
                    part(g, kit.cylinder, gold, half + .5, floor + 5, side * 4.3, .4, .4, 1.1)
                    part(g, lowCylinder, timber, 28.6, floor + 5.3, side * 9, .5, 10.6, .5)
                    part(g, sphere, gold, 28.6, floor + 10.8, side * 9, .65, .65, .65)
                    part(g, box, trim, 28.95, floor + 6.4, side * 9, .1, 5.5, 2.4)
                }
                const porch = part(g, box, roofCloth, 25.4, 13, 0, 7.4, .3, 20)
                porch.rotation.z = -.28
                part(g, box, wall, 28.9, 11.5, 0, .2, 1.4, 20)
                part(g, box, gold, 29, 12.1, 0, .1, .3, 20)
                // 軒先から基壇の縁へ張った綱と杭（入口側を除く）
                for (let side = 1; side < 4; side++) {
                    const a = side * Math.PI / 2, nx = Math.cos(a), nz = Math.sin(a)
                    for (const t of [-18, -6, 6, 18]) {
                        const from = new THREE.Vector3(nx * (eave - 1) - nz * t, wallTop + .6, nz * (eave - 1) + nx * t)
                        const to = new THREE.Vector3(nx * (deck - .8) - nz * t, floor, nz * (deck - .8) + nx * t)
                        strut(g, rope, from, to, .08)
                        part(g, lowCylinder, darkTimber, to.x, floor + .4, to.z, .25, .9, .25)
                    }
                }
                // 基壇の四隅の旗竿。後ろ左は本陣の大旗を掲げる
                for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                    const px = sx * (deck - 1.5), pz = sz * (deck - 1.5)
                    if (sx < 0 && sz < 0) continue
                    part(g, lowCylinder, iron, px, floor + 11, pz, .25, 22, .25)
                    part(g, box, darkTimber, px, floor + 20.5, pz, .3, .3, 4)
                    part(g, box, trim, px, floor + 15.5, pz, .12, 10, 3.6)
                    if (human) part(g, sphere, gold, px, floor + 22.4, pz, .6, .6, .6)
                    else part(g, sphere, bone, px, floor + 22.6, pz, 1, 1.1, 1)
                }
                if (!human) {
                    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
                        if ((sx === 0 && sz === 0) || (sx === 1 && sz === 0)) continue
                        if (sx !== 0 && sz !== 0) continue
                        for (const t of [-12, 12]) {
                            const px = sx ? sx * (deck + 1.2) : t, pz = sz ? sz * (deck + 1.2) : t
                            part(g, lowCylinder, darkTimber, px, 6, pz, .5, 12, .5)
                            part(g, sphere, bone, px, 12.8, pz, 1.1, 1.2, 1.1)
                        }
                    }
                }
            })
            // 入口の両脇の篝火
            for (const side of [-1, 1]) {
                const bx = x + 26, bz = z + side * 17
                place(bx, bz, 0, g => {
                    for (let i = 0; i < 3; i++) {
                        const a = i / 3 * Math.PI * 2
                        part(g, lowCylinder, iron, Math.cos(a) * 1.1, floor + 2.6, Math.sin(a) * 1.1, .18, 5.4, .18).rotation.set(Math.sin(a) * .25, 0, -Math.cos(a) * .25)
                    }
                    part(g, cone, iron, 0, floor + 5.8, 0, 2, 1.4, 2).rotation.x = Math.PI
                })
                const flame = new THREE.Mesh(flamePlane, flameMaterial)
                flame.position.set(bx, floor + 6, bz); flame.scale.set(4, 6.2, 1)
                flame.frustumCulled = false
                group.add(flame); flames.push(flame)
            }
            // 本陣の大旗（基壇の後ろ左の隅）
            const poleX = x - (deck - 1.5), poleZ = z - (deck - 1.5)
            part(group, lowCylinder, iron, poleX, 22, poleZ, .35, 44, .35)
            const flag = part(group, curveCloth(10, 6.5), cloth(faction), poleX + 5.2, 40, poleZ, 1, 1, 1)
            flag.name = 'banner'
            banners.push(flag)
            // 頂の小旗
            const pennant = part(group, curveCloth(4.4, 2.2), cloth(faction), x + 2.3, apex + 5.6, z, 1, 1, 1)
            pennant.name = 'banner'
            banners.push(pennant)
        } else if (s.kind === 'barracks') {
            place(x, z, 0, g => {
                for (let i = -1; i <= 1; i++) {
                    const tz = i * 15
                    part(g, prism, i === 0 ? canvasAlt : canvas, 0, .2, tz, 24, 9, 12)
                    part(g, box, darkTimber, 0, 9.3, tz, 25, .4, .4)
                    part(g, box, material(0x2f2a25), 12.1, 2.8, tz, .2, 5, 3)
                    part(g, box, trim, 0, 6, tz + 6.05, 10, 1, .1)
                    for (const px of [-12.5, 12.5]) part(g, lowCylinder, darkTimber, px, 5, tz, .25, 10, .25)
                }
                // 兵舎前の武器と寝具
                for (let i = 0; i < 4; i++) part(g, box, material(0x6d5a43), 14, .6, -18 + i * 12, 3, .8, 5)
            })
        } else if (s.kind === 'stable') {
            place(x, z, 0, g => {
                for (const px of [-22, -7, 7, 22]) for (const pz of [-13, 13]) part(g, lowCylinder, timber, px, 6, pz, .7, 12, .7)
                const roof = part(g, box, human ? material(0x6a4a37) : canvasAlt, 0, 12.5, -2, 48, .8, 32)
                roof.rotation.x = .18
                part(g, box, timber, 0, 1.8, 14, 46, .5, .5)
                part(g, box, timber, 0, 4, 14, 46, .5, .5)
                for (let i = -2; i <= 2; i++) part(g, box, darkTimber, i * 9, 4, -4, .6, 8, 14)
                for (let i = 0; i < 5; i++) part(g, lowCylinder, straw, -18 + i * 9, 1.6, -9, 2.2, 3.2, 2.2).rotation.z = Math.PI / 2
                part(g, box, darkTimber, 0, 1.6, 9, 30, 2, 2.5)
                if (!human) for (let i = 0; i < 5; i++) part(g, lowCylinder, bone, -16 + i * 8, .5, 6, .35, 4, .35).rotation.set(Math.PI / 2, 0, i)
            })
        } else if (s.kind === 'range') {
            place(x, z, 0, g => {
                for (let i = -1; i <= 1; i++) {
                    const tz = i * 14
                    if (human) {
                        // 藁の的
                        const target = part(g, lowCylinder, straw, 18, 6, tz, 4.2, 1.6, 4.2)
                        target.rotation.z = Math.PI / 2
                        // 内側の輪ほど厚くして前面を少しずつ手前に出し、同じ面が重なって明滅しないようにする
                        const rings = [[3, 0xf2efe6], [2, 0xb33a2c], [1, 0xf2efe6], [.45, 0xb33a2c]] as const
                        rings.forEach(([r, c], i) => {
                            const thick = .12 + i * .15
                            const ring = part(g, lowCylinder, material(c), 18.8 + thick / 2, 6, tz, r, thick, r)
                            ring.rotation.z = Math.PI / 2
                        })
                        for (const dz of [-2.6, 2.6]) part(g, lowCylinder, darkTimber, 17.5, 3.5, tz + dz, .25, 7, .25).rotation.z = -.2
                    } else {
                        // 藁人形の訓練台
                        part(g, lowCylinder, darkTimber, 18, 5, tz, .5, 10, .5)
                        part(g, box, darkTimber, 18, 8.5, tz, .5, .5, 7)
                        part(g, sphere, straw, 18, 7, tz, 2, 3, 2)
                        part(g, sphere, straw, 18, 10.5, tz, 1.3, 1.4, 1.3)
                    }
                }
                part(g, box, darkTimber, -18, 1, 0, 1, 2, 30)
            })
        } else if (s.kind === 'depot') {
            place(x, z, random() * Math.PI, g => {
                for (let i = 0; i < 4; i++) part(g, box, timber, -3 + (i % 2) * 6, 2.2 + Math.floor(i / 2) * 4.4, -3 + (i % 3) * 2, 4.4, 4.4, 4.4)
                for (let i = 0; i < 3; i++) part(g, lowCylinder, material(0x7a5534), 4.5, 2.4, -4 + i * 4, 1.8, 4.8, 1.8)
                part(g, box, canvasAlt, 0, 9.8, 0, 13, .3, 13).rotation.z = .1
            })
        } else if (s.kind === 'well') {
            place(x, z, 0, g => {
                if (human) {
                    part(g, lowCylinder, stone, 0, 2, 0, 4.5, 4, 4.5)
                    part(g, lowCylinder, material(0x2b3a40), 0, 4.05, 0, 3.6, .1, 3.6)
                    for (const side of [-1, 1]) part(g, box, timber, side * 4.2, 6, 0, .6, 8, .6)
                    part(g, prism, material(0x6a4a37), 0, 9.5, 0, 11, 3, 7).rotation.y = Math.PI / 2
                } else {
                    // 煮えたぎる大鍋
                    part(g, sphere, iron, 0, 3.5, 0, 4, 3, 4)
                    part(g, lowCylinder, material(0x5f7d2b), 0, 5.7, 0, 3.4, .2, 3.4)
                    for (let i = 0; i < 3; i++) part(g, lowCylinder, darkTimber, Math.cos(i * 2.1) * 3, 4, Math.sin(i * 2.1) * 3, .3, 9, .3).rotation.set(Math.sin(i * 2.1) * .35, 0, -Math.cos(i * 2.1) * .35)
                }
            })
        } else if (s.kind === 'rack') {
            place(x, z, 0, g => {
                for (const side of [-1, 1]) part(g, lowCylinder, timber, 0, 3.5, side * 5, .4, 7, .4)
                part(g, box, darkTimber, 0, 6, 0, .5, .5, 11)
                for (let i = -2; i <= 2; i++) {
                    part(g, lowCylinder, timber, .8, 6, i * 2, .18, 12, .18).rotation.z = -.15
                    part(g, cone, iron, .8 + Math.sin(.15) * 6.3, 12.3, i * 2, .35, 1.2, .35)
                }
            })
        } else if (s.kind === 'barricade') {
            place(x, z, 0, g => {
                // 拒馬（丸太に交差した杭）
                part(g, lowCylinder, darkTimber, 0, 3, 0, 1, d - 2, 1).rotation.x = Math.PI / 2
                for (let t = -d / 2 + 2; t <= d / 2 - 2; t += 3) {
                    for (const lean of [-.75, .75]) {
                        const stake = part(g, lowCylinder, timber, 0, 3, t, .45, 11, .45)
                        stake.rotation.set(0, 0, lean)
                        part(g, cone, timber, Math.sin(-lean) * 5.8, 3 + Math.cos(lean) * 5.8, t, .45, 1.4, .45).rotation.z = lean
                    }
                }
                if (!human) for (let t = -d / 2 + 6; t < d / 2; t += 18) part(g, sphere, bone, 0, 7, t, 1, 1.1, 1)
            })
        } else if (s.kind === 'campfire') {
            place(x, z, 0, g => {
                for (let i = 0; i < 8; i++) part(g, sphere, stone, Math.cos(i / 8 * Math.PI * 2) * 3, .6, Math.sin(i / 8 * Math.PI * 2) * 3, 1, .8, 1)
                for (let i = 0; i < 3; i++) part(g, lowCylinder, darkTimber, 0, .9, 0, .4, 5, .4).rotation.set(Math.PI / 2, 0, i * 1.05)
                // 焚き火を囲む丸太の腰掛け
                for (let i = 0; i < 3; i++) {
                    const a = i * 2.1 + .4
                    part(g, lowCylinder, timber, Math.cos(a) * 8, 1, Math.sin(a) * 8, 1, 6, 1).rotation.set(Math.PI / 2, 0, a)
                }
            })
            // 薪の間に転がる炭。いくつかは赤く熾っている
            for (let i = 0; i < 9; i++) {
                const a = random() * Math.PI * 2, r = .4 + random() * 1.8, size = .35 + random() * .35
                const coal = part(group, sphere, i % 3 === 0 ? charcoal : emberMaterial, x + Math.cos(a) * r, .55, z + Math.sin(a) * r, size, size * .6, size * .8)
                coal.rotation.y = random() * Math.PI
            }
            // カメラを向く板にノイズの炎を描く（ビルボード炎）
            const flame = new THREE.Mesh(flamePlane, flameMaterial)
            flame.position.set(x, .8, z); flame.scale.set(7, 9, 1)
            flame.frustumCulled = false
            group.add(flame); flames.push(flame)
            for (let i = 0; i < 4; i++) {
                const mesh = new THREE.Mesh(sphere, sparkMaterial)
                mesh.scale.setScalar(.18)
                group.add(mesh)
                sparks.push({ mesh, x, z, phase: random() })
            }
            const glow = new THREE.Mesh(disc, groundGlowMaterial)
            glow.position.set(x, .4, z); glow.scale.setScalar(9)
            group.add(glow); glows.push(glow)
        }
    }

    // 外周の旗
    for (const ly of [2, 13]) {
        const x = cx(FORT_DEPTH - 1) - 4, z = cz(ly)
        part(group, lowCylinder, iron, x, 13, z, .22, 26, .22)
        const flag = part(group, curveCloth(5, 3.4), cloth(faction), x + 2.5, 23.5, z, 1, 1, 1)
        flag.name = 'banner'
        banners.push(flag)
    }

    // 旗・炎以外の静的な部材を材質ごとに結合する。
    const dynamic = new Set<THREE.Object3D>([...banners, ...flames, ...sparks.map(p => p.mesh), ...glows])
    const statics = new THREE.Group()
    for (const child of [...group.children]) if (!dynamic.has(child) && (child as THREE.Mesh).material !== emberMaterial) statics.add(child)
    bake(statics)
    group.add(statics)

    group.position.set(fort.x, fort.groundHeight, fort.y)
    group.rotation.y = fort.front === 1 ? 0 : Math.PI
    return {
        group,
        labelHeight,
        update(time: number) {
            banners.forEach((b, i) => { b.rotation.y = Math.sin(time * 2 + i * 1.3) * .2 })
            flameMaterial.uniforms.uTime!.value = time
            for (const s of sparks) {
                const k = (time * .7 + s.phase) % 1
                const a = s.phase * 40 + Math.floor(time * .7 + s.phase) * 2.4
                s.mesh.position.set(s.x + Math.cos(a) * (.5 + k * 2) + Math.sin(time * 6 + a) * .3, 2 + k * 11, s.z + Math.sin(a) * (.5 + k * 2))
                s.mesh.scale.setScalar(.22 * (1 - k))
            }
            groundGlowMaterial.uniforms.uStrength!.value = .32 + Math.sin(time * 9) * .04 + Math.sin(time * 17) * .03
        },
        destroy() {
            group.removeFromParent()
            for (const m of flameMaterials) m.dispose()
            emberMaterial.dispose()
        },
    }
}

/**
 * 焚き火の炎。カメラを向く板に、上へ流れるノイズで揺らぎと千切れを作り、
 * 熱さに応じて暗赤→橙→黄へ色を変える。背景を少し暗くしてから炎を足し、昼でも白く飛ばさずに光って見せる。
 */
function createFlameMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        vertexShader: /* glsl */`
            varying vec2 vUv;
            varying float vSeed;
            void main() {
                vUv = uv;
                vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                vSeed = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453) * 50.0;
                vec2 size = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
                vec4 view = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                view.xy += position.xy * size;
                gl_Position = projectionMatrix * view;
            }
        `,
        fragmentShader: /* glsl */`
            uniform float uTime;
            varying vec2 vUv;
            varying float vSeed;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
                return v;
            }
            void main() {
                float y = vUv.y;
                float x = (vUv.x - 0.5) * 2.0;
                float t = uTime;
                // 上へ流れるノイズで横に揺らし、先端ほど大きく曲げる
                float sway = fbm(vec2(x * 1.2 + vSeed, y * 1.6 - t * 1.8)) - 0.5;
                x += sway * 0.9 * y;
                // 縦に引き伸ばしたノイズを上へ流し、炎の舌の筋を作る
                float n = fbm(vec2(x * 3.6 + vSeed, y * 1.6 - t * 2.6));
                float fine = noise(vec2(x * 6.0 - vSeed, y * 3.0 - t * 4.5));
                // 輪郭は中心から外へなだらかに冷める涙形（内側を平らに飽和させない）
                float width = 0.6 * pow(1.0 - y, 0.55) + 0.02;
                float shape = 1.0 - smoothstep(0.0, width, abs(x));
                // 根元は薪の陰でやや暗く、少し上が最も熱い
                float base = smoothstep(0.02, 0.3, y + (n - 0.5) * 0.2) * smoothstep(0.0, 0.06, y);
                float body = shape * base;
                // ノイズは輪郭の内側にだけ効かせ、上へいくほど冷えて千切れる
                // 根元は安定させ、上へいくほどノイズで揺らぎ千切れる
                float flicker = mix(0.85 + n * 0.3, 0.3 + n * 1.4, smoothstep(0.1, 0.6, y));
                float heat = body * (1.1 - y * 0.8) * flicker - (1.0 - n) * y * 0.5 + (fine - 0.5) * 0.2 * body;
                heat = clamp(heat * 1.4, 0.0, 1.0);
                vec3 color = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.0, 0.35, heat));
                color = mix(color, vec3(1.0, 0.66, 0.15), smoothstep(0.35, 0.7, heat));
                color = mix(color, vec3(1.0, 0.82, 0.42), smoothstep(0.85, 1.0, heat) * 0.35);
                float alpha = smoothstep(0.02, 0.35, heat) * 0.85;
                if (alpha < 0.01) discard;
                // 背景を少し暗くしてから炎を足す（加算だけだと明るい地面の上で白く飛ぶ）
                gl_FragColor = vec4(color * alpha, alpha * 0.55);
            }
        `,
    })
}

/** 焚き火の地面の照り返し。中心から外へ滑らかに消え、円盤の縁を見せない。 */
function createGroundGlowMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: .32 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
            varying vec2 vPos;
            void main() {
                vPos = position.xz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform float uStrength;
            varying vec2 vPos;
            void main() {
                float k = 1.0 - clamp(length(vPos), 0.0, 1.0);
                gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * k * k * k * uStrength, 1.0);
            }
        `,
    })
}
