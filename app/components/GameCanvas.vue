<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGameStore } from '~/stores/game'
import { useBattleInput } from '~/composables/useBattleInput'
import TimePlate from './TimePlate.vue'
import DeploymentEditor from './DeploymentEditor.vue'
import ArmyStatus from './ArmyStatus.vue'
import BattleMenu from './BattleMenu.vue'
import CommandBar from './CommandBar.vue'
import CommandIcon from './CommandIcon.vue'
import SquadPanel from './SquadPanel.vue'
import { ARMY_NAME, UNIT_NAME, companyActions, companyName, squadActions, squadName } from './battleUi'
import type { GameScene } from '~/render/gameScene'
import { MAP_TYPE_DESCRIPTION, MAP_TYPE_NAME, MAP_TYPES, mapTypeForMode } from '~/game/mapType'
import type { Army, BattleMode, MapType } from '~/types/game'

const gameStore = useGameStore()
const canvasRef = ref<HTMLElement | null>(null)
const input = useBattleInput(gameStore)
const { contextMenuRef, contextMenu, handleContextMenuAction } = input

let scene: GameScene | null = null
let disposed = false
const ready = ref(false)
const loadError = ref('')
const customSeed = ref('')
const seedEntry = ref(false)
const MODES: { mode: BattleMode; name: string; description: string }[] = [
  { mode: 'field', name: '攻防戦', description: '両軍が砦を構える。敵の本陣を落とした軍の勝利' },
  { mode: 'siege', name: '攻城戦', description: '魔王軍の砦を攻める。本陣を落とせば勝利、全滅で敗北' },
  { mode: 'defense', name: '防衛戦', description: '魔王軍から砦を守る。敵を全滅させれば勝利、本陣を落とされれば敗北' },
]
const MODE_NAME = Object.fromEntries(MODES.map(m => [m.mode, m.name])) as Record<BattleMode, string>
const selectedMode = ref<BattleMode>(gameStore.mode)
const modeDescription = computed(() => MODES.find(m => m.mode === selectedMode.value)!.description)
const selectedMap = ref<MapType>(gameStore.mapChoice)
/** 地形を選べるのは攻防戦だけ。攻城戦・防衛戦は地形が決まっている。 */
const mapSelectable = computed(() => selectedMode.value === 'field')
const shownMap = computed(() => mapTypeForMode(selectedMode.value, selectedMap.value))
/** 戦場に入る。deploy なら戦場で部隊編成をしてから開戦し、そうでなければ前回の編成ですぐ開戦する（Restart）。 */
const start = (seed?: string, deploy = true) => { input.reset(); gameStore.startGame(seed, selectedMode.value, selectedMap.value, deploy) }
const resetView = () => scene?.resetCamera()
const focusSquad = (squadId: number) => { input.selectSquad(squadId); scene?.focusSquad(squadId) }
const focusCompany = (companyId: number) => { input.selectCompany(companyId); scene?.focusCompany(companyId) }
const title = () => { input.reset(); menuOpen.value = false; gameStore.backToTitle() }
/** 開戦前（戦場で部隊編成をしている間）。 */
const deploying = computed(() => gameStore.status === 'deploying')

const menuOpen = ref(false)
const squadsOpen = ref(false)
const commandBar = ref<InstanceType<typeof CommandBar> | null>(null)
const menuSquad = computed(() => gameStore.squads.find(sq => sq.id === contextMenu.value.squadId))
const menuCompany = computed(() => gameStore.companies.find(c => c.id === contextMenu.value.companyId))
/** 決着の理由（砦を持たない軍は全滅、砦を持つ軍は本陣の陥落）。 */
const defeatReason = computed(() => {
  const loser: Army = gameStore.winner === 'player' ? 'cpu' : 'player'
  return gameStore.summary[loser].hasFort ? `${ARMY_NAME[loser]}の本陣が陥落した` : `${ARMY_NAME[loser]}が全滅した`
})

const onKey = (event: KeyboardEvent) => {
  if (gameStore.status === 'title' || deploying.value || event.target instanceof HTMLInputElement) return
  if (event.code === 'Space') {
    event.preventDefault()
    gameStore.togglePause()
  } else if (event.code === 'Escape') {
    if (input.cancelDrag()) return
    if (input.buildMode.value) input.cancelBuild()
    else if (menuOpen.value) menuOpen.value = false
    else commandBar.value?.closePopups()
  }
  else if (event.code === 'KeyR' && input.buildMode.value) input.rotateBuild()
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (!canvasRef.value) return
  try {
    const { createGameScene } = await import('~/render/gameScene')
    if (disposed || !canvasRef.value) return
    const created = await createGameScene({ canvasEl: canvasRef.value, gameStore, input })
    if (disposed) { created.destroy(); return }
    scene = created
    ready.value = true
  } catch (error) {
    console.error('3D scene initialization failed', error)
    loadError.value = '3D画面を初期化できませんでした。WebGL 2対応のブラウザーで再読み込みしてください。'
  }
})

onUnmounted(() => {
  disposed = true
  window.removeEventListener('keydown', onKey)
  scene?.destroy()
  scene = null
})
</script>

<template>
  <div class="game-container" @contextmenu.prevent>
    <div ref="canvasRef" class="canvas-wrapper"></div>
    <div v-if="loadError" class="loading-panel" role="alert">{{ loadError }}</div>
    <div v-else-if="!ready" class="loading-panel" role="status">戦場を準備しています…</div>
    <div v-else-if="gameStore.status === 'title'" class="title-screen">
      <div class="title-content">
        <p class="eyebrow">HUMANS VS MONSTERS</p>
        <h1>THE LAST BATTALION</h1>
        <p class="title-subtitle">数千の兵がぶつかり合う、最後の大会戦。</p>
        <div class="mode-select" role="radiogroup" aria-label="戦場の種類">
          <button v-for="m in MODES" :key="m.mode" role="radio" :aria-checked="selectedMode === m.mode" :class="{ active: selectedMode === m.mode }" @click="selectedMode = m.mode">{{ m.name }}</button>
        </div>
        <p class="mode-description">{{ modeDescription }}</p>
        <div v-if="mapSelectable" class="mode-select map-select" role="radiogroup" aria-label="地形">
          <button v-for="type in MAP_TYPES" :key="type" role="radio" :aria-checked="selectedMap === type" :class="{ active: selectedMap === type }" @click="selectedMap = type">{{ MAP_TYPE_NAME[type] }}</button>
        </div>
        <p class="mode-description map-description">地形: {{ MAP_TYPE_NAME[shownMap] }} — {{ MAP_TYPE_DESCRIPTION[shownMap] }}</p>
        <button class="start-button" @click="start()">開戦する <span>→</span></button>
        <button class="seed-button" @click="seedEntry = !seedEntry">特定の戦場（SEED）で開始</button>
        <form v-if="seedEntry" class="seed-form" @submit.prevent="start(customSeed)">
          <input v-model="customSeed" aria-label="SEED" placeholder="SEEDを入力" maxlength="32" autofocus>
          <button type="submit">開始</button>
        </form>
        <p class="title-help">中隊・小隊の旗をドラッグして指示 · 陣形は画面下の「全軍」から</p>
      </div>
    </div>
    <template v-if="ready && gameStore.status !== 'title'">
      <header class="battle-header">
        <ArmyStatus army="player" />
        <div class="clock"><TimePlate :day-time="gameStore.dayTime" /><span v-if="gameStore.status === 'paused'" class="paused-label">一時停止</span></div>
        <ArmyStatus army="cpu" />
      </header>
      <DeploymentEditor v-if="deploying" :key="`${gameStore.mode}:${gameStore.seed}`" :mode="gameStore.mode" :mode-name="MODE_NAME[gameStore.mode]" :plan="gameStore.plans[gameStore.mode]" :unit-names="UNIT_NAME.player"
        @change="plan => gameStore.previewPlan(plan)" @save="plan => gameStore.beginBattle(plan)" @close="title" />
      <SquadPanel v-else :selected-id="input.selectedSquadId.value" :selected-company-id="input.selectedCompanyId.value" :list-open="squadsOpen" @focus="focusSquad" @focus-company="focusCompany" />
      <CommandBar ref="commandBar" :input="input" :deploying="deploying" :menu-open="menuOpen" :squads-open="squadsOpen"
        @toggle-menu="menuOpen = !menuOpen" @toggle-squads="squadsOpen = !squadsOpen" @reset-view="resetView" />
      <BattleMenu v-if="menuOpen && !deploying" :mode-name="MODE_NAME[gameStore.mode]" :map-name="MAP_TYPE_NAME[gameStore.mapType]" @close="menuOpen = false" @title="title" />
    </template>
    <div v-if="gameStore.isGameOver && gameStore.status !== 'title'" class="overlay">
      <div class="modal">
        <h1>{{ gameStore.winner === 'player' ? '人間軍の勝利' : '魔王軍の勝利' }}</h1>
        <p>{{ defeatReason }}</p>
        <p>撃破数 人間軍 {{ gameStore.summary.player.killed }} / 魔王軍 {{ gameStore.summary.cpu.killed }}</p>
        <p v-if="gameStore.summary.cpu.deserted">魔王軍の逃走 {{ gameStore.summary.cpu.deserted }}</p>
        <div class="modal-actions">
          <button @click="start(undefined, false)">Restart</button>
          <button @click="title" class="secondary">Back to Title</button>
        </div>
      </div>
    </div>

    <!-- 長押しメニュー（no-life-kingと同じく表示中は一時停止） -->
    <div v-if="contextMenu.visible" ref="contextMenuRef" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
      <div class="context-menu-content">
        <template v-if="contextMenu.type === 'squad' && menuSquad">
          <span class="context-menu-title">{{ squadName(menuSquad) }}</span>
          <button v-for="action in squadActions(menuSquad.type)" :key="action.key" class="context-menu-item" @click="handleContextMenuAction(action.key)"><CommandIcon :name="action.icon" />{{ action.label }}</button>
        </template>
        <template v-if="contextMenu.type === 'company' && menuCompany">
          <span class="context-menu-title">{{ companyName(menuCompany) }}</span>
          <button v-for="action in companyActions(menuCompany.types)" :key="action.key" class="context-menu-item" @click="handleContextMenuAction(action.key)"><CommandIcon :name="action.icon" />{{ action.label }}</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-container { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background: #000; overflow: hidden; }
.canvas-wrapper { position: absolute; inset: 0; width: 100%; height: 100%; background: #000; display: flex; justify-content: center; align-items: center; }
.canvas-wrapper :deep(canvas) { width: 100% !important; height: 100% !important; display: block; touch-action: none; }
.overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 100; }
.modal { background: #1b252c; padding: 2rem 2.5rem; border-radius: 6px; text-align: center; color: #eee5cf; border: 1px solid #a48d5f; }
.modal h1 { font-family: Georgia, serif; font-weight: 400; letter-spacing: .08em; }
.modal p { color: #b9c2c1; font-size: 13px; }
.modal-actions { display: flex; gap: 1rem; justify-content: center; }
button { margin-top: 1rem; padding: 0.5rem 2rem; font-size: 1.2rem; background: #3a6ea8; border: none; color: white; border-radius: 0.5rem; cursor: pointer; transition: transform 0.1s; }
button.secondary { background: #7f8c8d; }
button:hover { transform: scale(1.05); }

.loading-panel { z-index: 10; max-width: 480px; padding: 32px; text-align: center; color: #ded5c0; }
.title-screen { position: absolute; inset: 0; display: grid; place-items: center; background: linear-gradient(0deg, #070c13ee, #0b111b44 70%), url('/images/title_bg.png') center / cover; z-index: 20; }
.title-content { text-align: center; padding: 28px; }
.eyebrow { font-size: 11px; letter-spacing: .28em; color: #c5af83; }
.title-content h1 { font-family: Georgia, serif; font-weight: 400; letter-spacing: .09em; font-size: clamp(36px, 6.5vw, 96px); margin: 18px 0; color: #f2e8cf; text-shadow: 0 3px 30px #000; }
.title-subtitle { color: #c6c7c4; font-size: 14px; letter-spacing: .12em; }
.mode-select { display: flex; justify-content: center; gap: 6px; margin-top: 34px; }
.mode-select button { margin: 0; padding: 8px 20px; font-size: 14px; letter-spacing: .12em; background: #1d242bcc; border: 1px solid #5d6466; border-radius: 3px; color: #c9ccc8; }
.mode-select button.active { border-color: #c2a875; color: #f2e8cf; background: #3a3121dd; }
.mode-select button:hover { transform: none; border-color: #c2a875; }
.mode-description { margin: 10px 0 0; min-height: 1.5em; color: #b2b8b7; font-size: 12px; letter-spacing: .06em; }
.map-select { flex-wrap: wrap; margin-top: 18px; }
.map-select button { padding: 6px 14px; font-size: 13px; letter-spacing: .08em; }
.start-button { margin: 22px auto 12px; display: block; border: 1px solid #c2a875; border-radius: 3px; background: #1d242bdd; color: #e9dab9; padding: 18px 55px; font-size: 16px; letter-spacing: .16em; }
.start-button span { margin-left: 25px; }
.seed-button { background: transparent; color: #aeb4b8; font-size: 12px; }
.seed-form { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.seed-form input { background: #101923; color: white; border: 1px solid #777; padding: 10px; border-radius: 3px; }
.seed-form button { margin: 0; font-size: 13px; padding: 8px 14px; }
.title-help { margin-top: 60px; color: #b2b8b7; font-size: 12px; }

.battle-header { position: absolute; top: 0; left: 0; right: 0; z-index: 7; display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 16px 28px; background: linear-gradient(#0b151dd9, #0b151d00); pointer-events: none; }
.battle-header > .army-status { pointer-events: auto; }
.clock { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: #e2cf9f; font-size: 11px; letter-spacing: .1em; }
.paused-label { margin-top: 2px; text-shadow: 0 1px 3px #000; }
.context-menu { position: fixed; z-index: 1000; background: #0e1d25f2; border: 1px solid #a48d5f; border-radius: 8px; box-shadow: 0 6px 18px #0009; min-width: 200px; padding: 4px 0 8px; color: #e4e2da; user-select: none; }
.context-menu-content { display: flex; flex-direction: column; }
.context-menu-title { padding: 8px 16px 3px; font-size: 10px; letter-spacing: .14em; color: #c5af83; }
.context-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 16px; background: none; border: none; color: #e4e2da; font-size: 13px; text-align: left; cursor: pointer; margin: 0; border-radius: 0; }
.context-menu-item .command-icon { width: 18px; height: 18px; color: #e2cf9f; }
.context-menu-item:hover { background: #22303a; color: #fff; transform: none; }

.canvas-wrapper :deep(.world-labels) { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.canvas-wrapper :deep(.world-labels[hidden]) { display: none; }
.canvas-wrapper :deep(.world-label) { position: absolute; left: 0; top: 0; padding: 5px 7px; color: var(--faction); font: 600 14px system-ui, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; user-select: none; text-shadow: 0 1px 3px #000, 0 0 5px #000, 1px 0 2px #000, -1px 0 2px #000; }
.canvas-wrapper :deep(.world-label[hidden]) { display: none; }
.canvas-wrapper :deep(.squad-label), .canvas-wrapper :deep(.company-label) { margin: 0; background: none; border: 0; border-radius: 0; cursor: pointer; pointer-events: auto; touch-action: none; font-size: 12px; display: flex; gap: 4px; align-items: baseline; }
.canvas-wrapper :deep(.squad-label .squad-count) { font-size: 10px; font-weight: 500; opacity: .85; }
.canvas-wrapper :deep(.squad-label .squad-ammo) { font-size: 9px; font-weight: 500; opacity: .75; }
.canvas-wrapper :deep(.squad-label.low-ammo .squad-ammo) { color: #ffcf6e; opacity: 1; }
.canvas-wrapper :deep(.squad-label:hover) { transform: none; }
.canvas-wrapper :deep(.squad-label.is-locked) { cursor: default; }
.canvas-wrapper :deep(.squad-label.cpu) { font-size: 11px; }
.canvas-wrapper :deep(.company-label) { padding: 3px 7px; border: 1px solid color-mix(in srgb, var(--faction) 65%, transparent); background: #0e1d25a8; border-radius: 3px; z-index: 1; }
.canvas-wrapper :deep(.company-label .company-count) { font-size: 10px; font-weight: 500; opacity: .85; }
.canvas-wrapper :deep(.company-label.compact) { padding: 2px 5px; font-size: 10px; opacity: .85; }
.canvas-wrapper :deep(.company-label.compact .company-count) { display: none; }
.canvas-wrapper :deep(.company-label.is-selected), .canvas-wrapper :deep(.company-label.is-target), .canvas-wrapper :deep(.company-label.is-hover), .canvas-wrapper :deep(.company-label:hover) { border-color: #eecf7d; opacity: 1; }
.canvas-wrapper :deep(.world-label.is-selected), .canvas-wrapper :deep(.world-label.is-target), .canvas-wrapper :deep(.squad-label:not(.is-locked):hover), .canvas-wrapper :deep(.squad-label.is-hover), .canvas-wrapper :deep(.company-label:hover), .canvas-wrapper :deep(.company-label.is-hover) { color: #fff4ca; text-shadow: 0 0 5px #eecf7d, 0 1px 3px #000; }
.canvas-wrapper :deep(.world-label.is-source) { color: #e3edff; }
.canvas-wrapper :deep(.construction-label) { font-size: 10px; font-weight: 500; opacity: .9; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.canvas-wrapper :deep(.construction-gauge) { display: block; width: 44px; height: 4px; background: #0b1216cc; border: 1px solid #000a; border-radius: 2px; overflow: hidden; box-shadow: 0 1px 3px #0008; }
.canvas-wrapper :deep(.construction-gauge-fill) { display: block; height: 100%; background: var(--faction); }
.canvas-wrapper :deep(.construction-label.damaged) { color: #ffcf6e; }
.canvas-wrapper :deep(.construction-label.damaged .construction-gauge-fill) { background: #ffcf6e; }
@media (max-width: 550px) { .battle-header { padding: 6px 8px 20px; } .clock { top: 8px; } .title-help { line-height: 2; } }
</style>
