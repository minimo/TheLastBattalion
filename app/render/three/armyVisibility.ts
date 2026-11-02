import * as THREE from 'three'
import type { Soldier } from '../../types/game'

export interface ArmyView {
    camera: THREE.Camera
    light: THREE.DirectionalLight
    /** CSS pixels, so shadow quality does not depend on devicePixelRatio. */
    viewportHeight: number
    /** Receiver floor; the game's walkable surfaces are at or above zero. */
    shadowFloor?: number
}

export const ARMY_CELL_SIZE = 96
export const SHADOW_ENTER_DISTANCE = 850
export const SHADOW_EXIT_DISTANCE = 950
const SHADOW_ENTER_PIXELS = 6
const SHADOW_EXIT_PIXELS = 4

interface Cell { bounds: THREE.Box3; frame: number; screen: boolean; shadow: boolean; insideFar: boolean }

/** Cells are only a broad phase; they never create extra draw calls. Includes corpses. */
export function createArmyVisibility() {
    const cells = new Map<string, Cell>()
    const membership: Cell[] = []
    let grounds = new Float64Array(0), centers = new Float64Array(0)
    const frustum = new THREE.Frustum(), projection = new THREE.Matrix4()
    const cameraPosition = new THREE.Vector3(), lightDirection = new THREE.Vector3(), target = new THREE.Vector3()
    const sphere = new THREE.Sphere(), swept = new THREE.Box3(), point = new THREE.Vector3()
    let frame = 0, view: ArmyView | undefined, floor = 0
    const shadowState = new WeakMap<Soldier, { frame: number; enabled: boolean }>()

    const shadowIntersects = (bounds: THREE.Box3) => {
        if (!view?.light.castShadow) return false
        // Horizontal/upward light has no finite projection onto the floor: retain conservatively.
        if (lightDirection.y >= -1e-5) return true
        const length = Math.max(0, bounds.max.y - floor) / -lightDirection.y
        swept.copy(bounds)
        point.copy(bounds.min).addScaledVector(lightDirection, length); swept.expandByPoint(point)
        point.copy(bounds.max).addScaledVector(lightDirection, length); swept.expandByPoint(point)
        return frustum.intersectsBox(swept)
    }
    const bounds = new THREE.Box3()

    return {
        prepare(soldiers: Soldier[], heightAt: (x: number, y: number) => number, time: number,
            radiusOf: (s: Soldier) => number, nextView?: ArmyView) {
            frame++; view = nextView; floor = nextView?.shadowFloor ?? 0
            if (grounds.length < soldiers.length) {
                grounds = new Float64Array(soldiers.length * 2)
                centers = new Float64Array(soldiers.length * 2)
            }
            membership.length = soldiers.length
            if (view) {
                view.camera.updateWorldMatrix(true, false)
                projection.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse)
                frustum.setFromProjectionMatrix(projection)
                cameraPosition.setFromMatrixPosition(view.camera.matrixWorld)
                view.light.getWorldPosition(lightDirection)
                view.light.target.getWorldPosition(target)
                lightDirection.subVectors(target, lightDirection).normalize()
            }
            for (let i = 0; i < soldiers.length; i++) {
                const s = soldiers[i]!
                const ground = heightAt(s.x, s.y)
                grounds[i] = ground
                const sink = s.state === 'dead' ? Math.max(0, time - s.deathTime - 5) * 2.2 : 0
                const y = ground + .2 - sink
                centers[i] = y
                // -Infinity deathTime marks soldiers removed immediately by the simulation.
                if (!Number.isFinite(y) || !view) continue
                const key = `${Math.floor(s.x / ARMY_CELL_SIZE)},${Math.floor(s.y / ARMY_CELL_SIZE)}`
                let cell = cells.get(key)
                if (!cell) { cell = { bounds: new THREE.Box3(), frame: 0, screen: false, shadow: false, insideFar: false }; cells.set(key, cell) }
                if (cell.frame !== frame) { cell.bounds.makeEmpty(); cell.frame = frame }
                membership[i] = cell
                const r = radiusOf(s)
                point.set(s.x - r, y - r, s.y - r); cell.bounds.expandByPoint(point)
                point.set(s.x + r, y + r, s.y + r); cell.bounds.expandByPoint(point)
            }
            for (const [key, cell] of cells) {
                if (cell.frame !== frame) { cells.delete(key); continue }
                cell.screen = frustum.intersectsBox(cell.bounds)
                const tooFar = cell.bounds.distanceToPoint(cameraPosition) > SHADOW_EXIT_DISTANCE
                cell.shadow = !tooFar && shadowIntersects(cell.bounds)
                // Whole cells inside a wide overview need neither per-soldier plane tests nor shadow checks.
                cell.insideFar = cell.screen && (tooFar || !view?.light.castShadow) && frustum.planes.every(plane => {
                    const n = plane.normal, box = cell.bounds
                    point.set(n.x >= 0 ? box.min.x : box.max.x, n.y >= 0 ? box.min.y : box.max.y, n.z >= 0 ? box.min.z : box.max.z)
                    return plane.distanceToPoint(point) >= 0
                })
            }
        },
        ground(index: number) { return grounds[index]! },
        get cellCount() { return cells.size },
        /** 0: culled, 1: visible without shadow, 2: shadow caster (possibly offscreen). */
        classify(s: Soldier, index: number, radius: number, height: number): 0 | 1 | 2 {
            const y = centers[index]!
            if (!Number.isFinite(y)) return 0
            if (!view) return 2
            const cell = membership[index]!
            if (!cell.screen && !cell.shadow) return 0
            if (cell.insideFar) return 1
            sphere.center.set(s.x, y, s.y); sphere.radius = radius
            const visible = cell.screen && frustum.intersectsSphere(sphere)
            const state = shadowState.get(s)
            const previous = state?.frame === frame - 1 && state.enabled
            const distance = previous ? SHADOW_EXIT_DISTANCE : SHADOW_ENTER_DISTANCE
            const elements = view.camera.matrixWorldInverse.elements
            const depth = -(elements[2]! * s.x + elements[6]! * y + elements[10]! * s.y + elements[14]!)
            const perspective = view.camera.projectionMatrix.elements[15] === 0
            const pixels = height * view.camera.projectionMatrix.elements[5]! * view.viewportHeight
                / (2 * (perspective ? Math.max(1, depth) : 1))
            const shadow = view.light.castShadow && cameraPosition.distanceToSquared(sphere.center) <= distance * distance
                && pixels >= (previous ? SHADOW_EXIT_PIXELS : SHADOW_ENTER_PIXELS)
            if (state) { state.frame = frame; state.enabled = shadow }
            else shadowState.set(s, { frame, enabled: shadow })
            if (shadow && (visible || cell.shadow && shadowIntersects(sphere.getBoundingBox(bounds)))) return 2
            return visible ? 1 : 0
        },
    }
}
