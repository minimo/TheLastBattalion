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
    const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: .9 })
    const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a1f })
    let labelHeight = 40

    for (const s of FORT_STRUCTURES) {
        const { x, z, w, d } = center(s)
        if (s.kind === 'command') {
            labelHeight = 46
            place(x, z, 0, g => {
                part(g, box, dirt, 0, .3, 0, w + 4, .4, d + 4)
                part(g, lowCylinder, human ? canvas : canvasAlt, 0, 5.5, 0, 13, 10, 13)
                part(g, cone, human ? trim : canvas, 0, 16.5, 0, 15.5, 12, 15.5)
                part(g, lowCylinder, trim, 0, 10.6, 0, 13.4, 1, 13.4)
                part(g, box, material(0x2b2420), 13.1, 4.5, 0, .4, 8, 5)
                part(g, sphere, kit.metal(0xd1b46a), 0, 23.2, 0, .9, .9, .9)
                for (const side of [-1, 1]) {
                    part(g, lowCylinder, darkTimber, 15, 7, side * 5, .35, 14, .35)
                    part(g, box, trim, 15.1, 10, side * 5, .1, 6, 2.6)
                }
                if (!human) {
                    for (let i = 0; i < 6; i++) {
                        const a = i / 6 * Math.PI * 2
                        part(g, lowCylinder, darkTimber, Math.cos(a) * 15.5, 6, Math.sin(a) * 15.5, .5, 12, .5)
                        part(g, sphere, bone, Math.cos(a) * 15.5, 12.8, Math.sin(a) * 15.5, 1.1, 1.2, 1.1)
                    }
                }
            })
            // 本陣の大旗
            part(group, lowCylinder, iron, x - 4, 20, z - 9, .3, 40, .3)
            const flag = part(group, curveCloth(9, 6), cloth(faction), x + .6, 36, z - 9, 1, 1, 1)
            flag.name = 'banner'
            banners.push(flag)
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
                        for (const [r, c] of [[3, 0xf2efe6], [2, 0xb33a2c], [1, 0xf2efe6], [.45, 0xb33a2c]] as const) {
                            const ring = part(g, lowCylinder, material(c), 18.85, 6, tz, r, .1, r)
                            ring.rotation.z = Math.PI / 2
                        }
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
            const flame = new THREE.Mesh(cone, flameMaterial)
            flame.position.set(x, 3.2, z); flame.scale.set(1.6, 4, 1.6)
            group.add(flame); flames.push(flame)
            const ember = new THREE.Mesh(sphere, emberMaterial)
            ember.position.set(x, 1.4, z); ember.scale.set(1.8, .6, 1.8)
            group.add(ember)
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
    const dynamic = new Set<THREE.Object3D>([...banners, ...flames])
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
            flames.forEach((f, i) => {
                const flicker = 1 + Math.sin(time * 13 + i * 2.1) * .12 + Math.sin(time * 23 + i) * .08
                f.scale.set(1.6 * flicker, 4 * (2 - flicker), 1.6 * flicker)
            })
        },
        destroy() {
            group.removeFromParent()
            flameMaterial.dispose(); emberMaterial.dispose()
        },
    }
}
