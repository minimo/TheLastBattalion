import * as THREE from 'three'
import { TILE, TILE_PX } from '../../game/constants'
import { getTerrainTile, PLAYABLE_GRID_MAX, PLAYABLE_GRID_MIN } from '../../game/playableArea'
import { applyPlantSnow } from './snowCover'

/** 葦の株（細長い葉の束）を、高さ1の大きさで作る。根元は暗く、穂先は枯れ色。 */
function createClumpGeometry() {
    const positions: number[] = [], colors: number[] = []
    const base = new THREE.Color(0x4f5a2c), tip = new THREE.Color(0xc9b77a)
    for (let b = 0; b < 9; b++) {
        const angle = b * 2.4, r = .08 + (b % 3) * .06
        const x = Math.cos(angle) * r, z = Math.sin(angle) * r
        const height = .7 + .3 * ((b * 7) % 5) / 4
        const lean = .12 + .1 * (b % 2)
        const tx = x + Math.cos(angle) * lean, tz = z + Math.sin(angle) * lean
        const sx = -Math.sin(angle) * .035, sz = Math.cos(angle) * .035
        positions.push(x - sx, 0, z - sz, x + sx, 0, z + sz, tx, height, tz)
        colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()
    return geometry
}

/** 湿地の葦原: 部隊の動ける範囲の葦原のマスに葦の株を立てる。密な葦原は株が多く、背も高い。 */
export function createReeds(grid: number[][], heightAt: (x: number, y: number) => number, reserved: (x: number, y: number) => boolean, color: number) {
    const clumps: { x: number; y: number; h: number; size: number; turn: number }[] = []
    for (let j = PLAYABLE_GRID_MIN; j <= PLAYABLE_GRID_MAX; j++) for (let i = PLAYABLE_GRID_MIN; i <= PLAYABLE_GRID_MAX; i++) {
        const tile = getTerrainTile(grid, i, j)
        if (tile !== TILE.REEDS && tile !== TILE.REEDS_DENSE) continue
        const dense = tile === TILE.REEDS_DENSE
        for (let k = 0; k < (dense ? 6 : 3); k++) {
            const x = i * TILE_PX + Math.sin(i * 17.3 + j * 31.1 + k * 11) * 7.5, y = j * TILE_PX + Math.cos(i * 13.7 + j * 7.9 + k * 19) * 7.5
            if (reserved(x, y)) continue
            const size = (dense ? 13 : 9) + 4 * (1 + Math.sin(i * 3.1 + j * 1.7 + k)) / 2
            clumps.push({ x, y, h: Math.max(0, heightAt(x, y)), size, turn: i * 1.3 + j * 2.1 + k })
        }
    }
    const geometry = createClumpGeometry()
    const material = new THREE.MeshStandardMaterial({ color, vertexColors: true, side: THREE.DoubleSide, roughness: .95 })
    // 雪が降り続くと、穂先から白くなる（株の高さは 0〜1）。
    applyPlantSnow(material, 0, 1)
    const mesh = new THREE.InstancedMesh(geometry, material, clumps.length)
    const dummy = new THREE.Object3D()
    clumps.forEach((c, i) => {
        dummy.position.set(c.x, c.h - .3, c.y)
        dummy.rotation.set(0, c.turn, 0)
        dummy.scale.set(c.size * .9, c.size, c.size * .9)
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    return { mesh, destroy() { mesh.dispose(); geometry.dispose(); material.dispose() } }
}
