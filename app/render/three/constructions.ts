import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Army, Construction, ConstructionPlan, FortCell, Point } from '../../types/game'
import { TILE_PX } from '../../game/constants'
import { OUTPOST_SIZE } from '../../game/battleConfig'
import { BRIDGE_HEIGHT } from './heightfield'
import { FACTION, OCCLUDER_LAYER, type ModelKit } from './models'

type Height = (x: number, y: number) => number

interface Visual {
    site: Construction
    /** 作ったときの持ち主（占領されたら作り直す）。 */
    owner: Army
    group: THREE.Group
    /** 建てる順に並べた部材。進み具合に応じて見せる。 */
    pieces: THREE.Group[]
    /** 建設予定地の印（完成すると消える）。 */
    plot: THREE.Group
    geometries: THREE.BufferGeometry[]
    /** 橋の床のマス（兵が床の高さに立つ）。 */
    deck: Set<string>
}

const cellKey = (gx: number, gy: number) => `${gx},${gy}`
/** 建設予定地の面の、1マスの分割数と地面から浮かせる高さ。 */
const PLOT_SEGMENTS = 4
const PLOT_LIFT = .6
/** 建設場所の下見の不透明度と、置ける・置けないの色へ寄せる割合。 */
const PREVIEW_OPACITY = .55
const PREVIEW_TINT = { ok: new THREE.Color(0x9be38f), bad: new THREE.Color(0xff3b2a) }
const PREVIEW_TINT_AMOUNT = { ok: .3, bad: .65 }

/** 組み立てる建設物（下見ではまだIDや作業の地点がない）。 */
type ModelSite = ConstructionPlan & Partial<Pick<Construction, 'id' | 'approach'>>

/**
 * 工兵の建設物（拠点・バリケード・橋）を描く。部材は建設の進み具合に合わせて順に現れ、
 * 建設中は敷地を所属色で示す。建設場所を選んでいる間は、完成した姿を半透明で下見させ、置ける・置けないを色で示す。
 */
export function createConstructionRenderer(kit: ModelKit, groundAt: Height) {
    const { part, bake, box, cone, sphere, material, cloth, track } = kit
    const group = new THREE.Group()
    group.name = 'constructions'
    const visuals = new Map<number, Visual>()
    const lowCylinder = track(new THREE.CylinderGeometry(1, 1, 1, 8))
    const plotGeometry = track(new THREE.BoxGeometry(TILE_PX - 1.5, 1, TILE_PX - 1.5))
    const plotMaterial = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const plotMaterials = { player: plotMaterial(FACTION.player, .3), cpu: plotMaterial(FACTION.cpu, .22) }
    const flagGeometry = kit.curveCloth(6, 4)
    const flat = (p: Point) => Math.max(.4, groundAt(p.x, p.y))

    /** 建設予定地の面。マスを細かく分けて各点の高さを地形から拾い、斜面に沿わせる（地形にめり込まない）。 */
    const plotSurface = (cells: FortCell[]) => {
        const parts = cells.map(c => {
            const size = TILE_PX - 1.5
            const cell = new THREE.PlaneGeometry(size, size, PLOT_SEGMENTS, PLOT_SEGMENTS).rotateX(-Math.PI / 2).translate(c.gx * TILE_PX, 0, c.gy * TILE_PX)
            const position = cell.getAttribute('position')
            for (let i = 0; i < position.count; i++) position.setY(i, flat({ x: position.getX(i), y: position.getZ(i) }) + PLOT_LIFT)
            return cell
        })
        const merged = mergeGeometries(parts)!
        parts.forEach(part => part.dispose())
        return merged
    }

    /** 一時グループに組み立て、位置・向きを焼き込んで部材へ移す。 */
    const place = (target: THREE.Group, x: number, y: number, z: number, yaw: number, pitch: number, build: (g: THREE.Group) => void) => {
        const temp = new THREE.Group()
        build(temp)
        temp.position.set(x, y, z); temp.rotation.set(pitch, yaw, 0, 'YXZ'); temp.updateMatrix()
        for (const child of [...temp.children]) { child.applyMatrix4(temp.matrix); target.add(child) }
    }

    /** 橋の床の高さ: 両岸の高さを結ぶ坂（川の上では最低でも橋の高さ）。 */
    const deckLine = (site: Pick<Construction, 'ends'>, ground: Height = groundAt) => {
        const [a, b] = site.ends as [Point, Point]
        const ha = Math.max(BRIDGE_HEIGHT, ground(a.x, a.y)), hb = Math.max(BRIDGE_HEIGHT, ground(b.x, b.y))
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
        return {
            a, b, ha, hb, length, yaw: Math.atan2(dx, dy),
            at: (x: number, y: number) => {
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (length * length)))
                return ha + (hb - ha) * t
            },
        }
    }

    /**
     * 建設物の部材を組み立てて target に加える（建てる順に並べて返す）。ground は部材を置く地面の高さ。
     * finish は部材ごとに、焼き込んだあとに呼ぶ。
     */
    const assemble = (site: ModelSite, target: THREE.Group, geometries: THREE.BufferGeometry[], ground: Height, finish?: (piece: THREE.Group) => void) => {
        const pieces: THREE.Group[] = []
        const human = site.owner === 'player'
        const timber = human ? kit.surfaces.wood : material(0x4c3d31)
        const darkTimber = material(human ? 0x5d4733 : 0x2f2621)
        const dirt = material(human ? 0x76684d : 0x6b5c48)
        const bone = material(0xe4dac0)
        const banner = cloth(FACTION[site.owner])
        let seed = (site.id ?? 0) * 7919 + 13
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
        const piece = (fill: (g: THREE.Group) => void) => {
            const g = new THREE.Group()
            fill(g)
            bake(g)
            finish?.(g)
            for (const child of g.children) geometries.push((child as THREE.Mesh).geometry)
            pieces.push(g)
            target.add(g)
        }
        /** 尖った丸太を並べた柵（ローカル +Z の向きに TILE_PX の長さ）。 */
        const palisade = (g: THREE.Group, height: number) => {
            part(g, box, dirt, 0, .9, 0, 7, 2, TILE_PX + .2)
            for (let t = -6.6; t <= 6.6; t += 2.2) {
                const h = height + random() * 2
                part(g, lowCylinder, timber, 0, 1.5 + h / 2, t, .8, h, .8)
                part(g, cone, timber, 0, 1.5 + h + .8, t, .8, 1.6, .8)
            }
            part(g, box, darkTimber, -.6, height * .6, 0, .45, .55, TILE_PX)
            if (!human && random() < .3) part(g, sphere, bone, .6, height + 2.6, 0, .9, 1, .9)
        }

        if (site.kind === 'outpost') {
            const half = (OUTPOST_SIZE - 1) / 2
            const center = site.center
            const local = (c: FortCell) => ({ dx: Math.round(c.gx - center.x / TILE_PX), dy: Math.round(c.gy - center.y / TILE_PX) })
            // 柵は中心の周りを一回りする順に立てる。
            const walls = [...site.walls].sort((p, q) => {
                const a = local(p), b = local(q)
                return Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx)
            })
            for (const c of walls) {
                const { dx, dy } = local(c)
                const x = c.gx * TILE_PX, z = c.gy * TILE_PX, h = ground(x, z)
                if (Math.abs(dx) === half && Math.abs(dy) === half) {
                    // 四隅の見張り台
                    piece(g => place(g, x, h, z, 0, 0, t => {
                        part(t, box, dirt, 0, 1, 0, 11, 2, 11)
                        for (const px of [-3.5, 3.5]) for (const pz of [-3.5, 3.5]) part(t, lowCylinder, timber, px, 8, pz, .7, 15, .7)
                        part(t, box, timber, 0, 14, 0, 10, .7, 10)
                        for (const side of [-1, 1]) { part(t, box, timber, side * 4.8, 15.6, 0, .4, 2.6, 10); part(t, box, timber, 0, 15.6, side * 4.8, 10, 2.6, .4) }
                        part(t, cone, human ? material(0x6a4a37) : cloth(0x6d4c3a), 0, 20.5, 0, 7.5, 4.5, 7.5)
                    }))
                } else {
                    const alongZ = Math.abs(dx) === half
                    piece(g => place(g, x, h, z, alongZ ? 0 : Math.PI / 2, 0, t => palisade(t, 9)))
                }
            }
            // 門（四方の真ん中）
            for (const [dx, dy] of [[0, -half], [0, half], [-half, 0], [half, 0]] as const) {
                const x = center.x + dx * TILE_PX, z = center.y + dy * TILE_PX, h = ground(x, z)
                piece(g => place(g, x, h, z, dx === 0 ? Math.PI / 2 : 0, 0, t => {
                    for (const side of [-1, 1]) part(t, lowCylinder, darkTimber, 0, 7, side * 7.4, 1, 14, 1)
                    part(t, box, darkTimber, 0, 13.5, 0, 1.4, 1.2, TILE_PX + 1)
                    part(t, box, banner, .8, 11.6, 0, .15, 2.6, 6)
                }))
            }
            // 内側: 補給の天幕・物資・旗
            const tent = { x: center.x - TILE_PX, y: center.y - TILE_PX }
            piece(g => place(g, tent.x, ground(tent.x, tent.y), tent.y, .4, 0, t => {
                part(t, lowCylinder, cloth(human ? 0xe5dcc5 : 0x8d6a4c), 0, 3, 0, 7, 6, 7)
                part(t, cone, human ? banner : cloth(0x6d4c3a), 0, 9, 0, 8.5, 6, 8.5)
            }))
            const crates = { x: center.x + TILE_PX, y: center.y + TILE_PX }
            piece(g => place(g, crates.x, ground(crates.x, crates.y), crates.y, random() * Math.PI, 0, t => {
                for (let i = 0; i < 3; i++) part(t, box, timber, -2.5 + i * 2.6, 1.6 + (i === 1 ? 3 : 0), (i % 2) * 2, 3.2, 3.2, 3.2)
                for (let i = 0; i < 2; i++) part(t, lowCylinder, material(0x7a5534), 4, 1.8, -2 + i * 3.4, 1.4, 3.6, 1.4)
                // 矢の束
                for (let i = 0; i < 4; i++) part(t, lowCylinder, material(0xd8c39a), -3 + i * .5, 4.2, -3, .12, 6, .12).rotation.z = .3
            }))
            piece(g => {
                const h = ground(center.x, center.y)
                part(g, lowCylinder, kit.metal(0x5a5f62), center.x, h + 11, center.y, .25, 22, .25)
                const flag = part(g, flagGeometry, banner, center.x + 3.1, h + 19.5, center.y, 1, 1, 1)
                flag.rotation.y = .3
            })
        } else if (site.kind === 'barricade') {
            const yaw = site.axis === 'y' ? 0 : Math.PI / 2
            const walls = [...site.walls].sort((p, q) => (p.gx + p.gy) - (q.gx + q.gy))
            for (const c of walls) {
                const x = c.gx * TILE_PX, z = c.gy * TILE_PX
                piece(g => place(g, x, ground(x, z), z, yaw, 0, t => {
                    // 拒馬（丸太に交差した杭）
                    part(t, lowCylinder, darkTimber, 0, 3, 0, 1, TILE_PX, 1).rotation.x = Math.PI / 2
                    for (let k = -6; k <= 6; k += 3) for (const lean of [-.75, .75]) {
                        part(t, lowCylinder, timber, 0, 3, k, .45, 11, .45).rotation.z = lean
                        part(t, cone, timber, Math.sin(-lean) * 5.8, 3 + Math.cos(lean) * 5.8, k, .45, 1.4, .45).rotation.z = lean
                    }
                    if (!human && random() < .4) part(t, sphere, bone, 0, 7, 0, 1, 1.1, 1)
                }))
            }
        } else {
            const line = deckLine(site, ground)
            const rows = new Set(site.deck.map(c => site.axis === 'x' ? c.gy : c.gx)).size
            const width = rows * TILE_PX - 2
            // 工兵が作業する岸から、向こう岸へ床を伸ばしていく。
            const approach = site.approach ?? line.a
            const fromA = Math.hypot(approach.x - line.a.x, approach.y - line.a.y) <= Math.hypot(approach.x - line.b.x, approach.y - line.b.y)
            const segments = Math.max(2, Math.ceil(line.length / 8))
            const pitch = -Math.atan2(line.hb - line.ha, line.length)
            for (let k = 0; k < segments; k++) {
                const i = fromA ? k : segments - 1 - k
                const t = (i + .5) / segments
                const x = line.a.x + (line.b.x - line.a.x) * t, z = line.a.y + (line.b.y - line.a.y) * t
                const h = line.ha + (line.hb - line.ha) * t
                const length = line.length / segments + .2
                piece(g => place(g, x, h, z, line.yaw, pitch, d => {
                    part(d, box, timber, 0, -.6, 0, width, 1.2, length)
                    for (let p = -length / 2 + 1; p < length / 2; p += 2.4) part(d, box, darkTimber, 0, .05, p, width - .6, .15, .5)
                    for (const side of [-1, 1]) {
                        part(d, box, timber, side * (width / 2 - .3), 3.4, 0, .5, .6, length)
                        part(d, lowCylinder, darkTimber, side * (width / 2 - .3), 1.7, 0, .35, 3.4, .35)
                        // 橋脚（1区画おき）
                        if (i % 2 === 0) part(d, lowCylinder, darkTimber, side * (width / 2 - 1.5), -6, 0, .8, 11, .8)
                    }
                }))
            }
        }
        return pieces
    }

    const build = (site: Construction): Visual => {
        const visual: Visual = { site, owner: site.owner, group: new THREE.Group(), pieces: [], plot: new THREE.Group(), geometries: [], deck: new Set(site.deck.map(c => cellKey(c.gx, c.gy))) }
        visual.pieces = assemble(site, visual.group, visual.geometries, groundAt)
        // 建設予定地の印
        const plot = plotSurface(site.area)
        visual.geometries.push(plot)
        const mesh = new THREE.Mesh(plot, plotMaterials[site.owner])
        mesh.renderOrder = 2
        mesh.raycast = () => {}
        visual.plot.add(mesh)
        visual.group.add(visual.plot)
        group.add(visual.group)
        return visual
    }

    const remove = (visual: Visual) => {
        visual.group.removeFromParent()
        visual.geometries.forEach(g => g.dispose())
    }

    // ---- 建設場所の下見 ----
    const previewGroup = new THREE.Group()
    group.add(previewGroup)
    let previewGeometries: THREE.BufferGeometry[] = []
    let previewKey = ''
    const previewPlate = new THREE.Mesh(plotGeometry, plotMaterial(PREVIEW_TINT.bad.getHex(), .5))
    previewPlate.raycast = () => {}
    /** 部材の色の半透明の写し（置ける・置けないで色が違う）。 */
    const previewMaterials = new Map<THREE.Material, { ok: THREE.Material; bad: THREE.Material }>()
    const previewMaterial = (source: THREE.Material, valid: boolean) => {
        let pair = previewMaterials.get(source)
        if (!pair) {
            const tinted = (kind: 'ok' | 'bad') => {
                const copy = source.clone() as THREE.MeshStandardMaterial
                copy.transparent = true
                copy.opacity = PREVIEW_OPACITY
                copy.color.lerp(PREVIEW_TINT[kind], PREVIEW_TINT_AMOUNT[kind])
                return copy
            }
            pair = { ok: tinted('ok'), bad: tinted('bad') }
            previewMaterials.set(source, pair)
        }
        return valid ? pair.ok : pair.bad
    }
    /** 部材の足元のマスの中で一番高い地面。ここに置けば、斜面でも部材が地形にめり込まない。 */
    const previewGround: Height = (x, y) => {
        const half = TILE_PX / 2
        return Math.max(groundAt(x, y), groundAt(x - half, y - half), groundAt(x + half, y - half), groundAt(x - half, y + half), groundAt(x + half, y + half))
    }
    const clearPreview = () => {
        previewGroup.clear()
        previewGeometries.forEach(kit.release)
        previewGeometries = []
    }

    return {
        group,
        update(sites: Construction[]) {
            const alive = new Set<number>()
            for (const site of sites) {
                alive.add(site.id)
                let visual = visuals.get(site.id)
                // 新しい戦闘では同じIDの建設物が別物になる。
                if (visual && (visual.site !== site || visual.owner !== site.owner)) { remove(visual); visual = undefined }
                if (!visual) { visual = build(site); visuals.set(site.id, visual) }
                const shown = site.complete ? visual.pieces.length : Math.floor(site.progress * visual.pieces.length)
                visual.pieces.forEach((p, i) => { p.visible = i < shown })
                visual.plot.visible = !site.complete
            }
            for (const [id, visual] of visuals) if (!alive.has(id)) { remove(visual); visuals.delete(id) }
        },
        /** 完成した橋の上なら床の高さ（兵や旗を床に乗せる）。 */
        surfaceAt(x: number, y: number): number | undefined {
            for (const visual of visuals.values()) {
                const site = visual.site
                if (site.kind !== 'bridge' || !site.complete) continue
                if (!visual.deck.has(cellKey(Math.round(x / TILE_PX), Math.round(y / TILE_PX)))) continue
                return deckLine(site).at(x, y)
            }
            return undefined
        },
        /** 建設場所の下見。完成した姿を半透明で描き、置ければ緑、置けなければ赤に寄せる。マスが変わったときだけ組み立て直す。 */
        preview(plan: ConstructionPlan | null) {
            const key = plan?.area.length ? JSON.stringify([plan.kind, plan.axis, plan.owner, plan.center, plan.ends, plan.valid]) : ''
            if (key === previewKey) return
            previewKey = key
            clearPreview()
            if (!plan?.area.length) return
            // 向こう岸が決まらない橋は姿がないので、指しているマスを赤く示す。
            if (plan.kind === 'bridge' && plan.ends.length < 2) {
                const { x, y } = plan.center
                previewPlate.position.set(x, previewGround(x, y) + .5, y)
                previewGroup.add(previewPlate)
                return
            }
            assemble(plan, previewGroup, previewGeometries, previewGround, piece => {
                for (const child of [...piece.children]) {
                    const mesh = child as THREE.Mesh
                    // 隠れ判定用の形は持たせない（下見は旗を隠さない）。
                    if (mesh.layers.isEnabled(OCCLUDER_LAYER)) { piece.remove(mesh); continue }
                    mesh.material = previewMaterial(mesh.material as THREE.Material, plan.valid)
                    mesh.castShadow = mesh.receiveShadow = false
                    mesh.renderOrder = 3
                    mesh.raycast = () => {}
                }
            })
        },
        destroy() {
            visuals.forEach(remove); visuals.clear()
            clearPreview()
            previewMaterials.forEach(pair => { pair.ok.dispose(); pair.bad.dispose() })
            ;(previewPlate.material as THREE.Material).dispose()
            Object.values(plotMaterials).forEach(m => m.dispose())
            group.removeFromParent()
        },
    }
}
export type ConstructionRenderer = ReturnType<typeof createConstructionRenderer>
