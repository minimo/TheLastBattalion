import * as THREE from 'three'
import { createForest } from './forest'
import { TILE, TILE_PX } from '../../game/constants'
import type { Fort } from '../../types/game'
import { BRIDGE_HEIGHT, createHeightfield } from './heightfield'
import { createLandscape, LANDSCAPE_RADIUS, TERRAIN_CENTER } from './landscape'
import { createTerrainMeshes } from './terrainMesh'
import { createScenery } from './scenery'
import type { ModelKit } from './models'
import { fortFootprint, fortGroundAt, gridToLocal, localToWorld } from '../../game/fortLayout'
import { CASTLE_DEPTH, CASTLE_WIDTH, castleCell, castleRadius } from '../../game/castleLayout'
import { mapTypeOf } from '../../game/mapType'
import { MAP_THEME } from './mapTheme'

export function createWorld(grid: number[][], forts: Fort[], kit: ModelKit) {
    const mapType = mapTypeOf(grid), theme = MAP_THEME[mapType]
    grid = grid.map(row => Array.from(row))
    const group = new THREE.Group()
    const coreField = createHeightfield(grid, [], mapType)
    const camps = forts.filter(fort => fort.kind === 'camp'), castles = forts.filter(fort => fort.kind === 'castle')
    const foundations = camps.map(fort => fortFootprint(fort))
    // 砦の敷地（キャンプは平地、城は岩山）。戦場の内外で地形の高さを置き換えるので、砦が戦場の内側にあっても平らに建つ。
    const shape = forts.length ? (x: number, y: number, h: number) => {
        for (const fort of forts) h = fortGroundAt(fort, x, y, fort.groundHeight, h) ?? h
        return h
    } : undefined
    const inCastle = (x: number, y: number) => castles.some(fort => {
        const { lx, ly } = gridToLocal(fort, x / TILE_PX, y / TILE_PX)
        return castleRadius(lx, ly) < 1.25
    })
    // 砦の敷地と正門前、城の周りには木・岩・草を置かない。
    const reserved = (x: number, y: number) => inCastle(x, y) || foundations.some(f => x > f.minX - 14 && x < f.maxX + 14 && y > f.minY - 14 && y < f.maxY + 14)
    const landscape = createLandscape(grid, coreField, [], shape)
    const terrainMeshes = createTerrainMeshes(coreField, landscape, kit.surfaces.ground, theme.ground)
    const field = { ...coreField, heightAt: terrainMeshes.heightAt,
        surfaceAt: (x: number, y: number) => landscape.inside(x, y) ? landscape.surfaceAt(x, y) : Math.max(0, terrainMeshes.heightAt(x, y)),
    }
    const { terrain, surroundings } = terrainMeshes
    group.add(terrain, surroundings)
    const scenery = createScenery(grid, reserved, landscape, field.heightAt, kit, theme)
    group.add(scenery.group)

    const trees: { x: number; z: number; h: number; scale: number }[] = []
    const bridges: THREE.Object3D[] = []
    for (let j = 0; j < grid.length; j++) for (let i = 0; i < grid[j]!.length; i++) {
        const t = grid[j]![i]!, x = i * TILE_PX, z = j * TILE_PX
        if (t === TILE.BRIDGE) {
            const bridge = new THREE.Group()
            bridge.position.set(x, 0, z)
            // Match the crossing direction used by the original map renderer.
            const riverX = grid[j]?.[i - 1] === TILE.WATER || grid[j]?.[i + 1] === TILE.WATER
            if (!riverX) bridge.rotation.y = Math.PI / 2
            kit.part(bridge, kit.rounded, kit.surfaces.wood, 0, BRIDGE_HEIGHT - 1, 0, 15, 2, 16)
            for (let k = -6; k <= 6; k += 3) kit.part(bridge, kit.rounded, kit.surfaces.wood, 0, BRIDGE_HEIGHT + .15, k, 14, .3, 2.5)
            for (const side of [-1, 1]) {
                kit.part(bridge, kit.rounded, kit.surfaces.wood, side * 7, 7, 0, .8, 1, 16)
                for (const end of [-6, 6]) kit.part(bridge, kit.rounded, kit.surfaces.wood, side * 7, 2, end, 1.2, 11, 1.2)
            }
            for (const side of [-1, 1]) for (let k = -6; k <= 6; k += 3) {
                kit.part(bridge, kit.cylinder, 0x454746, side * 5.8, BRIDGE_HEIGHT + .33, k, .14, .1, .14)
            }
            // Deck extensions form approaches at the two land-facing ends.
            for (const end of [-1, 1]) {
                const gx = riverX ? i : i + end, gy = riverX ? j + end : j
                const neighbor = grid[gy]?.[gx]
                if (neighbor !== undefined && neighbor !== TILE.BRIDGE && neighbor !== TILE.WATER) {
                    const bankHeight = field.heightAt(gx * TILE_PX, gy * TILE_PX)
                    const ramp = kit.part(bridge, kit.rounded, kit.surfaces.wood, 0, (BRIDGE_HEIGHT + bankHeight) / 2 - .5, end * 12, 14, 1, Math.hypot(8, bankHeight - BRIDGE_HEIGHT))
                    ramp.rotation.x = -end * Math.atan2(bankHeight - BRIDGE_HEIGHT, 8)
                    // Align the top face exactly with the shared walking surface.
                    ramp.position.y = (BRIDGE_HEIGHT + bankHeight) / 2 - .5 * Math.cos(ramp.rotation.x)
                    ramp.position.z = end * 12 - .5 * Math.sin(ramp.rotation.x)
                }
            }
            group.add(bridge)
            bridges.push(bridge)
        }
        if ((t === TILE.WOOD || t >= 31 && t <= 41) && !reserved(x, z)) {
            // 枯れ木はまばらに立つ。
            const count = theme.trees.style === 'dead' ? (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1 + 1) % 1 < .45 ? 1 : 0
                : t >= 34 ? 3 : 2
            for (let k = 0; k < count; k++) {
                const tx = x + Math.sin(i * 17 + j * 31 + k * 11) * 5
                const tz = z + Math.cos(i * 13 + j * 7 + k * 19) * 5
                trees.push({ x: tx, z: tz, h: field.heightAt(tx, tz), scale: .7 + .35 * (1 + Math.sin(i * 3 + j + k)) })
            }
        }
    }
    // 城の裏手の斜面の林（本陣の棟が建つ頂の裏手には植えない）。
    for (const fort of castles) for (let lx = 0; lx < CASTLE_DEPTH; lx++) for (let ly = 0; ly < CASTLE_WIDTH; ly++) {
        if (castleCell(lx, ly) !== 'grove' || castleRadius(lx, ly) < .5 || Math.sin(lx * 12.9898 + ly * 78.233) * 43758.5453 % 1 > .1) continue
        const p = localToWorld(fort, lx + Math.sin(lx * 7.1 + ly) * .3, ly + Math.cos(ly * 5.3 + lx) * .3)
        trees.push({ x: p.x, z: p.y, h: field.heightAt(p.x, p.y) - 1, scale: .6 + .25 * (1 + Math.sin(lx * 3 + ly)) })
    }
    const forest = createForest([...trees, ...scenery.trees], kit, theme.trees)
    group.add(forest.group)
    // The terrain itself shapes the shoreline; no square water-tile silhouettes.
    const waterGeometry = new THREE.PlaneGeometry(LANDSCAPE_RADIUS * 2, LANDSCAPE_RADIUS * 2)
    waterGeometry.rotateX(-Math.PI / 2)
    waterGeometry.translate(TERRAIN_CENTER, 0, TERRAIN_CENTER)
    const waterMaterial = new THREE.MeshStandardMaterial({ color: theme.water.color, roughness: theme.water.roughness, metalness: theme.water.metalness, transparent: true, opacity: theme.water.opacity })
    waterMaterial.onBeforeCompile = shader => {
        shader.uniforms.time = { value: 0 }
        waterMaterial.userData.shader = shader
        shader.vertexShader = 'varying vec3 riverPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nriverPosition = position;')
        shader.fragmentShader = 'uniform float time; varying vec3 riverPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat ripple = sin(riverPosition.x * 1.3 + riverPosition.z * .7 - time * 1.6) * sin(riverPosition.z * 1.7 - riverPosition.x * .4 + time);\ndiffuseColor.rgb += ripple * .006;')
    }
    const water = new THREE.Mesh(waterGeometry, waterMaterial)
    group.add(water)
    return { group, field, mapType, theme, pickables: [terrain, surroundings, water, ...bridges], update(time: number) {
        const shader = waterMaterial.userData.shader
        if (shader) shader.uniforms.time.value = time
    }, destroy() {
        terrainMeshes.destroy(); scenery.destroy(); waterGeometry.dispose(); waterMaterial.dispose()
        forest.destroy()
        group.removeFromParent()
    } }
}
