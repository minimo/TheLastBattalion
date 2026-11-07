import * as THREE from 'three'

/**
 * 雪が降り続くと地面が少しずつ白くなる。見た目だけで、ゲームの処理には影響しない。
 * 高い所ほど早く積もる（山の頂上が一番先に白くなり、低い所ほど遅れる）。どこでもまだらに積もり始め、だんだん広がる。
 * 低い所が白いのに高い所が白くない、ということが起こらないように、積もり具合は高さとともに必ず増える。
 * 積もる速さと溶ける速さは game/weather.ts の WEATHER_CHANGE が決める（雪が止むと、積もったときと逆の順に溶けて地面が見えてくる）。
 * slope: 雪が積もる地面の傾き（法線の上向きの成分）。scale: まだらの模様の大きさ / shore: 水際から積もり始める高さ。
 * rise: この高さだけ上がるごとに、積もる速さが平地の1倍分ずつ増える（高さ rise で2倍、rise の2倍で3倍）。
 * mountainSlope: 高い所と積もりきった所で雪が残る地面の傾き（平地より急な斜面まで白くする）。high: 山とみなす高さ（この間で傾きの基準を移す）。
 */
const SNOW_COVER = {
    color: 0xe6ecf0,
    slope: [.72, .9], scale: .012, shore: [.5, 4],
    rise: 45, mountainSlope: [.45, .7], high: [20, 220],
}

/** 雪の積もり具合（0〜1）。積雪の進み具合（WeatherState の snow）から決める。 */
export function snowCoverOf(progress: number) {
    const t = Math.min(1, Math.max(0, progress))
    return t * t * (3 - 2 * t)
}

/** 積もり具合（0〜1）。地面と木の素材で共有し、毎フレーム gameScene が決める。 */
export const snowCover = { value: 0 }

/** 地面の素材に積雪を描き足す。 */
export function applySnowCover(material: THREE.MeshStandardMaterial) {
    const cover = snowCover
    const color = { value: new THREE.Color(SNOW_COVER.color) }
    const before = material.onBeforeCompile.bind(material)
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => `${key}:snowCover`
    material.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer)
        shader.uniforms.snowCover = cover
        shader.uniforms.snowColor = color
        shader.vertexShader = 'varying vec3 vSnowWorld; varying float vSnowUp;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;`)
        shader.fragmentShader = `varying vec3 vSnowWorld; varying float vSnowUp; uniform float snowCover; uniform vec3 snowColor;
            float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float snowNoise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(snowHash(i), snowHash(i + vec2(1, 0)), f.x), mix(snowHash(i + vec2(0, 1)), snowHash(i + vec2(1, 1)), f.x), f.y);
            }\n` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            if (snowCover > 0.0) {
                vec2 snowAt = vSnowWorld.xz * ${SNOW_COVER.scale};
                float snowPatch = snowNoise(snowAt) * .65 + snowNoise(snowAt * 4.1 + 17.0) * .35;
                // その場所の積もり具合。高い所ほど早く進む。
                float snowLocal = min(1.0, snowCover * (1.0 + max(vSnowWorld.y, 0.0) / ${SNOW_COVER.rise.toFixed(1)}));
                // 積もり具合が上がるほど、まだらの模様の低い所まで白くなる。
                float snowAmount = clamp((snowLocal * 1.5 - (1.0 - snowPatch)) / .25, 0.0, 1.0);
                // 雪が残る傾き。山の上と積もりきった所では、平地より急な斜面まで白くする。
                float snowSteep = max(smoothstep(${SNOW_COVER.high[0].toFixed(1)}, ${SNOW_COVER.high[1].toFixed(1)}, vSnowWorld.y), snowLocal * snowLocal);
                vec2 snowSlope = mix(vec2(${SNOW_COVER.slope[0]}, ${SNOW_COVER.slope[1]}), vec2(${SNOW_COVER.mountainSlope[0]}, ${SNOW_COVER.mountainSlope[1]}), snowSteep);
                snowAmount *= smoothstep(snowSlope.x, snowSlope.y, vSnowUp);
                snowAmount *= smoothstep(${SNOW_COVER.shore[0].toFixed(1)}, ${SNOW_COVER.shore[1].toFixed(1)}, vSnowWorld.y);
                // 地面の模様を少しだけ残して、雪の面がのっぺりしないようにする。
                float snowGrain = .93 + .07 * dot(diffuseColor.rgb, vec3(.3, .59, .11));
                diffuseColor.rgb = mix(diffuseColor.rgb, snowColor * snowGrain, snowAmount);
            }`)
    }
    material.needsUpdate = true
}

/**
 * 木の葉と草に積雪を描き足す（木の幹と枝は地肌のまま）。上の端から先に白くなり、だんだん下へ広がる。
 * 地面と同じく、高い所に生えているものほど早く積もる。low・high: 白くする部分の高さ（形の中での高さ。上の端が high）。
 */
export function applyPlantSnow(material: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial, low: number, high: number) {
    const before = material.onBeforeCompile.bind(material)
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => `${key}:treeSnow`
    material.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer)
        shader.uniforms.snowCover = snowCover
        shader.vertexShader = 'varying vec3 vTreeSnow;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 treeSnowBase = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vec4 treeSnowAt = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                treeSnowBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                treeSnowAt = instanceMatrix * treeSnowAt;
            #endif
            // x: 木の中での高さ（根元側 0 〜 梢 1）/ y: 木の立つ高さ / z: むらを付けるための位置
            vTreeSnow = vec3((transformed.y - ${low.toFixed(1)}) / ${(high - low).toFixed(1)}, treeSnowBase.y, dot((modelMatrix * treeSnowAt).xyz, vec3(.61, .37, .53)));`)
        shader.fragmentShader = 'varying vec3 vTreeSnow; uniform float snowCover;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            if (snowCover > 0.0) {
                float treeLocal = min(1.0, snowCover * (1.0 + max(vTreeSnow.y, 0.0) / ${SNOW_COVER.rise.toFixed(1)}));
                // 梢から下へ白さが下りてくる。境目は葉ごとに少しずらして、横一直線にならないようにする。
                float treeEdge = 1.0 - treeLocal * 1.35 + sin(vTreeSnow.z * 1.7) * sin(vTreeSnow.z * .63 + 1.3) * .12;
                float treeAmount = smoothstep(treeEdge, treeEdge + .25, clamp(vTreeSnow.x, 0.0, 1.0));
                // 葉の絵の濃淡は少し残して葉の形を見せ、裏を向いた面は影になって少し暗くする。
                float treeLight = (gl_FrontFacing ? 1.0 : .82) * (.62 + .42 * dot(diffuseColor.rgb, vec3(.333)));
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.95, .97, 1.0) * treeLight, treeAmount);
            }`)
    }
    material.needsUpdate = true
}

/**
 * 枯れ木の幹と枝、岩に積雪を描き足す。上を向いた面にだけ積もり、梢の枝から先に白くなる。
 * 枝はそれぞれが別の部品なので、木の中での高さと木の立つ高さを、部品ごとの値 snowPlace（x: 根元 0 〜 梢 1 / y: 木の立つ高さ）で受け取る。
 */
export function applyBranchSnow(material: THREE.MeshStandardMaterial) {
    applyTopSnow(material, 'branchSnow')
}

/**
 * 陣地・城・拠点・橋などの部材に積雪を描き足す。屋根や床のように上を向いた面に積もり、高い所にあるものほど早く白くなる。
 * place: 雪が積もる順番（枯れ木の中での高さと同じ尺度。大きいほど早い）。
 */
export function applySurfaceSnow(material: THREE.MeshStandardMaterial, place = SURFACE_SNOW_PLACE) {
    applyTopSnow(material, 'surfaceSnow', place)
}

/** 部材の雪が積もる順番。平地の地面より少し早く白くなる。 */
const SURFACE_SNOW_PLACE = .6

/** 上を向いた面に積もる雪。place がなければ、部品ごとの値 snowPlace から順番と立つ高さを受け取る。 */
function applyTopSnow(material: THREE.MeshStandardMaterial, name: string, place?: number) {
    const before = material.onBeforeCompile.bind(material)
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => `${key}:${name}`
    material.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer)
        shader.uniforms.snowCover = snowCover
        shader.vertexShader = `${place === undefined ? 'attribute vec2 snowPlace; ' : ''}varying vec3 vBranchSnow;\n` + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec3 branchSnowUp = objectNormal;
            vec4 branchSnowAt = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                branchSnowUp = mat3(instanceMatrix) * branchSnowUp;
                branchSnowAt = instanceMatrix * branchSnowAt;
            #endif
            // x: 積もる順番 / y: 立つ高さ / z: 面の上向きの度合い
            vBranchSnow = vec3(${place === undefined ? 'snowPlace' : `${place.toFixed(2)}, (modelMatrix * branchSnowAt).y`}, normalize(mat3(modelMatrix) * branchSnowUp).y);`)
        shader.fragmentShader = 'varying vec3 vBranchSnow; uniform float snowCover;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            if (snowCover > 0.0) {
                float branchLocal = min(1.0, snowCover * (1.0 + max(vBranchSnow.y, 0.0) / ${SNOW_COVER.rise.toFixed(1)}));
                float branchEdge = 1.0 - branchLocal * 1.35;
                float branchAmount = smoothstep(branchEdge, branchEdge + .25, clamp(vBranchSnow.x, 0.0, 1.0));
                // 上の面から積もり、積もるほど横の面まで回り込む。下の面は地肌のまま（両面の布は、裏側を下の面として扱う）。
                float branchUp = gl_FrontFacing ? vBranchSnow.z : -vBranchSnow.z;
                branchAmount *= smoothstep(mix(.25, -.05, branchLocal), mix(.7, .35, branchLocal), branchUp);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92, .94, .97) * (.85 + .15 * max(branchUp, 0.0)), branchAmount);
            }`)
    }
    material.needsUpdate = true
}
