import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Owner, Point } from '../../types/game'
import { FACTION } from './models'

type SurfaceHeight = (x: number, y: number) => number
/** 地形などに隠れた部分の不透明度。丘の裏へ回り込む経路も、薄く透けて見える。 */
const HIDDEN_OPACITY = .3
/** 三角の長さと根元の半幅（px）。ラインは三角の根元で止め、先は三角だけで示す。 */
const HEAD_LENGTH = 18
const HEAD_HALF_WIDTH = 10

type Head = {
    vertices: THREE.Vector3[]
    geometry: LineGeometry
    /** 三角の根元で切った区間の番号（切る前の終わりへ戻すため）。 */
    cut: number
    shown: THREE.Mesh
    hidden: THREE.Mesh
}

/** Screen-width strokes and solid arrowheads remain readable at every zoom level. */
export function createPathOverlay(camera: THREE.Camera, canvas: HTMLElement, heightAt: SurfaceHeight, isOccluded: (point: THREE.Vector3) => boolean) {
    const group = new THREE.Group()
    type Materials = { line: LineMaterial; head: THREE.MeshBasicMaterial }
    /** ラインは見えている部分（shown）と地形などに隠れた部分（hidden）を深度で分けて描く。 */
    const materials = new Map<Owner, { shown: Materials; hidden: Materials }>()
    const heads: Head[] = []
    // 三角は画面に向いた板なので、地形と深度を比べると斜面に一部が埋もれる。
    // 深度は比べず、終点が隠れているかどうかで濃い方か薄い方の一方だけを出す。
    const createMaterials = (owner: Owner, depthFunc: THREE.DepthModes, opacity: number): Materials => ({
        line: new LineMaterial({ color: FACTION[owner], linewidth: 6, transparent: true, opacity, depthFunc, depthWrite: false }),
        head: new THREE.MeshBasicMaterial({ color: FACTION[owner], side: THREE.DoubleSide, transparent: true, opacity, depthTest: false, depthWrite: false }),
    })
    const getMaterials = (owner: Owner) => {
        if (!materials.has(owner)) materials.set(owner, {
            shown: createMaterials(owner, THREE.LessEqualDepth, .95),
            hidden: createMaterials(owner, THREE.GreaterDepth, HIDDEN_OPACITY),
        })
        return materials.get(owner)!
    }
    const clear = () => {
        // 見えている部分と隠れた部分は形を共有しているので、二重に捨てない。
        new Set(group.children.map(child => (child as THREE.Mesh).geometry)).forEach(geometry => geometry.dispose())
        group.clear(); heads.length = 0
    }
    /** ラインの区間 index の終わりを point にする（区間の始まり・終わりは instanceStart/instanceEnd で一続きに並ぶ）。 */
    const setSegmentEnd = (geometry: LineGeometry, index: number, point: THREE.Vector3) => {
        const data = (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
        data.array[index * 6 + 3] = point.x; data.array[index * 6 + 4] = point.y; data.array[index * 6 + 5] = point.z
        data.needsUpdate = true
    }
    const toScreen = (point: THREE.Vector3, width: number, height: number) => {
        const p = point.clone().project(camera)
        return { x: (p.x + 1) * width / 2, y: (p.y + 1) * height / 2, z: p.z }
    }
    return { group, clear, add(points: Point[], owner: Owner = 'player') {
        const vertices: THREE.Vector3[] = []
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1]!, b = points[i]!, distance = Math.hypot(b.x - a.x, b.y - a.y)
            if (distance < .001) continue
            const steps = Math.max(1, Math.ceil(distance / 4))
            for (let j = vertices.length ? 1 : 0; j <= steps; j++) {
                const x = THREE.MathUtils.lerp(a.x, b.x, j / steps), y = THREE.MathUtils.lerp(a.y, b.y, j / steps)
                vertices.push(new THREE.Vector3(x, heightAt(x, y) + 3, y))
            }
        }
        if (vertices.length < 2) return
        const mat = getMaterials(owner)
        const geometry = new LineGeometry().setPositions(vertices.flatMap(p => [p.x, p.y, p.z]))
        // 隠れた部分を先に、見えている部分を後に描き、三角はラインの上に重ねる。
        for (const [pass, order] of [[mat.hidden, 3], [mat.shown, 4]] as const) {
            const line = new Line2(geometry, pass.line)
            line.renderOrder = order
            group.add(line)
        }
        const headGeometry = new THREE.BufferGeometry()
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
        const [shown, hidden] = [mat.shown, mat.hidden].map(pass => {
            const mesh = new THREE.Mesh(headGeometry, pass.head)
            mesh.renderOrder = 5; mesh.frustumCulled = false
            group.add(mesh)
            return mesh
        }) as [THREE.Mesh, THREE.Mesh]
        heads.push({ vertices, geometry, cut: vertices.length - 2, shown, hidden })
    }, updateCamera() {
        const width = canvas.clientWidth, height = canvas.clientHeight
        if (!width || !height) return
        for (const mat of materials.values()) for (const pass of [mat.shown, mat.hidden]) pass.line.resolution.set(width, height)
        for (const head of heads) {
            const { vertices, geometry } = head
            // 前のフレームで切った区間を元の終わりへ戻す。
            setSegmentEnd(geometry, head.cut, vertices[head.cut + 1]!)
            const end = toScreen(vertices.at(-1)!, width, height)
            // 終点から画面上で三角の長さだけ戻った所を、ラインの区間の中から探す。
            let cut = -1, base = vertices[0]!, baseScreen = toScreen(base, width, height)
            let after = end, afterDistance = 0
            for (let i = vertices.length - 2; i >= 0; i--) {
                const p = toScreen(vertices[i]!, width, height), distance = Math.hypot(p.x - end.x, p.y - end.y)
                if (distance >= HEAD_LENGTH) {
                    const t = (HEAD_LENGTH - afterDistance) / (distance - afterDistance)
                    base = vertices[i]!.clone().lerp(vertices[i + 1]!, 1 - t)
                    baseScreen = { x: p.x + (after.x - p.x) * (1 - t), y: p.y + (after.y - p.y) * (1 - t), z: p.z }
                    cut = i
                    break
                }
                after = p; afterDistance = distance
            }
            // ラインは三角の根元で止める。三角より短ければラインは引かない。
            head.cut = Math.max(0, cut)
            if (cut >= 0) setSegmentEnd(geometry, cut, base)
            geometry.instanceCount = cut + 1
            const dx = end.x - baseScreen.x, dy = end.y - baseScreen.y, length = Math.hypot(dx, dy)
            const onScreen = length > .001 && end.z > -1 && end.z < 1
            const hidden = onScreen && isOccluded(vertices.at(-1)!)
            head.shown.visible = onScreen && !hidden
            head.hidden.visible = hidden
            if (!onScreen) continue
            // 先端を終点に、根元をラインの切れ目に置く。
            const ux = dx / length, uy = dy / length
            const position = head.shown.geometry.getAttribute('position') as THREE.BufferAttribute
            for (const [index, [along, across]] of [[0, 0], [-HEAD_LENGTH, HEAD_HALF_WIDTH], [-HEAD_LENGTH, -HEAD_HALF_WIDTH]].entries()) {
                const x = end.x + ux * along! - uy * across!, y = end.y + uy * along! + ux * across!
                const vertex = new THREE.Vector3(x / width * 2 - 1, y / height * 2 - 1, end.z).unproject(camera)
                position.setXYZ(index, vertex.x, vertex.y, vertex.z)
            }
            position.needsUpdate = true
        }
    }, destroy() {
        clear(); group.removeFromParent()
        materials.forEach(mat => { for (const pass of [mat.shown, mat.hidden]) { pass.line.dispose(); pass.head.dispose() } }); materials.clear()
    } }
}
