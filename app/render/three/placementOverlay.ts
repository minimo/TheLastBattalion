import * as THREE from 'three'
import { TILE_PX } from '../../game/constants'
import type { PlacementCell } from '../../game/battle'

const COLOR: Record<PlacementCell['kind'], THREE.Color> = { blocked: new THREE.Color(0xd8352a), unit: new THREE.Color(0xf4c430) }

/** 開戦前のドラッグ中に、置けない地形と他の部隊のマスを塗る。隠れないよう、地形や木にかかわらず手前に描く。 */
export function createPlacementOverlay(heightAt: (x: number, y: number) => number) {
    const group = new THREE.Group()
    const geometry = new THREE.PlaneGeometry(TILE_PX - 1, TILE_PX - 1).rotateX(-Math.PI / 2)
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .42, depthTest: false, depthWrite: false })
    let mesh: THREE.InstancedMesh | null = null
    const clear = () => {
        if (!mesh) return
        group.remove(mesh)
        mesh.dispose()
        mesh = null
    }
    return { group, clear, show(cells: PlacementCell[]) {
        clear()
        if (!cells.length) return
        mesh = new THREE.InstancedMesh(geometry, material, cells.length)
        // 配置する部隊の下見（建設場所の下見と同じもの）より先に描く。
        mesh.renderOrder = -1
        mesh.frustumCulled = false
        const matrix = new THREE.Matrix4()
        cells.forEach((cell, i) => {
            const x = cell.gx * TILE_PX, y = cell.gy * TILE_PX
            mesh!.setMatrixAt(i, matrix.makeTranslation(x, heightAt(x, y) + 1, y))
            mesh!.setColorAt(i, COLOR[cell.kind])
        })
        group.add(mesh)
    }, destroy() {
        clear()
        geometry.dispose()
        material.dispose()
        group.removeFromParent()
    } }
}
