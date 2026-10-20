import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ModelKit } from './models'

export function createForest(trees: { x: number; z: number; h: number; scale: number }[], kit: ModelKit) {
    const group = new THREE.Group()
    // A branch spray with individual leaf silhouettes, shared by all crowns.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#657050'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(63, 125); ctx.lineTo(63, 9); ctx.stroke()
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
        const y = 112 - i * 14
        ctx.save(); ctx.translate(64 + side * 14, y); ctx.rotate(side * .7)
        ctx.fillStyle = i % 2 ? '#a6b481' : '#83995f'
        ctx.beginPath(); ctx.ellipse(0, -6, 8 - i * .35, 17 - i * .6, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#b2b995'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -18); ctx.stroke()
        ctx.restore()
    }
    const leafMap = new THREE.CanvasTexture(canvas)
    leafMap.colorSpace = THREE.SRGBColorSpace
    leafMap.anisotropy = 4
    const leafMaterial = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: .25, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .95, color: 0xced3b5 })
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
    return { group, destroy() {
        trunks.dispose(); branches.dispose(); leaves.dispose()
        trunkGeometry.dispose(); crownGeometry.dispose(); leafMaterial.dispose(); leafMap.dispose()
    } }
}
