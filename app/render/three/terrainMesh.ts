import * as THREE from 'three'
import { MAP_MIN, MAP_MAX, MESH_STEP, type Heightfield } from './heightfield'
import { createLandscape, LANDSCAPE_RADIUS, TERRAIN_CENTER, smooth } from './landscape'
import type { MapTheme } from './mapTheme'

/**
 * 地面の区画の一辺（網目の数）と、粗い網に切り替えるカメラからの距離（px）。
 * 網目は細かく（MESH_STEP）、戦場を見渡すと1つが画面の1画素より小さくなって描画が重いので、遠い区画は網目を1つおきに間引く。
 */
const TERRAIN_CHUNK = 64
const TERRAIN_COARSE_DISTANCE = 1300, TERRAIN_COARSE_MARGIN = 60
/** 区画の縁から下へ垂らす面の高さ（px）。細かい区画と粗い区画の境目で、頂点の高さの違いからできる隙間をふさぐ。 */
const TERRAIN_SKIRT = 8

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
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) vertex(central, MAP_MIN + i * MESH_STEP, MAP_MIN + j * MESH_STEP)
    // 戦場の地面は区画に分け、区画ごとに細かい網と粗い網を持つ（頂点はすべての区画で共有する）。
    // 粗い網はマスの中心（奇数番目の頂点）を残す: 川底はマスの中心がいちばん低いので、細い川が途切れない。区画の境目も奇数番目に置く。
    const bounds = [0]
    for (let b = 1 + TERRAIN_CHUNK; b < size - 1 - TERRAIN_CHUNK / 2; b += TERRAIN_CHUNK) bounds.push(b)
    bounds.push(size - 1)
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
    const kept = (stops: number[]) => stops.filter(i => i % 2 === 1 || i === 0 || i === size - 1)
    /** 縁から垂らす面の下の頂点（元の頂点を下げた写し。法線と色は元のままで、地面の続きに見える）。 */
    const lowered = new Map<number, number>()
    const lower = (v: number) => {
        let copy = lowered.get(v)
        if (copy === undefined) {
            copy = central.positions.length / 3
            central.positions.push(central.positions[v * 3]!, central.positions[v * 3 + 1]! - TERRAIN_SKIRT, central.positions[v * 3 + 2]!)
            central.normals.push(central.normals[v * 3]!, central.normals[v * 3 + 1]!, central.normals[v * 3 + 2]!)
            central.colors.push(central.colors[v * 3]!, central.colors[v * 3 + 1]!, central.colors[v * 3 + 2]!)
            central.uvs.push(central.uvs[v * 2]!, central.uvs[v * 2 + 1]!)
            lowered.set(v, copy)
        }
        return copy
    }
    /** xs・ys 番目の頂点を結ぶ網。ほかの区画と接する縁には、下へ垂らす面を付ける（どちらから見ても描かれるよう両面）。 */
    const weave = (xs: number[], ys: number[]) => {
        const indices: number[] = []
        for (let b = 0; b < ys.length - 1; b++) for (let a = 0; a < xs.length - 1; a++) {
            const p = ys[b]! * size + xs[a]!, q = ys[b]! * size + xs[a + 1]!, r = ys[b + 1]! * size + xs[a]!, t = ys[b + 1]! * size + xs[a + 1]!
            indices.push(p, r, q, t, q, r)
        }
        const skirt = (u: number, v: number) => { const du = lower(u), dv = lower(v); indices.push(u, du, v, v, du, dv, u, v, du, v, dv, du) }
        const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = ys[0]!, y1 = ys[ys.length - 1]!
        for (const y of [y0, y1]) if (y > 0 && y < size - 1) for (let a = 0; a < xs.length - 1; a++) skirt(y * size + xs[a]!, y * size + xs[a + 1]!)
        for (const x of [x0, x1]) if (x > 0 && x < size - 1) for (let b = 0; b < ys.length - 1; b++) skirt(ys[b]! * size + x, ys[b + 1]! * size + x)
        return indices
    }
    const plans: { fine: number[]; coarse: number[]; box: THREE.Box3 }[] = []
    for (let cj = 0; cj < bounds.length - 1; cj++) for (let ci = 0; ci < bounds.length - 1; ci++) {
        const xs = range(bounds[ci]!, bounds[ci + 1]!), ys = range(bounds[cj]!, bounds[cj + 1]!)
        let low = Infinity, high = -Infinity
        for (const j of ys) for (const i of xs) { const h = central.positions[(j * size + i) * 3 + 1]!; low = Math.min(low, h); high = Math.max(high, h) }
        const box = new THREE.Box3(
            new THREE.Vector3(MAP_MIN + xs[0]! * MESH_STEP, low - TERRAIN_SKIRT, MAP_MIN + ys[0]! * MESH_STEP),
            new THREE.Vector3(MAP_MIN + xs[xs.length - 1]! * MESH_STEP, high, MAP_MIN + ys[ys.length - 1]! * MESH_STEP))
        plans.push({ fine: weave(xs, ys), coarse: weave(kept(xs), kept(ys)), box })
    }
    // Cap radial spacing so distant slopes do not turn into long, angular triangles.
    const surround = make(), half = (MAP_MAX - MAP_MIN) / 2, sideSteps = size - 1, ringSize = sideSteps * 4
    const radii = [half]
    let radius = half
    while (radius < LANDSCAPE_RADIUS) {
        radius = Math.min(LANDSCAPE_RADIUS, radius + Math.min(40, Math.max(12, (radius - half) * .055)))
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
    const attributes = {
        position: new THREE.Float32BufferAttribute(central.positions, 3), normal: new THREE.Float32BufferAttribute(central.normals, 3),
        color: new THREE.Float32BufferAttribute(central.colors, 3), uv: new THREE.Float32BufferAttribute(central.uvs, 2),
    }
    const terrain = new THREE.Group()
    terrain.name = 'battlefield-terrain'
    const geometries: THREE.BufferGeometry[] = []
    const chunks = plans.map(({ fine, coarse, box }) => {
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const [near, far] = [fine, coarse].map(indices => {
            const geometry = new THREE.BufferGeometry()
            for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute)
            geometry.setIndex(indices)
            // 頂点は全区画で共有しているので、範囲は区画の分だけを渡す（自動で求めると戦場全体になる）。
            geometry.boundingBox = box; geometry.boundingSphere = sphere
            geometries.push(geometry)
            const object = new THREE.Mesh(geometry, material)
            object.receiveShadow = true
            terrain.add(object)
            return object
        }) as [THREE.Mesh, THREE.Mesh]
        // 地面の点を拾うとき（クリックした地点など）は、表示に関わらず細かい網だけを調べる。
        far.visible = false
        far.raycast = () => {}
        return { near, far, box, coarse: false }
    })
    const lastCamera = new THREE.Vector3(Infinity, 0, 0)
    /** カメラの位置に合わせて、区画ごとに網の細かさを切り替える。 */
    const update = (camera: THREE.Vector3) => {
        if (lastCamera.distanceToSquared(camera) < 64) return
        lastCamera.copy(camera)
        for (const chunk of chunks) {
            // 境目でちらつかないよう、今の細かさから離れる向きにだけ余裕を持たせる。
            const coarse = chunk.box.distanceToPoint(camera) > TERRAIN_COARSE_DISTANCE + (chunk.coarse ? -TERRAIN_COARSE_MARGIN : TERRAIN_COARSE_MARGIN)
            if (coarse === chunk.coarse) continue
            chunk.coarse = coarse
            chunk.near.visible = !coarse
            chunk.far.visible = coarse
        }
    }
    const surroundings = mesh(surround, 'surrounding-landscape')
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
    return { terrain, surroundings, heightAt, update, destroy() { geometries.forEach(g => g.dispose()); surroundings.geometry.dispose() } }
}
