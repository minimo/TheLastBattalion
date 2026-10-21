import * as THREE from 'three'
import { MAP_MIN, MAP_MAX, MESH_STEP, type Heightfield } from './heightfield'
import { createLandscape, LANDSCAPE_RADIUS, TERRAIN_CENTER, smooth } from './landscape'
import type { MapTheme } from './mapTheme'

/** Shared world coordinates and normals prevent a visible join around the battlefield. */
export function createTerrainMeshes(field: Heightfield, landscape: ReturnType<typeof createLandscape>, material: THREE.Material, ground: MapTheme['ground']) {
    const make = () => ({ positions: [] as number[], normals: [] as number[], colors: [] as number[], uvs: [] as number[], indices: [] as number[] })
    type Buffers = ReturnType<typeof make>
    const green = new THREE.Color(ground.base), dry = new THREE.Color(ground.patch), rock = new THREE.Color(ground.rock), sand = new THREE.Color(ground.shore)
    const crest = ground.crest && { ...ground.crest, color: new THREE.Color(ground.crest.color) }
    const color = new THREE.Color(), normal = new THREE.Vector3()
    const vertex = (buffers: Buffers, x: number, y: number) => {
        const h = landscape.heightAt(x, y)
        const dx = landscape.heightAt(x + 2, y) - landscape.heightAt(x - 2, y)
        const dy = landscape.heightAt(x, y + 2) - landscape.heightAt(x, y - 2)
        normal.set(-dx, 4, -dy).normalize()
        const slope = 1 - normal.y
        const meadow = smooth(-.55, .55, landscape.noise(x * .008, y * .008))
        color.copy(green).lerp(dry, meadow * ground.patchAmount)
        if (crest) color.lerp(crest.color, smooth(crest.from, crest.to, h) * crest.amount)
        color.lerp(rock, Math.max(smooth(.07, .32, slope), smooth(90, 310, h) * .8))
        if (h < 7) color.lerp(sand, 1 - smooth(0, 7, h))
        color.multiplyScalar(.92 + .1 * landscape.noise(x * .029, y * .029))
        buffers.positions.push(x, h, y); buffers.normals.push(normal.x, normal.y, normal.z)
        buffers.colors.push(color.r, color.g, color.b)
        buffers.uvs.push((x - MAP_MIN) / (MAP_MAX - MAP_MIN), (y - MAP_MIN) / (MAP_MAX - MAP_MIN))
    }
    const mesh = (buffers: Buffers, name: string) => {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3))
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2))
        geometry.setIndex(buffers.indices)
        const object = new THREE.Mesh(geometry, material)
        object.name = name; object.receiveShadow = true
        return object
    }
    const central = make(), { size } = field
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        vertex(central, MAP_MIN + i * MESH_STEP, MAP_MIN + j * MESH_STEP)
        if (i < size - 1 && j < size - 1) {
            const a = j * size + i
            central.indices.push(a, a + size, a + 1, a + size + 1, a + 1, a + size)
        }
    }
    // Cap radial spacing so distant slopes do not turn into long, angular triangles.
    const surround = make(), half = (MAP_MAX - MAP_MIN) / 2, sideSteps = size - 1, ringSize = sideSteps * 4
    const radii = [half]
    let radius = half
    while (radius < LANDSCAPE_RADIUS) {
        radius = Math.min(LANDSCAPE_RADIUS, radius + Math.min(20, Math.max(12, (radius - half) * .055)))
        radii.push(radius)
    }
    radii.forEach((r, ring) => {
        for (let side = 0; side < 4; side++) for (let i = 0; i < sideSteps; i++) {
            const t = i / sideSteps * 2 - 1
            const x = side === 0 ? t : side === 1 ? 1 : side === 2 ? -t : -1
            const y = side === 0 ? -1 : side === 1 ? t : side === 2 ? 1 : -t
            vertex(surround, TERRAIN_CENTER + x * r, TERRAIN_CENTER + y * r)
        }
        if (ring === 0) return
        for (let i = 0; i < ringSize; i++) {
            const a = (ring - 1) * ringSize + i, b = (ring - 1) * ringSize + (i + 1) % ringSize
            surround.indices.push(a, b, a + ringSize, b, b + ringSize, a + ringSize)
        }
    })
    const terrain = mesh(central, 'battlefield-terrain'), surroundings = mesh(surround, 'surrounding-landscape')
    // Sample the rendered triangles, including the coarser distant rings, so scenery
    // and camera clearance use the actual surface rather than the source noise.
    const positions = surroundings.geometry.getAttribute('position')
    const triangle = (x: number, y: number, a: number, b: number, c: number) => {
        const ax = positions.getX(a), az = positions.getZ(a)
        const bx = positions.getX(b) - ax, bz = positions.getZ(b) - az
        const cx = positions.getX(c) - ax, cz = positions.getZ(c) - az
        const determinant = bx * cz - bz * cx
        const u = ((x - ax) * cz - (y - az) * cx) / determinant
        const v = (bx * (y - az) - bz * (x - ax)) / determinant
        return { u, v, height: positions.getY(a) * (1 - u - v) + positions.getY(b) * u + positions.getY(c) * v }
    }
    const heightAt = (x: number, y: number) => {
        if (landscape.inside(x, y)) return landscape.heightAt(x, y)
        const dx = x - TERRAIN_CENTER, dy = y - TERRAIN_CENTER, r = Math.max(Math.abs(dx), Math.abs(dy))
        if (r > LANDSCAPE_RADIUS) return landscape.heightAt(x, y)
        let low = 0, high = radii.length - 1
        while (high - low > 1) {
            const middle = (low + high) >> 1
            if (radii[middle]! <= r) low = middle
            else high = middle
        }
        const side = dy <= -Math.abs(dx) ? 0 : dx >= Math.abs(dy) ? 1 : dy >= Math.abs(dx) ? 2 : 3
        const t = (side === 0 ? dx : side === 1 ? dy : side === 2 ? -dx : -dy) / r
        const i = side * sideSteps + Math.min(sideSteps - 1, Math.floor((t + 1) * .5 * sideSteps))
        const a = low * ringSize + i, b = low * ringSize + (i + 1) % ringSize
        const sample = triangle(x, y, a, b, a + ringSize)
        return sample.u >= -1e-5 && sample.v >= -1e-5 && sample.u + sample.v <= 1 + 1e-5
            ? sample.height : triangle(x, y, b, b + ringSize, a + ringSize).height
    }
    return { terrain, surroundings, heightAt, destroy() { terrain.geometry.dispose(); surroundings.geometry.dispose() } }
}
