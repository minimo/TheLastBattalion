import * as THREE from 'three'
import type { MapTheme } from './mapTheme'

/** 月の方角。初期視点（自軍の後方から敵軍の方）を上へ傾けたときに、地平線の少し上に見える。 */
const MOON_DIRECTION = new THREE.Vector3(.9, .107, -.37).normalize()

/** Horizon and distance haze use the same color so the landscape has no visible edge. */
export function createAtmosphere(scene: THREE.Scene, initial: MapTheme['sky']) {
    const dayHorizon = new THREE.Color(), nightHorizon = new THREE.Color()
    const fog = new THREE.FogExp2(0xffffff, initial.fog)
    scene.fog = fog
    const geometry = new THREE.SphereGeometry(10000, 32, 16)
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
            night: { value: 0 }, horizon: { value: new THREE.Color() },
            dayZenith: { value: new THREE.Color() }, nightZenith: { value: new THREE.Color() },
            dayCloud: { value: new THREE.Color() }, nightCloud: { value: new THREE.Color() }, cloudAmount: { value: .2 },
            moonDirection: { value: MOON_DIRECTION }, moonColor: { value: new THREE.Color() }, moonGlow: { value: new THREE.Color() }, moon: { value: 0 },
        },
        vertexShader: 'varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            varying vec3 direction; uniform float night; uniform vec3 horizon;
            uniform vec3 dayZenith; uniform vec3 nightZenith; uniform vec3 dayCloud; uniform vec3 nightCloud; uniform float cloudAmount;
            uniform vec3 moonDirection; uniform vec3 moonColor; uniform vec3 moonGlow; uniform float moon;
            void main() {
                vec3 dir = normalize(direction);
                vec3 zenith = mix(dayZenith, nightZenith, night);
                vec3 sky = mix(horizon, zenith, smoothstep(0.0, .8, dir.y));
                float cloud = sin(dir.x * 16.0 + sin(dir.z * 10.0)) * sin(dir.z * 23.0 + dir.x * 4.0);
                cloud = smoothstep(.35, .9, cloud) * smoothstep(.0, .2, dir.y) * (1.0 - smoothstep(.3, .7, dir.y));
                sky = mix(sky, mix(dayCloud, nightCloud, night), cloud * cloudAmount);
                if (moon > 0.0) {
                    float d = dot(dir, moonDirection);
                    // Large, low moon: a disc with darker maria and a wide halo.
                    float disc = smoothstep(.99525, .99545, d);
                    vec3 side = normalize(cross(moonDirection, vec3(0.0, 1.0, 0.0)));
                    vec3 up = cross(side, moonDirection);
                    vec2 p = vec2(dot(dir, side), dot(dir, up)) * 36.0;
                    float maria = .5 + .5 * sin(p.x * 2.1 + sin(p.y * 1.7)) * sin(p.y * 2.6 - p.x * .8);
                    vec3 face = moonColor * (.78 + .3 * maria);
                    float halo = pow(max(d, 0.0), 300.0) * .55 + pow(max(d, 0.0), 60.0) * .18;
                    float visible = moon * smoothstep(.2, .7, night) * smoothstep(-.02, .02, dir.y);
                    sky += moonGlow * halo * visible * (1.0 - disc);
                    sky = mix(sky, face, disc * visible * (1.0 - cloud * cloudAmount * 1.5));
                }
                gl_FragColor = vec4(sky, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    })
    const sky = new THREE.Mesh(geometry, material)
    sky.frustumCulled = false; sky.renderOrder = -10
    scene.add(sky)
    const u = material.uniforms
    const setTheme = (theme: MapTheme['sky']) => {
        dayHorizon.set(theme.dayHorizon); nightHorizon.set(theme.nightHorizon)
        u.dayZenith!.value.set(theme.dayZenith); u.nightZenith!.value.set(theme.nightZenith)
        u.dayCloud!.value.set(theme.dayCloud); u.nightCloud!.value.set(theme.nightCloud); u.cloudAmount!.value = theme.cloudAmount
        u.moon!.value = theme.moon ? 1 : 0
        if (theme.moon) { u.moonColor!.value.set(theme.moon.color); u.moonGlow!.value.set(theme.moon.glow) }
        fog.density = theme.fog
        if (scene.background instanceof THREE.Color) scene.background.copy(dayHorizon)
    }
    setTheme(initial)
    return { setTheme, update(camera: THREE.Camera, night: number) {
        sky.position.copy(camera.position)
        u.night!.value = night
        fog.color.copy(dayHorizon).lerp(nightHorizon, night)
        u.horizon!.value.copy(fog.color)
    }, destroy() { sky.removeFromParent(); geometry.dispose(); material.dispose(); scene.fog = null } }
}
