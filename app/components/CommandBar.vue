<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { GAME_SPEEDS, useGameStore } from '~/stores/game'
import { FORMATIONS } from '~/game/formation'
import type { BattleInput } from '~/composables/useBattleInput'
import type { ConstructionKind, SquadOrder } from '~/types/game'
import ArmyMenu from './ArmyMenu.vue'
import CommandIcon from './CommandIcon.vue'
import { squadActions, squadName, type SquadAction } from './battleUi'

/** 画面下中央の操作バー。左は選んでいるものへの指示（何も選んでいなければ全軍）、右は進行の操作。上に一言のヒントを出す。 */
const props = defineProps<{ input: BattleInput; deploying: boolean; menuOpen: boolean; squadsOpen: boolean }>()
const emit = defineEmits<{ toggleMenu: []; toggleSquads: []; resetView: [] }>()
const gameStore = useGameStore()
const root = ref<HTMLElement | null>(null)
const armyOpen = ref(false)

const selected = computed(() => gameStore.squads.find(sq => sq.id === props.input.selectedSquadId.value))
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
const deselect = () => { props.input.cancelBuild(); props.input.selectSquad(null) }
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
const DROP_NAME: Partial<Record<SquadOrder, string>> = { move: 'ここへ移動', attack: '攻撃', demolish: '建設物を破壊', support: '補給を届ける', retreat: '自陣へ退却', charge: '敵陣へ突撃' }
/** その場で必要な操作だけを一言で示す。 */
const hint = computed(() => {
  if (props.deploying) return '右の編成で部隊を整えて開戦'
  const mode = buildMode.value
  if (mode) return `${BUILD_HINT[mode.kind]} · Esc で取り消し`
  const dragging = props.input.dragging.value
  if (dragging === 'army') return '離した場所へ陣全体を動かす'
  if (typeof dragging === 'number') {
    const command = props.input.previewCommand()
    const name = command?.order === 'build' ? (command.kind === 'bridge' ? '橋を架ける' : '建設・修理') : command ? DROP_NAME[command.order] : ''
    return `離すと${name ? `「${name}」` : '指示'} · 敵部隊で攻撃 · 自陣で退却 · 敵陣で突撃`
  }
  if (paused.value) return '一時停止中 · 停止中も指示できます'
  const squad = selected.value
  if (squad?.owner === 'player') {
    if (squad.type === 'engineer') return '旗をドラッグして指示 · 川へドラッグで橋を架ける'
    if (squad.type === 'supply') return '旗をドラッグして指示 · 味方の部隊へドラッグで補給を届ける'
    return '旗をドラッグして指示 · 長押しでメニュー'
  }
  return '部隊の旗をドラッグして指示 · 全軍の旗で陣を動かす · 長押しでメニュー'
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
    <p class="command-hint" role="status">
      <span :key="hint" class="hint-text">{{ hint }}</span>
      <span v-if="input.buildError.value" class="build-error">{{ input.buildError.value }}</span>
    </p>
    <div class="command-bar-wrap">
    <div v-if="armyOpen && !deploying" class="command-popup">
      <ArmyMenu :formation="gameStore.formation" @formation="setFormation" @order="orderArmy" />
    </div>
    <nav class="command-bar" aria-label="操作">
      <template v-if="!deploying">
        <div class="command-group">
          <template v-if="selected">
            <button class="command squad-name" :class="selected.owner" :title="`${squadName(selected)}の選択を外す`" @click="deselect">
              <CommandIcon name="close" /><span class="label">{{ squadName(selected) }}</span>
            </button>
            <template v-if="selected.owner === 'player'">
              <button v-for="action in squadActions(selected.type)" :key="action.key" class="command" :class="{ active: isActive(action) }" :aria-pressed="isActive(action)" @click="runAction(action)">
                <CommandIcon :name="action.icon" /><span class="label">{{ action.label }}</span>
              </button>
              <button v-if="buildMode?.kind === 'barricade'" class="command" @click="input.rotateBuild()">
                <CommandIcon name="rotate" /><span class="label">向き · {{ buildMode.axis === 'y' ? '南北' : '東西' }}</span>
              </button>
            </template>
          </template>
          <button v-else class="command army" :class="{ active: armyOpen }" :aria-expanded="armyOpen" @click="armyOpen = !armyOpen">
            <CommandIcon name="army" /><span class="label">全軍 · {{ formationName }} ▴</span>
          </button>
        </div>
        <div class="command-divider"></div>
        <div class="command-group">
          <button class="command" :class="{ active: squadsOpen }" :aria-pressed="squadsOpen" @click="emit('toggleSquads')"><CommandIcon name="squads" /><span class="label">部隊</span></button>
          <button class="command" :class="{ active: paused }" @click="gameStore.togglePause()"><CommandIcon :name="paused ? 'play' : 'pause'" /><span class="label">{{ paused ? '再開' : '停止' }}</span></button>
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
.command-dock { position: absolute; z-index: 8; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: calc(100% - 16px); pointer-events: none; }
.command-hint { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 18px; background: #0b151dd9; border: 1px solid #44545a; border-radius: 999px; color: #e4e2da; font-size: 12px; letter-spacing: .04em; text-align: center; text-shadow: 0 1px 2px #000; }
.build-error { color: #ffb39f; font-size: 11px; }
.hint-text { animation: hint-in .2s ease-out; }
@keyframes hint-in { from { opacity: 0; } }
.command-bar-wrap { position: relative; max-width: 100%; }
.command-popup { position: absolute; left: 0; bottom: calc(100% + 8px); pointer-events: auto; padding: 4px 0 8px; background: #0e1d25f2; border: 1px solid #a48d5f; border-radius: 8px; box-shadow: 0 6px 18px #0009; }
.command-bar { pointer-events: auto; display: flex; align-items: stretch; gap: 2px; max-width: 100%; overflow-x: auto; scrollbar-width: none; padding: 6px; background: #0e1d25ee; border: 1px solid #a48d5f; border-radius: 10px; box-shadow: 0 6px 20px #0008; }
.command-group { display: flex; gap: 2px; }
.command-divider { width: 1px; margin: 6px 5px; background: #44545a; flex: none; }
.command { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-width: 58px; margin: 0; padding: 8px 8px 6px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: #e2cf9f; font: 11px system-ui, sans-serif; letter-spacing: .04em; white-space: nowrap; cursor: pointer; transition: background .12s, border-color .12s; }
.command:hover { border-color: #5d6466; background: #17262f; transform: none; }
.command.active { border-color: #c2a875; background: #3a3121; color: #f2e8cf; }
.command.squad-name { color: #9fc0f5; }
.command.squad-name.cpu { color: #f1907f; }
@media (max-width: 900px) {
  .command { min-width: 44px; padding: 8px 6px; }
  .command .label { display: none; }
  .command.army .label, .command.squad-name .label { display: inline; }
  .command-hint { font-size: 11px; padding: 6px 12px; }
}
@media (max-width: 550px) { .command.army .label, .command.squad-name .label { display: none; } }
</style>
