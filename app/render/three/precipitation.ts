import * as THREE from 'three'

/**
 * 雨の筋と雪の粒。戦場全体には降らせず、カメラの前の箱の中だけに降らせる（描画の重さが戦場の広さによらず一定になる）。
 * 粒の位置は頂点シェーダーで時刻から求めるので、毎フレームの CPU の計算はない。
 * 粒は世界に対して落ちていき、箱の端を越えると反対側に回り込む（カメラが動いても雨が一緒に動いて見えない）。
 */
const RAIN = {
    count: 8000, box: 520, ahead: 260,
    fall: 340, wind: { x: 40, z: 18 }, length: 30,
    color: 0xe4ecf2, opacity: .5, nightOpacity: .27,
    /** 時刻を回す周期（秒）。大きな時刻で mod の精度が落ちないようにする。 */
    period: 600,
}

/** 雪の粒。雨よりゆっくり落ち、左右に揺れながら舞う。粒の大きさは近いほど大きく見せる。
 * big: 大粒の雪の割合と大きさの倍率。大粒は少しゆっくり落ちる。 */
const SNOW = {
    count: 9000, box: 520, ahead: 260,
    fall: 26, wind: { x: 8, z: 3 }, sway: 7,
    size: 700, minSize: 1.5, maxSize: 7,
    big: { share: .06, scale: 2.4, slow: .8 },
    color: 0xf4f7fa, opacity: .85, nightOpacity: .45,
    period: 600,
}

function createSnow(scene: THREE.Scene) {
    const seeds = new Float32Array(SNOW.count * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: {
            center: { value: new THREE.Vector3() }, size: { value: SNOW.box }, time: { value: 0 },
            velocity: { value: new THREE.Vector3(SNOW.wind.x, -SNOW.fall, SNOW.wind.z) }, sway: { value: SNOW.sway },
            pointSize: { value: new THREE.Vector3(SNOW.size, SNOW.minSize, SNOW.maxSize) },
            big: { value: new THREE.Vector3(SNOW.big.share, SNOW.big.scale, SNOW.big.slow) },
            color: { value: new THREE.Color(SNOW.color) }, opacity: { value: SNOW.opacity },
        },
        vertexShader: `
            uniform vec3 center; uniform float size; uniform float time; uniform vec3 velocity; uniform float sway; uniform vec3 pointSize; uniform vec3 big;
            varying float alpha;
            void main() {
                vec3 low = center - size * .5;
                // 粒ごとに大粒かどうかを決める（同じ粒はいつも同じ）。
                float large = step(1.0 - big.x, fract(position.x * 71.0 + position.y * 53.0 + position.z * 29.0));
                float scale = mix(1.0, big.y, large);
                vec3 p = low + mod(position * size + velocity * mix(1.0, big.z, large) * time - low, size);
                // 粒ごとに揺れの速さと向きを変えて、ひらひらと舞って見せる。
                float phase = position.x * 37.0 + position.z * 19.0;
                float rate = .6 + fract(position.y * 13.0) * .8;
                p.x += sin(time * rate + phase) * sway;
                p.z += cos(time * rate * .8 + phase * 1.3) * sway;
                vec3 edge = abs(p - center) / size;
                alpha = 1.0 - smoothstep(.32, .5, max(edge.x, max(edge.y, edge.z)));
                vec4 view = viewMatrix * vec4(p, 1.0);
                gl_PointSize = clamp(pointSize.x / max(-view.z, 1.0), pointSize.y, pointSize.z) * scale;
                gl_Position = projectionMatrix * view;
            }`,
        fragmentShader: `
            uniform vec3 color; uniform float opacity; varying float alpha;
            void main() {
                float r = length(gl_PointCoord - .5) * 2.0;
                float a = opacity * alpha * (1.0 - smoothstep(.4, 1.0, r));
                if (a < .01) discard;
                gl_FragColor = vec4(color, a);
            }`,
    })
    const snow = new THREE.Points(geometry, material)
    snow.frustumCulled = false
    snow.visible = false
    scene.add(snow)
    const u = material.uniforms
    const forward = new THREE.Vector3()
    let clock = 0
    return {
        update(camera: THREE.Camera, snowing: boolean, night: number, delta: number) {
            snow.visible = snowing
            if (!snowing) return
            clock = (clock + delta) % SNOW.period
            u.time!.value = clock
            camera.getWorldDirection(forward)
            u.center!.value.copy(camera.position).addScaledVector(forward, SNOW.ahead)
            u.opacity!.value = SNOW.opacity + (SNOW.nightOpacity - SNOW.opacity) * night
        },
        destroy() { snow.removeFromParent(); geometry.dispose(); material.dispose() },
    }
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
                alpha = (1.0 - smoothstep(.32, .5, max(edge.x, max(edge.y, edge.z)))) * (1.0 - tail * .7);
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
    const snow = createSnow(scene)
    return {
        /** 雨か雪を降らせる（null で何も降らせない）。delta は実時間の秒（一時停止中も、早送り中も同じ速さで降る）。 */
        update(camera: THREE.Camera, fall: 'rain' | 'snow' | null, night: number, delta: number) {
            snow.update(camera, fall === 'snow', night, delta)
            const raining = fall === 'rain'
            rain.visible = raining
            if (!raining) return
            clock = (clock + delta) % RAIN.period
            u.time!.value = clock
            camera.getWorldDirection(forward)
            u.center!.value.copy(camera.position).addScaledVector(forward, RAIN.ahead)
            u.opacity!.value = RAIN.opacity + (RAIN.nightOpacity - RAIN.opacity) * night
        },
        destroy() { rain.removeFromParent(); geometry.dispose(); material.dispose(); snow.destroy() },
    }
}
