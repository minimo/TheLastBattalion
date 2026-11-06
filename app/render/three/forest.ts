import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ModelKit } from './models'
import type { MapTheme } from './mapTheme'
import { applyBranchSnow, applyPlantSnow } from './snowCover'
import { TILE_PX } from '../../game/constants'
import type { FortCell } from '../../types/game'

type Tree = { x: number; z: number; h: number; scale: number }
/** 木の部品のメッシュと、木1本あたりのインスタンス数。 */
type TreePart = [THREE.InstancedMesh, number]
/** 木1本ぶんのインスタンス（メッシュとその番号）。 */
type TreeInstance = [THREE.InstancedMesh, number]

/** 木を描き、マスを指定して消せるようにする（拠点の建設で切り払う）。切り株は残さない。 */
export function createForest(trees: Tree[], kit: ModelKit, style: MapTheme['trees'] = { style: 'broadleaf', outsideCount: 0 }) {
    const { group, parts, locate, update, destroy } = createTrees(trees, kit, style)
    const instancesOf = locate ?? ((tree: number) => (parts ?? []).flatMap(([mesh, perTree]) => Array.from({ length: perTree }, (_, k) => [mesh, tree * perTree + k] as TreeInstance)))
    const treesInCell = new Map<string, number[]>()
    trees.forEach((tree, i) => {
        const key = `${Math.round(tree.x / TILE_PX)},${Math.round(tree.z / TILE_PX)}`
        treesInCell.set(key, [...treesInCell.get(key) ?? [], i])
    })
    const felled = new Set<string>()
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const originals: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[] = []
    return {
        group, destroy,
        /** カメラの位置に合わせて木の細かさを切り替える。 */
        update(camera: THREE.Vector3) { update?.(camera) },
        fell(cells: FortCell[]) {
            for (const { gx, gy } of cells) {
                const key = `${gx},${gy}`
                if (felled.has(key)) continue
                felled.add(key)
                for (const tree of treesInCell.get(key) ?? []) for (const [mesh, index] of instancesOf(tree)) {
                    const matrix = new THREE.Matrix4()
                    mesh.getMatrixAt(index, matrix)
                    originals.push({ mesh, index, matrix })
                    mesh.setMatrixAt(index, hidden)
                    mesh.instanceMatrix.needsUpdate = true
                }
            }
        },
        /** 切り払った木を元に戻す（同じ地図で戦い直すとき）。 */
        regrow() {
            for (const { mesh, index, matrix } of originals) {
                mesh.setMatrixAt(index, matrix)
                mesh.instanceMatrix.needsUpdate = true
            }
            originals.length = 0
            felled.clear()
        },
    }
}

/**
 * 小枝に積もった雪の塊の絵。丸い塊を枝に沿って重ね、輪郭をふっくらさせる。
 * 塊の上側を明るく下側を暗く塗り、雪の素材がこの濃淡で厚みを見せる（色は素材が雪の白にする）。
 */
function drawSnowClumps(ctx: CanvasRenderingContext2D) {
    const clumps = [[64, 108, 14], [57, 92, 13], [71, 80, 14], [62, 64, 15], [69, 48, 13], [62, 33, 12], [66, 24, 9]]
    for (const [x, y, r] of clumps) {
        const shade = ctx.createRadialGradient(x! - r! * .2, y! - r! * .45, r! * .1, x!, y!, r!)
        shade.addColorStop(0, '#ffffff'); shade.addColorStop(.65, '#d9d9d9'); shade.addColorStop(1, '#8c8c8c')
        ctx.fillStyle = shade
        ctx.beginPath(); ctx.arc(x!, y!, r!, 0, Math.PI * 2); ctx.fill()
    }
}

/** 葉のついた小枝の絵。根元が絵の下端にある。snowy は葉の代わりに積もった雪の塊を描く。 */
function createLeafMap(snowy = false) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    if (snowy) drawSnowClumps(ctx)
    else {
    ctx.strokeStyle = '#657050'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(63, 125); ctx.lineTo(63, 9); ctx.stroke()
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
        const y = 112 - i * 14
        ctx.save(); ctx.translate(64 + side * 14, y); ctx.rotate(side * .7)
        ctx.fillStyle = snowy ? i % 2 ? '#4f6a4c' : '#3e5a41' : i % 2 ? '#a6b481' : '#83995f'
        ctx.beginPath(); ctx.ellipse(0, -6, 8 - i * .35, 17 - i * .6, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = snowy ? '#6f8670' : '#b2b995'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -18); ctx.stroke()
        ctx.restore()
    }
    }
    const leafMap = new THREE.CanvasTexture(canvas)
    leafMap.colorSpace = THREE.SRGBColorSpace
    leafMap.anisotropy = 4
    return leafMap
}

/**
 * 葉を緑が見えないくらいの雪で覆う。葉の絵の濃淡は少しだけ残して葉の形を見せ、木の中の位置で雪の厚みにむらをつける。
 * 下を向いた面は影になるので、青みのある灰色にする。
 */
function addSnowCover(material: THREE.Material) {
    material.onBeforeCompile = shader => {
        shader.vertexShader = `varying vec3 vSnowWorld;\n` + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vSnowWorld = (instanceMatrix * vec4(transformed, 1.0)).xyz;`)
        shader.fragmentShader = `varying vec3 vSnowWorld;\n` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            float snowDepth = sin(vSnowWorld.x * .62 + sin(vSnowWorld.z * .41) * 1.7) * sin(vSnowWorld.z * .67 + vSnowWorld.y * .5);
            float snowLight = (gl_FrontFacing ? 1.0 : .82) * (.95 + .04 * snowDepth) * (.6 + .42 * dot(diffuseColor.rgb, vec3(.333)));
            diffuseColor.rgb = vec3(.95, .97, 1.0) * snowLight;`)
    }
}

/** 雪が降り続いたときに白くなる葉の高さの範囲（木の形の中での高さ）。森林の木は根元、広葉樹は樹冠の中心が 0。 */
const WOODLAND_SNOW = { low: 6, high: 30 }
const BROADLEAF_SNOW = { low: -10, high: 10 }

/** 森林の木の寸法（木の大きさ1のとき）。太枝は下ほど長く水平に近く、上ほど短く立つ。 */
const WOODLAND = {
    trunk: { height: 22, base: .95, top: .12 },
    boughs: 8,
    bough: { lowest: 9, highest: 20, longest: 6, shortest: 2.5, flattest: 25, steepest: 50, base: .42, tip: .2 },
    twig: { longest: 2.8, shortest: 1.8, spread: .75, base: .17 },
    /** 葉の板の幅と長さ。絵の透明な余白は切り落とす。 */
    leaf: { width: 13, length: 10, crop: { width: .5, top: .9375 } },
}

/** 木の細かさの段階。遠い段階ほど枝と葉を省き、残した葉を大きくして茂り方を保つ。 */
const WOODLAND_LEVELS = [
    { boughs: true, twigs: true, sideLeaves: true, twigLeaves: true, leafScale: 1, shadowEvery: 3 },
    { boughs: true, twigs: false, sideLeaves: false, twigLeaves: true, leafScale: 1.2, shadowEvery: 3 },
    { boughs: false, twigs: false, sideLeaves: false, twigLeaves: false, leafScale: 1.6, shadowEvery: 2 },
]
/** 区画の一辺（px）と、段階を切り替えるカメラからの距離（px）。粗くするときは余裕を持たせ、境目でちらつかないようにする。 */
const WOODLAND_CHUNK = 256
const WOODLAND_LEVEL_DISTANCE = [380, 800]
const WOODLAND_LEVEL_MARGIN = 40
/** 木の高さと枝の広がりを含めた、区画の範囲の余白（px）。 */
const WOODLAND_CHUNK_PADDING = 50

/**
 * 森林の木の形を1本ぶん作る。幹から太枝、太枝から小枝が分かれ、葉の板は根元を枝につけて枝先の向きへ伸ばす。
 * 三角形を増やさないよう、枝は先細りの三角錐にする。
 */
function buildWoodlandTree(detail: typeof WOODLAND_LEVELS[number]) {
    const { trunk, boughs, bough, twig, leaf } = WOODLAND
    const up = new THREE.Vector3(0, 1, 0)
    const wood: THREE.BufferGeometry[] = [], plates: THREE.BufferGeometry[] = []
    const limb = (start: THREE.Vector3, direction: THREE.Vector3, length: number, base: number, tip = 0, sides = 3) => {
        const geometry = new THREE.CylinderGeometry(tip, base, length, sides, 1, true).translate(0, length / 2, 0)
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction)).translate(start.x, start.y, start.z)
        wood.push(geometry)
    }
    /** 根元を base に置いた葉の板。空へ面を向け、向きに合わせて少しひねる。 */
    const plate = (base: THREE.Vector3, direction: THREE.Vector3, roll: number) => {
        const { width, length, crop } = leaf
        const h = length * crop.top * Math.sqrt(detail.leafScale)
        const geometry = new THREE.PlaneGeometry(width * crop.width * detail.leafScale, h).translate(0, h / 2, 0)
        const uv = geometry.getAttribute('uv')
        for (let j = 0; j < uv.count; j++) uv.setXY(j, .5 + (uv.getX(j) - .5) * crop.width, uv.getY(j) * crop.top)
        const along = direction.clone().normalize()
        const face = up.clone().addScaledVector(along, -up.dot(along)).normalize().applyAxisAngle(along, roll)
        const side = along.clone().cross(face)
        geometry.applyMatrix4(new THREE.Matrix4().makeBasis(side, along, face).setPosition(base))
        plates.push(geometry)
    }
    /** 水平に turn だけ振り、rise だけ起こした向き。 */
    const turned = (direction: THREE.Vector3, turn: number, rise: number) => direction.clone().applyAxisAngle(up, turn).setY(direction.y + rise).normalize()

    limb(new THREE.Vector3(), up, trunk.height, trunk.base, trunk.top, 5)
    for (let b = 0; b < boughs; b++) {
        const t = b / (boughs - 1), angle = b * 2.399963
        const elevation = (bough.flattest + (bough.steepest - bough.flattest) * t) * Math.PI / 180
        const direction = new THREE.Vector3(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation))
        const start = new THREE.Vector3(0, bough.lowest + (bough.highest - bough.lowest) * t, 0)
        const length = bough.longest + (bough.shortest - bough.longest) * t
        if (detail.boughs) limb(start, direction, length, bough.base + (bough.tip - bough.base) * t)
        // 太枝の先の葉は、太枝の伸びる向きのまま少し垂らす。
        const end = start.clone().addScaledVector(direction, length * .95)
        plate(end, turned(direction, 0, -.25), Math.sin(b * 3.1) * .9)
        for (const side of [-1, 1]) {
            const twigStart = start.clone().addScaledVector(direction, length * (side < 0 ? .5 : .72))
            const twigDirection = turned(direction, side * twig.spread, .05)
            const twigLength = twig.longest + (twig.shortest - twig.longest) * t
            if (detail.twigs) limb(twigStart, twigDirection, twigLength, twig.base)
            if (detail.twigLeaves) plate(twigStart.clone().addScaledVector(twigDirection, twigLength * .95), turned(twigDirection, 0, -.2), side * (.5 + .5 * Math.sin(b * 1.7)))
            if (detail.sideLeaves) plate(twigStart.clone().addScaledVector(twigDirection, twigLength * .45), turned(twigDirection, side * .9, -.05), Math.cos(b * 2.1) * side)
        }
    }
    // 幹の先を上から覆う葉。
    for (let k = 0; k < 4; k++) {
        const angle = k * Math.PI / 2 + .4
        plate(new THREE.Vector3(0, trunk.height - .6, 0), new THREE.Vector3(Math.cos(angle), .4, Math.sin(angle)), k * .3)
    }
    const woodGeometry = mergeGeometries(wood)!, crownGeometry = mergeGeometries(plates)!
    // 影には葉の板を間引いて描く（葉の形の影は残す）。
    const shadowGeometry = mergeGeometries(plates.filter((_, i) => i % detail.shadowEvery === 0))!
    wood.forEach(g => g.dispose()); plates.forEach(g => g.dispose())
    return { woodGeometry, crownGeometry, shadowGeometry }
}

/**
 * 森林の木。数が桁違いに多いので、形は段階ごとに1本ぶんだけ作って共有し、向きと大きさだけを変える。
 * 木を区画に分けて画面外の区画を描かず、区画ごとにカメラからの距離で段階を切り替える。
 */
function createWoodlandTrees(trees: Tree[], kit: ModelKit, snowy = false) {
    const group = new THREE.Group()
    const leafMap = createLeafMap(snowy)
    const leafMaterial = new THREE.MeshLambertMaterial({ map: leafMap, alphaTest: .25, alphaToCoverage: true, side: THREE.DoubleSide, color: snowy ? 0xffffff : 0xd6d8c2 })
    // 雪原の木ははじめから雪をかぶっている。ほかの地形の木は、雪が降り続くと梢から白くなる。
    if (snowy) addSnowCover(leafMaterial)
    else applyPlantSnow(leafMaterial, WOODLAND_SNOW.low, WOODLAND_SNOW.high)
    // 影だけを落とす板: 通常の描画では画面の外へ飛ばして何も塗らず、影の描画では葉の絵の形どおりに描かれる。
    const shadowMaterial = new THREE.ShaderMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, vertexShader: 'void main() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }' })
    const shadowDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: .25 })
    const levels = WOODLAND_LEVELS.map(buildWoodlandTree)

    const byChunk = new Map<string, number[]>()
    trees.forEach((tree, i) => {
        const key = `${Math.floor(tree.x / WOODLAND_CHUNK)},${Math.floor(tree.z / WOODLAND_CHUNK)}`
        byChunk.set(key, [...byChunk.get(key) ?? [], i])
    })
    const dummy = new THREE.Object3D(), color = new THREE.Color()
    const where: TreeInstance[] = []
    const meshes: THREE.InstancedMesh[] = []
    const chunks = [...byChunk.values()].map(members => {
        // 段階どうしで同じ配置を共有する（拠点の建設で木を消すと全段階から消える）。
        const matrices = new THREE.InstancedBufferAttribute(new Float32Array(members.length * 16), 16)
        const colors = new THREE.InstancedBufferAttribute(new Float32Array(members.length * 3), 3)
        const box = new THREE.Box3()
        members.forEach((tree, local) => {
            const { x, z, h, scale } = trees[tree]!
            dummy.position.set(x, h - .3, z)
            dummy.rotation.set(0, tree * 1.7, 0)
            dummy.scale.set(scale, scale * (1 + .15 * Math.sin(tree)), scale)
            dummy.updateMatrix(); dummy.matrix.toArray(matrices.array, local * 16)
            // 雪の白を濁らせないよう、雪の木は明るさだけを変える。
            if (snowy) color.setScalar(.9 + .1 * Math.sin(tree * 2.8))
            else color.setHSL(.22 + .03 * Math.sin(tree), .22, .54 + .1 * Math.sin(tree * 2.8))
            color.toArray(colors.array, local * 3)
            box.expandByPoint(dummy.position)
        })
        box.expandByScalar(WOODLAND_CHUNK_PADDING)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
            const mesh = new THREE.InstancedMesh(geometry, material, members.length)
            mesh.instanceMatrix = matrices
            mesh.boundingSphere = sphere
            meshes.push(mesh)
            return mesh
        }
        const views = levels.map(({ woodGeometry, crownGeometry, shadowGeometry }, level) => {
            const wood = instanced(woodGeometry, kit.surfaces.bark)
            wood.castShadow = true
            const leaves = instanced(crownGeometry, leafMaterial)
            leaves.instanceColor = colors
            leaves.receiveShadow = true
            const shadow = instanced(shadowGeometry, shadowMaterial)
            shadow.customDepthMaterial = shadowDepth
            shadow.castShadow = true
            const view = new THREE.Group()
            view.add(wood, leaves, shadow)
            view.visible = level === 0
            group.add(view)
            if (level === 0) members.forEach((tree, local) => { where[tree] = [wood, local] })
            return view
        })
        return { views, box, level: 0 }
    })
    const lastCamera = new THREE.Vector3(Infinity, 0, 0)
    const update = (camera: THREE.Vector3) => {
        if (lastCamera.distanceToSquared(camera) < 64) return
        lastCamera.copy(camera)
        for (const chunk of chunks) {
            // カメラから区画までの最短の距離（区画の中なら高さの差だけ）。
            const distance = chunk.box.distanceToPoint(camera)
            let level = 0
            while (level < WOODLAND_LEVEL_DISTANCE.length && distance > WOODLAND_LEVEL_DISTANCE[level]! + (chunk.level <= level ? WOODLAND_LEVEL_MARGIN : 0)) level++
            if (level === chunk.level) continue
            chunk.views[chunk.level]!.visible = false
            chunk.views[level]!.visible = true
            chunk.level = level
        }
    }
    return { group, update, locate: (tree: number): TreeInstance[] => [where[tree]!], destroy() {
        meshes.forEach(mesh => mesh.dispose())
        for (const { woodGeometry, crownGeometry, shadowGeometry } of levels) { woodGeometry.dispose(); crownGeometry.dispose(); shadowGeometry.dispose() }
        leafMaterial.dispose(); leafMap.dispose(); shadowMaterial.dispose(); shadowDepth.dispose()
    } }
}

function createTrees(trees: Tree[], kit: ModelKit, style: NonNullable<MapTheme['trees']>): { group: THREE.Group; parts?: TreePart[]; locate?: (tree: number) => TreeInstance[]; update?: (camera: THREE.Vector3) => void; destroy(): void } {
    if (style.style === 'palm') return createPalms(trees, kit)
    if (style.style === 'dead') return createDeadTrees(trees, kit, style.barkColor ?? 0x4d463e)
    if (style.style === 'woodland') return createWoodlandTrees(trees, kit)
    if (style.style === 'snowy') return createWoodlandTrees(trees, kit, true)
    const group = new THREE.Group()
    // A branch spray with individual leaf silhouettes, shared by all crowns.
    const leafMap = createLeafMap()
    const leafMaterial = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: .25, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .95, color: 0xced3b5 })
    applyPlantSnow(leafMaterial, BROADLEAF_SNOW.low, BROADLEAF_SNOW.high)
    const parts: THREE.BufferGeometry[] = []
    // Layer sprays throughout an irregular volume, rather than stacking cones.
    for (let i = 0; i < 170; i++) {
        const a = i * 2.399963, v = 1 - 2 * (i + .5) / 170
        const r = Math.sqrt(1 - v * v), radius = .6 + .4 * (.5 + .5 * Math.sin(i * 13.7))
        const geometry = new THREE.PlaneGeometry(4.8, 6, 1, 2)
        const position = geometry.getAttribute('position')
        for (let j = 0; j < position.count; j++) position.setZ(j, Math.abs(position.getY(j)) * .18)
        geometry.rotateY(a + .8)
        geometry.rotateZ(Math.sin(i * 3.1) * .8)
        geometry.translate(Math.cos(a) * r * 7 * radius, v * 8 * radius, Math.sin(a) * r * 7 * radius)
        geometry.computeVertexNormals()
        parts.push(geometry)
    }
    const crownGeometry = mergeGeometries(parts)!
    parts.forEach(g => g.dispose())
    const trunkGeometry = new THREE.CylinderGeometry(.55, 1, 1, 12)
    const trunks = new THREE.InstancedMesh(trunkGeometry, kit.surfaces.bark, trees.length)
    const branches = new THREE.InstancedMesh(trunkGeometry, kit.surfaces.bark, trees.length * 5)
    const leaves = new THREE.InstancedMesh(crownGeometry, leafMaterial, trees.length)
    const dummy = new THREE.Object3D(), color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0)
    trees.forEach((tree, i) => {
        dummy.rotation.set(0, 0, 0)
        dummy.position.set(tree.x, tree.h + 8 * tree.scale, tree.z)
        dummy.scale.set(.85 * tree.scale, 16 * tree.scale, .85 * tree.scale)
        dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix)
        for (let j = 0; j < 5; j++) {
            const angle = j * 2.4 + i
            const start = new THREE.Vector3(tree.x, tree.h + (7 + j * 1.2) * tree.scale, tree.z)
            const end = new THREE.Vector3(tree.x + Math.cos(angle) * 5 * tree.scale, tree.h + (16 + j * .6) * tree.scale, tree.z + Math.sin(angle) * 5 * tree.scale)
            const direction = end.clone().sub(start)
            dummy.position.copy(start).lerp(end, .5)
            dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize())
            dummy.scale.set(.28 * tree.scale, direction.length(), .28 * tree.scale)
            dummy.updateMatrix(); branches.setMatrixAt(i * 5 + j, dummy.matrix)
        }
        dummy.rotation.set(0, i * 1.7, 0)
        dummy.position.set(tree.x, tree.h + 19 * tree.scale, tree.z)
        dummy.scale.set(tree.scale, tree.scale * (1 + .15 * Math.sin(i)), tree.scale)
        dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix)
        leaves.setColorAt(i, color.setHSL(.22 + .03 * Math.sin(i), .22, .54 + .1 * Math.sin(i * 2.8)))
    })
    trunks.castShadow = branches.castShadow = leaves.castShadow = true
    leaves.receiveShadow = true
    group.add(trunks, branches, leaves)
    return { group, parts: [[trunks, 1], [branches, 5], [leaves, 1]], destroy() {
        trunks.dispose(); branches.dispose(); leaves.dispose()
        trunkGeometry.dispose(); crownGeometry.dispose(); leafMaterial.dispose(); leafMap.dispose()
    } }
}

/** 伐採地の切り株: 樹皮の側面と、明るい切り口。 */
export function createStumps(stumps: Tree[], kit: ModelKit) {
    const geometry = new THREE.CylinderGeometry(.82, 1, 1, 9)
    const cut = new THREE.MeshStandardMaterial({ color: 0xb99a6b, roughness: .9 })
    const mesh = new THREE.InstancedMesh(geometry, [kit.surfaces.bark, cut, kit.surfaces.bark], stumps.length)
    const dummy = new THREE.Object3D()
    stumps.forEach((stump, i) => {
        const height = (1.6 + .7 * Math.sin(i * 2.3)) * stump.scale
        dummy.position.set(stump.x, stump.h + height / 2 - .2, stump.z)
        dummy.rotation.set(.08 * Math.sin(i * 1.7), i * 1.3, .08 * Math.cos(i * 1.1))
        dummy.scale.set(1.5 * stump.scale, height, 1.5 * stump.scale)
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.castShadow = mesh.receiveShadow = true
    return { mesh, destroy() { mesh.dispose(); geometry.dispose(); cut.dispose() } }
}

/** オアシスのヤシ: 少し傾いて反った幹と、垂れ下がる羽状の葉。 */
function createPalms(trees: Tree[], kit: ModelKit) {
    const group = new THREE.Group()
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#6d6a3e'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(32, 252); ctx.lineTo(32, 4); ctx.stroke()
    // Leaflets along the midrib, shorter towards the tip.
    for (let i = 0; i < 26; i++) for (const side of [-1, 1]) {
        const y = 246 - i * 9.4, length = 28 * (1 - i / 30)
        ctx.strokeStyle = i % 2 ? '#7f9a4c' : '#6c8a3f'; ctx.lineWidth = 3.2
        ctx.beginPath(); ctx.moveTo(32, y); ctx.quadraticCurveTo(32 + side * length * .6, y - 4, 32 + side * length, y - 12); ctx.stroke()
    }
    const frondMap = new THREE.CanvasTexture(canvas)
    frondMap.colorSpace = THREE.SRGBColorSpace
    frondMap.anisotropy = 4
    const frondMaterial = new THREE.MeshStandardMaterial({ map: frondMap, alphaTest: .3, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .9, color: 0xd7dcb8 })
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 11; i++) {
        // A frond arches up from the crown and droops towards its tip.
        const geometry = new THREE.PlaneGeometry(5, 13, 1, 8)
        geometry.translate(0, 6.5, 0)
        const position = geometry.getAttribute('position')
        const lift = .5 + .5 * Math.sin(i * 2.7)
        for (let j = 0; j < position.count; j++) {
            const t = position.getY(j) / 13
            position.setXYZ(j, position.getX(j) * (1 - t * .5), (lift * 1.5 + 1.5) * t * 4 - t * t * 9, t * 12)
        }
        geometry.rotateY(i * 2.399963)
        geometry.computeVertexNormals()
        parts.push(geometry)
    }
    const crownGeometry = mergeGeometries(parts)!
    parts.forEach(g => g.dispose())
    const SEGMENTS = 5
    const trunkGeometry = new THREE.CylinderGeometry(.7, .85, 1, 10)
    const trunkMaterial = kit.surfaces.bark.clone()
    trunkMaterial.color.set(0x8a7559)
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length * SEGMENTS)
    const crowns = new THREE.InstancedMesh(crownGeometry, frondMaterial, trees.length)
    const dummy = new THREE.Object3D(), color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0)
    const start = new THREE.Vector3(), end = new THREE.Vector3(), direction = new THREE.Vector3()
    trees.forEach((tree, i) => {
        const lean = i * 2.3, leanX = Math.cos(lean), leanZ = Math.sin(lean)
        const height = 22 * tree.scale, bend = (2 + 2 * (.5 + .5 * Math.sin(i * 1.9))) * tree.scale
        start.set(tree.x, tree.h - .5, tree.z)
        for (let k = 0; k < SEGMENTS; k++) {
            const t = (k + 1) / SEGMENTS
            end.set(tree.x + leanX * bend * t * t * 2, tree.h + height * t, tree.z + leanZ * bend * t * t * 2)
            direction.subVectors(end, start)
            dummy.position.copy(start).lerp(end, .5)
            dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize())
            const taper = 1 - t * .35
            dummy.scale.set(taper * tree.scale, direction.length() + .3, taper * tree.scale)
            dummy.updateMatrix(); trunks.setMatrixAt(i * SEGMENTS + k, dummy.matrix)
            start.copy(end)
        }
        dummy.quaternion.identity()
        dummy.rotation.set(0, i * 1.3, 0)
        dummy.position.copy(end)
        dummy.scale.setScalar(tree.scale)
        dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix)
        crowns.setColorAt(i, color.setHSL(.2 + .02 * Math.sin(i), .25, .55 + .08 * Math.sin(i * 2.8)))
    })
    trunks.castShadow = crowns.castShadow = true
    crowns.receiveShadow = true
    group.add(trunks, crowns)
    return { group, parts: [[trunks, SEGMENTS], [crowns, 1]], destroy() {
        trunks.dispose(); crowns.dispose()
        trunkGeometry.dispose(); crownGeometry.dispose(); frondMaterial.dispose(); frondMap.dispose(); trunkMaterial.dispose()
    } }
}

/** 葉の落ちた枯れ木: ねじれた幹から、枝が上と外へ伸び、枝先がさらに分かれる。 */
/** 枯れ木の梢の高さ（木の大きさ1のとき）。小枝の先までの高さで、雪が梢から下りてくる範囲になる。 */
const DEAD_TREE_CROWN = 24

function createDeadTrees(trees: Tree[], kit: ModelKit, barkColor: number) {
    const group = new THREE.Group()
    const BRANCHES = 6, TWIGS = 2
    const geometry = new THREE.CylinderGeometry(.5, 1, 1, 8)
    const material = kit.surfaces.bark.clone()
    material.color.set(barkColor)
    // 雪が降り続くと、枝と幹の上の面に梢から雪が積もる。
    applyBranchSnow(material)
    // 幹と枝は数が違うので、枝ごとの雪の積もり方の値を持たせるために形を分ける。
    const trunkGeometry = geometry.clone()
    const trunkPlace = new Float32Array(trees.length * 2 * 2), branchPlace = new Float32Array(trees.length * BRANCHES * (1 + TWIGS) * 2)
    const trunks = new THREE.InstancedMesh(trunkGeometry, material, trees.length * 2)
    const branches = new THREE.InstancedMesh(geometry, material, trees.length * BRANCHES * (1 + TWIGS))
    const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0)
    const direction = new THREE.Vector3()
    let ground = 0, crown = 1
    const limb = (mesh: THREE.InstancedMesh, index: number, start: THREE.Vector3, end: THREE.Vector3, width: number) => {
        // 木の中での高さ（根元 0 〜 梢 1）と、木の立つ高さ。
        const place = mesh === trunks ? trunkPlace : branchPlace
        place[index * 2] = ((start.y + end.y) / 2 - ground) / crown
        place[index * 2 + 1] = ground
        direction.subVectors(end, start)
        dummy.position.copy(start).lerp(end, .5)
        dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize())
        dummy.scale.set(width, direction.length(), width)
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix)
    }
    trees.forEach((tree, i) => {
        const s = tree.scale, wobble = i * 1.7
        const base = new THREE.Vector3(tree.x, tree.h - .5, tree.z)
        ground = tree.h; crown = DEAD_TREE_CROWN * s
        const middle = new THREE.Vector3(tree.x + Math.cos(wobble) * 1.2 * s, tree.h + 8 * s, tree.z + Math.sin(wobble) * 1.2 * s)
        const top = new THREE.Vector3(tree.x - Math.cos(wobble) * .8 * s, tree.h + 16 * s, tree.z - Math.sin(wobble) * .8 * s)
        limb(trunks, i * 2, base, middle, 1 * s)
        limb(trunks, i * 2 + 1, middle, top, .6 * s)
        for (let j = 0; j < BRANCHES; j++) {
            const angle = j * 2.4 + i, rise = j / (BRANCHES - 1)
            const start = middle.clone().lerp(top, .1 + rise * .85)
            const length = (7 - rise * 3) * s
            const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * length, length * (.55 + .3 * Math.sin(i + j)), Math.sin(angle) * length))
            const index = (i * BRANCHES + j) * (1 + TWIGS)
            limb(branches, index, start, end, .3 * s)
            for (let k = 0; k < TWIGS; k++) {
                const twigAngle = angle + (k ? .8 : -.8)
                const twigEnd = end.clone().add(new THREE.Vector3(Math.cos(twigAngle) * 2.6 * s, 2.2 * s, Math.sin(twigAngle) * 2.6 * s))
                limb(branches, index + 1 + k, end, twigEnd, .14 * s)
            }
        }
    })
    trunkGeometry.setAttribute('snowPlace', new THREE.InstancedBufferAttribute(trunkPlace, 2))
    geometry.setAttribute('snowPlace', new THREE.InstancedBufferAttribute(branchPlace, 2))
    trunks.castShadow = branches.castShadow = true
    trunks.receiveShadow = true
    group.add(trunks, branches)
    return { group, parts: [[trunks, 2], [branches, BRANCHES * (1 + TWIGS)]], destroy() { trunks.dispose(); branches.dispose(); geometry.dispose(); trunkGeometry.dispose(); material.dispose() } }
}
