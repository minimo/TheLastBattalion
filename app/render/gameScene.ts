import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { getNightAlpha } from '~/game/daynight'
import type { useGameStore } from '~/stores/game'
import type { BattleInput } from '~/composables/useBattleInput'
import type { Construction, Fort, Point, Squad, UnitType } from '~/types/game'
import { FORMATIONS, squadBlock, toWorld } from '~/game/formation'
import { CONSTRUCTION, STAMINA } from '~/game/battleConfig'
import { depotOf, squadRoute } from '~/game/battle'
import { createModelKit, FACTION } from './three/models'
import { createWorld } from './three/world'
import { createAtmosphere } from './three/atmosphere'
import { createPathOverlay } from './three/overlays'
import { createFortCamp } from './three/fortCamp'
import { createCastle } from './three/castle'
import { createArmyRenderer } from './three/army'
import { createConstructionRenderer } from './three/constructions'

interface GameSceneOptions {
    canvasEl: HTMLElement
    gameStore: ReturnType<typeof useGameStore>
    input: BattleInput
}

const CLICK_TOLERANCE = 6 // px
const TYPE_MARK: Record<UnitType, string> = { infantry: '歩', pikeman: '槍', archer: '弓', cavalry: '騎', supply: '補', engineer: '工' }
const TYPE_NAME: Record<UnitType, string> = { infantry: '歩兵', pikeman: '槍兵', archer: '弓兵', cavalry: '騎兵', supply: '補給', engineer: '工兵' }

export async function createGameScene({ canvasEl, gameStore, input }: GameSceneOptions) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-label', '3Dの戦場。部隊の旗をドラッグして移動・攻撃を指示、長押しでメニュー。全軍の旗のドラッグで陣全体を移動。何もない場所からの左ドラッグで回転、右ドラッグとShiftを押しながらの左ドラッグでパン、ホイールで拡大縮小。タッチ画面・トラックパッドの2本指の横ドラッグで左右回転、ピンチで拡大縮小。')
    canvasEl.appendChild(renderer.domElement)
    const labels = document.createElement('div')
    labels.className = 'world-labels'
    canvasEl.appendChild(labels)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xb6c9cb)
    const atmosphere = createAtmosphere(scene)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environmentScene = new RoomEnvironment()
    const environment = pmrem.fromScene(environmentScene, .04)
    scene.environment = environment.texture
    scene.environmentIntensity = .45
    environmentScene.dispose()
    pmrem.dispose()
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 1, 12000)
    const controls = new OrbitControls(camera, canvasEl)
    controls.enableDamping = true
    controls.enablePan = true
    controls.screenSpacePanning = false
    controls.panSpeed = 1.15
    // Individual soldiers are small; allow a closer view than no-life-king.
    controls.minDistance = 30
    controls.minPolarAngle = .25
    controls.maxPolarAngle = Math.PI / 2.3
    // As in no-life-king, the left button orbits only for gestures that start away from a banner.
    controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE }
    // Trackpads send two-finger swipes as wheel events, not touch pointers.
    // Capture horizontal swipes before OrbitControls treats them as zoom input.
    const trackpadRotate = (event: WheelEvent) => {
        if (!controls.enabled || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvasEl.clientWidth : 1
        controls.rotateLeft(-event.deltaX * pixels * Math.PI * 2 / Math.max(1, canvasEl.clientHeight))
    }
    canvasEl.addEventListener('wheel', trackpadRotate, { capture: true, passive: false })
    /** 部隊へのカメラ移動。動いている部隊を追うため、毎フレーム現在の重心へ向けて補間する。 */
    let focus: { squadId: number; elapsed: number; target: THREE.Vector3; offset: THREE.Vector3; endOffset: THREE.Vector3 } | null = null
    const FOCUS_DURATION = .9, FOCUS_MAX_DISTANCE = 420
    const easeInOutCubic = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    const focusSquad = (squadId: number) => {
        if (!gameStore.battle?.squadById.has(squadId)) return
        const offset = camera.position.clone().sub(controls.target)
        // 向きは保ったまま、遠すぎるときだけ寄せる。
        const endOffset = offset.clone().setLength(Math.min(offset.length(), FOCUS_MAX_DISTANCE))
        focus = { squadId, elapsed: 0, target: controls.target.clone(), offset, endOffset }
    }
    const updateFocus = (delta: number) => {
        if (!focus) return
        const squad = gameStore.battle?.squadById.get(focus.squadId)
        if (!squad) { focus = null; return }
        focus.elapsed += delta
        const t = Math.min(1, focus.elapsed / FOCUS_DURATION), k = easeInOutCubic(t)
        const goal = new THREE.Vector3(squad.center.x, surfaceAt(squad.center.x, squad.center.y), squad.center.y)
        controls.target.lerpVectors(focus.target, goal, k)
        camera.position.copy(controls.target).add(focus.offset.clone().lerp(focus.endOffset, k))
        if (t >= 1) focus = null
    }
    const cancelFocus = () => { focus = null }
    canvasEl.addEventListener('wheel', cancelFocus, { capture: true, passive: true })
    const resetCamera = () => {
        focus = null
        controls.enableDamping = false
        controls.update() // Flush any rotation momentum before restoring the view.
        controls.target.set(416, 24, 416)
        const fit = Math.max(1, 1.6 / camera.aspect)
        // Look from the south so the human camp is on the left and the monster camp on the right.
        camera.position.set(416, 24 + 820 * fit, 416 + 1480 * fit)
        // Allow only a little extra zoom-out beyond the view fitted to the screen.
        controls.maxDistance = camera.position.distanceTo(controls.target) * 1.1
        camera.zoom = 1
        camera.updateProjectionMatrix()
        controls.update()
        controls.enableDamping = true
    }
    resetCamera()
    if (import.meta.dev) {
        // Development aid for inspecting models: frame a world point from a given offset.
        Object.assign(window, { __tlbView: (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
            controls.target.set(x, y, z); camera.position.set(x + dx, y + dy, z + dz); controls.update()
        }, __tlbStore: gameStore })
    }
    const sky = new THREE.HemisphereLight(0xc8e5e4, 0x56634d, 2.2)
    const sun = new THREE.DirectionalLight(0xffdeb3, 3)
    sun.position.set(200, 750, 200)
    sun.target.position.set(416, 0, 416)
    sun.castShadow = true
    // Cover both camps at the edges of the battlefield.
    sun.shadow.mapSize.set(4096, 4096)
    Object.assign(sun.shadow.camera, { left: -800, right: 800, top: 800, bottom: -800, near: 1, far: 2000 })
    sun.shadow.bias = -.0004
    sun.shadow.normalBias = 1.2
    scene.add(sky, sun, sun.target)
    const kit = createModelKit()
    gameStore.initGame()
    let world = createWorld(gameStore.mapGrid, gameStore.battle!.forts, kit)
    let mapReference = gameStore.mapGrid
    scene.add(world.group)
    const army = createArmyRenderer(scene)
    const constructions = createConstructionRenderer(kit, (x, y) => world.field.surfaceAt(x, y))
    scene.add(constructions.group)
    /** 地面の高さ（完成した橋の上では床の高さ）。 */
    const surfaceAt = (x: number, y: number) => constructions.surfaceAt(x, y) ?? world.field.surfaceAt(x, y)

    const project = (x: number, y: number, elevation = 0) => {
        const point = new THREE.Vector3(x, surfaceAt(x, y) + elevation, y).project(camera)
        return { x: (point.x + 1) * canvasEl.clientWidth / 2, y: (1 - point.y) * canvasEl.clientHeight / 2, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1 }
    }
    const placeLabel = (label: HTMLElement, x: number, y: number, h: number) => {
        const p = project(x, y, h)
        label.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`
        label.hidden = !p.visible
    }
    const factionColor = (owner: Fort['owner']) => `#${FACTION[owner].toString(16).padStart(6, '0')}`

    type CampVisual = { fort: Fort; camp: ReturnType<typeof createFortCamp> | ReturnType<typeof createCastle>; label: HTMLSpanElement }
    let camps: CampVisual[] = []
    const buildCamps = () => {
        camps.forEach(c => { c.camp.destroy(); c.label.remove() })
        camps = gameStore.battle!.forts.map(fort => {
            // 攻城戦・防衛戦の守り手は岩山の城、攻防戦はベースキャンプ型の砦。
            const camp = fort.kind === 'castle' ? createCastle(fort, kit) : createFortCamp(fort, kit)
            const label = document.createElement('span')
            label.className = 'world-label fort-label'
            label.style.setProperty('--faction', factionColor(fort.owner))
            labels.appendChild(label)
            scene.add(camp.group)
            return { fort, camp, label }
        })
    }
    buildCamps()

    // 部隊の旗と全軍の旗。no-life-kingの拠点ラベルと同じく、透明な押下対象を兼ねる。
    const squadLabels = new Map<number, { label: HTMLButtonElement; name: HTMLSpanElement; count: HTMLSpanElement; ammo: HTMLSpanElement }>()
    const makeSquadLabel = (squad: Squad) => {
        const label = document.createElement('button')
        label.type = 'button'
        label.className = `world-label squad-label ${squad.owner}`
        label.dataset.squad = String(squad.id)
        label.style.setProperty('--faction', factionColor(squad.owner))
        const name = document.createElement('span'), count = document.createElement('span'), ammo = document.createElement('span')
        name.className = 'squad-name'; count.className = 'squad-count'; ammo.className = 'squad-ammo'
        name.textContent = `${TYPE_MARK[squad.type]}${squad.number}`
        label.append(name, count, ammo)
        labels.appendChild(label)
        const visual = { label, name, count, ammo }
        squadLabels.set(squad.id, visual)
        return visual
    }
    const removeSquadLabels = () => { squadLabels.forEach(v => v.label.remove()); squadLabels.clear() }
    // 建設物の名前と、建設の進み具合・耐久。
    const constructionLabels = new Map<number, { site: Construction; label: HTMLSpanElement }>()
    const removeConstructionLabels = () => { constructionLabels.forEach(v => v.label.remove()); constructionLabels.clear() }
    const updateConstructionLabels = (sites: Construction[]) => {
        const alive = new Set<number>()
        for (const site of sites) {
            alive.add(site.id)
            let visual = constructionLabels.get(site.id)
            if (visual && visual.site !== site) { visual.label.remove(); visual = undefined }
            if (!visual) {
                const label = document.createElement('span')
                label.className = 'world-label construction-label'
                label.style.setProperty('--faction', factionColor(site.owner))
                labels.appendChild(label)
                visual = { site, label }
                constructionLabels.set(site.id, visual)
            }
            const name = CONSTRUCTION[site.kind].name
            const text = !site.complete ? `${name} 建設中${Math.floor(site.progress * 100)}%`
                : site.hp < site.maxHp - .5 ? `${name} ${Math.ceil(site.hp)}` : name
            if (visual.label.textContent !== text) visual.label.textContent = text
            visual.label.classList.toggle('damaged', site.complete && site.hp < site.maxHp * .4)
            placeLabel(visual.label, site.center.x, site.center.y, site.kind === 'outpost' ? 26 : 12)
        }
        constructionLabels.forEach((v, id) => { if (!alive.has(id)) { v.label.remove(); constructionLabels.delete(id) } })
    }
    const armyLabel = document.createElement('button')
    armyLabel.type = 'button'
    armyLabel.className = 'world-label army-label'
    armyLabel.dataset.army = 'player'
    armyLabel.style.setProperty('--faction', factionColor('player'))
    labels.appendChild(armyLabel)

    const pathOverlay = createPathOverlay(camera, canvasEl, (x, y) => world.field.surfaceAt(x, y))
    scene.add(pathOverlay.group)
    let pathKey = ''
    /** 部隊の今の指示の行き先（表示用）。 */
    const orderDestination = (squad: Squad): Point | undefined => {
        const battle = gameStore.battle!
        if (squad.order === 'attack') return battle.squadById.get(squad.targetSquadId)?.center
        if (squad.order === 'charge') return battle.homes[squad.owner === 'player' ? 'cpu' : 'player'].core
        if (squad.order === 'resupply') {
            const depot = depotOf(battle, squad)
            return depot.site ? depot.site.center : battle.homes[squad.owner].core
        }
        if (squad.order === 'retreat') return battle.homes[squad.owner].core
        if (squad.order === 'build' || squad.order === 'demolish') return battle.constructionById.get(squad.constructionId)?.center
        if (squad.order === 'support' && battle.squadById.has(squad.targetSquadId)) return battle.squadById.get(squad.targetSquadId)!.center
        // 持ち場の原点は前列中央なので、部隊の中心へ戻して示す。
        return toWorld(squad.anchor, squad.facing, -squadBlock(squad.type, Math.max(1, squad.count)).depth / 2, 0)
    }
    const updatePaths = () => {
        const battle = gameStore.battle!
        const dragging = input.dragging.value
        const selected = input.selectedSquadId.value !== null ? battle.squadById.get(input.selectedSquadId.value) : undefined
        if (input.selectedSquadId.value !== null && !selected) input.selectSquad(null)
        const preview = input.previewCommand()
        const cursor = input.worldMousePos.value
        const key = [dragging, input.hoverSquadId.value, Math.round(cursor.x / 4), Math.round(cursor.y / 4), preview?.order,
            selected ? `${selected.id}:${selected.order}:${Math.round(selected.center.x / 4)}:${Math.round(selected.center.y / 4)}:${Math.round(selected.anchor.x / 4)}:${Math.round(selected.anchor.y / 4)}` : '',
            Math.floor(animationTime * 4)].join('|')
        if (key === pathKey) return
        pathKey = key
        pathOverlay.clear()
        if (dragging === 'army') pathOverlay.add([battle.formations.player.anchor, cursor])
        else if (typeof dragging === 'number') {
            const squad = battle.squadById.get(dragging)
            const target = preview?.order === 'attack' || preview?.order === 'support' ? battle.squadById.get(preview.targetSquadId!)?.center
                : preview?.constructionId !== undefined ? battle.constructionById.get(preview.constructionId)?.center : cursor
            if (squad && target && cursor.x > -9000) pathOverlay.add([squad.center, target])
        } else if (selected) {
            const destination = orderDestination(selected)
            if (destination && Math.hypot(destination.x - selected.center.x, destination.y - selected.center.y) > 20) pathOverlay.add(squadRoute(battle, selected, destination), selected.owner)
        }
    }

    // ---- 入力（no-life-kingと同じく、押した瞬間に旗の上かどうかで操作を決める） ----
    const raycaster = new THREE.Raycaster()
    let activePointer: number | null = null
    let backgroundGesture = false
    let pressed: { x: number; y: number } | null = null
    const setBackgroundGesture = (enabled: boolean) => {
        controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.ROTATE : null as unknown as THREE.MOUSE
        controls.touches.ONE = enabled ? THREE.TOUCH.PAN : null as unknown as THREE.TOUCH
    }
    const endGesture = () => {
        activePointer = null
        backgroundGesture = false
        pressed = null
        setBackgroundGesture(false)
        renderer.domElement.style.cursor = 'default'
    }
    const groundPoint = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect()
        camera.updateMatrixWorld()
        raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
        const ground = raycaster.intersectObjects(world.pickables, true)[0]
        return ground ? { x: ground.point.x, y: ground.point.z } : { x: -10000, y: -10000 }
    }
    const pointer = (event: PointerEvent) => {
        // Pointer capture targets the wrapper; resolve the banner under the cursor.
        const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-squad], [data-army]')
        const squadId = element?.dataset.squad ? Number(element.dataset.squad) : null
        const army = !!element?.dataset.army
        input.setWorldPointer(groundPoint(event), squadId)
        renderer.domElement.style.cursor = squadId !== null || army ? 'pointer' : input.buildMode.value ? 'crosshair' : 'default'
        return { squadId, army }
    }
    /** クリックした地点に最も近い兵の部隊を選ぶ。 */
    const pickSquad = (event: PointerEvent) => {
        const battle = gameStore.battle
        const point = groundPoint(event)
        if (!battle || point.x < -9000) { input.selectSquad(null); return }
        let best: number | null = null, bestDistance = 6 + camera.position.distanceTo(controls.target) * .006
        battle.hash.forEachNear(point.x, point.y, bestDistance, s => {
            const d = Math.hypot(s.x - point.x, s.y - point.y)
            if (d < bestDistance) { bestDistance = d; best = s.squadId }
        })
        input.selectSquad(best)
    }
    const canCommand = () => gameStore.status === 'playing' || gameStore.status === 'paused'
    const down = (event: PointerEvent) => {
        focus = null // 視点を動かし始めたら部隊へのカメラ移動をやめる。
        if (!canCommand()) return
        // OrbitControls normally swaps right-drag from pan to rotate when Shift is
        // held. This combination is intentionally left unassigned.
        if (event.button === 2 && event.shiftKey) {
            event.preventDefault()
            event.stopImmediatePropagation()
            return
        }
        if (event.button !== 0) return
        if (activePointer !== null) { input.reset(); activePointer = null; backgroundGesture = true; return }
        activePointer = event.pointerId
        const { squadId, army } = pointer(event)
        // Decide once, before OrbitControls receives pointerdown. Crossing a banner
        // during a background drag must never turn that gesture into an order.
        backgroundGesture = squadId === null && !army
        setBackgroundGesture(backgroundGesture)
        if (squadId !== null) input.handleSquadPointerDown(squadId, event)
        else if (army) input.handleArmyPointerDown(event)
        else { pressed = { x: event.clientX, y: event.clientY }; renderer.domElement.style.cursor = 'grabbing' }
    }
    const move = (event: PointerEvent) => {
        if (!canCommand() || backgroundGesture) return
        input.handleGlobalPointerMove(event)
        if (canvasEl.contains(event.target as Node) || activePointer === event.pointerId) pointer(event)
    }
    const up = (event: PointerEvent) => {
        if (input.contextMenu.value.visible || (!backgroundGesture && activePointer === event.pointerId)) {
            pointer(event)
            input.handleGlobalPointerUp(event)
        } else if (backgroundGesture && pressed && activePointer === event.pointerId
            && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < CLICK_TOLERANCE) {
            // 建設場所を選んでいる間は、クリックした地点に建てる。
            if (input.buildMode.value) { pointer(event); input.confirmBuild() }
            else pickSquad(event)
        }
        if (activePointer === event.pointerId || activePointer === null) endGesture()
    }
    const cancel = () => { endGesture(); input.reset(); gameStore.resumeGame() }
    canvasEl.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    const resize = () => {
        const width = canvasEl.clientWidth, height = canvasEl.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height)
        const previousAspect = camera.aspect
        camera.aspect = width / height
        // Reserve room for the HUD without moving the orbit focus below the ground.
        camera.setViewOffset(width, height, 0, Math.round(height * .06), width, height)
        camera.updateProjectionMatrix()
        if (Math.abs(previousAspect - camera.aspect) > .01) resetCamera()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvasEl)
    resize()
    let lastTime = 0, animationTime = 0, frame = 0, destroyed = false
    const animate = (now: number) => {
        if (destroyed) return
        const delta = lastTime ? Math.min((now - lastTime) / 1000, .1) : 0
        lastTime = now
        if (mapReference !== gameStore.mapGrid) {
            input.reset(); endGesture(); removeSquadLabels(); removeConstructionLabels()
            pathOverlay.clear(); pathKey = ''
            world.destroy()
            world = createWorld(gameStore.mapGrid, gameStore.battle!.forts, kit)
            mapReference = gameStore.mapGrid
            scene.add(world.group)
            buildCamps()
            resetCamera()
        }
        controls.enabled = gameStore.status !== 'title'
        updateFocus(delta)
        controls.update()
        // Keep the camera above hills when orbiting close to the terrain.
        const groundBelowCamera = world.field.heightAt(camera.position.x, camera.position.z)
        if (camera.position.y < groundBelowCamera + 12) {
            camera.position.y = groundBelowCamera + 12
            camera.lookAt(controls.target)
        }
        camera.updateMatrixWorld()
        atmosphere.update(camera, getNightAlpha(gameStore.dayTime) * 2)
        const visible = gameStore.status !== 'title'
        labels.hidden = !visible
        world.group.visible = visible
        army.group.visible = visible
        constructions.group.visible = visible
        pathOverlay.group.visible = visible
        camps.forEach(c => { c.camp.group.visible = visible })
        if (visible) {
            gameStore.update(delta)
            if (gameStore.status === 'playing') animationTime += delta * gameStore.timeScale
            const night = getNightAlpha(gameStore.dayTime) * 2
            sky.intensity = 1.7 - night * .9
            sun.intensity = 2.5 - night * 1.8
            sun.color.set(night > .5 ? 0xa1bbff : 0xffdeb3)
            world.update(animationTime)
            const battle = gameStore.battle!
            for (const c of camps) {
                c.camp.update(animationTime)
                if ('setNight' in c.camp) c.camp.setNight(night)
                const text = String(Math.ceil(c.fort.hp))
                if (c.label.textContent !== text) c.label.textContent = text
                c.label.setAttribute('aria-label', `${c.fort.owner === 'player' ? '人間軍' : 'モンスター軍'}の本陣 耐久${text}`)
                placeLabel(c.label, c.fort.core.x, c.fort.core.y, c.camp.labelHeight)
            }
            // 部隊の旗を重心の上に置く。
            const alive = new Set<number>()
            const dragging = input.dragging.value
            const preview = typeof dragging === 'number' ? input.previewCommand() : null
            for (const squad of battle.squads) {
                alive.add(squad.id)
                const visual = squadLabels.get(squad.id) ?? makeSquadLabel(squad)
                const count = String(squad.count)
                if (visual.count.textContent !== count) visual.count.textContent = count
                visual.label.classList.toggle('is-selected', input.selectedSquadId.value === squad.id)
                visual.label.classList.toggle('is-source', dragging === squad.id)
                visual.label.classList.toggle('is-target', input.hoverSquadId.value === squad.id && (preview?.order === 'attack' || preview?.order === 'support'))
                // 補給に戻っている間はその旨を、弓兵は矢の残り、補給部隊は補給の残り回数、工兵は建設の進み具合、疲れていれば「疲労」を示す。
                const tired = squad.stamina < STAMINA.tiredBelow
                const site = squad.order === 'build' ? battle.constructionById.get(squad.constructionId) : undefined
                const ammoText = squad.order === 'resupply' ? '補給中'
                    : [squad.maxArrows > 0 ? `矢${Math.round(squad.arrows / squad.maxArrows * 100)}%` : '', squad.maxSupplies > 0 ? `残${squad.supplies}回` : '',
                        site ? (site.complete ? '修理中' : `建設${Math.floor(site.progress * 100)}%`) : '', tired ? '疲労' : ''].filter(Boolean).join(' ')
                if (visual.ammo.textContent !== ammoText) visual.ammo.textContent = ammoText
                visual.label.classList.toggle('low-ammo', squad.order === 'resupply' || tired || (squad.maxArrows > 0 && squad.arrows < squad.maxArrows * .25) || (squad.maxSupplies > 0 && squad.supplies === 0))
                visual.label.setAttribute('aria-label', `${squad.owner === 'player' ? '自軍' : '敵軍'} 第${squad.number}${TYPE_NAME[squad.type]}隊 ${count}人${ammoText ? ` ${ammoText}` : ''}`)
                placeLabel(visual.label, squad.center.x, squad.center.y, squad.type === 'cavalry' ? 16 : 13)
            }
            squadLabels.forEach((v, id) => { if (!alive.has(id)) { v.label.remove(); squadLabels.delete(id) } })
            const formation = battle.formations.player
            const formationName = FORMATIONS.find(f => f.type === formation.type)!.name
            const armyText = `全軍・${formationName}`
            if (armyLabel.textContent !== armyText) armyLabel.textContent = armyText
            armyLabel.setAttribute('aria-label', `全軍の旗（${formationName}）。ドラッグで陣を移動、長押しで陣形を変更`)
            armyLabel.classList.toggle('is-source', dragging === 'army')
            // 部隊の旗と重ならないよう、陣の少し前方・高めに掲げる。
            const banner = toWorld(formation.anchor, formation.facing, 34, 0)
            placeLabel(armyLabel, banner.x, banner.y, 34)
            constructions.update(battle.constructions)
            updateConstructionLabels(battle.constructions)
            // 建設場所の下見（場所選び中、または工兵を川へドラッグ中の橋）。
            const buildPlan = input.buildPreview()
                ?? (preview?.order === 'build' && preview.kind ? input.buildPreviewAt(preview.kind, input.worldMousePos.value) : null)
            constructions.preview(buildPlan)
            army.update(battle.soldiers, battle.arrows, battle.spentArrows, surfaceAt, animationTime, battle.time, input.selectedSquadId.value)
            updatePaths()
        }
        pathOverlay.updateCamera()
        renderer.render(scene, camera)
        frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return { resetCamera, focusSquad, destroy() {
        destroyed = true
        cancelAnimationFrame(frame)
        observer.disconnect()
        canvasEl.removeEventListener('pointerdown', down, true)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('blur', cancel)
        input.reset()
        canvasEl.removeEventListener('wheel', trackpadRotate, true)
        canvasEl.removeEventListener('wheel', cancelFocus, true)
        controls.dispose()
        camps.forEach(c => { c.camp.destroy(); c.label.remove() })
        removeSquadLabels(); removeConstructionLabels(); armyLabel.remove()
        pathOverlay.destroy(); army.destroy(); constructions.destroy()
        world.destroy(); kit.destroy(); sun.shadow.dispose(); atmosphere.destroy()
        environment.dispose(); renderer.dispose(); renderer.forceContextLoss()
        renderer.domElement.remove(); labels.remove()
    } }
}
export type GameScene = Awaited<ReturnType<typeof createGameScene>>
