<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { GAME_SPEEDS, useGameStore } from '~/stores/game'
import { FORMATIONS } from '~/game/formation'
import type { BattleInput } from '~/composables/useBattleInput'
import type { CompanyOrder } from '~/game/battle'
import type { ConstructionKind, SquadOrder } from '~/types/game'
import ArmyMenu from './ArmyMenu.vue'
import CommandIcon from './CommandIcon.vue'
import { companyActions, companyName, squadActions, squadName, type SquadAction } from './battleUi'

/** 画面下中央の操作バー。左は選んでいるものへの指示（何も選んでいなければ全軍）、右は進行の操作。上に一言のヒントを出す。 */
const props = defineProps<{ input: BattleInput; deploying: boolean; menuOpen: boolean; squadsOpen: boolean }>()
const emit = defineEmits<{ toggleMenu: []; toggleSquads: []; resetView: [] }>()
const gameStore = useGameStore()
const root = ref<HTMLElement | null>(null)
const armyOpen = ref(false)

const selected = computed(() => gameStore.squads.find(sq => sq.id === props.input.selectedSquadId.value))
const selectedCompany = computed(() => gameStore.companies.find(c => c.id === props.input.selectedCompanyId.value))
/** 中隊の指示が出ているか（中隊の小隊がみなその指示で動いているか）。 */
const isCompanyActive = (action: SquadAction) => {
  const company = selectedCompany.value
  return !!company && company.squadIds.length > 0 && company.squadIds.every(id => gameStore.squads.find(sq => sq.id === id)?.order === action.order)
}
const runCompanyAction = (action: SquadAction) => {
  const company = selectedCompany.value
  if (company && action.order) gameStore.orderCompany(company.id, { order: action.order as CompanyOrder })
}
const buildMode = computed(() => props.input.buildMode.value)
const paused = computed(() => gameStore.status === 'paused')
const formationName = computed(() => FORMATIONS.find(f => f.type === gameStore.formation)?.name ?? '')

const isActive = (action: SquadAction) => action.build
  ? buildMode.value?.squadId === selected.value?.id && buildMode.value?.kind === action.build
  : selected.value?.order === action.order
const runAction = (action: SquadAction) => {
  const squad = selected.value
  if (!squad) return
  if (action.build) {
    if (isActive(action)) props.input.cancelBuild()
    else props.input.startBuild(squad.id, action.build)
  } else if (action.order) gameStore.orderSquad(squad.id, action.order)
}
const deselect = () => { props.input.cancelBuild(); props.input.selectSquad(null); props.input.selectCompany(null) }
const nextSpeed = () => {
  const index = GAME_SPEEDS.indexOf(gameStore.gameSpeed)
  gameStore.setGameSpeed(GAME_SPEEDS[(index + 1) % GAME_SPEEDS.length]!)
}
const setFormation = (type: Parameters<typeof gameStore.setFormation>[0]) => { gameStore.setFormation(type); armyOpen.value = false }
const orderArmy = (order: 'charge' | 'hold' | 'retreat') => { gameStore.orderArmy(order); armyOpen.value = false }

const BUILD_HINT: Record<ConstructionKind, string> = {
  outpost: '拠点（補給できる陣地）を建てる場所をクリック',
  barricade: '柵を置く場所をクリック · R で向きを変える',
  bridge: '橋を架ける川をクリック',
}
const DROP_NAME: Partial<Record<SquadOrder, string>> = { move: 'ここへ移動', attack: '攻撃', demolish: '建設物を破壊', occupy: '拠点を占領', support: '補給を届ける', retreat: '自陣へ退却', charge: '敵陣へ突撃' }
/** その場で必要な操作だけを一言で示す。 */
const hint = computed(() => {
  if (props.deploying) return '右の編成で部隊を整えて開戦'
  const mode = buildMode.value
  if (mode) return `${BUILD_HINT[mode.kind]} · Esc で取り消し`
  const dragging = props.input.dragging.value
  if (props.input.draggingCompany.value !== null) {
    const command = props.input.previewCompanyCommand()
    const name = command ? DROP_NAME[command.order as SquadOrder] : ''
    return `離すと中隊ごと${name ? `「${name}」` : '指示'} · 敵の中隊・小隊で攻撃 · 自陣で退却 · 敵陣で突撃`
  }
  if (typeof dragging === 'number') {
    const command = props.input.previewCommand()
    const name = command?.order === 'build' ? (command.kind === 'bridge' ? '橋を架ける' : '建設・修理') : command ? DROP_NAME[command.order] : ''
    return `離すと${name ? `「${name}」` : '指示'} · 敵部隊で攻撃 · 自陣で退却 · 敵陣で突撃`
  }
  if (paused.value) return '一時停止中 · 停止中も指示できます'
  const squad = selected.value
  if (squad?.owner === 'player') {
    if (squad.type === 'engineer') return '旗をドラッグして指示 · 川へドラッグで橋を架ける · 敵の拠点へドラッグで占領'
    if (squad.type === 'supply') return '旗をドラッグして指示 · 味方の部隊へドラッグで補給を届ける'
    return '旗をドラッグして指示 · 長押しでメニュー'
  }
  if (selectedCompany.value?.owner === 'player') return '中隊の旗をドラッグして中隊ごと指示 · 長押しでメニュー'
  return '中隊・小隊の旗をドラッグして指示 · 長押しでメニュー · 陣形は「全軍」から'
})

const closeOnOutside = (event: PointerEvent) => {
  if (armyOpen.value && !root.value?.contains(event.target as Node)) armyOpen.value = false
}
onMounted(() => window.addEventListener('pointerdown', closeOnOutside))
onUnmounted(() => window.removeEventListener('pointerdown', closeOnOutside))
defineExpose({ closePopups: () => { armyOpen.value = false } })
</script>

<template>
  <div ref="root" class="command-dock">
    <p class="command-hint parchment-window" role="status">
      <span :key="hint" class="hint-text">{{ hint }}</span>
      <span v-if="input.buildError.value" class="build-error">{{ input.buildError.value }}</span>
    </p>
    <div class="command-bar-wrap">
    <div v-if="armyOpen && !deploying" class="command-popup parchment-window">
      <ArmyMenu :formation="gameStore.formation" @formation="setFormation" @order="orderArmy" />
    </div>
    <nav class="command-bar" aria-label="操作">
      <template v-if="!deploying">
        <div class="command-group">
          <template v-if="selected">
            <button class="command squad-name" :class="selected.owner" :title="`${squadName(selected)}の選択を外す`" :aria-label="`${squadName(selected)}の選択を外す`" @click="deselect">
              <CommandIcon name="close" /><span class="label">{{ squadName(selected) }}</span>
            </button>
            <template v-if="selected.owner === 'player'">
              <button v-for="action in squadActions(selected.type)" :key="action.key" class="command" :class="{ active: isActive(action) }" :aria-pressed="isActive(action)" :title="action.label" @click="runAction(action)">
                <CommandIcon :name="action.icon" /><span class="label">{{ action.label }}</span>
              </button>
              <button v-if="buildMode?.kind === 'barricade'" class="command" @click="input.rotateBuild()">
                <CommandIcon name="rotate" /><span class="label">向き · {{ buildMode.axis === 'y' ? '南北' : '東西' }}</span>
              </button>
            </template>
          </template>
          <template v-else-if="selectedCompany">
            <button class="command squad-name" :class="selectedCompany.owner" :title="`${companyName(selectedCompany)}の選択を外す`" :aria-label="`${companyName(selectedCompany)}の選択を外す`" @click="deselect">
              <CommandIcon name="close" /><span class="label">{{ companyName(selectedCompany) }}</span>
            </button>
            <template v-if="selectedCompany.owner === 'player'">
              <button v-for="action in companyActions(selectedCompany.types)" :key="action.key" class="command" :class="{ active: isCompanyActive(action) }" :aria-pressed="isCompanyActive(action)" :title="action.label" @click="runCompanyAction(action)">
                <CommandIcon :name="action.icon" /><span class="label">{{ action.label }}</span>
              </button>
            </template>
          </template>
          <button v-else class="command army" :class="{ active: armyOpen }" :aria-expanded="armyOpen" @click="armyOpen = !armyOpen">
            <CommandIcon name="army" /><span class="label">全軍 · {{ formationName }} ▴</span>
          </button>
        </div>
        <div class="command-divider" aria-hidden="true"></div>
        <div class="command-group">
          <button class="command" :class="{ active: squadsOpen }" :aria-pressed="squadsOpen" @click="emit('toggleSquads')"><CommandIcon name="squads" /><span class="label">部隊</span></button>
          <button class="command" :class="{ active: paused }" :aria-pressed="paused" @click="gameStore.togglePause()"><CommandIcon :name="paused ? 'play' : 'pause'" /><span class="label">{{ paused ? '再開' : '停止' }}</span></button>
          <button class="command" :aria-label="`ゲーム速度 ×${gameStore.gameSpeed}（押すと切り替え）`" @click="nextSpeed"><CommandIcon name="speed" /><span class="label">×{{ gameStore.gameSpeed }}</span></button>
        </div>
      </template>
      <div class="command-group">
        <button class="command" @click="emit('resetView')"><CommandIcon name="view" /><span class="label">視点</span></button>
        <button v-if="!deploying" class="command" :class="{ active: menuOpen }" :aria-expanded="menuOpen" @click="emit('toggleMenu')"><CommandIcon name="menu" /><span class="label">メニュー</span></button>
      </div>
    </nav>
    </div>
  </div>
</template>

<style scoped>
.command-dock { position: absolute; z-index: 8; left: 50%; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; width: max-content; max-width: calc(100% - 16px); pointer-events: none; }
.command-hint { box-sizing: border-box; max-width: 100%; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 2px 10px; border-width: 7px 9px 6px; border-image-width: 7px 9px 6px; color: #493522; font-size: 12px; line-height: 1.45; letter-spacing: .03em; text-align: center; text-wrap: pretty; filter: drop-shadow(0 2px 3px #0006); }
.build-error { color: #90391f; font-size: 11px; font-weight: 600; }
.hint-text { animation: hint-in .2s ease-out; }
@keyframes hint-in { from { opacity: 0; } }
/* The frame stays fixed while the controls inside can scroll horizontally. */
.command-bar-wrap { position: relative; box-sizing: border-box; min-width: 0; max-width: 100%; border: 2px solid #96703e; border-top-color: #d0ae6a; border-bottom-color: #634522; border-radius: 5px; background: linear-gradient(#160c0670, #130a04a6), url('/images/ui/command-walnut.png') center / 480px auto repeat; box-shadow: inset 0 0 0 1px #e0b76d4d, inset 0 0 12px #0009, 0 5px 14px #0009; }
.command-bar-wrap::after { content: ''; position: absolute; inset: 3px; pointer-events: none; background: radial-gradient(circle at 3px 3px, #edce88 0 1px, #886132 1.5px 2.5px, transparent 3px) top left, radial-gradient(circle at 3px 3px, #edce88 0 1px, #886132 1.5px 2.5px, transparent 3px) top right, radial-gradient(circle at 3px 3px, #edce88 0 1px, #886132 1.5px 2.5px, transparent 3px) bottom left, radial-gradient(circle at 3px 3px, #edce88 0 1px, #886132 1.5px 2.5px, transparent 3px) bottom right; background-size: 6px 6px; background-repeat: no-repeat; }
.command-popup { position: absolute; z-index: 2; left: 0; bottom: calc(100% + 12px); box-sizing: border-box; max-height: calc(100dvh - 180px); overflow-y: auto; pointer-events: auto; padding: 2px 0 6px; }
.command-bar { box-sizing: border-box; pointer-events: auto; display: flex; align-items: stretch; gap: 3px; max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: #9d7845 #20130b; padding: 8px 10px; }
.command-bar::-webkit-scrollbar { height: 4px; }
.command-bar::-webkit-scrollbar-thumb { background: #9d7845; }
.command-bar::-webkit-scrollbar-track { background: #20130b; }
.command-group { display: flex; flex: none; gap: 3px; }
.command-divider { width: 1px; margin: 7px 6px; background: linear-gradient(transparent, #d4ae69 25%, #97703b 75%, transparent); box-shadow: 1px 0 #0008; flex: none; }
.command { box-sizing: border-box; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-width: 62px; min-height: 58px; margin: 0; padding: 4px 5px 3px; background: linear-gradient(#d8af6120, #09050233); border: solid transparent; border-width: 6px 5px; border-radius: 3px; box-shadow: inset 0 0 0 1px #b78c4933; color: #e2c58a; font: 11px system-ui, sans-serif; letter-spacing: .04em; white-space: nowrap; cursor: pointer; text-shadow: 0 1px 2px #000; transition: color .12s, box-shadow .12s; }
.command :deep(.command-icon) { background: linear-gradient(#f0d99e, #bb8d48); }
.command:hover { color: #fff0c6; box-shadow: inset 0 0 0 1px #d2ab66aa, inset 0 0 14px #d8af6126; transform: none; }
.command.active, .command.squad-name { border-image: url('/images/ui/parchment-window-small.png') 160 100 130 fill / 6px 5px / 0 stretch; border-radius: 0; background: none; box-shadow: none; color: #49311b; text-shadow: none; }
.command.active :deep(.command-icon), .command.squad-name :deep(.command-icon) { background: currentColor; }
.command.active .label { font-weight: 700; }
.command.active:hover, .command.squad-name:hover { color: #28190c; filter: brightness(1.05); }
.command.squad-name { color: #274d7b; }
.command.squad-name.cpu { color: #943c2b; }
.command.squad-name .label { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.command:focus-visible { outline: 2px solid #ffe0a0; outline-offset: 1px; }
@media (max-width: 900px) {
  .command { min-width: 52px; min-height: 54px; padding: 3px; font-size: 10px; gap: 4px; }
  .command-hint { font-size: 11px; padding: 2px 6px; }
  .command.squad-name .label { max-width: 90px; }
}
@media (max-width: 550px) {
  .command-dock { max-width: calc(100% - 12px); }
  .command-bar { padding: 7px 8px; }
  .command { min-width: 50px; font-size: 9px; }
  .command-divider { margin-inline: 3px; }
  .command-hint { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .hint-text { animation: none; }
  .command { transition: none; }
}
</style>
