// Node 22.13+; CPU-only. No WebGL rendering, terrain lookup, or battle simulation.
// Optional: --baseline=HEAD compares with army.ts at the specified local git revision.
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

const root = fileURLToPath(new URL('../', import.meta.url))
const modules = new Map()
function load(file, source = fs.readFileSync(file, 'utf8')) {
    if (modules.has(file)) return modules.get(file)
    const code = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/from ['"]([^'"]+)['"]/g, (_, name) => {
        const url = name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : import.meta.resolve(name)
        return `from '${url}'`
    })
    const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
    modules.set(file, url)
    return url
}
const armyFile = path.join(root, 'app/render/three/army.ts')
const current = await import(load(armyFile))
const revision = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length)
const variants = []
if (revision) {
    const source = execFileSync('git', ['show', `${revision}:app/render/three/army.ts`], { cwd: root, encoding: 'utf8' })
    variants.push(['before', await import(load(path.join(path.dirname(armyFile), '__baseline.ts'), source))])
}
variants.push(['after', current])
const types = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer'], empty = new Set()
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 5000)
const light = new THREE.DirectionalLight()
light.position.set(200, 750, 200); light.target.position.set(416, 0, 416); light.castShadow = true
const view = { camera, light, viewportHeight: 900 }
for (const count of [5000, 10000]) {
    const soldiers = Array.from({ length: count }, (_, id) => ({
        id, owner: id % 2 ? 'cpu' : 'player', type: types[Math.floor(id / 2) % 6], x: id % 100 * 8,
        y: Math.floor(id / 100) * 8, heading: id * .1, state: 'advance', deathTime: 0,
        elapsedTime: id * .017, moving: true, swing: 0, aim: 0, squadId: Math.floor(id / 25),
    }))
    const leaders = new Set(soldiers.filter(s => s.id % 25 === 0).map(s => s.id))
    for (const scenario of ['overview-moving', 'close-moving', 'overview-paused']) {
        const close = scenario.startsWith('close'), paused = scenario.endsWith('paused')
        camera.position.set(400, close ? 70 : 1000, close ? 80 : 1400); camera.lookAt(400, 0, close ? 0 : 300)
        const result = { count, scenario }
        for (const [name, module] of variants) {
            const renderer = module.createArmyRenderer(new THREE.Scene()), samples = []
            for (let frame = 0; frame < 240; frame++) {
                const time = paused ? 10 : frame / 60
                for (const s of soldiers) s.x = s.id % 100 * 8 + (paused ? 0 : time * 2)
                const start = performance.now()
                renderer.update(soldiers, [], [], () => 0, time, time, empty, leaders, empty, view)
                if (frame >= 120) samples.push(performance.now() - start)
            }
            samples.sort((a, b) => a - b)
            result[name] = { medianMs: +samples[60].toFixed(3), p95Ms: +samples[114].toFixed(3) }
            if (name === 'after') result.stats = { ...renderer.stats }
            renderer.destroy()
        }
        console.log(JSON.stringify(result))
    }
}
