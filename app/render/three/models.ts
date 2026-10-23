import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createSurfaceMaterials } from './materials'

/** 人間軍は青、魔王軍は赤。 */
export const FACTION = { player: 0x6f9be8, cpu: 0xe0614f, neutral: 0xf1e4be }
/** 隠れ判定（ラベルが建物の後ろにあるか）専用の形を置くレイヤー。カメラはこのレイヤーを描かない。 */
export const OCCLUDER_LAYER = 1
/** これより小さい部材（窓・胸壁・杭など）は隠れ判定に使わない。 */
const OCCLUDER_MIN_VOLUME = 100

export function createModelKit() {
    const box = new THREE.BoxGeometry(1, 1, 1)
    const rounded = new RoundedBoxGeometry(1, 1, 1, 3, .09)
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 24)
    const cone = new THREE.ConeGeometry(1, 1, 32)
    const sphere = new THREE.SphereGeometry(1, 20, 14)
    const surfaces = createSurfaceMaterials()
    const geometries = new Set<THREE.BufferGeometry>([box, rounded, cylinder, cone, sphere])
    const materials = new Map<number, THREE.MeshStandardMaterial>()
    const metalMaterials = new Map<number, THREE.MeshStandardMaterial>()
    const clothMaterials = new Map<number, THREE.MeshStandardMaterial>()
    const material = (color: number) => {
        if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .82 }))
        return materials.get(color)!
    }
    const metal = (color: number) => {
        if (!metalMaterials.has(color)) metalMaterials.set(color, surfaces.metal(color))
        return metalMaterials.get(color)!
    }
    const cloth = (color: number) => {
        if (!clothMaterials.has(color)) clothMaterials.set(color, surfaces.cloth(color))
        return clothMaterials.get(color)!
    }
    const part = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: number | THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        const mesh = new THREE.Mesh(geometry, typeof color === 'number' ? material(color) : color)
        mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz)
        mesh.castShadow = mesh.receiveShadow = true
        parent.add(mesh)
        return mesh
    }
    const occluderMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    // Merge static detail by material; hundreds of stakes remain only a few draw calls.
    // 結合したメッシュは城全体ほどの大きさになり、レイキャストが全三角形の総当たりになる。
    // そこで大きな部材だけを、描画されない隠れ判定用の形（OCCLUDER_LAYER）として個別に残す。
    const bake = (group: THREE.Group) => {
        const batches = new Map<THREE.Material, THREE.BufferGeometry[]>()
        const occluders: THREE.Mesh[] = []
        const size = new THREE.Vector3()
        for (const child of [...group.children]) {
            if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue
            child.updateMatrix()
            if (!child.material.transparent) {
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
                child.geometry.boundingBox!.getSize(size).multiply(child.scale)
                if (Math.abs(size.x * size.y * size.z) >= OCCLUDER_MIN_VOLUME) {
                    // 部材の形をそのまま使う（描画しないので、元の形を dispose してもGPUの資源は関係ない）。
                    const occluder = new THREE.Mesh(child.geometry, occluderMaterial)
                    occluder.matrix.copy(child.matrix)
                    occluder.matrixAutoUpdate = false
                    occluder.layers.set(OCCLUDER_LAYER)
                    occluders.push(occluder)
                }
            }
            let g = child.geometry.clone().applyMatrix4(child.matrix)
            if (g.index) { const indexed = g; g = g.toNonIndexed(); indexed.dispose() }
            // Merging requires identical attribute sets.
            for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
            if (!batches.has(child.material)) batches.set(child.material, [])
            batches.get(child.material)!.push(g)
            group.remove(child)
        }
        batches.forEach((parts, mat) => {
            const geometry = mergeGeometries(parts)!
            geometries.add(geometry)
            parts.forEach(g => g.dispose())
            part(group, geometry, mat, 0, 0, 0, 1, 1, 1)
        })
        if (occluders.length) group.add(...occluders)
    }
    const curveCloth = (width: number, height: number) => {
        const geometry = new THREE.PlaneGeometry(width, height, 12, 12)
        const position = geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++) {
            const x = position.getX(i), y = position.getY(i)
            position.setZ(i, Math.sin(x * 2.4) * .18 + Math.sin(y * .9 + x) * .18)
        }
        geometry.computeVertexNormals(); geometries.add(geometry)
        return geometry
    }
    const track = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry }
    return { box, rounded, cone, cylinder, sphere, surfaces, material, metal, cloth, part, bake, curveCloth, track, destroy() {
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); occluderMaterial.dispose(); surfaces.destroy()
    } }
}
export type ModelKit = ReturnType<typeof createModelKit>
