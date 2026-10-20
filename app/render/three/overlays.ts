import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Owner, Point } from '../../types/game'
import { FACTION } from './models'

type SurfaceHeight = (x: number, y: number) => number
/** Screen-width strokes and solid arrowheads remain readable at every zoom level. */
export function createPathOverlay(camera: THREE.Camera, canvas: HTMLElement, heightAt: SurfaceHeight) {
    const group = new THREE.Group()
    const materials = new Map<Owner, { line: LineMaterial; head: THREE.MeshBasicMaterial }>()
    const heads: { mesh: THREE.Mesh; end: THREE.Vector3; previous: THREE.Vector3 }[] = []
    const getMaterials = (owner: Owner) => {
        if (!materials.has(owner)) materials.set(owner, {
            line: new LineMaterial({ color: FACTION[owner], linewidth: 6, transparent: true, opacity: .95, depthTest: false, depthWrite: false }),
            head: new THREE.MeshBasicMaterial({ color: FACTION[owner], side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
        })
        return materials.get(owner)!
    }
    const clear = () => {
        for (const child of group.children) (child as THREE.Mesh).geometry.dispose()
        group.clear(); heads.length = 0
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
        const line = new Line2(geometry, mat.line)
        line.renderOrder = 3
        group.add(line)
        const headGeometry = new THREE.BufferGeometry()
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
        const mesh = new THREE.Mesh(headGeometry, mat.head)
        mesh.renderOrder = 4; mesh.frustumCulled = false
        group.add(mesh)
        heads.push({ mesh, end: vertices.at(-1)!, previous: vertices.at(-2)! })
    }, updateCamera() {
        const width = canvas.clientWidth, height = canvas.clientHeight
        if (!width || !height) return
        for (const mat of materials.values()) mat.line.resolution.set(width, height)
        for (const head of heads) {
            const end = head.end.clone().project(camera), previous = head.previous.clone().project(camera)
            const dx = (end.x - previous.x) * width / 2, dy = (end.y - previous.y) * height / 2
            const length = Math.hypot(dx, dy)
            head.mesh.visible = length > .001 && end.z > -1 && end.z < 1
            if (!head.mesh.visible) continue
            const ux = dx / length, uy = dy / length
            const position = head.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
            // Tip extends over the rounded line cap; its filled base is 20 px wide.
            for (const [index, [along, across]] of [[3, 0], [-18, 10], [-18, -10]].entries()) {
                const vertex = new THREE.Vector3(end.x + (ux * along! - uy * across!) * 2 / width, end.y + (uy * along! + ux * across!) * 2 / height, end.z).unproject(camera)
                position.setXYZ(index, vertex.x, vertex.y, vertex.z)
            }
            position.needsUpdate = true
        }
    }, destroy() {
        clear(); group.removeFromParent()
        materials.forEach(mat => { mat.line.dispose(); mat.head.dispose() }); materials.clear()
    } }
}
