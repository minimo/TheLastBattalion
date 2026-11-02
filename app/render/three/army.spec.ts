import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Soldier } from '../../types/game'
import { createArmyRenderer, type ArmyRenderer } from './army'
import { createArmyVisibility, type ArmyView } from './armyVisibility'
import { InstanceBuffer } from './instanceBuffer'

const empty = new Set<number>()
const soldier = (id: number, options: Partial<Soldier> = {}): Soldier => ({
    id, owner: 'player', type: 'infantry', x: 0, y: 0, heading: 0, state: 'hold', moving: false,
    elapsedTime: 0, deathTime: 0, swing: 0, aim: 0, squadId: 1, ...options,
} as Soldier)
function view(): ArmyView {
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000)
    camera.position.set(0, 120, 200); camera.lookAt(0, 0, 0)
    const light = new THREE.DirectionalLight()
    light.position.set(100, 200, 100); light.castShadow = true
    return { camera, light, viewportHeight: 800 }
}
const renderers: ArmyRenderer[] = []
function renderer() { const result = createArmyRenderer(new THREE.Scene()); renderers.push(result); return result }
afterEach(() => { for (const r of renderers) r.destroy(); renderers.length = 0 })
function update(r: ArmyRenderer, soldiers: Soldier[], options: { view?: ArmyView; time?: number; ground?: number; selected?: Set<number>; leaders?: Set<number> } = {}) {
    r.update(soldiers, [], [], () => options.ground ?? 0, options.time ?? 1, options.time ?? 1,
        options.selected ?? empty, options.leaders ?? empty, empty, options.view)
}
const activeMeshes = (r: ArmyRenderer) => r.group.children.filter(m => m.visible) as THREE.InstancedMesh[]

describe('army visibility and cached transforms', () => {
    it('excludes an offscreen army before composing matrices; camera movement restores it at the current pose', () => {
        const r = renderer(), cameraView = view()
        const soldiers = [soldier(1), ...Array.from({ length: 5000 }, (_, i) => soldier(i + 2, { x: 10000 + i % 10 }))]
        update(r, soldiers, { view: cameraView })
        expect(r.stats.renderedSoldiers).toBe(1)
        expect(r.stats.culledSoldiers).toBe(5000)
        expect(r.stats.matrixCompositions).toBe(5)
        cameraView.camera.position.x = 10000
        cameraView.camera.lookAt(10000, 0, 0)
        update(r, soldiers, { view: cameraView, time: 2 })
        expect(r.stats.renderedSoldiers).toBe(5000)
        expect(activeMeshes(r).filter(m => m.count === 5000)).toHaveLength(4)
    })

    it('reuses static poses and does not upload unchanged matrices; ground, heading and selection remain live', () => {
        const r = renderer(), s = soldier(1)
        update(r, [s])
        const versions = activeMeshes(r).map(m => m.instanceMatrix.version)
        update(r, [s], { time: 2 })
        expect(r.stats.matrixCompositions).toBe(0)
        expect(r.stats.matrixWrites).toBe(0)
        expect(r.stats.dirtyMatrixBytes).toBe(0)
        expect(activeMeshes(r).map(m => m.instanceMatrix.version)).toEqual(versions)
        s.heading = .5
        update(r, [s], { time: 2, ground: 7, selected: new Set([1]) })
        expect(r.stats.matrixWrites).toBe(5)
        expect(activeMeshes(r).some(m => m.renderOrder === 5)).toBe(true)
        update(r, [s], { time: 2, ground: 7 })
        expect(activeMeshes(r).some(m => m.renderOrder === 5)).toBe(false)
    })

    it('only rebuilds the attacking arm of a stationary infantryman', () => {
        const r = renderer(), s = soldier(1)
        update(r, [s])
        s.swing = .2
        update(r, [s])
        expect(r.stats.matrixCompositions).toBe(1)
        expect(r.stats.matrixWrites).toBe(1)
    })

    it('keeps flags and arrows stable while paused, resumes moving poses, and removes departed leaders', () => {
        const r = renderer(), s = soldier(1, { type: 'archer', moving: true })
        update(r, [s], { leaders: new Set([1]) })
        update(r, [s], { leaders: new Set([1]) })
        expect(r.stats.matrixWrites).toBe(0)
        update(r, [s], { time: 2, leaders: new Set([1]) })
        expect(r.stats.matrixWrites).toBeGreaterThan(0)
        update(r, [s], { time: 2 })
        expect(activeMeshes(r)).toHaveLength(5)
        s.moving = false; s.state = 'fight'; s.aim = .3
        update(r, [s], { time: 2 })
        expect(r.stats.matrixWrites).toBeGreaterThan(0)
    })

    it('repacks cached poses when another soldier disappears and handles reused IDs and capacity growth', () => {
        const r = renderer()
        const soldiers = Array.from({ length: 130 }, (_, i) => soldier(i, { x: i }))
        update(r, soldiers)
        update(r, soldiers.slice(1))
        // Slot changes rebuild four part transforms from each cached base pose.
        expect(r.stats.matrixCompositions).toBe(129 * 4)
        const matrix = new THREE.Matrix4()
        for (const mesh of activeMeshes(r)) {
            expect(mesh.count).toBe(129)
            mesh.getMatrixAt(0, matrix)
            expect(matrix.elements[12]).toBeGreaterThan(-1)
            expect(matrix.elements[12]).toBeLessThan(3)
        }
        update(r, [soldier(1, { x: 500 })])
        activeMeshes(r)[0]!.getMatrixAt(0, matrix)
        expect(matrix.elements[12]).toBe(500)
        update(r, [])
        expect(activeMeshes(r)).toHaveLength(0)
    })

    it('moves visible distant soldiers to non-shadow batches, then restores near shadows', () => {
        const r = renderer(), v = view(), s = soldier(1)
        update(r, [s], { view: v, leaders: new Set([1]) })
        expect(r.stats.shadowSoldiers).toBe(1)
        v.camera.position.set(0, 600, 1600); v.camera.lookAt(0, 0, 0)
        update(r, [s], { view: v, leaders: new Set([1]) })
        expect(r.stats.renderedSoldiers).toBe(1)
        expect(r.stats.shadowSoldiers).toBe(0)
        expect(activeMeshes(r).every(m => !m.castShadow)).toBe(true)
        v.camera.position.set(0, 120, 200); v.camera.lookAt(0, 0, 0)
        update(r, [s], { view: v })
        expect(r.stats.shadowSoldiers).toBe(1)
        expect(activeMeshes(r).every(m => m.castShadow)).toBe(true)
    })

    it('retains falling and sinking corpses, but does not upload non-finite removal poses', () => {
        const r = renderer(), s = soldier(1, { state: 'dead', deathTime: 0 })
        update(r, [s], { view: view(), time: .1 })
        expect(r.stats.renderedSoldiers).toBe(1)
        update(r, [s], { time: 6 })
        expect(r.stats.matrixWrites).toBeGreaterThan(0)
        s.deathTime = -Infinity
        update(r, [s])
        expect(r.stats.renderedSoldiers).toBe(0)
        expect(activeMeshes(r)).toHaveLength(0)
    })
})

describe('conservative bounds and shadow selection', () => {
    function orthographicView() {
        const v = view()
        const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 1000)
        camera.position.set(0, 100, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0)
        v.camera = camera
        // Shadows travel toward -X, so a soldier outside the right edge can cast into view.
        v.light.position.set(100, 100, 0)
        return v
    }
    it('keeps an offscreen caster whose swept shadow reaches the image, but rejects unrelated cells', () => {
        const visibility = createArmyVisibility(), v = orthographicView()
        const soldiers = [soldier(1, { x: 20 }), soldier(2, { x: 1000 })]
        visibility.prepare(soldiers, () => 20, 1, () => 2, v)
        expect(visibility.classify(soldiers[0]!, 0, 2, 8)).toBe(2)
        expect(visibility.classify(soldiers[1]!, 1, 2, 8)).toBe(0)
        v.light.castShadow = false
        visibility.prepare(soldiers, () => 20, 1, () => 2, v)
        expect(visibility.classify(soldiers[0]!, 0, 2, 8)).toBe(0)
    })
    it('includes long weapons/flags crossing the image edge and elevated terrain', () => {
        const visibility = createArmyVisibility(), v = orthographicView()
        v.light.castShadow = false
        const soldiers = [soldier(1, { x: 20 }), soldier(2, { x: -200 })]
        visibility.prepare(soldiers, () => 40, 1, () => 30, v)
        expect(visibility.classify(soldiers[0]!, 0, 30, 8)).toBe(1)
        expect(visibility.classify(soldiers[1]!, 1, 30, 8)).toBe(0)
    })
    it('uses hysteresis at the shadow distance boundary', () => {
        const visibility = createArmyVisibility(), v = orthographicView(), s = soldier(1)
        const classify = (distance: number) => {
            v.camera.position.set(0, distance, 0); v.camera.lookAt(0, 0, 0)
            visibility.prepare([s], () => 0, 1, () => 10, v)
            return visibility.classify(s, 0, 10, 8)
        }
        expect(classify(800)).toBe(2)
        expect(classify(900)).toBe(2)
        expect(classify(980)).toBe(1)
        expect(classify(900)).toBe(1)
        expect(classify(800)).toBe(2)
    })
})

describe('instance uploads', () => {
    it('retains pending dirty spans across updates, grows without losing data, and clears draw counts', () => {
        const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), group = new THREE.Group()
        const buffer = new InstanceBuffer(group, geometry, material, false, 0, 2)
        const a = new THREE.Matrix4().makeTranslation(1, 2, 3)
        buffer.write(0, a.elements); buffer.finish(1)
        buffer.write(1, new THREE.Matrix4().makeTranslation(4, 5, 6).elements); buffer.finish(2)
        expect(buffer.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }])
        buffer.write(5, a.elements); buffer.finish(6)
        const matrix = new THREE.Matrix4()
        buffer.mesh.getMatrixAt(0, matrix)
        expect(matrix.elements).toEqual(a.elements)
        expect(group.children).toHaveLength(1)
        const version = buffer.mesh.instanceMatrix.version
        expect(buffer.write(0, a.elements)).toBe(false)
        expect(buffer.finish(1)).toBe(0)
        expect(buffer.mesh.instanceMatrix.version).toBe(version)
        buffer.finish(0)
        expect(buffer.mesh.visible).toBe(false)
        buffer.dispose(); geometry.dispose(); material.dispose()
    })
})
