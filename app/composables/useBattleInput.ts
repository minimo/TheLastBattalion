import { nextTick, ref } from 'vue'
import type { SquadCommand, useGameStore } from '~/stores/game'
import { constructionNear, previewConstruction } from '~/game/battle'
import type { ConstructionAxis, ConstructionKind, FormationType, Point, SquadOrder } from '~/types/game'

type EntityPointerEvent = Pick<PointerEvent, 'clientX' | 'clientY'>

const LONG_PRESS_THRESHOLD = 500 // ms
const CLICK_DISTANCE = 10 // px
/** 地面で離したとき、これより近い敵部隊・砦を指示の対象にする。 */
const DROP_RADIUS = 35
const FORT_DROP_RADIUS = 80
/** 地面で離したとき、これより近い建設物を指示の対象にする。 */
const CONSTRUCTION_DROP_RADIUS = 14

/**
 * no-life-kingの入力作法を部隊に当てはめる。
 * 部隊の旗からドラッグ → 地面で移動・敵部隊で攻撃・自陣で退却・敵陣で突撃。長押しでメニュー。
 * 「全軍」の旗からドラッグで陣全体を移動、長押しで陣形メニュー。
 * 工兵は建設物を選んでから地面をクリックして建設場所を決める（川へドラッグすると橋を架ける）。
 */
export function useBattleInput(gameStore: ReturnType<typeof useGameStore>) {
    const contextMenuRef = ref<HTMLElement | null>(null)
    const worldMousePos = ref<Point>({ x: 0, y: 0 })
    const pointerDownPos = ref({ x: 0, y: 0 })
    /** ドラッグ中の部隊ID、または全軍（'army'）。 */
    const dragging = ref<number | 'army' | null>(null)
    const hoverSquadId = ref<number | null>(null)
    const selectedSquadId = ref<number | null>(null)
    const menuJustOpened = ref(false)
    /** 建設場所を選んでいる工兵の部隊と、建てる物・向き。 */
    const buildMode = ref<{ squadId: number; kind: ConstructionKind; axis: ConstructionAxis } | null>(null)
    /** 直前に建設場所を選べなかった理由（表示用）。 */
    const buildError = ref('')
    const contextMenu = ref<{ visible: boolean; x: number; y: number; type: 'squad' | 'army' | null; squadId: number | null }>({
        visible: false, x: 0, y: 0, type: null, squadId: null,
    })
    let longPressTimeout: ReturnType<typeof setTimeout> | null = null

    const clearLongPress = () => {
        if (longPressTimeout) { clearTimeout(longPressTimeout); longPressTimeout = null }
    }

    const openContextMenu = async (type: 'squad' | 'army', squadId: number | null, clickX: number, clickY: number) => {
        contextMenu.value = { visible: true, x: clickX, y: clickY, type, squadId }
        await nextTick()
        if (contextMenuRef.value) {
            // 画面からはみ出さないよう寄せる
            const rect = contextMenuRef.value.getBoundingClientRect()
            contextMenu.value.x = Math.min(clickX, window.innerWidth - rect.width - 10)
            contextMenu.value.y = Math.min(clickY, window.innerHeight - rect.height - 10)
        }
        gameStore.pauseGame()
        dragging.value = null
        menuJustOpened.value = true
    }

    const closeContextMenu = () => {
        contextMenu.value = { visible: false, x: 0, y: 0, type: null, squadId: null }
        gameStore.resumeGame()
    }

    const startLongPress = (e: EntityPointerEvent, open: () => void) => {
        clearLongPress()
        pointerDownPos.value = { x: e.clientX, y: e.clientY }
        longPressTimeout = setTimeout(() => { longPressTimeout = null; open() }, LONG_PRESS_THRESHOLD)
    }

    const handleSquadPointerDown = (squadId: number, e: EntityPointerEvent) => {
        const squad = gameStore.battle?.squadById.get(squadId)
        if (!squad) return
        selectedSquadId.value = squadId
        pointerDownPos.value = { x: e.clientX, y: e.clientY }
        if (squad.owner !== 'player') { clearLongPress(); dragging.value = null; return }
        dragging.value = squadId
        startLongPress(e, () => openContextMenu('squad', squadId, e.clientX, e.clientY))
    }

    const handleArmyPointerDown = (e: EntityPointerEvent) => {
        dragging.value = 'army'
        startLongPress(e, () => openContextMenu('army', null, e.clientX, e.clientY))
    }

    /** 描画側が地面上のポインター位置と、ポインター下の部隊（旗）を渡す。 */
    const setWorldPointer = (point: Point, squadId: number | null) => {
        worldMousePos.value = point
        const battle = gameStore.battle
        let hover = squadId
        if (hover === null && battle) {
            let best = DROP_RADIUS
            for (const squad of battle.squads) {
                const d = Math.hypot(squad.center.x - point.x, squad.center.y - point.y)
                if (d < best) { best = d; hover = squad.id }
            }
        }
        hoverSquadId.value = hover
    }

    const handleGlobalPointerMove = (e: PointerEvent) => {
        if (longPressTimeout && Math.hypot(e.clientX - pointerDownPos.value.x, e.clientY - pointerDownPos.value.y) > CLICK_DISTANCE) clearLongPress()
    }

    /** ドラッグを離した地点から、部隊への指示を決める。 */
    const dropCommand = (sourceId: number): SquadCommand & { order: SquadOrder } => {
        const battle = gameStore.battle!
        const point = worldMousePos.value
        const target = hoverSquadId.value !== null ? battle.squadById.get(hoverSquadId.value) : undefined
        if (target && target.owner !== 'player') return { order: 'attack', targetSquadId: target.id }
        const source = battle.squadById.get(sourceId)
        // 敵の建設物へ落とすと壊しに行く。工兵を自軍の建設中・傷んだ建設物へ落とすと、続きを建てる・直す。
        const site = constructionNear(battle, point, CONSTRUCTION_DROP_RADIUS)
        if (site && site.owner !== 'player') return { order: 'demolish', constructionId: site.id }
        if (source?.type === 'engineer' && site && (!site.complete || site.hp < site.maxHp)) return { order: 'build', constructionId: site.id }
        // 工兵を川へ落とすと、そこに橋を架ける。
        if (source?.type === 'engineer' && !battle.paths.passable(point.x, point.y)) {
            const plan = previewConstruction(battle, 'player', 'bridge', point)
            if (plan.valid) return { order: 'build', kind: 'bridge', point: { ...point } }
        }
        // 補給部隊を味方の部隊へ落とすと、その部隊へ矢と体力を届ける。
        if (source?.type === 'supply' && target && target.type !== 'supply' && target.id !== source.id) return { order: 'support', targetSquadId: target.id }
        const home = battle.homes.player, enemy = battle.homes.cpu
        if (Math.hypot(home.x - point.x, home.y - point.y) < FORT_DROP_RADIUS) return { order: 'retreat' }
        if (Math.hypot(enemy.x - point.x, enemy.y - point.y) < FORT_DROP_RADIUS) return { order: 'charge' }
        return { order: 'move', point: { ...point } }
    }

    const handleGlobalPointerUp = (e: PointerEvent) => {
        clearLongPress()
        if (menuJustOpened.value) { menuJustOpened.value = false; return }
        if (contextMenu.value.visible && !contextMenuRef.value?.contains(e.target as Node)) closeContextMenu()
        const source = dragging.value
        dragging.value = null
        if (source === null) return
        // 動かさずに離したら選択のみ
        if (Math.hypot(e.clientX - pointerDownPos.value.x, e.clientY - pointerDownPos.value.y) < CLICK_DISTANCE) return
        if (worldMousePos.value.x < -9000) return
        if (source === 'army') gameStore.moveFormation({ ...worldMousePos.value })
        else {
            const command = dropCommand(source)
            gameStore.orderSquad(source, command.order, command)
        }
    }

    /** ドラッグ中（手を離す前）なら、指示を出さずにドラッグと選択を取り消す。取り消したら true。 */
    const cancelDrag = () => {
        if (dragging.value === null) return false
        clearLongPress()
        dragging.value = null
        selectedSquadId.value = null
        return true
    }

    const startBuild = (squadId: number, kind: ConstructionKind) => {
        // バリケードは敵陣の方（東西）を向いて南北に並べるのを初めの向きにする。
        buildMode.value = { squadId, kind, axis: 'y' }
        buildError.value = ''
        selectedSquadId.value = squadId
    }
    const cancelBuild = () => { buildMode.value = null; buildError.value = '' }
    const rotateBuild = () => { if (buildMode.value) buildMode.value = { ...buildMode.value, axis: buildMode.value.axis === 'y' ? 'x' : 'y' } }
    /** 建設場所の下見（表示用）。 */
    const buildPreview = () => {
        const mode = buildMode.value, battle = gameStore.battle
        if (!mode || !battle || worldMousePos.value.x < -9000) return null
        return previewConstruction(battle, 'player', mode.kind, worldMousePos.value, mode.axis)
    }
    /** 指定した建設物を地点に置いた場合の下見（ドラッグ中の表示用）。 */
    const buildPreviewAt = (kind: ConstructionKind, point: Point) => gameStore.battle ? previewConstruction(gameStore.battle, 'player', kind, point) : null
    /** 今のポインターの位置に建設物を置く。置けなければ理由を示して選び直させる。 */
    const confirmBuild = () => {
        const mode = buildMode.value, battle = gameStore.battle
        if (!mode || !battle) return
        if (!battle.squadById.has(mode.squadId)) { cancelBuild(); return }
        const plan = buildPreview()
        if (!plan) return
        if (!plan.valid) { buildError.value = plan.reason; return }
        if (gameStore.construct(mode.squadId, mode.kind, { ...worldMousePos.value }, mode.axis)) cancelBuild()
    }

    const handleContextMenuAction = (action: string) => {
        const { type, squadId } = contextMenu.value
        closeContextMenu()
        if (type === 'squad' && squadId !== null && action.startsWith('build:')) startBuild(squadId, action.slice(6) as ConstructionKind)
        else if (type === 'squad' && squadId !== null) gameStore.orderSquad(squadId, action as SquadOrder)
        else if (type === 'army') {
            if (action === 'charge' || action === 'hold' || action === 'retreat') gameStore.orderArmy(action)
            else gameStore.setFormation(action as FormationType)
        }
    }

    const reset = () => {
        clearLongPress()
        dragging.value = null
        hoverSquadId.value = null
        selectedSquadId.value = null
        contextMenu.value = { visible: false, x: 0, y: 0, type: null, squadId: null }
        menuJustOpened.value = false
        cancelBuild()
    }

    return {
        contextMenuRef,
        contextMenu,
        worldMousePos,
        dragging,
        hoverSquadId,
        selectedSquadId,
        buildMode,
        buildError,
        startBuild,
        cancelBuild,
        rotateBuild,
        confirmBuild,
        buildPreview,
        buildPreviewAt,
        setWorldPointer,
        handleSquadPointerDown,
        handleArmyPointerDown,
        handleGlobalPointerMove,
        handleGlobalPointerUp,
        handleContextMenuAction,
        closeContextMenu,
        cancelDrag,
        selectSquad: (id: number | null) => { selectedSquadId.value = id },
        reset,
        /** ドラッグ中の指示の種類（プレビュー表示用）。 */
        previewCommand: () => typeof dragging.value === 'number' ? dropCommand(dragging.value) : null,
    }
}

export type BattleInput = ReturnType<typeof useBattleInput>
