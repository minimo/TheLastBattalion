import * as THREE from 'three'
import type { Army, Arrow, Soldier, SpentArrow, UnitType } from '../../types/game'
import { createArrowGeometry, createArrowTrailGeometry, createBannerGeometry, createMonsterBannerGeometry, createUnitModels, type PartRole } from './unitModels'
import { FACTION } from './models'

type SurfaceHeight = (x: number, y: number) => number

const ARMIES: Army[] = ['player', 'cpu']
const TYPES: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']

interface PartBatch { role: PartRole; pivot: THREE.Vector3; mesh: THREE.InstancedMesh }

/** 兵士・矢をInstancedMeshで一括描画する。 */
export function createArmyRenderer(scene: THREE.Scene) {
    const group = new THREE.Group()
    group.name = 'army'
    scene.add(group)
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .12 })
    const models = createUnitModels()
    const batches = new Map<string, { scale: number; parts: PartBatch[]; capacity: number }>()
    const makeMesh = (geometry: THREE.BufferGeometry, capacity: number) => {
        const mesh = new THREE.InstancedMesh(geometry, material, capacity)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.count = 0
        group.add(mesh)
        return mesh
    }
    for (const army of ARMIES) for (const type of TYPES) {
        const model = models[army][type]
        const capacity = 512
        batches.set(`${army}:${type}`, { scale: model.scale, capacity, parts: model.parts.map(p => ({ role: p.role, pivot: p.pivot, mesh: makeMesh(p.geometry, capacity) })) })
    }
    const grow = (batch: { parts: PartBatch[]; capacity: number }, needed: number) => {
        let capacity = batch.capacity
        while (capacity < needed) capacity *= 2
        for (const p of batch.parts) {
            const old = p.mesh
            p.mesh = makeMesh(old.geometry, capacity)
            old.removeFromParent(); old.dispose()
        }
        batch.capacity = capacity
    }

    /** 必要に応じて容量を倍々に増やすInstancedMesh。 */
    const growable = (geometry: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, renderOrder = 0) => {
        let capacity = 512
        const create = () => {
            const mesh = new THREE.InstancedMesh(geometry, mat, capacity)
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            mesh.frustumCulled = false; mesh.castShadow = shadow; mesh.count = 0; mesh.renderOrder = renderOrder
            group.add(mesh)
            return mesh
        }
        let mesh = create()
        return {
            get mesh() { return mesh },
            ensure(needed: number) {
                if (needed <= capacity) return
                while (capacity < needed) capacity *= 2
                const old = mesh
                mesh = create()
                old.removeFromParent(); old.dispose()
            },
            dispose() { mesh.dispose() },
        }
    }
    const arrowGeometry = createArrowGeometry(), trailGeometry = createArrowTrailGeometry()
    const trailMaterial = new THREE.MeshBasicMaterial({ color: 0xfffbea, transparent: true, opacity: .3, depthWrite: false })
    const flying = growable(arrowGeometry, material, true)
    const trails = growable(trailGeometry, trailMaterial, false, 4)
    const stuck = growable(arrowGeometry, material, false)
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    // 隊長が背負う自軍の幟。人間軍は縦長の幟、モンスター軍は十字の槍に吊るしたボロ布。
    const bannerGeometries = { player: createBannerGeometry(FACTION.player), cpu: createMonsterBannerGeometry() } as Record<Army, THREE.BufferGeometry>
    const banners = Object.fromEntries(ARMIES.map(army => [army, growable(bannerGeometries[army], material, true)])) as Record<Army, ReturnType<typeof growable>>
    const bannerCounts = { player: 0, cpu: 0 } as Record<Army, number>
    const bannerLocal = new THREE.Matrix4(), bannerSway = new THREE.Matrix4(), bannerEuler = new THREE.Euler()

    // 選択中の部隊の兵の足元に輪を出す。
    const ringGeometry = new THREE.RingGeometry(2.6, 3.4, 20)
    ringGeometry.rotateX(-Math.PI / 2)
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide })
    let ringCapacity = 128
    const makeRings = () => {
        const mesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, ringCapacity)
        mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.count = 0
        group.add(mesh)
        return mesh
    }
    let rings = makeRings()
    const ringMatrix = new THREE.Matrix4()

    const base = new THREE.Matrix4(), local = new THREE.Matrix4(), out = new THREE.Matrix4()
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const counts = new Map<string, number>()
    const from = new THREE.Vector3(), to = new THREE.Vector3(), tangent = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), trailScale = new THREE.Matrix4()

    return {
        group,
        update(soldiers: Soldier[], arrows: Arrow[], spentArrows: SpentArrow[], heightAt: SurfaceHeight, time: number, battleTime: number, selectedSquadId: number | null, leaderIds: ReadonlySet<number>) {
            counts.clear()
            for (const s of soldiers) { const key = `${s.owner}:${s.type}`; counts.set(key, (counts.get(key) ?? 0) + 1) }
            for (const [key, batch] of batches) if ((counts.get(key) ?? 0) > batch.capacity) grow(batch, counts.get(key)!)
            counts.clear()
            let ringCount = 0
            for (const army of ARMIES) { banners[army].ensure(leaderIds.size); bannerCounts[army] = 0 }
            const selectedCount = selectedSquadId === null ? 0 : soldiers.reduce((n, s) => n + (s.squadId === selectedSquadId && s.state !== 'dead' ? 1 : 0), 0)
            if (selectedCount > ringCapacity) {
                while (ringCapacity < selectedCount) ringCapacity *= 2
                const old = rings
                rings = makeRings()
                old.removeFromParent(); old.dispose()
            }
            for (const s of soldiers) {
                const key = `${s.owner}:${s.type}`
                const batch = batches.get(key)!
                const index = counts.get(key) ?? 0
                counts.set(key, index + 1)
                const dead = s.state === 'dead'
                const since = dead ? battleTime - s.deathTime : 0
                // 倒れる → しばらく横たわる → 地面に沈む
                const fall = dead ? Math.min(1, since / .45) * Math.PI / 2 : 0
                const sink = dead ? Math.max(0, since - 5) * 2.2 : 0
                const ground = heightAt(s.x, s.y)
                position.set(s.x, ground + .2 - sink, s.y)
                euler.set(-fall, s.heading, 0)
                quaternion.setFromEuler(euler)
                scale.setScalar(batch.scale)
                base.compose(position, quaternion, scale)
                const phase = time * (s.type === 'cavalry' ? 13 : 10) + s.elapsedTime * 3
                const stride = s.moving && !dead ? Math.sin(phase) * (s.type === 'cavalry' ? .7 : .6) : 0
                const bob = s.moving && !dead ? Math.abs(Math.sin(phase)) * (s.type === 'cavalry' ? 1 : .6) : 0
                // 弓兵は構えると腕を前へ上げ、相手が遠いほど上へ向ける。放った直後は手元の矢がない。
                const aiming = s.type === 'archer' && !dead && (s.swing > 0 || s.state === 'fight' && !s.moving && s.aim > 0)
                const bowPitch = aiming ? -(1.45 + s.aim) : -.1
                const swing = s.swing > 0 ? Math.sin((1 - s.swing / .45) * Math.PI) : 0
                for (const p of batch.parts) {
                    // Legs and weapons ride on the bobbing body; mount legs stay planted.
                    let rx = 0, dy = p.role === 'mountFront' || p.role === 'mountBack' ? 0 : bob
                    if (p.role === 'legL' || p.role === 'mountFront') rx = stride
                    else if (p.role === 'legR' || p.role === 'mountBack') rx = -stride
                    else if (p.role === 'nock') {
                        if (!aiming || s.swing > .35) { p.mesh.setMatrixAt(index, hidden); continue }
                        rx = bowPitch
                    } else if (p.role === 'weapon') {
                        if (s.type === 'archer') rx = bowPitch
                        else if (s.type === 'cavalry') rx = -swing * .5
                        // 槍兵は進むときも戦うときも穂先を向いている方（進む方向・攻撃する相手）へ向け、突くときは前へ突き出す。
                        else if (s.type === 'pikeman') rx = -swing * .12
                        else rx = -.15 - swing * 1.6
                    }
                    local.makeRotationX(rx)
                    const thrust = p.role === 'weapon' && s.type === 'pikeman' ? swing * 2.4 : 0
                    local.setPosition(p.pivot.x, p.pivot.y + dy, p.pivot.z + thrust)
                    out.multiplyMatrices(base, local)
                    p.mesh.setMatrixAt(index, out)
                }
                if (leaderIds.has(s.id) && !dead) {
                    // 背中の竿の付け根に付け、歩くと揺れ、止まっているとゆっくりたなびく。騎兵は騎手の背に付ける。
                    const rider = s.type === 'cavalry'
                    const sway = s.moving ? Math.sin(phase * .5) * .07 : Math.sin(time * 1.4 + s.id) * .035
                    bannerSway.makeRotationFromEuler(bannerEuler.set(sway * .4, 0, sway))
                    bannerLocal.makeTranslation(0, (rider ? 12.5 : 7.6) + bob, rider ? -1.6 : -1.7).multiply(bannerSway)
                    out.multiplyMatrices(base, bannerLocal)
                    banners[s.owner].mesh.setMatrixAt(bannerCounts[s.owner]++, out)
                }
                if (s.squadId === selectedSquadId && !dead) {
                    const size = s.type === 'cavalry' ? 1.5 : 1
                    ringMatrix.makeScale(size, 1, size).setPosition(s.x, ground + .6, s.y)
                    rings.setMatrixAt(ringCount++, ringMatrix)
                }
            }
            rings.count = ringCount
            for (const army of ARMIES) { banners[army].mesh.count = bannerCounts[army]; banners[army].mesh.instanceMatrix.needsUpdate = true }
            rings.instanceMatrix.needsUpdate = true
            for (const [key, batch] of batches) {
                const count = counts.get(key) ?? 0
                for (const p of batch.parts) { p.mesh.count = count; p.mesh.instanceMatrix.needsUpdate = true }
            }
            // 飛んでいる矢: 放物線上の位置に置き、向きを軌道の接線に合わせる。
            flying.ensure(arrows.length); trails.ensure(arrows.length)
            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i]!
                const t = Math.min(1, arrow.time / arrow.duration)
                const dx = arrow.toX - arrow.fromX, dy = arrow.toY - arrow.fromY
                const startZ = heightAt(arrow.fromX, arrow.fromY) + arrow.fromZ, endZ = heightAt(arrow.toX, arrow.toY) + 3
                from.set(arrow.fromX + dx * t, startZ + (endZ - startZ) * t + arrow.peak * 4 * t * (1 - t), arrow.fromY + dy * t)
                tangent.set(dx, endZ - startZ + arrow.peak * 4 * (1 - 2 * t), dy).normalize()
                // Matrix4.lookAt orients +Z toward the eye argument.
                to.copy(from).add(tangent)
                out.lookAt(to, from, up).setPosition(from)
                flying.mesh.setMatrixAt(i, out)
                // 軌跡は放った直後と着弾直前で短くする。
                const trail = 9 * Math.min(1, t * 6, (1 - t) * 6 + .3)
                out.multiply(trailScale.makeScale(1, 1, Math.max(.01, trail)))
                trails.mesh.setMatrixAt(i, out)
            }
            flying.mesh.count = trails.mesh.count = arrows.length
            flying.mesh.instanceMatrix.needsUpdate = trails.mesh.instanceMatrix.needsUpdate = true
            // 地面に刺さった矢: 矢じりを少し埋め、消える前にゆっくり沈める。
            stuck.ensure(spentArrows.length)
            for (let i = 0; i < spentArrows.length; i++) {
                const spent = spentArrows[i]!
                const age = battleTime - spent.time
                tangent.set(Math.sin(spent.yaw) * Math.cos(spent.pitch), -Math.sin(spent.pitch), Math.cos(spent.yaw) * Math.cos(spent.pitch))
                from.set(spent.x, heightAt(spent.x, spent.y) - Math.max(0, age - 1.8) * 4, spent.y).addScaledVector(tangent, -1.9)
                to.copy(from).add(tangent)
                out.lookAt(to, from, up).setPosition(from)
                stuck.mesh.setMatrixAt(i, out)
            }
            stuck.mesh.count = spentArrows.length
            stuck.mesh.instanceMatrix.needsUpdate = true
        },
        destroy() {
            for (const batch of batches.values()) for (const p of batch.parts) { p.mesh.geometry.dispose(); p.mesh.dispose() }
            flying.dispose(); trails.dispose(); stuck.dispose(); arrowGeometry.dispose(); trailGeometry.dispose(); trailMaterial.dispose()
            rings.dispose(); ringGeometry.dispose(); ringMaterial.dispose()
            for (const army of ARMIES) { banners[army].dispose(); bannerGeometries[army].dispose() }
            material.dispose()
            group.removeFromParent()
        },
    }
}
export type ArmyRenderer = ReturnType<typeof createArmyRenderer>
