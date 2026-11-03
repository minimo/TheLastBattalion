import * as THREE from 'three'
import { TILE_PX } from '../../game/constants'
import type { PlacementCell } from '../../game/battle'

const COLOR: Record<PlacementCell['kind'], THREE.Color> = { blocked: new THREE.Color(0xd8352a), unit: new THREE.Color(0xf4c430) }
const PREVIEW_COLOR = { ok: new THREE.Color(0x9be38f), bad: new THREE.Color(0xff6b5a) }
/** マスの中心から四隅までの距離（マスの間に細い隙間を空ける）。 */
const HALF = (TILE_PX - 1) / 2
/** 地面から浮かせる高さ。 */
const LIFT = 1

type Cell = { gx: number; gy: number; color: THREE.Color }

/**
 * 開戦前のドラッグ中に、置けない地形と他の部隊のマス、掴んでいる部隊の移動先を塗る。
 * マスの四隅の高さを地形から拾って斜面に沿わせる。隠れないよう、地形や木にかかわらず手前に描く。
 */
export function createPlacementOverlay(heightAt: (x: number, y: number) => number) {
    const group = new THREE.Group()
    const createMaterial = (opacity: number) => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
    const areaMaterial = createMaterial(.42), previewMaterial = createMaterial(.6)
    /** マスを1枚のメッシュにまとめる（renderOrder はこの順に重なる）。 */
    const build = (cells: Cell[], material: THREE.Material, renderOrder: number) => {
        const positions = new Float32Array(cells.length * 12), colors = new Float32Array(cells.length * 12), indices = new Uint32Array(cells.length * 6)
        cells.forEach((cell, i) => {
            const x = cell.gx * TILE_PX, y = cell.gy * TILE_PX
            ;[[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].forEach(([dx, dy], corner) => {
                const k = (i * 4 + corner) * 3
                positions[k] = x + dx!; positions[k + 1] = heightAt(x + dx!, y + dy!) + LIFT; positions[k + 2] = y + dy!
                cell.color.toArray(colors, k)
            })
            indices.set([0, 2, 1, 0, 3, 2].map(v => i * 4 + v), i * 6)
        })
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geometry.setIndex(new THREE.BufferAttribute(indices, 1))
        const mesh = new THREE.Mesh(geometry, material)
        mesh.renderOrder = renderOrder
        mesh.frustumCulled = false
        group.add(mesh)
        return mesh
    }
    const remove = (mesh: THREE.Mesh | null) => {
        if (!mesh) return
        group.remove(mesh)
        mesh.geometry.dispose()
    }
    let area: THREE.Mesh | null = null, preview: THREE.Mesh | null = null, previewKey = ''
    const clearPreview = () => { remove(preview); preview = null; previewKey = '' }
    const clear = () => { remove(area); area = null; clearPreview() }
    return { group, clear, show(cells: PlacementCell[]) {
        remove(area)
        area = cells.length ? build(cells.map(cell => ({ ...cell, color: COLOR[cell.kind] })), areaMaterial, 1) : null
    }, preview(plan: { valid: boolean; area: { gx: number; gy: number }[] } | null) {
        const key = plan ? `${plan.valid}:${plan.area.map(c => `${c.gx},${c.gy}`).join(';')}` : ''
        if (key === previewKey) return
        clearPreview()
        previewKey = key
        if (!plan?.area.length) return
        const color = plan.valid ? PREVIEW_COLOR.ok : PREVIEW_COLOR.bad
        preview = build(plan.area.map(cell => ({ ...cell, color })), previewMaterial, 2)
    }, destroy() {
        clear()
        areaMaterial.dispose()
        previewMaterial.dispose()
        group.removeFromParent()
    } }
}
