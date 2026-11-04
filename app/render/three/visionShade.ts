import * as THREE from 'three'
import { TILE_PX } from '../../game/constants'
import { PLAYABLE_GRID_MIN } from '../../game/playableArea'
import { VISION_SIZE } from '../../game/vision'

const N = VISION_SIZE
/** 視界の境界がなめらかに変わる秒数（実時間）。 */
const BLEND_SECONDS = .3
/** 視界の外の暗さ（1で元の明るさ）。夜はもともと暗いので、見分けられるよう強めにする。 */
const DARK_DAY = .52, DARK_NIGHT = .36
/** 戦場の端で、見えている明るさが視界の外の暗さへ変わる幅（px）。戦場の外はすべて視界の外。 */
const EDGE_FADE = 24

/**
 * 視界の外の地形・木・建物を暗く沈める。自軍の視界の地図をテクスチャにして、該当する素材のシェーダーへ渡す。
 * 地図は更新のときだけ送り、前後の地図の間を時間で混ぜて境界をなめらかに動かす。
 */
export function createVisionShade() {
    const makeTexture = () => {
        const texture = new THREE.DataTexture(new Uint8Array(N * N).fill(255), N, N, THREE.RedFormat, THREE.UnsignedByteType)
        texture.minFilter = texture.magFilter = THREE.LinearFilter
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
        texture.needsUpdate = true
        return texture
    }
    let previous = makeTexture(), next = makeTexture()
    const uniforms = {
        visionPrevious: { value: previous }, visionNext: { value: next }, visionBlend: { value: 1 }, visionDark: { value: DARK_DAY }, visionReveal: { value: 0 },
        visionOrigin: { value: new THREE.Vector2((PLAYABLE_GRID_MIN - .5) * TILE_PX, (PLAYABLE_GRID_MIN - .5) * TILE_PX) },
        visionScale: { value: 1 / (N * TILE_PX) },
    }
    const shaded = new WeakSet<THREE.Material>()
    const shade = (material: THREE.Material) => {
        if (shaded.has(material) || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return
        shaded.add(material)
        const before = material.onBeforeCompile.bind(material)
        const key = material.customProgramCacheKey()
        material.customProgramCacheKey = () => `${key}:vision`
        material.onBeforeCompile = (shader, renderer) => {
            before(shader, renderer)
            Object.assign(shader.uniforms, uniforms)
            shader.vertexShader = 'varying vec2 vVisionXZ;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
                vec4 visionWorld = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    visionWorld = instanceMatrix * visionWorld;
                #endif
                vVisionXZ = (modelMatrix * visionWorld).xz;`)
            shader.fragmentShader = `varying vec2 vVisionXZ;
                uniform sampler2D visionPrevious; uniform sampler2D visionNext;
                uniform float visionBlend; uniform float visionDark; uniform float visionReveal; uniform vec2 visionOrigin; uniform float visionScale;\n` + shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
                vec2 visionUv = (vVisionXZ - visionOrigin) * visionScale;
                vec2 visionBeyond = max(max(-visionUv, visionUv - 1.0), vec2(0.0));
                float visionLit = smoothstep(.3, .7, mix(texture2D(visionPrevious, visionUv).r, texture2D(visionNext, visionUv).r, visionBlend));
                visionLit = max(visionReveal, visionLit * (1.0 - smoothstep(0.0, ${EDGE_FADE.toFixed(1)}, max(visionBeyond.x, visionBeyond.y) / visionScale)));
                float visionGray = dot(gl_FragColor.rgb, vec3(.3, .59, .11));
                gl_FragColor.rgb = mix(mix(vec3(visionGray), gl_FragColor.rgb, .45) * visionDark, gl_FragColor.rgb, visionLit);`)
        }
        material.needsUpdate = true
    }
    let version = -1
    return {
        /** グループの中の素材に暗さを付ける（同じ素材は一度だけ）。 */
        apply(object: THREE.Object3D) {
            object.traverse(child => {
                const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
                if (Array.isArray(material)) material.forEach(shade)
                else if (material) shade(material)
            })
        },
        update(mask: Uint8Array, maskVersion: number, delta: number, night: number, reveal: boolean) {
            uniforms.visionDark.value = DARK_DAY + (DARK_NIGHT - DARK_DAY) * night
            uniforms.visionReveal.value = reveal ? 1 : 0
            uniforms.visionBlend.value = Math.min(1, uniforms.visionBlend.value + delta / BLEND_SECONDS)
            if (maskVersion === version) return
            const first = version < 0
            version = maskVersion
            ;[previous, next] = [next, previous]
            uniforms.visionPrevious.value = previous
            uniforms.visionNext.value = next
            uniforms.visionBlend.value = first ? 1 : 0
            // 周りのマスとならして、マス目の角と小さな穴を目立たなくする。
            const out = next.image.data as Uint8Array
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
                let sum = 0
                for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
                    const a = Math.max(0, Math.min(N - 1, i + x)), b = Math.max(0, Math.min(N - 1, j + y))
                    sum += mask[b * N + a]! * (x ? 1 : 2) * (y ? 1 : 2)
                }
                out[j * N + i] = sum * 255 / 16
            }
            next.needsUpdate = true
        },
        destroy() { previous.dispose(); next.dispose() },
    }
}
