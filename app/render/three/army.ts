import * as THREE from 'three'
import type { Army, Arrow, Soldier, SpentArrow, UnitType } from '../../types/game'
import { createArrowGeometry, createArrowTrailGeometry, createBannerGeometry, createMonsterBannerGeometry, createUnitModels, type PartRole } from './unitModels'
import { InstanceBuffer } from './instanceBuffer'
import { createArmyVisibility, type ArmyView } from './armyVisibility'
import { createUnitMaterial } from './unitMaterial'

type SurfaceHeight = (x: number, y: number) => number

const ARMIES: Army[] = ['player', 'cpu']
const TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
/** 中隊長の幟の大きさ（小隊長の幟に対する倍率）。 */
export const COMPANY_BANNER_SCALE = 1.4

interface PartBatch { role: PartRole; pivot: THREE.Vector3; buffer?: InstanceBuffer }
interface UnitBatch { parts: PartBatch[]; count: number }

export interface ArmyRenderStats {
    totalSoldiers: number
    renderedSoldiers: number
    culledSoldiers: number
    shadowSoldiers: number
    cells: number
    matrixCompositions: number
    matrixWrites: number
    dirtyMatrixBytes: number
    updateMs: number
}

/** 兵士の可視判定後、陣営・兵種・影の有無・部位ごとに一括描画する。 */
/** 視界の外のものを描かないための判定。 */
export interface ArmyFog { soldier(soldier: Soldier): boolean; at(x: number, y: number): boolean }

/** Radians of leg swing per px walked, and the speed (px/s) from which the stride is at full length. */
const GAIT = { foot: { radiansPerPx: 1, fullStrideSpeed: 5 }, mount: { radiansPerPx: .42, fullStrideSpeed: 10 } }
/** Below this speed a soldier is standing; the smoothed velocity only approaches zero. */
const GAIT_REST_SPEED = .2

export function createArmyRenderer(scene: THREE.Scene) {
    const group = new THREE.Group()
    group.name = 'army'
    scene.add(group)
    const { material, disposeTextures } = createUnitMaterial()
    const models = createUnitModels()
    const visibility = createArmyVisibility()
    const stats: ArmyRenderStats = { totalSoldiers: 0, renderedSoldiers: 0, culledSoldiers: 0, shadowSoldiers: 0,
        cells: 0, matrixCompositions: 0, matrixWrites: 0, dirtyMatrixBytes: 0, updateMs: 0 }
    const buffer = (geometry: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, order = 0) =>
        new InstanceBuffer(group, geometry, mat, shadow, order)
    const batches = Object.fromEntries(ARMIES.map(army => [army, Object.fromEntries(TYPES.map(type => {
        const model = models[army][type]
        const makeBatch = (shadow: boolean): UnitBatch => ({ count: 0, parts: model.parts.map(p =>
            ({ role: p.role, pivot: p.pivot, buffer: shadow ? buffer(p.geometry, material, true) : p.farGeometry && buffer(p.farGeometry, material, false) })) })
        // Any joint rotation preserves this radius. Include bob and the pikeman's thrust.
        const radius = Math.max(...model.parts.map(p => {
            p.geometry.computeBoundingSphere()
            const sphere = p.geometry.boundingSphere!
            return p.pivot.length() + sphere.center.length() + sphere.radius + 3.4
        })) * model.scale
        return [type, { scale: model.scale, radius, height: (type === 'cavalry' ? 24 : 17) * model.scale,
            near: makeBatch(true), far: makeBatch(false) }]
    }))])) as Record<Army, Record<UnitType, { scale: number; radius: number; height: number; near: UnitBatch; far: UnitBatch }>>
    const allBatches = ARMIES.flatMap(army => TYPES.flatMap(type => [batches[army][type].near, batches[army][type].far]))
    const arrowGeometry = createArrowGeometry(), trailGeometry = createArrowTrailGeometry()
    const trailMaterial = new THREE.MeshBasicMaterial({ color: 0xfffbea, transparent: true, opacity: .3, depthWrite: false })
    const flying = buffer(arrowGeometry, material, true)
    const trails = buffer(trailGeometry, trailMaterial, false, 4)
    const stuck = buffer(arrowGeometry, material, false)
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const bannerGeometries = { player: createBannerGeometry(), cpu: createMonsterBannerGeometry() }
    const banners = Object.fromEntries(ARMIES.map(army => [army, {
        near: buffer(bannerGeometries[army], material, true), far: buffer(bannerGeometries[army], material, false),
        nearCount: 0, farCount: 0,
    }])) as Record<Army, { near: InstanceBuffer; far: InstanceBuffer; nearCount: number; farCount: number }>
    const bannerRadius = Math.max(...ARMIES.map(army => {
        const geometry = bannerGeometries[army]
        geometry.computeBoundingSphere()
        return geometry.boundingSphere!.center.length() + geometry.boundingSphere!.radius
    }))
    // Includes attachment offset, company-leader scale, sway, and the largest unit scale.
    const leaderRadius = (14 + bannerRadius * COMPANY_BANNER_SCALE) * Math.max(...ARMIES.flatMap(army => TYPES.map(type => models[army][type].scale)))
    const bannerLocal = new THREE.Matrix4(), bannerSway = new THREE.Matrix4(), bannerEuler = new THREE.Euler()
    const bannerScale = new THREE.Matrix4().makeScale(COMPANY_BANNER_SCALE, COMPANY_BANNER_SCALE, COMPANY_BANNER_SCALE)
    const ringGeometry = new THREE.RingGeometry(2.6, 3.4, 20)
    ringGeometry.rotateX(-Math.PI / 2)
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide })
    const rings = buffer(ringGeometry, ringMaterial, false, 5)
    const ringMatrix = new THREE.Matrix4()
    type ModelBatch = typeof batches.player.infantry
    interface Pose {
        model: ModelBatch; base: THREE.Matrix4; local: Float64Array; revisions: Uint32Array
        x: number; y: number; z: number; heading: number; fall: number
        baseRevision: number
        banner?: { baseRevision: number; sway: number; bob: number; company: boolean; revision: number; matrix: THREE.Matrix4 }
    }
    // Object identity also handles a new battle reusing soldier IDs. Removed soldiers can be collected.
    const poses = new WeakMap<Soldier, Pose>()
    const write = (target: InstanceBuffer, index: number, matrix: ArrayLike<number>, offset = 0) => {
        if (target.write(index, matrix, offset)) stats.matrixWrites++
    }
    const finish = (target: InstanceBuffer, count: number) => { stats.dirtyMatrixBytes += target.finish(count) }
    const local = new THREE.Matrix4(), out = new THREE.Matrix4()
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const from = new THREE.Vector3(), to = new THREE.Vector3(), tangent = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), trailScale = new THREE.Matrix4()

    return {
        group,
        stats,
        update(soldiers: Soldier[], arrows: Arrow[], spentArrows: SpentArrow[], heightAt: SurfaceHeight, time: number, battleTime: number,
            selectedSquadIds: ReadonlySet<number>, leaderIds: ReadonlySet<number>, companyLeaderIds: ReadonlySet<number> = new Set(), view?: ArmyView, fog?: ArmyFog) {
            const started = performance.now()
            stats.totalSoldiers = soldiers.length
            stats.renderedSoldiers = stats.culledSoldiers = stats.shadowSoldiers = 0
            stats.matrixCompositions = stats.matrixWrites = stats.dirtyMatrixBytes = 0
            const radiusOf = (s: Soldier) => Math.max(batches[s.owner][s.type].radius, leaderIds.has(s.id) && s.state !== 'dead' ? leaderRadius : 0)
            visibility.prepare(soldiers, heightAt, battleTime, radiusOf, view)
            stats.cells = visibility.cellCount
            for (const batch of allBatches) batch.count = 0
            for (const army of ARMIES) banners[army].nearCount = banners[army].farCount = 0
            let ringCount = 0
            for (let soldierIndex = 0; soldierIndex < soldiers.length; soldierIndex++) {
                const s = soldiers[soldierIndex]!
                const model = batches[s.owner][s.type]
                if (fog && !fog.soldier(s)) { stats.culledSoldiers++; continue }
                const classification = visibility.classify(s, soldierIndex, radiusOf(s), model.height)
                if (!classification) { stats.culledSoldiers++; continue }
                stats.renderedSoldiers++
                const shadow = classification === 2
                if (shadow) stats.shadowSoldiers++
                const batch = shadow ? model.near : model.far
                const index = batch.count++
                const dead = s.state === 'dead'
                const since = dead ? battleTime - s.deathTime : 0
                const fall = dead ? Math.min(1, since / .45) * Math.PI / 2 : 0
                const sink = dead ? Math.max(0, since - 5) * 2.2 : 0
                const ground = visibility.ground(soldierIndex)
                const y = ground + .2 - sink
                let pose = poses.get(s)
                if (!pose || pose.model !== model) {
                    pose = { model, base: new THREE.Matrix4(), baseRevision: 0,
                        local: new Float64Array(batch.parts.length * 4).fill(NaN), revisions: new Uint32Array(batch.parts.length),
                        x: NaN, y: NaN, z: NaN, heading: NaN, fall: NaN }
                    poses.set(s, pose)
                }
                const baseChanged = pose.x !== s.x || pose.y !== y || pose.z !== s.y || pose.heading !== s.heading || pose.fall !== fall
                if (baseChanged) {
                    position.set(s.x, y, s.y)
                    euler.set(-fall, s.heading, 0)
                    quaternion.setFromEuler(euler)
                    scale.setScalar(model.scale)
                    pose.base.compose(position, quaternion, scale)
                    pose.x = s.x; pose.y = y; pose.z = s.y; pose.heading = s.heading; pose.fall = fall
                    pose.baseRevision++
                    stats.matrixCompositions++
                }
                // Feet follow the distance actually covered, so a slow march takes slow steps
                // instead of treading in place, and starting or stopping eases in and out.
                const gait = GAIT[s.type === 'cavalry' ? 'mount' : 'foot']
                const speed = Math.hypot(s.vx, s.vy)
                const phase = s.gait * gait.radiansPerPx + s.id * 2.4
                const step = !dead && speed > GAIT_REST_SPEED ? Math.sin(phase) * Math.min(1, speed / gait.fullStrideSpeed) : 0
                // A mount's jointed legs swing less than a soldier's, keeping the paired
                // feet apart and the hips under the barrel.
                const stride = step * (s.type === 'cavalry' ? .45 : .6)
                const bob = Math.abs(step) * .6
                const aiming = s.type === 'archer' && !dead && (s.swing > 0 || s.state === 'fight' && !s.moving && s.aim > 0)
                // Archers carry the bow at their side and draw it only to attack. The drawn arms
                // and bow turn together at the shoulders, keeping hands, string and arrow in line.
                // Limit the visual lean; projectile trajectories still use the full aim.
                const bowPitch = -Math.min(.55, Math.max(0, s.aim))
                const swing = s.swing > 0 ? Math.sin((1 - s.swing / .45) * Math.PI) : 0
                for (let partIndex = 0; partIndex < batch.parts.length; partIndex++) {
                    const p = batch.parts[partIndex]!
                    if (!p.buffer) continue
                    let rx = 0, dy = p.role === 'mountFront' || p.role === 'mountBack' ? 0 : bob
                    // The distant model has only the carried pose, so that is never hidden.
                    const hide = s.type === 'archer' && (p.role === 'nock' ? !aiming || s.swing > .35
                        : p.role === 'weapon' ? !aiming : p.role === 'carry' && aiming && shadow)
                    if (p.role === 'legL' || p.role === 'mountFront') rx = stride
                    else if (p.role === 'legR' || p.role === 'mountBack') rx = -stride
                    else if (p.role === 'nock') rx = bowPitch
                    else if (p.role === 'weapon') {
                        if (s.type === 'archer') rx = bowPitch
                        else if (s.type === 'cavalry') rx = -swing * .5
                        else if (s.type === 'pikeman') rx = -swing * .12
                        else rx = -.15 - swing * 1.6
                    }
                    // Keep the sleeve inside its fixed shoulder armour during a thrust.
                    const thrust = p.role === 'weapon' && s.type === 'pikeman' ? swing * 1.2 : 0
                    const state = partIndex * 4
                    if (baseChanged || pose.local[state] !== rx || pose.local[state + 1] !== dy
                        || pose.local[state + 2] !== thrust || pose.local[state + 3] !== Number(hide)) {
                        pose.local[state] = rx; pose.local[state + 1] = dy
                        pose.local[state + 2] = thrust; pose.local[state + 3] = Number(hide)
                        pose.revisions[partIndex] = pose.revisions[partIndex]! + 1
                    }
                    // Write directly into the instance buffer. Repacking recomputes from the cached
                    // base/local pose, avoiding a second matrix copy for every moving soldier.
                    const revision = pose.revisions[partIndex]!
                    if (!p.buffer.matches(index, pose, revision)) {
                        if (hide) out.copy(hidden)
                        else {
                            local.makeRotationX(rx)
                            local.setPosition(p.pivot.x, p.pivot.y + dy, p.pivot.z + thrust)
                            out.multiplyMatrices(pose.base, local)
                            stats.matrixCompositions++
                        }
                        if (p.buffer.writeCached(index, pose, revision, out.elements)) stats.matrixWrites++
                    }
                }
                if (leaderIds.has(s.id) && !dead) {
                    const rider = s.type === 'cavalry'
                    const sway = s.moving ? Math.sin(phase * .5) * .07 : Math.sin(time * 1.4 + s.id) * .035
                    const company = companyLeaderIds.has(s.id)
                    const cached = pose.banner ??= { baseRevision: -1, sway: NaN, bob: NaN, company, revision: 0, matrix: new THREE.Matrix4() }
                    if (cached.baseRevision !== pose.baseRevision || cached.sway !== sway || cached.bob !== bob || cached.company !== company) {
                        bannerSway.makeRotationFromEuler(bannerEuler.set(sway * .4, 0, sway))
                        bannerLocal.makeTranslation(0, (rider ? 12.5 : 7.6) + bob, rider ? -1.6 : -1.7).multiply(bannerSway)
                        if (company) bannerLocal.multiply(bannerScale)
                        cached.matrix.multiplyMatrices(pose.base, bannerLocal)
                        cached.baseRevision = pose.baseRevision; cached.sway = sway; cached.bob = bob; cached.company = company
                        cached.revision++; stats.matrixCompositions++
                    }
                    const banner = banners[s.owner]
                    if ((shadow ? banner.near : banner.far).writeCached(shadow ? banner.nearCount++ : banner.farCount++, cached, cached.revision, cached.matrix.elements)) stats.matrixWrites++
                }
                if (selectedSquadIds.has(s.squadId) && !dead) {
                    const size = s.type === 'cavalry' ? 1.5 : 1
                    ringMatrix.makeScale(size, 1, size).setPosition(s.x, ground + .6, s.y)
                    write(rings, ringCount++, ringMatrix.elements)
                }
            }
            finish(rings, ringCount)
            for (const army of ARMIES) {
                finish(banners[army].near, banners[army].nearCount)
                finish(banners[army].far, banners[army].farCount)
            }
            for (const batch of allBatches) for (const p of batch.parts) if (p.buffer) finish(p.buffer, batch.count)
            // 飛んでいる矢: 放物線上の位置に置き、向きを軌道の接線に合わせる。視界の外の矢は描かない。
            let flyingCount = 0
            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i]!
                const t = Math.min(1, arrow.time / arrow.duration)
                const dx = arrow.toX - arrow.fromX, dy = arrow.toY - arrow.fromY
                if (fog && !fog.at(arrow.fromX + dx * t, arrow.fromY + dy * t)) continue
                const startZ = heightAt(arrow.fromX, arrow.fromY) + arrow.fromZ, endZ = heightAt(arrow.toX, arrow.toY) + 3
                from.set(arrow.fromX + dx * t, startZ + (endZ - startZ) * t + arrow.peak * 4 * t * (1 - t), arrow.fromY + dy * t)
                tangent.set(dx, endZ - startZ + arrow.peak * 4 * (1 - 2 * t), dy).normalize()
                // Matrix4.lookAt orients +Z toward the eye argument.
                to.copy(from).add(tangent)
                out.lookAt(to, from, up).setPosition(from)
                write(flying, flyingCount, out.elements)
                // 軌跡は放った直後と着弾直前で短くする。
                const trail = 9 * Math.min(1, t * 6, (1 - t) * 6 + .3)
                out.multiply(trailScale.makeScale(1, 1, Math.max(.01, trail)))
                write(trails, flyingCount++, out.elements)
            }
            finish(flying, flyingCount); finish(trails, flyingCount)
            // 地面に刺さった矢: 矢じりを少し埋め、消える前にゆっくり沈める。
            let stuckCount = 0
            for (let i = 0; i < spentArrows.length; i++) {
                const spent = spentArrows[i]!
                if (fog && !fog.at(spent.x, spent.y)) continue
                const age = battleTime - spent.time
                tangent.set(Math.sin(spent.yaw) * Math.cos(spent.pitch), -Math.sin(spent.pitch), Math.cos(spent.yaw) * Math.cos(spent.pitch))
                from.set(spent.x, heightAt(spent.x, spent.y) - Math.max(0, age - 1.8) * 4, spent.y).addScaledVector(tangent, -1.9)
                to.copy(from).add(tangent)
                out.lookAt(to, from, up).setPosition(from)
                write(stuck, stuckCount++, out.elements)
            }
            finish(stuck, stuckCount)
            stats.updateMs = performance.now() - started
        },
        destroy() {
            for (const batch of allBatches) for (const p of batch.parts) p.buffer?.dispose()
            for (const army of ARMIES) for (const type of TYPES) for (const p of models[army][type].parts) { p.geometry.dispose(); p.farGeometry?.dispose() }
            flying.dispose(); trails.dispose(); stuck.dispose(); arrowGeometry.dispose(); trailGeometry.dispose(); trailMaterial.dispose()
            rings.dispose(); ringGeometry.dispose(); ringMaterial.dispose()
            for (const army of ARMIES) { banners[army].near.dispose(); banners[army].far.dispose(); bannerGeometries[army].dispose() }
            material.dispose(); disposeTextures()
            group.removeFromParent()
        },
    }
}
export type ArmyRenderer = ReturnType<typeof createArmyRenderer>
