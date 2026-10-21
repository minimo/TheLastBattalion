import * as THREE from 'three'
import { createMulberry32, hashString } from '../../game/random'
import { createLandscape } from './landscape'
import type { ModelKit } from './models'
import type { MapTheme } from './mapTheme'

export function createScenery(grid: number[][], reserved: (x: number, y: number) => boolean, landscape: ReturnType<typeof createLandscape>, heightAt: (x: number, y: number) => number, kit: ModelKit, theme: MapTheme) {
    const random = createMulberry32(hashString(JSON.stringify(grid)) ^ 7834)
    const trees: { x: number; z: number; h: number; scale: number }[] = []
    const rocks: { x: number; y: number; h: number; size: number }[] = []
    const grass: { x: number; y: number; h: number; size: number }[] = []
    for (let i = 0; i < 9000; i++) {
        const x = -750 + random() * 2350, y = -750 + random() * 2350
        const h = heightAt(x, y), outside = landscape.distanceOutside(x, y)
        if (h < 5 || reserved(x, y)) continue
        const slope = Math.hypot(heightAt(x + 3, y) - heightAt(x - 3, y), heightAt(x, y + 3) - heightAt(x, y - 3)) / 6
        if (slope > .85) continue
        const patch = landscape.noise(x * .011, y * .011)
        if (outside > 4 && outside < 650 && patch > .1 && trees.length < theme.trees.outsideCount) trees.push({ x, z: y, h: h - .5, scale: .85 + random() * .7 })
        if (h > theme.rocks.above && patch < -.3 && rocks.length < theme.rocks.count) rocks.push({ x, y, h, size: (outside > 100 ? 5 : 1.8) + random() * (outside > 100 ? 12 : 3) })
        if (h < 100 && outside < 350 && grass.length < theme.grass.count) grass.push({ x, y, h, size: .6 + random() * 1.2 })
    }
    const group = new THREE.Group()
    const stoneGeometry = new THREE.IcosahedronGeometry(1, 2)
    const position = stoneGeometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
        const displacement = 1 + landscape.noise(x * 3 + y, z * 3) * .16
        position.setXYZ(i, x * displacement, y * displacement, z * displacement)
    }
    stoneGeometry.computeVertexNormals()
    const rockMesh = new THREE.InstancedMesh(stoneGeometry, kit.material(0x747668), rocks.length)
    const dummy = new THREE.Object3D(), color = new THREE.Color()
    rocks.forEach((r, i) => {
        dummy.position.set(r.x, r.h + r.size * .2, r.y)
        dummy.rotation.set(random() * .4, random() * 6, random() * .4)
        dummy.scale.set(r.size, r.size * .6, r.size * .8)
        dummy.updateMatrix(); rockMesh.setMatrixAt(i, dummy.matrix)
        rockMesh.setColorAt(i, color.setHSL(theme.rocks.hue, theme.rocks.saturation, theme.rocks.lightness + random() * .25))
    })
    rockMesh.castShadow = rockMesh.receiveShadow = true
    group.add(rockMesh)
    const grassGeometry = new THREE.BufferGeometry()
    grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.35, 0, 0, 0, 2, .25, .35, 0, 0, 0, 0, -.4, .3, 1.4, 0, 0, 0, .4], 3))
    grassGeometry.computeVertexNormals()
    const grassMaterial = new THREE.MeshStandardMaterial({ color: theme.grass.color, side: THREE.DoubleSide, roughness: 1 })
    const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grass.length)
    grass.forEach((g, i) => {
        dummy.position.set(g.x, g.h, g.y); dummy.rotation.set(0, random() * 6, 0); dummy.scale.setScalar(g.size)
        dummy.updateMatrix(); grassMesh.setMatrixAt(i, dummy.matrix)
    })
    group.add(grassMesh)
    return { group, trees, destroy() { rockMesh.dispose(); grassMesh.dispose(); stoneGeometry.dispose(); grassGeometry.dispose(); grassMaterial.dispose() } }
}
