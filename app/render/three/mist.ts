import * as THREE from 'three'
import { WATER_HEIGHT } from './heightfield'
import { TERRAIN_CENTER } from './landscape'

/**
 * 濃霧の日に地面の上を漂うもや。地形の起伏に沿わせた半透明の膜を高さを変えて重ね、膜ごとに違う速さと向きで、
 * ちぎれたもやの模様を流す。膜は地面より上に沿わせるので丘に突き刺さらず、重なった膜がずれて動くので厚みがあるように見える。
 * 見た目だけで、ゲームの視界には関わらない。
 */
const MIST = {
    /** もやを置く範囲（戦場の中心からの半分の幅、px）、膜の頂点の間隔（px）、膜の高さを決めるために地面を測る間隔（px、地形の網と同じ細かさ）。 */
    reach: 1248, spacing: 16, ground: 4,
    /**
     * 膜は low から high までの間に count 枚、等しい間隔で重ねる。上の膜ほど薄く（opacity）、模様が小さく（scale）、速く流れる（drift、px/秒、実時間）。
     * 横から見ると膜の高さで濃さが段になって帯に見えるので、薄い膜を多く重ねて濃さがなだらかに変わるようにする。
     */
    layers: { count: 6, low: 3, high: 42, opacity: [.32, .19], scale: [620, 340], drift: [{ x: 9, z: 3.5 }, { x: 21, z: 1 }] },
    /** 膜をほぼ真横から見ている所は薄くする（膜の面と視線のなす角の正弦: この値から濃くなり始め、ここで元の濃さ）。 */
    graze: [.05, .3],
    /** もやは低い所にたまる: 地面がこの高さから薄くなり、ここで消える（平地は0〜40、低い山は72から）。 */
    highland: [40, 80],
    /** 急な斜面ではもやを薄くする（地面の法線の上向きの成分: この値で消え、ここで元の濃さ）。膜の頂点の間で地形から離れて角が見えないように。 */
    steep: [.72, .92],
    /** 細かいもやは大きな模様よりこの倍率で速く流れ、少し違う向きへ動く（形が移ろって見える）。 */
    detail: { scale: .4, speed: 1.4, turn: .5 },
    /** カメラのすぐ前は薄くする: この距離から濃くなり始め、ここで最も濃くなる（px）。 */
    nearFrom: 12, nearTo: 150,
    /** 夜の濃さの倍率（霞の色が暗いので、濃いままだと黒い膜に見える）。 */
    night: .6,
    /** 模様のテクスチャの一辺。 */
    texture: 256,
}

/** 繰り返して貼れる、ちぎれ雲のような濃淡（0〜1）。格子の周期をテクスチャの一辺にそろえて継ぎ目をなくす。 */
function createMistTexture() {
    const n = MIST.texture
    const data = new Uint8Array(n * n)
    const field = new Float32Array(n * n)
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (const [cells, weight] of [[4, .5], [8, .27], [16, .15], [32, .08]] as const) {
        const lattice = Array.from({ length: cells * cells }, random)
        const at = (i: number, j: number) => lattice[((j % cells) * cells) + (i % cells)]!
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const fx = x / n * cells, fy = y / n * cells
            const i = Math.floor(fx), j = Math.floor(fy)
            const u = fx - i, v = fy - j
            const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v)
            const top = at(i, j) + (at(i + 1, j) - at(i, j)) * su
            const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su
            field[y * n + x] += (top + (bottom - top) * sv) * weight
        }
    }
    let min = Infinity, max = -Infinity
    for (const v of field) { min = Math.min(min, v); max = Math.max(max, v) }
    for (let i = 0; i < field.length; i++) data[i] = Math.round((field[i]! - min) / (max - min) * 255)
    const texture = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    return texture
}

/**
 * 地形に沿った膜の形（高さ0の位置）。地面を細かく（ground px おきに）測り、膜の頂点にはその周り（隣の頂点まで）で
 * 最も高い地面の高さを使う。膜の三角形は頂点の高さの間をまっすぐ結ぶので、こうしておけば膜はどこでも地面より上にあり、
 * 斜面で膜が地面に突き刺さって段のような線が出ることがない。
 */
function createSheetGeometry(heightAt: (x: number, y: number) => number) {
    const size = MIST.reach * 2, low = TERRAIN_CENTER - MIST.reach
    const step = MIST.ground, n = Math.round(size / step) + 1
    const ground = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ground[j * n + i] = Math.max(WATER_HEIGHT, heightAt(low + i * step, low + j * step))
    // 周りの最も高い地面（横と縦に分けて求める）。
    const r = Math.round(MIST.spacing / step), across = new Float32Array(n * n), peak = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        let h = -Infinity
        for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) h = Math.max(h, ground[j * n + k]!)
        across[j * n + i] = h
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        let h = -Infinity
        for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) h = Math.max(h, across[k * n + i]!)
        peak[j * n + i] = h
    }
    const segments = Math.round(size / MIST.spacing)
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(TERRAIN_CENTER, 0, TERRAIN_CENTER)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let v = 0; v < position.count; v++) {
        const i = Math.min(n - 1, Math.max(0, Math.round((position.getX(v) - low) / step)))
        const j = Math.min(n - 1, Math.max(0, Math.round((position.getZ(v) - low) / step)))
        position.setY(v, peak[j * n + i]!)
    }
    geometry.computeVertexNormals()
    // もやの濃さのうち、場所だけで決まる分（低い所・ゆるい斜面・範囲の内側）を頂点に持たせる。
    const normal = geometry.attributes.normal as THREE.BufferAttribute
    const presence = new Float32Array(position.count)
    for (let v = 0; v < position.count; v++) {
        const edge = Math.max(Math.abs(position.getX(v) - TERRAIN_CENTER), Math.abs(position.getZ(v) - TERRAIN_CENTER)) / MIST.reach
        presence[v] = (1 - smoothstep(MIST.highland[0]!, MIST.highland[1]!, position.getY(v)))
            * smoothstep(MIST.steep[0]!, MIST.steep[1]!, normal.getY(v)) * (1 - smoothstep(.75, 1, edge))
    }
    geometry.setAttribute('presence', new THREE.BufferAttribute(presence, 1))
    // もやの出ない所（山の上・急な斜面・範囲の外）の三角形は描かない。
    const index = geometry.index!.array, kept: number[] = []
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!
        if (presence[a]! > 0 || presence[b]! > 0 || presence[c]! > 0) kept.push(a, b, c)
    }
    geometry.setIndex(kept)
    geometry.computeBoundingSphere()
    return geometry
}

function smoothstep(from: number, to: number, x: number) {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
    return t * t * (3 - 2 * t)
}

export function createMist(scene: THREE.Scene) {
    const texture = createMistTexture()
    const group = new THREE.Group()
    group.visible = false
    scene.add(group)
    const color = new THREE.Color()
    const { count, low, high, opacity, scale, drift } = MIST.layers
    const sheets = Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1), mix = (a: number, b: number) => a + (b - a) * t
        // 流れる向きも、膜ごとに少しずつ違える。
        const swing = (i % 2 ? 1 : -1) * 2.5
        return {
            height: mix(low, high), opacity: mix(opacity[0]!, opacity[1]!), scale: mix(scale[0]!, scale[1]!),
            drift: { x: mix(drift[0]!.x, drift[1]!.x), z: mix(drift[0]!.z, drift[1]!.z) + swing },
        }
    })
    const layers = sheets.map((layer, index) => {
        const material = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            uniforms: {
                mistMap: { value: texture }, color: { value: color }, opacity: { value: 0 }, lift: { value: layer.height },
                scale: { value: layer.scale }, offset: { value: new THREE.Vector2() }, detailOffset: { value: new THREE.Vector2() },
            },
            vertexShader: `
                attribute float presence;
                uniform float lift; varying vec3 vWorld; varying vec3 vNormal; varying float vPresence;
                void main() {
                    vec4 world = modelMatrix * vec4(position + vec3(0.0, lift, 0.0), 1.0);
                    vWorld = world.xyz;
                    vNormal = normalize(mat3(modelMatrix) * normal);
                    vPresence = presence;
                    gl_Position = projectionMatrix * viewMatrix * world;
                }`,
            fragmentShader: `
                uniform sampler2D mistMap; uniform vec3 color; uniform float opacity; uniform float scale;
                uniform vec2 offset; uniform vec2 detailOffset;
                varying vec3 vWorld; varying vec3 vNormal; varying float vPresence;
                void main() {
                    // 模様を読む前に、場所と見る向きで決まる濃さを求め、もやの出ない画素は描かない。
                    vec3 toSheet = vWorld - cameraPosition;
                    float sheetDistance = max(length(toSheet), 1.0);
                    float close = smoothstep(${MIST.nearFrom.toFixed(1)}, ${MIST.nearTo.toFixed(1)}, sheetDistance);
                    float facing = smoothstep(${MIST.graze[0]!.toFixed(2)}, ${MIST.graze[1]!.toFixed(2)}, abs(dot(toSheet, normalize(vNormal))) / sheetDistance);
                    float amount = vPresence * opacity * close * facing;
                    if (amount < .002) discard;
                    float broad = texture2D(mistMap, vWorld.xz / scale + offset).r;
                    float fine = texture2D(mistMap, vWorld.xz / (scale * ${MIST.detail.scale.toFixed(2)}) + detailOffset).r;
                    gl_FragColor = vec4(color, amount * smoothstep(.38, .8, broad * .7 + fine * .3));
                    #include <colorspace_fragment>
                }`,
        })
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
        mesh.frustumCulled = false
        // 上の膜ほど後に描き、上から見下ろしたときに重なりの順が崩れないようにする。
        mesh.renderOrder = 10 + index
        group.add(mesh)
        return { layer, mesh, material }
    })
    let builtFor: unknown = null
    let clock = 0
    return {
        /**
         * strength: もやの濃さ（0で描かない）。heightAt は今の地形の高さで、地形が変わったら膜を作り直す。
         * delta は実時間の秒（一時停止中ももやは流れる）。fogColor は今の霞の色。
         */
        update(strength: number, heightAt: (x: number, y: number) => number, fogColor: THREE.Color, night: number, delta: number) {
            group.visible = strength > 0
            if (!group.visible) return
            if (builtFor !== heightAt) {
                builtFor = heightAt
                const geometry = createSheetGeometry(heightAt)
                for (const l of layers) { l.mesh.geometry.dispose(); l.mesh.geometry = geometry }
            }
            clock = (clock + delta) % 3600
            color.copy(fogColor)
            const dim = 1 + (MIST.night - 1) * night
            for (const { layer, material } of layers) {
                const u = material.uniforms
                u.opacity!.value = layer.opacity * strength * dim
                // 模様の大きさを1とするずれ。テクスチャは繰り返すので、周期で回しても継ぎ目は出ない。
                u.offset!.value.set(-clock * layer.drift.x / layer.scale % 1, -clock * layer.drift.z / layer.scale % 1)
                const fine = layer.scale * MIST.detail.scale, turn = MIST.detail.turn, speed = MIST.detail.speed
                const dx = layer.drift.x * Math.cos(turn) - layer.drift.z * Math.sin(turn), dz = layer.drift.x * Math.sin(turn) + layer.drift.z * Math.cos(turn)
                u.detailOffset!.value.set(-clock * dx * speed / fine % 1, -clock * dz * speed / fine % 1)
            }
        },
        destroy() {
            layers[0]?.mesh.geometry.dispose()
            for (const l of layers) l.material.dispose()
            texture.dispose()
            group.removeFromParent()
        },
    }
}
