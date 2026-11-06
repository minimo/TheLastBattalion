import * as THREE from 'three'

/**
 * 雨の筋。戦場全体には降らせず、カメラの前の箱の中だけに降らせる（描画の重さが戦場の広さによらず一定になる）。
 * 粒の位置は頂点シェーダーで時刻から求めるので、毎フレームの CPU の計算はない。
 * 粒は世界に対して落ちていき、箱の端を越えると反対側に回り込む（カメラが動いても雨が一緒に動いて見えない）。
 */
const RAIN = {
    count: 7000, box: 520, ahead: 260,
    fall: 340, wind: { x: 40, z: 18 }, length: 16,
    color: 0xb9c6cf, opacity: .42, nightOpacity: .22,
    /** 時刻を回す周期（秒）。大きな時刻で mod の精度が落ちないようにする。 */
    period: 600,
}

export function createPrecipitation(scene: THREE.Scene) {
    const seeds = new Float32Array(RAIN.count * 2 * 3)
    const tails = new Float32Array(RAIN.count * 2)
    for (let i = 0; i < RAIN.count; i++) {
        const x = Math.random(), y = Math.random(), z = Math.random()
        for (let j = 0; j < 2; j++) {
            seeds.set([x, y, z], (i * 2 + j) * 3)
            tails[i * 2 + j] = j
        }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    geometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1))
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: {
            center: { value: new THREE.Vector3() }, size: { value: RAIN.box }, time: { value: 0 },
            velocity: { value: new THREE.Vector3(RAIN.wind.x, -RAIN.fall, RAIN.wind.z) }, streak: { value: RAIN.length },
            color: { value: new THREE.Color(RAIN.color) }, opacity: { value: RAIN.opacity },
        },
        vertexShader: `
            attribute float tail;
            uniform vec3 center; uniform float size; uniform float time; uniform vec3 velocity; uniform float streak;
            varying float alpha;
            void main() {
                vec3 low = center - size * .5;
                vec3 p = low + mod(position * size + velocity * time - low, size);
                vec3 edge = abs(p - center) / size;
                // 箱の端では薄くして、回り込むときに筋が急に現れたり消えたりしないようにする。
                alpha = (1.0 - smoothstep(.32, .5, max(edge.x, max(edge.y, edge.z)))) * (1.0 - tail * .85);
                p -= normalize(velocity) * streak * tail;
                gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 color; uniform float opacity; varying float alpha;
            void main() { gl_FragColor = vec4(color, opacity * alpha); }`,
    })
    const rain = new THREE.LineSegments(geometry, material)
    rain.frustumCulled = false
    rain.visible = false
    scene.add(rain)
    const u = material.uniforms
    const forward = new THREE.Vector3()
    let clock = 0
    return {
        /** 雨を降らせるか。delta は実時間の秒（一時停止中も、早送り中も同じ速さで降る）。 */
        update(camera: THREE.Camera, raining: boolean, night: number, delta: number) {
            rain.visible = raining
            if (!raining) return
            clock = (clock + delta) % RAIN.period
            u.time!.value = clock
            camera.getWorldDirection(forward)
            u.center!.value.copy(camera.position).addScaledVector(forward, RAIN.ahead)
            u.opacity!.value = RAIN.opacity + (RAIN.nightOpacity - RAIN.opacity) * night
        },
        destroy() { rain.removeFromParent(); geometry.dispose(); material.dispose() },
    }
}
