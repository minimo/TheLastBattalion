import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { getNightAlpha } from '~/game/daynight'
import type { useGameStore } from '~/stores/game'
import type { BattleInput } from '~/composables/useBattleInput'
import type { Company, Construction, Fort, Point, Squad, UnitType } from '~/types/game'
import { CONSTRUCTION, STAMINA } from '~/game/battleConfig'
import { companyLeader, companyPosition, companySquads, orderDestination, previewCompanyRoute, squadPosition, squadRoute, type Battle } from '~/game/battle'
import { createModelKit, FACTION, OCCLUDER_LAYER } from './three/models'
import { createWorld } from './three/world'
import { createAtmosphere } from './three/atmosphere'
import { MAP_THEME, type MapTheme } from './three/mapTheme'
import { createPathOverlay } from './three/overlays'
import { createFortCamp } from './three/fortCamp'
import { createCastle } from './three/castle'
import { COMPANY_BANNER_SCALE, createArmyRenderer } from './three/army'
import { createConstructionRenderer } from './three/constructions'

interface GameSceneOptions {
    canvasEl: HTMLElement
    gameStore: ReturnType<typeof useGameStore>
    input: BattleInput
}

const CLICK_TOLERANCE = 6 // px
/** 隊長の背の幟の高さの範囲（地面から、布の下端〜竿の先端。army.ts の幟の付け位置とモデルの縮尺から）。 */
const BANNER_SPAN = { foot: [8, 17], cavalry: [10.5, 19.5] } as const
/** 隊長の幟の高さの範囲。中隊長は幟を大きくして背負うので、布の上端が高い。 */
const bannerSpan = (type: UnitType, companyHead: boolean): [number, number] => {
    const [low, high] = type === 'cavalry' ? BANNER_SPAN.cavalry : BANNER_SPAN.foot
    return [low, companyHead ? low + (high - low) * COMPANY_BANNER_SCALE : high]
}
/** 中隊長の兵のIDと、その中隊。 */
const companyHeads = (battle: Battle) => new Map(battle.companies.flatMap(c => { const head = companyLeader(battle, c); return head ? [[head.id, c.id] as const] : [] }))
const TYPE_MARK: Record<UnitType, string> = { infantry: '歩', pikeman: '槍', archer: '弓', cavalry: '騎', supply: '補', engineer: '工' }
const TYPE_NAME: Record<UnitType, string> = { infantry: '歩兵', pikeman: '槍兵', archer: '弓兵', cavalry: '騎兵', supply: '補給', engineer: '工兵' }
const TYPE_ORDER: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
/** 中隊の旗の高さ（小隊の旗より上）。 */
const COMPANY_LABEL_HEIGHT = 34
/** カメラがこれより遠いと小隊の旗を隠し、中隊の旗だけを出す（選んでいる小隊・中隊の小隊の旗は出す）。 */
const SQUAD_LABEL_DISTANCE = 800
/** 兵の中心（兵がいなければ undefined）。 */
const membersCenter = (members: { x: number; y: number }[] | undefined) => members?.length
    ? { x: members.reduce((sum, s) => sum + s.x, 0) / members.length, y: members.reduce((sum, s) => sum + s.y, 0) / members.length }
    : undefined

export async function createGameScene({ canvasEl, gameStore, input }: GameSceneOptions) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-label', '3Dの戦場。中隊・小隊の旗をドラッグして移動・攻撃を指示、長押しでメニュー。何もない場所からの左ドラッグで回転、右ドラッグとShiftを押しながらの左ドラッグでパン、ホイールで拡大縮小。タッチ画面・トラックパッドの2本指の横ドラッグで左右回転、ピンチで拡大縮小。')
    canvasEl.appendChild(renderer.domElement)
    const labels = document.createElement('div')
    labels.className = 'world-labels'
    canvasEl.appendChild(labels)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xb6c9cb)
    const atmosphere = createAtmosphere(scene, MAP_THEME.standard.sky)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environmentScene = new RoomEnvironment()
    const environment = pmrem.fromScene(environmentScene, .04)
    scene.environment = environment.texture
    scene.environmentIntensity = .45
    environmentScene.dispose()
    pmrem.dispose()
    // 手前の描画距離を詰めすぎると遠くの深度の精度が落ち、壁と窓のように近接した面がちらつく。
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 8, 12000)
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
    let focus: { at: () => Point | undefined; elapsed: number; target: THREE.Vector3; offset: THREE.Vector3; endOffset: THREE.Vector3 } | null = null
    const FOCUS_DURATION = .9, FOCUS_MAX_DISTANCE = 420
    const easeInOutCubic = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    const startFocus = (at: () => Point | undefined, maxDistance: number) => {
        const offset = camera.position.clone().sub(controls.target)
        // 向きは保ったまま、遠すぎるときだけ寄せる。
        const endOffset = offset.clone().setLength(Math.min(offset.length(), maxDistance))
        focus = { at, elapsed: 0, target: controls.target.clone(), offset, endOffset }
    }
    const focusSquad = (squadId: number) => {
        if (!gameStore.battle?.squadById.has(squadId)) return
        startFocus(() => gameStore.battle?.squadById.get(squadId)?.center, FOCUS_MAX_DISTANCE)
    }
    /** 中隊へのカメラ移動。中隊の小隊が見渡せるよう、小隊より少し引いて止める。 */
    const focusCompany = (companyId: number) => {
        if (!gameStore.battle?.companyById.has(companyId)) return
        startFocus(() => {
            const battle = gameStore.battle, company = battle?.companyById.get(companyId)
            return battle && company ? companyPosition(battle, company) : undefined
        }, FOCUS_MAX_DISTANCE * 1.6)
    }
    const updateFocus = (delta: number) => {
        if (!focus) return
        const center = focus.at()
        if (!center) { focus = null; return }
        focus.elapsed += delta
        const t = Math.min(1, focus.elapsed / FOCUS_DURATION), k = easeInOutCubic(t)
        const goal = new THREE.Vector3(center.x, surfaceAt(center.x, center.y), center.y)
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
        // 自軍の真後ろから敵軍の方を望む。注視点は両軍の本拠地の中間。
        const homes = gameStore.battle?.homes
        const own = homes?.player ?? { x: 416 - 700, y: 416 }, enemy = homes?.cpu ?? { x: 416 + 700, y: 416 }
        const toEnemy = new THREE.Vector2(enemy.x - own.x, enemy.y - own.y)
        if (toEnemy.lengthSq() < 1) toEnemy.set(1, 0)
        toEnemy.normalize()
        const midX = (own.x + enemy.x) / 2, midZ = (own.y + enemy.y) / 2
        controls.target.set(midX, 24, midZ)
        const fit = Math.max(1, 1.6 / camera.aspect)
        camera.position.set(midX - toEnemy.x * 1480 * fit, 24 + 820 * fit, midZ - toEnemy.y * 1480 * fit)
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
    let light: MapTheme['light'] = MAP_THEME.standard.light
    const sunDay = new THREE.Color(), sunNight = new THREE.Color()
    const applyTheme = (theme: MapTheme) => {
        light = theme.light
        atmosphere.setTheme(theme.sky)
        sky.color.set(light.sky); sky.groundColor.set(light.ground)
        sunDay.set(light.sun); sunNight.set(light.nightSun)
    }
    const kit = createModelKit()
    gameStore.initGame()
    let world = createWorld(gameStore.mapGrid, gameStore.battle!.forts, kit)
    applyTheme(world.theme)
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
    // ---- ラベルの隠れ判定（地形や建物の後ろにあるラベルは出さない） ----
    const occlusionRay = new THREE.Raycaster()
    occlusionRay.layers.set(OCCLUDER_LAYER)
    /** 地形のいちばん高い所。視線がこれより上に出たら、もう地形には隠れない。 */
    let terrainTop: { world: typeof world | null; height: number } = { world: null, height: 0 }
    const terrainTopHeight = () => {
        if (terrainTop.world !== world) {
            const [terrain, surroundings] = world.pickables
            const box = new THREE.Box3().setFromObject(terrain!).union(new THREE.Box3().setFromObject(surroundings!))
            terrainTop = { world, height: box.max.y }
        }
        return terrainTop.height
    }
    const isOccluded = (point: THREE.Vector3) => {
        const toCamera = camera.position.clone().sub(point)
        const distance = toCamera.length()
        toCamera.divideScalar(distance)
        // 地形は高さを辿って調べる（地形のメッシュへのレイキャストは重い）。
        const top = terrainTopHeight()
        for (let t = 4; t < distance; t += 6) {
            const y = point.y + toCamera.y * t
            if (y > top) break
            if (y < world.field.heightAt(point.x + toCamera.x * t, point.z + toCamera.z * t)) return true
        }
        // 本陣・城・建設物は、大きな部材だけの隠れ判定用の形で調べる（半透明の下見は含まない）。
        // ラベルのすぐ下の自分の建物は数えない。
        occlusionRay.set(point, toCamera)
        occlusionRay.far = distance
        const hits = occlusionRay.intersectObjects([...camps.map(c => c.camp.group), constructions.group], true)
        return hits.some(hit => hit.distance > 4 && isShown(hit.object))
    }
    const isShown = (object: THREE.Object3D | null): boolean => !object || (object.visible && isShown(object.parent))
    const placeLabel = (label: HTMLElement, x: number, y: number, h: number) => {
        const p = project(x, y, h)
        label.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`
        label.hidden = !p.visible || isOccluded(new THREE.Vector3(x, surfaceAt(x, y) + h, y))
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

    // 部隊の旗。no-life-kingの拠点ラベルと同じく、透明な押下対象を兼ねる。
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
    // 中隊の旗（小隊の旗より上に掲げる）。
    const companyLabels = new Map<number, { label: HTMLButtonElement; name: HTMLSpanElement; count: HTMLSpanElement }>()
    const makeCompanyLabel = (company: Company) => {
        const label = document.createElement('button')
        label.type = 'button'
        label.className = `world-label company-label ${company.owner}`
        label.dataset.company = String(company.id)
        label.style.setProperty('--faction', factionColor(company.owner))
        const name = document.createElement('span'), count = document.createElement('span')
        name.className = 'company-name'; count.className = 'company-count'
        label.append(name, count)
        labels.appendChild(label)
        const visual = { label, name, count }
        companyLabels.set(company.id, visual)
        return visual
    }
    const removeCompanyLabels = () => { companyLabels.forEach(v => v.label.remove()); companyLabels.clear() }
    // 建設物の名前と、建設の進み具合・耐久ゲージ。
    const constructionLabels = new Map<number, { site: Construction; label: HTMLSpanElement; name: HTMLSpanElement; fill: HTMLSpanElement }>()
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
                const name = document.createElement('span'), gauge = document.createElement('span'), fill = document.createElement('span')
                name.className = 'construction-name'; gauge.className = 'construction-gauge'; fill.className = 'construction-gauge-fill'
                gauge.appendChild(fill)
                label.append(name, gauge)
                labels.appendChild(label)
                visual = { site, label, name, fill }
                constructionLabels.set(site.id, visual)
            }
            const name = CONSTRUCTION[site.kind].name
            const text = site.complete ? name : `${name} 建設中${Math.floor(site.progress * 100)}%`
            if (visual.name.textContent !== text) visual.name.textContent = text
            const width = `${Math.max(0, Math.min(100, site.hp / site.maxHp * 100)).toFixed(1)}%`
            if (visual.fill.style.width !== width) visual.fill.style.width = width
            visual.label.setAttribute('aria-label', `${text} 耐久${Math.ceil(site.hp)}/${site.maxHp}`)
            visual.label.classList.toggle('damaged', site.complete && site.hp < site.maxHp * .4)
            placeLabel(visual.label, site.center.x, site.center.y, site.kind === 'outpost' ? 26 : 12)
        }
        constructionLabels.forEach((v, id) => { if (!alive.has(id)) { v.label.remove(); constructionLabels.delete(id) } })
    }

    const pathOverlay = createPathOverlay(camera, canvasEl, (x, y) => world.field.surfaceAt(x, y), isOccluded)
    scene.add(pathOverlay.group)
    let pathKey = ''
    const updatePaths = () => {
        const battle = gameStore.battle!
        const dragging = input.dragging.value
        const selected = input.selectedSquadId.value !== null ? battle.squadById.get(input.selectedSquadId.value) : undefined
        if (input.selectedSquadId.value !== null && !selected) input.selectSquad(null)
        const selectedCompany = input.selectedCompanyId.value !== null ? battle.companyById.get(input.selectedCompanyId.value) : undefined
        if (input.selectedCompanyId.value !== null && !selectedCompany) input.selectCompany(null)
        const draggingCompany = input.draggingCompany.value !== null ? battle.companyById.get(input.draggingCompany.value) : undefined
        const preview = input.previewCommand()
        const companyPreview = input.previewCompanyCommand()
        const cursor = input.worldMousePos.value
        const squadKey = (squad: Squad) => `${squad.id}:${squad.order}:${Math.round(squadPosition(battle, squad).x / 4)}:${Math.round(squadPosition(battle, squad).y / 4)}:${Math.round(squad.anchor.x / 4)}:${Math.round(squad.anchor.y / 4)}`
        const key = [dragging, input.draggingCompany.value, input.hoverSquadId.value, input.hoverCompanyId.value, Math.round(cursor.x / 4), Math.round(cursor.y / 4), preview?.order, companyPreview?.order,
            selected ? squadKey(selected) : '', selectedCompany ? companySquads(battle, selectedCompany.id).map(squadKey).join(',') : '',
            Math.floor(animationTime * 4)].join('|')
        if (key === pathKey) return
        pathKey = key
        pathOverlay.clear()
        if (draggingCompany) {
            // 離したら出る指示で中隊長の小隊が進む経路を、指示を出したあとの矢印と同じく引く。
            const route = companyPreview && cursor.x > -9000 ? previewCompanyRoute(battle, draggingCompany.id, companyPreview) : undefined
            if (route) pathOverlay.add(route)
        } else if (typeof dragging === 'number') {
            const squad = battle.squadById.get(dragging)
            // 矢印はラベルの立つ隊長の幟から、狙う部隊なら相手の隊長の幟へ引く。
            const targetSquad = preview?.order === 'attack' || preview?.order === 'support' ? battle.squadById.get(preview.targetSquadId!) : undefined
            const target = targetSquad ? squadPosition(battle, targetSquad)
                : preview?.constructionId !== undefined ? battle.constructionById.get(preview.constructionId)?.center : cursor
            if (squad && target && cursor.x > -9000) pathOverlay.add([squadPosition(battle, squad), target])
        } else {
            // 選んでいる小隊の行き先を示す。中隊なら小隊ごとには引かず、中隊長の幟から中隊長の小隊の行き先へ1本だけ引く。
            // 敵は選んでも情報を見るだけなので、行き先は引かない。
            const head = selectedCompany ? battle.squadById.get(selectedCompany.leaderSquadId) : undefined
            for (const squad of selected ? [selected] : head ? [head] : []) {
                if (squad.owner !== 'player') continue
                const destination = orderDestination(battle, squad)
                const from = squadPosition(battle, squad)
                if (destination && Math.hypot(destination.x - from.x, destination.y - from.y) > 20) pathOverlay.add(squadRoute(battle, squad, destination), squad.owner)
            }
        }
    }

    // ---- 入力（no-life-kingと同じく、押した瞬間に旗の上かどうかで操作を決める） ----
    const raycaster = new THREE.Raycaster()
    /** ポインターの下にある隊長の幟の小隊・中隊長の幟の中隊（ラベルの上ではないとき）。 */
    let bannerHover: number | null = null
    let bannerCompanyHover: number | null = null
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
        const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-squad], [data-company]')
        // 隊長の幟もラベルと同じく部隊の旗として扱う（指すとラベルが光り、押せばドラッグ・長押しできる）。中隊長の幟は中隊の旗。
        const banner = element ? { squadId: null, companyId: null } : bannerAt(event)
        bannerHover = banner.squadId
        bannerCompanyHover = banner.companyId
        const companyId = element?.dataset.company ? Number(element.dataset.company) : bannerCompanyHover
        const squadId = element?.dataset.squad ? Number(element.dataset.squad) : bannerHover
        input.setWorldPointer(groundPoint(event), squadId, companyId)
        const selectable = squadId !== null && input.canSelectSquad(squadId)
        renderer.domElement.style.cursor = input.buildMode.value ? 'crosshair' : selectable || companyId !== null ? 'pointer' : 'default'
        return { squadId, companyId }
    }
    /**
     * クリックした画面上の点に重なる隊長の幟の部隊（中隊長の幟なら中隊）。幟は宙にあって地面の点では拾えないので、
     * 竿（布の高さ）を画面へ投影した線分との距離で判定し、布の幅ほどの近さなら当たりとする。
     */
    const bannerAt = (event: PointerEvent): { squadId: number | null; companyId: number | null } => {
        const none = { squadId: null, companyId: null }
        const battle = gameStore.battle
        if (!battle) return none
        const heads = companyHeads(battle)
        const rect = canvasEl.getBoundingClientRect()
        const cx = event.clientX - rect.left, cy = event.clientY - rect.top
        let best: number | null = null, bestDistance = Infinity
        for (const squad of battle.squads) {
            const leader = battle.byId.get(squad.leaderId)
            if (!leader || leader.state === 'dead') continue
            const [low, high] = bannerSpan(squad.type, heads.has(leader.id))
            const a = project(leader.x, leader.y, low), b = project(leader.x, leader.y, high)
            if (!a.visible || !b.visible) continue
            // 布の幅（約2.5）を画面の長さに直した分を、当たりの幅にする。
            const reach = Math.max(6, Math.hypot(b.x - a.x, b.y - a.y) / (high - low) * 2.5)
            const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy || 1
            const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / length2))
            const d = Math.hypot(cx - (a.x + dx * t), cy - (a.y + dy * t))
            if (d < reach && d < bestDistance) { bestDistance = d; best = squad.id }
        }
        // 地形や建物に隠れた幟は拾わない（ラベルも隠れている）。
        const squad = best !== null ? battle.squadById.get(best) : undefined, leader = squad && battle.byId.get(squad.leaderId)
        if (!squad || !leader) return none
        const top = bannerSpan(squad.type, heads.has(leader.id))[1]
        if (isOccluded(new THREE.Vector3(leader.x, surfaceAt(leader.x, leader.y) + top, leader.y))) return none
        const company = heads.get(leader.id)
        return company !== undefined ? { squadId: null, companyId: company } : { squadId: squad.id, companyId: null }
    }
    /** クリックした幟、またはクリックした地点に最も近い兵の部隊を選ぶ。選べる部隊がなければ（地面・中隊の小隊）、選択を外す。 */
    const pickSquad = (event: PointerEvent) => {
        const battle = gameStore.battle
        const banner = bannerAt(event)
        if (banner.companyId !== null) { input.selectCompany(banner.companyId); return }
        let best: number | null = banner.squadId
        const point = groundPoint(event)
        if (best === null && battle && point.x > -9000) {
            let bestDistance = 6 + camera.position.distanceTo(controls.target) * .006
            battle.hash.forEachNear(point.x, point.y, bestDistance, s => {
                const d = Math.hypot(s.x - point.x, s.y - point.y)
                // 部隊を離れて逃げ出した兵は選べない。
                if (d < bestDistance && s.squadId >= 0) { bestDistance = d; best = s.squadId }
            })
        }
        if (best !== null && input.canSelectSquad(best)) { input.selectSquad(best); return }
        input.selectSquad(null)
        input.selectCompany(null)
    }
    const canCommand = () => gameStore.status === 'playing' || gameStore.status === 'paused'
    const down = (event: PointerEvent) => {
        focus = null // 視点を動かし始めたら部隊へのカメラ移動をやめる。
        // 開戦前（部隊編成の間）は指示を出せないが、視点は動かせる。
        const deploying = gameStore.status === 'deploying'
        if (!canCommand() && !deploying) return
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
        if (deploying) { backgroundGesture = true; setBackgroundGesture(true); return }
        const { squadId, companyId } = pointer(event)
        // Decide once, before OrbitControls receives pointerdown. Crossing a banner
        // during a background drag must never turn that gesture into an order.
        // 建設場所を選んでいる間は、旗の上を押しても部隊は掴まず、その地点に建てる。
        // 選べない小隊（中隊の小隊）の旗を押したときは、地面を押したのと同じにする。
        const grabbed = squadId !== null && input.canSelectSquad(squadId)
        backgroundGesture = !!input.buildMode.value || (!grabbed && companyId === null)
        setBackgroundGesture(backgroundGesture)
        if (backgroundGesture) { pressed = { x: event.clientX, y: event.clientY }; renderer.domElement.style.cursor = 'grabbing' }
        else if (companyId !== null) input.handleCompanyPointerDown(companyId, event)
        else if (grabbed) input.handleSquadPointerDown(squadId!, event)
    }
    const move = (event: PointerEvent) => {
        if (!canCommand() || backgroundGesture) return
        input.handleGlobalPointerMove(event)
        if (canvasEl.contains(event.target as Node) || activePointer === event.pointerId) pointer(event)
        else bannerHover = null
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
            input.reset(); endGesture(); removeSquadLabels(); removeCompanyLabels(); removeConstructionLabels()
            pathOverlay.clear(); pathKey = ''
            world.destroy()
            world = createWorld(gameStore.mapGrid, gameStore.battle!.forts, kit)
            applyTheme(world.theme)
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
        atmosphere.update(camera, getNightAlpha(gameStore.dayTime) * 2, gameStore.dayTime)
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
            sky.intensity = (1.7 - night * .9) * light.sunScale
            sun.intensity = (2.5 - night * 1.8) * light.sunScale
            sun.color.copy(night > .5 ? sunNight : sunDay)
            world.update(animationTime)
            const battle = gameStore.battle!
            const heads = companyHeads(battle)
            for (const c of camps) {
                c.camp.update(animationTime)
                if ('setNight' in c.camp) c.camp.setNight(night)
                const text = String(Math.ceil(c.fort.hp))
                if (c.label.textContent !== text) c.label.textContent = text
                c.label.setAttribute('aria-label', `${c.fort.owner === 'player' ? '人間軍' : '魔王軍'}の本陣 耐久${text}`)
                placeLabel(c.label, c.fort.core.x, c.fort.core.y, c.camp.labelHeight)
            }
            // 部隊の旗を隊長の幟の上に置く。
            const alive = new Set<number>()
            const dragging = input.dragging.value
            const preview = typeof dragging === 'number' ? input.previewCommand() : null
            const companyPreview = input.previewCompanyCommand()
            const targeting = preview?.order === 'attack' || preview?.order === 'support' || companyPreview?.order === 'attack'
            // 引いた視点では小隊の旗を隠し、中隊の旗だけにする（選んでいる小隊と、選んでいる中隊の小隊は出す）。
            const far = camera.position.distanceTo(controls.target) > SQUAD_LABEL_DISTANCE
            const selectedCompany = input.selectedCompanyId.value
            for (const squad of battle.squads) {
                alive.add(squad.id)
                const visual = squadLabels.get(squad.id) ?? makeSquadLabel(squad)
                const count = String(squad.count)
                if (visual.count.textContent !== count) visual.count.textContent = count
                visual.label.classList.toggle('is-selected', input.selectedSquadId.value === squad.id)
                // 中隊の小隊の旗は選べないので、押せる見た目にしない。
                const locked = !input.canSelectSquad(squad.id)
                visual.label.classList.toggle('is-locked', locked)
                visual.label.classList.toggle('is-hover', bannerHover === squad.id && !locked)
                visual.label.classList.toggle('is-source', dragging === squad.id)
                visual.label.classList.toggle('is-target', input.hoverSquadId.value === squad.id && targeting)
                // 補給に戻っている間はその旨を、弓兵は矢の残り、補給部隊は補給の残り回数、工兵は建設の進み具合、疲れていれば「疲労」を示す。
                const tired = squad.stamina < STAMINA.tiredBelow
                const site = squad.order === 'build' ? battle.constructionById.get(squad.constructionId) : undefined
                const ammoText = squad.order === 'resupply' ? '補給中'
                    : [squad.maxArrows > 0 ? `矢${Math.round(squad.arrows / squad.maxArrows * 100)}%` : '', squad.maxSupplies > 0 ? `残${squad.supplies}回` : '',
                        site ? (site.complete ? '修理中' : `建設${Math.floor(site.progress * 100)}%`) : '', tired ? '疲労' : ''].filter(Boolean).join(' ')
                if (visual.ammo.textContent !== ammoText) visual.ammo.textContent = ammoText
                visual.label.classList.toggle('low-ammo', squad.order === 'resupply' || tired || (squad.maxArrows > 0 && squad.arrows < squad.maxArrows * .25) || (squad.maxSupplies > 0 && squad.supplies === 0))
                visual.label.setAttribute('aria-label', `${squad.owner === 'player' ? '自軍' : '敵軍'} 第${squad.number}${TYPE_NAME[squad.type]}小隊 ${count}人${ammoText ? ` ${ammoText}` : ''}`)
                // 隊長の背の幟の少し上に掲げる。隊長が決まる前（開戦前の部隊編成の間）は部隊の兵の中心の上。
                const leader = battle.byId.get(squad.leaderId)
                const at = leader && leader.state !== 'dead' ? leader : membersCenter(battle.members.get(squad.id)) ?? squad.center
                placeLabel(visual.label, at.x, at.y, bannerSpan(squad.type, !!leader && heads.has(leader.id))[1] + 2)
                // 引いた視点では中隊の小隊の旗を隠す（中隊の旗が代わりに立つ）。中隊に入らない小隊（工兵・補給兵）の旗は残す。
                if (far && locked && dragging !== squad.id && (selectedCompany === null || squad.companyId !== selectedCompany)) visual.label.hidden = true
            }
            squadLabels.forEach((v, id) => { if (!alive.has(id)) { v.label.remove(); squadLabels.delete(id) } })
            // 中隊の旗を中隊の小隊の幟の真ん中の上に掲げる。
            const aliveCompanies = new Set<number>()
            for (const company of battle.companies) {
                const squads = companySquads(battle, company.id)
                if (!squads.length) continue
                aliveCompanies.add(company.id)
                const visual = companyLabels.get(company.id) ?? makeCompanyLabel(company)
                const types = new Set(squads.map(sq => sq.type))
                const marks = TYPE_ORDER.filter(t => types.has(t)).map(t => TYPE_MARK[t]).join('')
                const name = `${company.number}中${marks}`
                if (visual.name.textContent !== name) visual.name.textContent = name
                const total = squads.reduce((sum, sq) => sum + sq.count, 0)
                const count = String(total)
                if (visual.count.textContent !== count) visual.count.textContent = count
                visual.label.classList.toggle('is-selected', selectedCompany === company.id)
                visual.label.classList.toggle('is-source', input.draggingCompany.value === company.id)
                visual.label.classList.toggle('is-hover', bannerCompanyHover === company.id)
                visual.label.classList.toggle('is-target', input.hoverCompanyId.value === company.id && targeting)
                visual.label.classList.toggle('compact', !far)
                visual.label.setAttribute('aria-label', `${company.owner === 'player' ? '自軍' : '敵軍'} 第${company.number}中隊（${TYPE_ORDER.filter(t => types.has(t)).map(t => TYPE_NAME[t]).join('・')}） ${squads.length}小隊 ${total}人`)
                // 中隊長の幟の上に掲げる（中隊長が決まる前は小隊の幟の真ん中の上）。
                const at = companyPosition(battle, company)
                placeLabel(visual.label, at.x, at.y, COMPANY_LABEL_HEIGHT)
            }
            companyLabels.forEach((v, id) => { if (!aliveCompanies.has(id)) { v.label.remove(); companyLabels.delete(id) } })
            constructions.update(battle.constructions)
            updateConstructionLabels(battle.constructions)
            // 建設場所の下見（場所選び中、または工兵を川へドラッグ中の橋）。
            const buildPlan = input.buildPreview()
                ?? (preview?.order === 'build' && preview.kind ? input.buildPreviewAt(preview.kind, input.worldMousePos.value) : null)
            constructions.preview(buildPlan)
            const ringed = new Set(input.selectedSquadId.value !== null ? [input.selectedSquadId.value] : selectedCompany !== null ? battle.companyById.get(selectedCompany)?.squadIds ?? [] : [])
            army.update(battle.soldiers, battle.arrows, battle.spentArrows, surfaceAt, animationTime, battle.time, ringed, new Set(battle.squads.map(sq => sq.leaderId)), new Set(heads.keys()))
            updatePaths()
        }
        pathOverlay.updateCamera()
        renderer.render(scene, camera)
        frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return { resetCamera, focusSquad, focusCompany, destroy() {
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
        removeSquadLabels(); removeCompanyLabels(); removeConstructionLabels()
        pathOverlay.destroy(); army.destroy(); constructions.destroy()
        world.destroy(); kit.destroy(); sun.shadow.dispose(); atmosphere.destroy()
        environment.dispose(); renderer.dispose(); renderer.forceContextLoss()
        renderer.domElement.remove(); labels.remove()
    } }
}
export type GameScene = Awaited<ReturnType<typeof createGameScene>>
