<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '~/stores/game'
import { useBattleInput } from '~/composables/useBattleInput'
import TimePlate from './TimePlate.vue'
import DeploymentEditor from './DeploymentEditor.vue'
import ArmyStatus from './ArmyStatus.vue'
import BattleMenu from './BattleMenu.vue'
import CommandBar from './CommandBar.vue'
import CommandIcon from './CommandIcon.vue'
import TerrainIcon from './TerrainIcon.vue'
import SquadPanel from './SquadPanel.vue'
import { ARMY_NAME, UNIT_NAME, companyActions, companyName, squadActions, squadName } from './battleUi'
import type { GameScene } from '~/render/gameScene'
import { MAP_TYPE_DESCRIPTION, MAP_TYPE_NAME, MAP_TYPES, mapTypeForMode } from '~/game/mapType'
import type { Army, BattleMode, MapType } from '~/types/game'

const gameStore = useGameStore()
const titleLogo = ref('/images/title-logo.png')
const titleViewport = ref<HTMLElement | null>(null)
const titleContent = ref<HTMLElement | null>(null)
// Keep the original vertical layout fully visible, including an expanded SEED field.
// Transforms do not change layout measurements, so this cannot create a resize loop.
watch([titleViewport, titleContent], ([viewport, content], _previous, onCleanup) => {
  if (!viewport || !content) return
  const fit = () => {
    if (!content.offsetWidth || !content.offsetHeight) return
    const scale = Math.min(1, viewport.clientWidth / content.offsetWidth, viewport.clientHeight / content.offsetHeight)
    content.style.setProperty('--title-fit', String(scale))
  }
  const observer = new ResizeObserver(fit)
  observer.observe(viewport)
  observer.observe(content)
  fit()
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })
const LOGO_CANDIDATES: Record<string, string> = {
  a1: 'a1-last-standard.png',
  a2: 'a2-shieldwall.png',
  a3: 'a3-forged-wordmark.png',
  b1: 'b1-legion-seal.png',
  b2: 'b2-war-chronicle.png',
  b3: 'b3-blood-moon.png',
}
const canvasRef = ref<HTMLElement | null>(null)
const input = useBattleInput(gameStore)
const { contextMenuRef, contextMenu, handleContextMenuAction } = input

let scene: GameScene | null = null
let disposed = false
const ready = ref(false)
const loadError = ref('')
const customSeed = ref('')
const seedEntry = ref(false)
const seedInput = ref<HTMLInputElement | null>(null)
const toggleSeedEntry = async () => {
  seedEntry.value = !seedEntry.value
  if (seedEntry.value) {
    await nextTick()
    seedInput.value?.focus()
  }
}
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
  // ?logo=a1 などで、タイトル画面の背景・サイズのまま候補を比較する。
  const logoCandidate = new URLSearchParams(window.location.search).get('logo')
  if (logoCandidate && Object.hasOwn(LOGO_CANDIDATES, logoCandidate)) {
    titleLogo.value = `/images/candidate/${LOGO_CANDIDATES[logoCandidate]}`
  }
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
    <div v-else-if="gameStore.status === 'title'" ref="titleViewport" class="title-screen">
      <div ref="titleContent" class="title-content">
        <h1 class="title-heading">
          <img class="title-logo" :src="titleLogo" alt="THE LAST BATTALION" width="1942" height="809" fetchpriority="high" draggable="false">
        </h1>
        <form class="operation-sheet" aria-labelledby="operation-title" @submit.prevent="start(seedEntry ? customSeed.trim() || undefined : undefined)">
          <span class="board-corner top-left" aria-hidden="true"></span>
          <span class="board-corner top-right" aria-hidden="true"></span>
          <span class="board-corner bottom-right" aria-hidden="true"></span>
          <span class="board-corner bottom-left" aria-hidden="true"></span>
          <h2 id="operation-title" class="title-sr-only">作戦準備</h2>
          <fieldset class="operation-section" aria-describedby="mode-description">
            <legend class="title-sr-only">戦場の種類</legend>
            <div class="mode-select">
              <label v-for="m in MODES" :key="m.mode" class="mode-option">
                <input v-model="selectedMode" type="radio" name="battle-mode" :value="m.mode">
                <span class="mode-tile">
                  <CommandIcon :name="m.mode === 'field' ? 'army' : m.mode === 'siege' ? 'charge' : 'hold'" />
                  <span>{{ m.name }}</span>
                  <span class="selection-mark" aria-hidden="true">◆</span>
                </span>
              </label>
            </div>
            <p id="mode-description" class="mode-description">{{ modeDescription }}</p>
          </fieldset>
          <fieldset v-if="mapSelectable" class="operation-section terrain-section" aria-describedby="map-description">
            <legend class="title-sr-only">地形</legend>
            <div class="map-select">
              <label v-for="type in MAP_TYPES" :key="type" class="map-option">
                <input v-model="selectedMap" type="radio" name="battle-terrain" :value="type">
                <span class="map-tile">
                  <TerrainIcon :type="type" />
                  <span>{{ MAP_TYPE_NAME[type] }}</span>
                  <span class="selection-mark" aria-hidden="true">◆</span>
                </span>
              </label>
            </div>
            <p id="map-description" class="mode-description">{{ MAP_TYPE_DESCRIPTION[shownMap] }}</p>
          </fieldset>
          <div v-else class="fixed-terrain terrain-section">
            <TerrainIcon :type="shownMap" />
            <div><span class="fixed-terrain-label">指定地形 · {{ MAP_TYPE_NAME[shownMap] }}</span><p class="mode-description">{{ MAP_TYPE_DESCRIPTION[shownMap] }}</p></div>
          </div>
          <button type="submit" class="start-button">部隊編成へ <span aria-hidden="true">→</span></button>
          <div class="seed-options">
            <button type="button" class="seed-button" :aria-expanded="seedEntry" aria-controls="seed-entry" @click="toggleSeedEntry"><span aria-hidden="true">{{ seedEntry ? '−' : '+' }}</span> 特定の戦場を指定（SEED）</button>
            <div v-if="seedEntry" id="seed-entry" class="seed-entry">
              <label for="battle-seed" class="title-sr-only">戦場のSEED</label>
              <input id="battle-seed" ref="seedInput" v-model="customSeed" placeholder="空欄ならランダム" maxlength="32" autocomplete="off" autocapitalize="off" :spellcheck="false" aria-describedby="seed-help">
              <p id="seed-help" class="title-sr-only">入力後「部隊編成へ」で進みます。</p>
            </div>
          </div>
        </form>
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
      <div class="modal parchment-window">
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
    <div v-if="contextMenu.visible" ref="contextMenuRef" class="context-menu parchment-window" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
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
.modal { box-sizing: border-box; max-width: calc(100% - 24px); max-height: calc(100% - 24px); overflow-y: auto; padding: 1.5rem 2rem; text-align: center; color: #39291d; }
.modal h1 { font-family: Georgia, serif; font-weight: 400; letter-spacing: .08em; }
.modal p { color: #69533d; font-size: 13px; }
.modal-actions { display: flex; gap: 1rem; justify-content: center; }
button { margin-top: 1rem; padding: 0.5rem 2rem; font-size: 1.2rem; background: #3a6ea8; border: none; color: white; border-radius: 0.5rem; cursor: pointer; transition: transform 0.1s; }
button.secondary { background: #7f8c8d; }
button:hover { transform: scale(1.05); }

.loading-panel { z-index: 10; max-width: 480px; padding: 32px; text-align: center; color: #ded5c0; }
/* Preserve the original single-column title layout without a scrolling surface. */
.title-screen { position: absolute; inset: 0; max-height: 100dvh; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(0deg, #130e0ae8, #0b111b33 75%), url('/images/title_bg.png') center / cover; z-index: 20; }
.title-content { box-sizing: border-box; flex: none; width: 100%; max-width: 1120px; display: flex; flex-direction: column; align-items: center; gap: clamp(8px, 2vh, 20px); padding: clamp(10px, 2vh, 24px) clamp(10px, 3vw, 32px); text-align: center; transform: scale(var(--title-fit, 1)); transform-origin: center; }
.title-heading { width: 100%; margin: 0; line-height: 0; }
.title-logo { display: block; width: 100%; max-width: 1040px; height: auto; max-height: 36dvh; object-fit: contain; margin: 0 auto; filter: drop-shadow(0 4px 10px #000c) drop-shadow(0 0 24px #0008); }
.operation-sheet { position: relative; isolation: isolate; box-sizing: border-box; width: 100%; max-width: 680px; margin: 0; padding: 12px 24px 8px; border: 10px solid transparent; border-radius: 4px; background: linear-gradient(#130b0670, #130b069c) padding-box, url('/images/ui/command-walnut.png') center / 480px auto padding-box, linear-gradient(135deg, #bd8b4c88, #48281366 35%, #20100799 70%, #98622e66) border-box, url('/images/ui/command-walnut.png') center / 320px auto border-box; box-shadow: inset 0 0 0 1px #d6aa654d, inset 0 3px 9px #000a, 0 2px 0 #30190d, 0 5px 0 #170c07, 0 9px 18px #0009; color: #e1cba7; }
/* Beveled wooden edges and small brass corner brackets replace the paper outline. */
.operation-sheet::before { content: ''; position: absolute; inset: -7px; border: 1px solid #9f733e70; border-top-color: #d5a96c99; border-bottom-color: #1a0d08cc; border-radius: 2px; pointer-events: none; }
.board-corner { position: absolute; width: 18px; height: 18px; pointer-events: none; background: linear-gradient(135deg, #e2c184, #96703c 45%, #5b3b1c); clip-path: polygon(0 0, 100% 0, 100% 30%, 30% 30%, 30% 100%, 0 100%); }
.board-corner::after { content: ''; position: absolute; top: 2px; left: 2px; width: 3px; height: 3px; border-radius: 50%; background: #60401f; box-shadow: 0 1px 0 #f2d39b; }
.board-corner.top-left { top: -9px; left: -9px; }
.board-corner.top-right { top: -9px; right: -9px; transform: rotate(90deg); }
.board-corner.bottom-right { bottom: -9px; right: -9px; transform: rotate(180deg); }
.board-corner.bottom-left { bottom: -9px; left: -9px; transform: rotate(270deg); }
.operation-sheet :is(button, input):focus-visible { outline: 2px solid #f1d193; outline-offset: 3px; }
.title-sr-only, .mode-option input, .map-option input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.operation-section { min-width: 0; padding: 0; margin: 0; border: 0; }
.mode-select { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mode-option, .map-option { position: relative; min-width: 0; cursor: pointer; }
.mode-tile { box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px; border: 1px solid #94703d; border-top-color: #c9a767; border-radius: 3px; background: linear-gradient(#23140970, #160b05ad), url('/images/ui/command-walnut.png') center / 360px auto; box-shadow: inset 0 0 0 1px #d9b16a26, 0 2px 3px #59361733; color: #e5c78b; font-size: 14px; letter-spacing: .08em; }
.mode-tile :deep(.command-icon) { width: 20px; height: 20px; }
.selection-mark { font-size: 9px; opacity: 0; flex: none; }
.mode-option input:checked + .mode-tile { border-color: #7f5323; box-shadow: inset 0 0 0 2px #dab56e; color: #fff0c9; }
.mode-option input:checked + .mode-tile .selection-mark, .map-option input:checked + .map-tile .selection-mark { opacity: 1; }
.mode-option:hover .mode-tile { filter: brightness(1.15); }
.mode-option input:focus-visible + .mode-tile, .map-option input:focus-visible + .map-tile { outline: 2px solid #f1d193; outline-offset: 3px; }
.mode-description { margin: 6px 0 0; color: #d4bfa0; font-size: 12px; line-height: 1.5; text-wrap: pretty; }
.terrain-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid #c49b5959; }
.map-select { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
.map-tile { box-sizing: border-box; height: 100%; min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 3px; border: 1px solid #99713d55; border-radius: 2px; background: #130c0740; color: #dfc590; font-size: 12px; line-height: 1.3; }
.map-tile :deep(.terrain-icon) { width: 22px; height: 22px; }
.map-tile .selection-mark { font-size: 7px; }
.map-option:hover .map-tile { background: #b48a4540; }
.map-option input:checked + .map-tile { border-color: #d2ad69; background: #986a3159; color: #fff0cb; box-shadow: inset 0 -2px #d2ad69; }
.fixed-terrain { display: flex; justify-content: center; align-items: center; gap: 10px; color: #dfc590; }
.fixed-terrain-label { font-size: 12px; font-weight: 600; }
.fixed-terrain .mode-description { margin-top: 3px; }
.start-button { display: flex; align-items: center; justify-content: center; gap: 24px; width: min(100%, 320px); min-height: 48px; margin: 14px auto 6px; padding: 10px 24px; border: 2px solid #9e753e; border-top-color: #d7b571; border-bottom-color: #694520; border-radius: 3px; background: linear-gradient(#33201160, #150b04a6), url('/images/ui/command-walnut.png') center / 480px auto; box-shadow: inset 0 0 0 1px #e6c48745, 0 3px 6px #59361744; color: #f4dfac; font-size: 16px; font-weight: 600; letter-spacing: .14em; text-shadow: 0 1px 2px #000; }
.start-button span { color: #d9b56e; }
.title-screen button:hover { transform: none; }
.start-button:hover { filter: brightness(1.15); }
.seed-options { font-size: 11px; }
.seed-button { margin: 0; min-height: 30px; padding: 4px 8px; border-radius: 2px; background: none; color: #d4bfa0; font-size: 11px; }
.seed-button:hover { color: #fff0cb; text-decoration: underline; text-underline-offset: 3px; }
.seed-entry { display: flex; justify-content: center; margin-top: 4px; }
.seed-entry input { box-sizing: border-box; min-width: 0; width: min(100%, 320px); height: 34px; border: 1px solid #9e7b49; border-radius: 2px; background: #160d09cc; box-shadow: inset 0 2px 4px #0007; color: #f4e2bf; padding: 6px 10px; font: 16px system-ui, sans-serif; }
.seed-entry input::placeholder { color: #bba585; font-size: 12px; }
@media (max-width: 600px) {
  .operation-sheet { padding: 8px 8px 4px; }
  .mode-select { gap: 5px; }
  .mode-tile { gap: 4px; padding: 7px 4px; min-height: 40px; font-size: 12px; letter-spacing: .02em; }
  .mode-tile :deep(.command-icon) { width: 16px; height: 16px; }
  .map-tile { position: relative; flex-direction: column; gap: 3px; padding: 5px 2px 10px; font-size: 10px; }
  .map-tile .selection-mark { position: absolute; bottom: 1px; font-size: 6px; }
  .map-select { gap: 2px; }
  .mode-description { font-size: 11px; }
  .start-button { width: 100%; font-size: 14px; }
}
/* Compress spacing first; the measured fit only scales unusually short viewports. */
@media (max-height: 650px) {
  .title-content { gap: 6px; padding-block: 8px; }
  .title-logo { max-height: 27dvh; }
  .operation-sheet { padding-top: 6px; padding-bottom: 2px; }
  .terrain-section { margin-top: 6px; padding-top: 5px; }
  .mode-description { margin-top: 4px; font-size: 11px; }
  .start-button { min-height: 40px; margin-top: 8px; padding-block: 6px; }
  .seed-button { min-height: 26px; }
}
@media (max-height: 420px) {
  .title-logo { max-height: 20dvh; }
  .mode-tile { min-height: 32px; padding-block: 4px; }
  .map-tile { min-height: 30px; padding-block: 3px; flex-direction: row; }
  .map-tile :deep(.terrain-icon) { display: none; }
  .map-tile .selection-mark { position: static; }
  .start-button { min-height: 34px; margin-block: 6px 2px; }
}

.battle-header { position: absolute; top: 0; left: 0; right: 0; z-index: 7; display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 16px 28px; background: linear-gradient(#0b151dd9, #0b151d00); pointer-events: none; }
.battle-header > .army-status { pointer-events: auto; }
.clock { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: #e2cf9f; font-size: 11px; letter-spacing: .1em; }
.paused-label { margin-top: 2px; text-shadow: 0 1px 3px #000; }
.context-menu { position: fixed; z-index: 1000; min-width: 200px; padding: 2px 0 6px; color: #493522; user-select: none; }
.context-menu-content { display: flex; flex-direction: column; }
.context-menu-title { padding: 8px 16px 3px; font-size: 10px; letter-spacing: .14em; color: #70502d; }
.context-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 16px; background: none; border: none; color: #493522; font-size: 13px; text-align: left; cursor: pointer; margin: 0; border-radius: 0; }
.context-menu-item .command-icon { width: 18px; height: 18px; color: #684521; }
.context-menu-item:hover { background: #b58c4d33; color: #352315; transform: none; }

.canvas-wrapper :deep(.world-labels) { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.canvas-wrapper :deep(.world-labels[hidden]) { display: none; }
.canvas-wrapper :deep(.world-label) { position: absolute; left: 0; top: 0; padding: 5px 7px; color: var(--faction); font: 600 14px system-ui, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; user-select: none; text-shadow: 0 1px 3px #000, 0 0 5px #000, 1px 0 2px #000, -1px 0 2px #000; }
.canvas-wrapper :deep(.world-label[hidden]) { display: none; }
.canvas-wrapper :deep(.squad-label), .canvas-wrapper :deep(.company-label) { margin: 0; padding: 1px 3px; background: none; border: solid transparent; border-width: 6px 5px 5px; border-image: url('/images/ui/parchment-window-small.png') 160 100 130 fill / 6px 5px 5px / 0 stretch; border-radius: 0; cursor: pointer; pointer-events: auto; touch-action: none; font-size: 12px; line-height: 1.2; display: flex; gap: 4px; align-items: baseline; }
.canvas-wrapper :deep(.squad-label .squad-count) { font-size: 10px; font-weight: 500; opacity: .85; }
.canvas-wrapper :deep(.squad-label .squad-ammo) { font-size: 9px; font-weight: 500; opacity: .75; }
.canvas-wrapper :deep(.squad-label.low-ammo .squad-ammo) { color: #954319; opacity: 1; }
.canvas-wrapper :deep(.squad-label:hover) { transform: none; }
.canvas-wrapper :deep(.squad-label.is-locked) { cursor: default; }
.canvas-wrapper :deep(.squad-label.cpu) { font-size: 11px; }
.canvas-wrapper :deep(.company-label) { z-index: 1; }
.canvas-wrapper :deep(.company-label .company-count) { font-size: 10px; font-weight: 500; opacity: .85; }
.canvas-wrapper :deep(.company-label.compact) { padding: 0 2px; border-width: 4px 5px; border-image-width: 4px 5px; font-size: 10px; }
.canvas-wrapper :deep(.company-label.compact .company-count) { display: none; }
.canvas-wrapper :deep(.world-label.is-selected), .canvas-wrapper :deep(.world-label.is-target), .canvas-wrapper :deep(.squad-label:not(.is-locked):hover), .canvas-wrapper :deep(.squad-label.is-hover), .canvas-wrapper :deep(.company-label:hover), .canvas-wrapper :deep(.company-label.is-hover) { color: #fff4ca; text-shadow: 0 0 5px #eecf7d, 0 1px 3px #000; }
.canvas-wrapper :deep(.world-label.is-source) { color: #e3edff; }
/* Paper labels keep faction ink readable in every selection/drag state. */
.canvas-wrapper :deep(.world-label:is(.squad-label, .company-label)) { color: var(--label-ink, #493522); text-shadow: none; filter: drop-shadow(0 1px 2px #0008); }
.canvas-wrapper :deep(.world-label.player) { --label-ink: #274d7b; }
.canvas-wrapper :deep(.world-label.cpu) { --label-ink: #943c2b; }
.canvas-wrapper :deep(.world-label:is(.squad-label, .company-label):is(.is-selected, .is-target, .is-hover, .is-source, :focus-visible)), .canvas-wrapper :deep(.squad-label:not(.is-locked):hover), .canvas-wrapper :deep(.company-label:hover) { color: var(--label-ink, #493522); text-shadow: none; filter: drop-shadow(0 0 3px #ffd477) drop-shadow(0 1px 2px #0008); z-index: 2; }
.canvas-wrapper :deep(.world-label:is(.is-selected, .is-source) :is(.squad-name, .company-name)) { text-decoration: underline; text-underline-offset: 3px; }
.canvas-wrapper :deep(.world-label.is-target :is(.squad-name, .company-name)) { text-decoration: underline dashed; text-underline-offset: 3px; }
.canvas-wrapper :deep(.world-label:is(.squad-label, .company-label):focus-visible) { outline: 2px solid #70491f; outline-offset: 1px; }
.canvas-wrapper :deep(.construction-label) { font-size: 10px; font-weight: 500; opacity: .9; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.canvas-wrapper :deep(.construction-gauge) { display: block; width: 44px; height: 4px; background: #0b1216cc; border: 1px solid #000a; border-radius: 2px; overflow: hidden; box-shadow: 0 1px 3px #0008; }
.canvas-wrapper :deep(.construction-gauge-fill) { display: block; height: 100%; background: var(--faction); }
.canvas-wrapper :deep(.construction-label.damaged) { color: #ffcf6e; }
.canvas-wrapper :deep(.construction-label.damaged .construction-gauge-fill) { background: #ffcf6e; }
@media (max-width: 550px) { .battle-header { padding: 6px 8px 20px; } .clock { top: 8px; } }
</style>
