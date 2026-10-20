import * as THREE from 'three'

/** Horizon and distance haze use the same color so the landscape has no visible edge. */
export function createAtmosphere(scene: THREE.Scene) {
    const dayHorizon = new THREE.Color(0xb6c9cb), nightHorizon = new THREE.Color(0x202d43)
    const fog = new THREE.FogExp2(dayHorizon, .00028)
    scene.fog = fog
    const geometry = new THREE.SphereGeometry(10000, 32, 16)
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { night: { value: 0 }, horizon: { value: dayHorizon.clone() } },
        vertexShader: 'varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            varying vec3 direction; uniform float night; uniform vec3 horizon;
            void main() {
                vec3 dir = normalize(direction);
                vec3 zenith = mix(vec3(.19, .39, .61), vec3(.012, .022, .065), night);
                vec3 sky = mix(horizon, zenith, smoothstep(0.0, .8, dir.y));
                float cloud = sin(dir.x * 16.0 + sin(dir.z * 10.0)) * sin(dir.z * 23.0 + dir.x * 4.0);
                cloud = smoothstep(.35, .9, cloud) * smoothstep(.0, .2, dir.y) * (1.0 - smoothstep(.3, .7, dir.y));
                sky = mix(sky, mix(vec3(.8, .85, .85), vec3(.12, .15, .22), night), cloud * .2);
                gl_FragColor = vec4(sky, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    })
    const sky = new THREE.Mesh(geometry, material)
    sky.frustumCulled = false; sky.renderOrder = -10
    scene.add(sky)
    return { update(camera: THREE.Camera, night: number) {
        sky.position.copy(camera.position)
        material.uniforms.night!.value = night
        fog.color.copy(dayHorizon).lerp(nightHorizon, night)
        material.uniforms.horizon!.value.copy(fog.color)
    }, destroy() { sky.removeFromParent(); geometry.dispose(); material.dispose(); scene.fog = null } }
}
