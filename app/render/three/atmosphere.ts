import * as THREE from 'three'
import type { MapTheme } from './mapTheme'

/**
 * 月の出と月の入り（ゲーム内の分）。夕方に左手（初期視点から見て）の地平線から昇り、敵陣の上を横切って、明け方に右手へ沈む。
 * カメラは地平線の少し上までしか見上げられないので、空の低いところを渡る（最も高くて約9°）。
 */
const MOONRISE = 1050, MOONSET = 1830
const MOON_ARC = { lowest: -6, highest: 9, fromAzimuth: -75, toAzimuth: 75 }
const DEGREE = Math.PI / 180

/** dayTime のときの月の方角。月が出ていなければ null。 */
export function moonDirectionAt(dayTime: number, target = new THREE.Vector3()) {
    const t = ((dayTime - MOONRISE + 1440) % 1440) / (MOONSET - MOONRISE)
    if (t > 1) return null
    const arc = Math.sin(Math.PI * t)
    const elevation = (MOON_ARC.lowest + (MOON_ARC.highest - MOON_ARC.lowest) * arc) * DEGREE
    const azimuth = (MOON_ARC.fromAzimuth + (MOON_ARC.toAzimuth - MOON_ARC.fromAzimuth) * t) * DEGREE
    return target.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation))
}

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
            moonDirection: { value: new THREE.Vector3(1, 0, 0) }, moonColor: { value: new THREE.Color() }, moonGlow: { value: new THREE.Color() }, moon: { value: 0 },
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
                    float visible = moon * smoothstep(0.0, .4, night) * smoothstep(-.02, .02, dir.y);
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
    let hasMoon = false
    const setTheme = (theme: MapTheme['sky']) => {
        dayHorizon.set(theme.dayHorizon); nightHorizon.set(theme.nightHorizon)
        u.dayZenith!.value.set(theme.dayZenith); u.nightZenith!.value.set(theme.nightZenith)
        u.dayCloud!.value.set(theme.dayCloud); u.nightCloud!.value.set(theme.nightCloud); u.cloudAmount!.value = theme.cloudAmount
        hasMoon = !!theme.moon
        if (theme.moon) { u.moonColor!.value.set(theme.moon.color); u.moonGlow!.value.set(theme.moon.glow) }
        fog.density = theme.fog
        if (scene.background instanceof THREE.Color) scene.background.copy(dayHorizon)
    }
    setTheme(initial)
    return { setTheme, update(camera: THREE.Camera, night: number, dayTime: number) {
        sky.position.copy(camera.position)
        u.night!.value = night
        u.moon!.value = hasMoon && moonDirectionAt(dayTime, u.moonDirection!.value) ? 1 : 0
        fog.color.copy(dayHorizon).lerp(nightHorizon, night)
        u.horizon!.value.copy(fog.color)
    }, destroy() { sky.removeFromParent(); geometry.dispose(); material.dispose(); scene.fog = null } }
}
