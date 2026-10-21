<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { GAME_SPEEDS, useGameStore } from '~/stores/game'
import { useBattleInput } from '~/composables/useBattleInput'
import { FORMATIONS } from '~/game/formation'
import { CONSTRUCTION } from '~/game/battleConfig'
import TimePlate from './TimePlate.vue'
import DeploymentEditor from './DeploymentEditor.vue'
import type { GameScene } from '~/render/gameScene'
import { MAP_TYPE_DESCRIPTION, MAP_TYPE_NAME, MAP_TYPES, mapTypeForMode } from '~/game/mapType'
import type { Army, BattleMode, ConstructionKind, MapType, SquadOrder, UnitType } from '~/types/game'

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
const title = () => { input.reset(); gameStore.backToTitle() }
/** 開戦前（戦場で部隊編成をしている間）。 */
const deploying = computed(() => gameStore.status === 'deploying')

const ARMY_NAME: Record<Army, string> = { player: '人間軍', cpu: '魔王軍' }
const UNIT_NAME: Record<Army, Record<UnitType, string>> = {
  player: { infantry: '歩兵', pikeman: '槍兵', archer: '弓兵', cavalry: '騎兵', supply: '補給兵', engineer: '工兵' },
  cpu: { infantry: 'オーク歩兵', pikeman: 'オーク槍兵', archer: 'ゴブリン弓兵', cavalry: '狼騎兵', supply: 'ゴブリン運び手', engineer: 'オーク工兵' },
}
const ORDER_NAME: Record<SquadOrder, string> = { formation: '陣形', move: '移動', hold: '待機', attack: '攻撃', charge: '突撃', retreat: '退却', resupply: '補給中', support: '補給', build: '建設', demolish: '破壊' }
const TIRED_BELOW = 40
type SquadAction = { key: string; label: string; order?: SquadOrder; build?: ConstructionKind }
const BUILD_ACTIONS: SquadAction[] = [
  { key: 'build:outpost', build: 'outpost', label: '拠点を建設' }, { key: 'build:barricade', build: 'barricade', label: 'バリケードを建設' },
  { key: 'build:bridge', build: 'bridge', label: '橋を架ける' },
]
/** 部隊への指示（長押しメニュー・部隊パネル共通）。どの部隊も補給に戻れ、補給部隊は突撃の代わりに自動補給、工兵は突撃の代わりに建設。 */
const squadActions = (type: UnitType): SquadAction[] => [
  ...(type === 'engineer' ? BUILD_ACTIONS : [type === 'supply' ? { key: 'support', order: 'support' as const, label: '自動補給' } : { key: 'charge', order: 'charge' as const, label: '突撃' }]),
  ...([['hold', '待機'], ['formation', '陣形に戻る'], ['retreat', '退却'], ['resupply', '補給に戻る']] as const).map(([order, label]) => ({ key: order, order, label })),
]
const runAction = (squadId: number, action: SquadAction) => {
  if (action.build) input.startBuild(squadId, action.build)
  else if (action.order) gameStore.orderSquad(squadId, action.order)
}
const BUILD_HINT: Record<ConstructionKind, string> = {
  outpost: '拠点（補給できる陣地）を建てる場所をクリック',
  barricade: 'バリケードを置く場所をクリック · R で向きを変える',
  bridge: '橋を架ける川をクリック',
}
const buildingSquad = computed(() => gameStore.squads.find(sq => sq.id === input.buildMode.value?.squadId))
const constructionStatus = (squad: { order: SquadOrder; construction: { kind: ConstructionKind; progress: number; hp: number; complete: boolean } | null }) => {
  const site = squad.construction
  if (!site) return ''
  const name = CONSTRUCTION[site.kind].name
  if (squad.order === 'demolish') return `${name}を破壊中（耐久${site.hp}%）`
  return site.complete ? `${name}を修理中（耐久${site.hp}%）` : `${name}を建設中 ${site.progress}%`
}
const ammo = (squad: { arrows: number; maxArrows: number }) => squad.maxArrows > 0 ? `矢 ${squad.arrows} / ${squad.maxArrows}` : ''
/** 部隊一覧の状態欄（指示・矢・補給回数・体力）。 */
const squadStatus = (squad: { order: SquadOrder; arrows: number; maxArrows: number; stamina: number; supplies: number; maxSupplies: number; construction: { progress: number; complete: boolean } | null }) => {
  if (squad.order === 'resupply') return ORDER_NAME.resupply
  const parts = [ORDER_NAME[squad.order]]
  if (squad.construction && squad.order === 'build') parts.push(squad.construction.complete ? '修理' : `${squad.construction.progress}%`)
  if (squad.maxArrows > 0) parts.push(`矢${Math.round(squad.arrows / squad.maxArrows * 100)}%`)
  if (squad.maxSupplies > 0) parts.push(`残${squad.supplies}回`)
  if (squad.stamina < TIRED_BELOW) parts.push('疲労')
  return parts.join('・')
}
const ARMY_ACTIONS: { order: 'charge' | 'hold' | 'retreat'; label: string }[] = [
  { order: 'charge', label: '全軍突撃' }, { order: 'hold', label: '全軍待機' }, { order: 'retreat', label: '全軍退却' },
]
const armies: Army[] = ['player', 'cpu']
const types: UnitType[] = ['infantry', 'pikeman', 'archer', 'cavalry', 'supply', 'engineer']
const percent = (value: number, max: number) => `${Math.max(0, Math.min(100, value / max * 100))}%`
const squadName = (squad: { owner: Army; type: UnitType; number: number }) => `第${squad.number}${UNIT_NAME[squad.owner][squad.type]}隊`
const selectedSquad = computed(() => gameStore.squads.find(sq => sq.id === input.selectedSquadId.value))
const menuSquad = computed(() => gameStore.squads.find(sq => sq.id === contextMenu.value.squadId))
const playerSquads = computed(() => gameStore.squads.filter(sq => sq.owner === 'player'))
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
    if (!input.cancelDrag() && input.buildMode.value) input.cancelBuild()
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
        <p class="title-help">部隊の旗をドラッグして指示 · 全軍の旗で陣を動かす</p>
      </div>
    </div>
    <template v-if="ready && gameStore.status !== 'title'">
      <header class="battle-header">
        <div class="battle-brand"><span class="eyebrow">THE LAST BATTALION</span><span class="seed-readout">{{ MODE_NAME[gameStore.mode] }} · {{ MAP_TYPE_NAME[gameStore.mapType] }} · SEED {{ gameStore.seed }}</span></div>
        <div class="clock"><TimePlate :day-time="gameStore.dayTime" /><span v-if="gameStore.status === 'paused'" class="paused-label">一時停止</span></div>
        <div class="battle-actions">
          <template v-if="!deploying">
          <button @click="gameStore.togglePause()" :aria-label="gameStore.status === 'paused' ? '再開' : '一時停止'">{{ gameStore.status === 'paused' ? '再開' : '一時停止' }}</button>
          <div class="speed-control" role="group" aria-label="ゲーム速度">
            <button v-for="speed in GAME_SPEEDS" :key="speed" :class="{ active: gameStore.gameSpeed === speed }" :aria-pressed="gameStore.gameSpeed === speed" @click="gameStore.setGameSpeed(speed)">×{{ speed }}</button>
          </div>
          </template>
          <button @click="resetView" aria-label="視点をリセット">視点リセット</button>
        </div>
      </header>
      <DeploymentEditor v-if="deploying" :key="`${gameStore.mode}:${gameStore.seed}`" :mode="gameStore.mode" :mode-name="MODE_NAME[gameStore.mode]" :plan="gameStore.plans[gameStore.mode]" :unit-names="UNIT_NAME.player"
        @change="plan => gameStore.previewPlan(plan)" @save="plan => gameStore.beginBattle(plan)" @close="title" />
      <template v-else>
      <aside class="army-panel" aria-label="両軍の戦況">
        <section v-for="army in armies" :key="army" :class="['army', army]">
          <div class="army-title"><span>{{ ARMY_NAME[army] }}</span><b>{{ gameStore.summary[army].total }}</b></div>
          <div v-if="gameStore.summary[army].hasFort" class="fort-bar" :aria-label="`本陣の耐久 ${Math.ceil(gameStore.summary[army].fortHp)}`">
            <span :style="{ width: percent(gameStore.summary[army].fortHp, gameStore.summary[army].fortMaxHp) }"></span>
          </div>
          <p v-else class="no-fort">砦なし · 全滅で敗北</p>
          <dl>
            <template v-for="type in types" :key="type"><dt>{{ UNIT_NAME[army][type] }}</dt><dd>{{ gameStore.summary[army][type] }}</dd></template>
            <template v-if="gameStore.summary[army].hasFort"><dt>予備兵</dt><dd>{{ gameStore.summary[army].reserves }}</dd></template>
            <dt>撃破</dt><dd>{{ gameStore.summary[army].killed }}</dd>
          </dl>
        </section>
      </aside>
      <aside class="squad-panel" aria-label="部隊">
        <div v-if="selectedSquad" class="squad-detail" role="status">
          <span class="unit-name" :class="selectedSquad.owner">{{ ARMY_NAME[selectedSquad.owner] }} · {{ squadName(selectedSquad) }}</span>
          <span>{{ ORDER_NAME[selectedSquad.order] }} · {{ selectedSquad.count }} / {{ selectedSquad.size }}人</span>
          <div class="hp-bar"><span :style="{ width: percent(selectedSquad.count, selectedSquad.size) }"></span></div>
          <span>体力 {{ selectedSquad.stamina }} / 100<template v-if="selectedSquad.stamina < TIRED_BELOW">（疲労）</template></span>
          <div class="hp-bar stamina-bar" :class="{ tired: selectedSquad.stamina < TIRED_BELOW }"><span :style="{ width: percent(selectedSquad.stamina, 100) }"></span></div>
          <template v-if="selectedSquad.maxArrows > 0">
            <span>{{ ammo(selectedSquad) }}</span>
            <div class="hp-bar ammo-bar"><span :style="{ width: percent(selectedSquad.arrows, selectedSquad.maxArrows) }"></span></div>
          </template>
          <span v-if="selectedSquad.maxSupplies > 0">補給 残り {{ selectedSquad.supplies }} / {{ selectedSquad.maxSupplies }}回</span>
          <template v-if="selectedSquad.construction">
            <span>{{ constructionStatus(selectedSquad) }}</span>
            <div class="hp-bar build-bar"><span :style="{ width: `${selectedSquad.construction.complete || selectedSquad.order === 'demolish' ? selectedSquad.construction.hp : selectedSquad.construction.progress}%` }"></span></div>
          </template>
          <div v-if="selectedSquad.owner === 'player'" class="squad-actions">
            <button v-for="action in squadActions(selectedSquad.type)" :key="action.key" :class="{ active: action.order ? selectedSquad.order === action.order : input.buildMode.value?.squadId === selectedSquad.id && input.buildMode.value?.kind === action.build }" @click="runAction(selectedSquad.id, action)">{{ action.label }}</button>
          </div>
          <button class="close" @click="input.selectSquad(null)" aria-label="選択を解除">×</button>
        </div>
        <ul class="squad-list">
          <li v-for="squad in playerSquads" :key="squad.id">
            <button :class="{ selected: squad.id === input.selectedSquadId.value }" @click="focusSquad(squad.id)" :aria-label="`${squadName(squad)} ${squad.count}人 ${ORDER_NAME[squad.order]}`">
              <span>{{ squadName(squad) }}</span><span class="order" :class="{ low: squad.stamina < TIRED_BELOW || (squad.maxArrows > 0 && squad.arrows < squad.maxArrows * .25) || (squad.maxSupplies > 0 && squad.supplies === 0) }">{{ squadStatus(squad) }}</span><b>{{ squad.count }}</b>
            </button>
          </li>
        </ul>
      </aside>
      <footer class="battle-footer">
        <div class="instructions"><span>部隊の旗をドラッグ <b>移動 / 敵部隊へ攻撃 / 敵の建設物へ破壊 / 自陣へ退却 / 敵陣へ突撃 / 補給部隊を味方へ / 工兵を川へ（橋）</b> · 長押し <b>待機・突撃・陣形に戻る・退却・補給に戻る・工兵の建設</b></span><span>全軍の旗をドラッグ <b>陣全体を移動</b> · 兵士をクリック <b>部隊を選択</b> · Space <b>一時停止（停止中も指示可）</b></span><span>何もない場所から左ドラッグで回転 · 右 / Shift＋左ドラッグでパン · ホイールでズーム · 2本指の横ドラッグで回転・ピンチでズーム</span></div>
        <div class="command-panel" role="group" aria-label="全軍への指示">
          <div class="formation-buttons">
            <button v-for="f in FORMATIONS" :key="f.type" :class="{ active: gameStore.formation === f.type }" :title="f.description" @click="gameStore.setFormation(f.type)">{{ f.name }}</button>
          </div>
          <div class="army-buttons">
            <button v-for="action in ARMY_ACTIONS" :key="action.order" @click="gameStore.orderArmy(action.order)">{{ action.label }}</button>
          </div>
        </div>
        <div class="factions"><span class="player-dot">人間軍（昼に強い）</span><span class="cpu-dot">魔王軍（夜に強い）</span></div>
      </footer>
      </template>
    </template>
    <div v-if="ready && input.buildMode.value && gameStore.status !== 'title'" class="build-banner" role="status">
      <span><b>{{ buildingSquad ? squadName(buildingSquad) : '工兵' }}</b> · {{ BUILD_HINT[input.buildMode.value.kind] }} · Esc で取り消し</span>
      <span v-if="input.buildError.value" class="build-error">{{ input.buildError.value }}</span>
      <div class="build-banner-actions">
        <button v-if="input.buildMode.value.kind === 'barricade'" @click="input.rotateBuild()">向きを変える（{{ input.buildMode.value.axis === 'y' ? '南北' : '東西' }}）</button>
        <button @click="input.cancelBuild()">取り消し</button>
      </div>
    </div>
    <div v-if="gameStore.isGameOver && gameStore.status !== 'title'" class="overlay">
      <div class="modal">
        <h1>{{ gameStore.winner === 'player' ? '人間軍の勝利' : '魔王軍の勝利' }}</h1>
        <p>{{ defeatReason }}</p>
        <p>撃破数 人間軍 {{ gameStore.summary.player.killed }} / 魔王軍 {{ gameStore.summary.cpu.killed }}</p>
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
          <button v-for="action in squadActions(menuSquad.type)" :key="action.key" class="context-menu-item" @click="handleContextMenuAction(action.key)">{{ action.label }}</button>
        </template>
        <template v-if="contextMenu.type === 'army'">
          <span class="context-menu-title">全軍の陣形</span>
          <button v-for="f in FORMATIONS" :key="f.type" class="context-menu-item" :class="{ active: gameStore.formation === f.type }" @click="handleContextMenuAction(f.type)">{{ f.name }}<small>{{ f.description }}</small></button>
          <span class="context-menu-title">全軍への指示</span>
          <button v-for="action in ARMY_ACTIONS" :key="action.order" class="context-menu-item" @click="handleContextMenuAction(action.order)">{{ action.label }}</button>
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

.battle-header, .battle-footer { position: absolute; left: 0; right: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; padding: 20px 28px; pointer-events: none; gap: 20px; }
.battle-header { top: 0; background: linear-gradient(#0b151deb, #0b151d00); }
.battle-brand { display: flex; flex-direction: column; gap: 8px; }
.seed-readout { font: 10px monospace; letter-spacing: .12em; color: #96a5a7; }
.clock { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: #c6cfcd; font-size: 11px; }
.paused-label { margin-top: 2px; }
.battle-actions { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #aebbb9; }
.battle-actions button { pointer-events: auto; margin: 0; padding: 9px 12px; font-size: 11px; background: #14262ccf; border: 1px solid #526469; border-radius: 3px; }
.speed-control { display: flex; }
.speed-control button { border-radius: 0; margin-left: -1px; }
.speed-control button:first-child { border-radius: 3px 0 0 3px; margin-left: 0; }
.speed-control button:last-child { border-radius: 0 3px 3px 0; }
.speed-control button.active { position: relative; background: #2f4f7a; border-color: #8fb3ea; color: #fff; }
.battle-footer { bottom: 0; background: linear-gradient(#0b151d00, #0b151de8); align-items: flex-end; padding-top: 40px; }
.instructions { display: flex; flex-direction: column; gap: 8px; font-size: 10px; color: #98abae; }
.instructions b { color: #d0d8d3; font-weight: 400; }
.factions { display: flex; gap: 16px; font-size: 10px; color: #b6c3c2; }
.factions span::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; }
.factions .player-dot::before { background: #6f9be8; }
.factions .cpu-dot::before { background: #e0614f; }

.army-panel { position: absolute; z-index: 6; top: 96px; right: 20px; width: 196px; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.army { padding: 10px 12px; background: #0e1d25d6; border: 1px solid #44545a; border-radius: 4px; font-size: 11px; color: #b8c4c5; }
.army-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; letter-spacing: .06em; }
.army-title b { font: 600 16px system-ui; font-variant-numeric: tabular-nums; }
.army.player .army-title b { color: #9fc0f5; }
.army.cpu .army-title b { color: #f1907f; }
.no-fort { margin: 0 0 8px; font-size: 10px; color: #c9a36b; }
.fort-bar { height: 5px; background: #00000080; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
.fort-bar span { display: block; height: 100%; transition: width .2s; }
.army.player .fort-bar span { background: #6f9be8; }
.army.cpu .fort-bar span { background: #e0614f; }
.army dl { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; margin: 0; }
.army dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: #dfe6e4; }

.squad-panel { position: absolute; z-index: 6; left: 20px; top: 96px; width: 214px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100% - 270px); }
.squad-detail { position: relative; padding: 10px 30px 10px 12px; background: #0e1d25e6; border: 1px solid #58636a; border-radius: 4px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #b8c4c5; }
.unit-name { font-size: 12px; color: #e8ecea; }
.unit-name.player { color: #9fc0f5; }
.unit-name.cpu { color: #f1907f; }
.hp-bar { height: 4px; background: #00000080; border-radius: 2px; overflow: hidden; }
.hp-bar span { display: block; height: 100%; background: #8bd38f; }
.ammo-bar span { background: #e2c27a; }
.build-bar span { background: #c9a36b; }
.build-banner { position: absolute; z-index: 7; top: 78px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 14px; background: #0e1d25e6; border: 1px solid #c9a36b; border-radius: 4px; color: #dfe6e4; font-size: 11px; max-width: calc(100% - 32px); text-align: center; }
.build-banner b { color: #9fc0f5; font-weight: 500; }
.build-error { color: #ffb39f; }
.build-banner-actions { display: flex; gap: 6px; }
.build-banner-actions button { margin: 0; padding: 5px 10px; font-size: 11px; background: #14262ccf; border: 1px solid #526469; border-radius: 3px; color: #dfe6e4; }
.build-banner-actions button:hover { transform: none; border-color: #c9a36b; }
.stamina-bar span { background: #7fb6e8; }
.stamina-bar.tired span { background: #e08b5a; }
.squad-detail .close { position: absolute; top: 4px; right: 4px; margin: 0; padding: 2px 8px; font-size: 14px; background: transparent; color: #9aa7a8; }
.squad-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.squad-actions button, .command-panel button { margin: 0; padding: 6px 4px; font-size: 11px; background: #14262ccf; border: 1px solid #526469; border-radius: 3px; color: #dfe6e4; }
.squad-actions button.active, .command-panel button.active { background: #2f4f7a; border-color: #8fb3ea; color: #fff; }
.squad-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.squad-list button { margin: 0; width: 100%; display: grid; grid-template-columns: 1fr auto 30px; gap: 6px; align-items: center; padding: 4px 8px; font-size: 10px; background: #0e1d25b8; border: 1px solid transparent; border-radius: 3px; color: #b8c4c5; text-align: left; }
.squad-list button:hover { transform: none; border-color: #526469; }
.squad-list button.selected { border-color: #fff1c2; color: #fff; }
.squad-list .order { color: #8fa3a6; }
.squad-list .order.low { color: #e8b25a; }
.squad-list b { text-align: right; color: #9fc0f5; font-weight: 500; font-variant-numeric: tabular-nums; }
.command-panel { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: #0e1d25dc; border: 1px solid #58636a; border-radius: 4px; }
.formation-buttons, .army-buttons { display: flex; gap: 4px; }
.formation-buttons button { min-width: 48px; font-size: 12px; }
.army-buttons button { flex: 1; }
.command-panel button:hover, .squad-actions button:hover { transform: none; border-color: #8fb3ea; }
.context-menu { position: fixed; z-index: 1000; background-color: #1a1b1e; border: 1px solid #3a3b3e; border-radius: 6px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); min-width: 200px; padding: 6px 0; color: #e4e5e7; user-select: none; }
.context-menu-content { display: flex; flex-direction: column; }
.context-menu-title { padding: 6px 16px 2px; font-size: 10px; letter-spacing: .1em; color: #8a9093; }
.context-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 7px 16px; background: none; border: none; color: #e4e5e7; font-size: 0.9rem; text-align: left; cursor: pointer; margin: 0; border-radius: 0; }
.context-menu-item small { font-size: 10px; color: #8a9093; }
.context-menu-item:hover { background-color: #313236; color: #fff; transform: none; }
.context-menu-item.active { color: #9fc0f5; }

.canvas-wrapper :deep(.world-labels) { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.canvas-wrapper :deep(.world-labels[hidden]) { display: none; }
.canvas-wrapper :deep(.world-label) { position: absolute; left: 0; top: 0; padding: 5px 7px; color: var(--faction); font: 600 14px system-ui, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; user-select: none; text-shadow: 0 1px 3px #000, 0 0 5px #000, 1px 0 2px #000, -1px 0 2px #000; }
.canvas-wrapper :deep(.world-label[hidden]) { display: none; }
.canvas-wrapper :deep(.squad-label), .canvas-wrapper :deep(.army-label) { margin: 0; background: none; border: 0; border-radius: 0; cursor: pointer; pointer-events: auto; touch-action: none; font-size: 12px; display: flex; gap: 4px; align-items: baseline; }
.canvas-wrapper :deep(.squad-label .squad-count) { font-size: 10px; font-weight: 500; opacity: .85; }
.canvas-wrapper :deep(.squad-label .squad-ammo) { font-size: 9px; font-weight: 500; opacity: .75; }
.canvas-wrapper :deep(.squad-label.low-ammo .squad-ammo) { color: #ffcf6e; opacity: 1; }
.canvas-wrapper :deep(.squad-label:hover) { transform: none; }
.canvas-wrapper :deep(.squad-label.cpu) { font-size: 11px; }
.canvas-wrapper :deep(.world-label.is-selected), .canvas-wrapper :deep(.world-label.is-target), .canvas-wrapper :deep(.squad-label:hover), .canvas-wrapper :deep(.squad-label.is-hover), .canvas-wrapper :deep(.army-label:hover) { color: #fff4ca; text-shadow: 0 0 5px #eecf7d, 0 1px 3px #000; }
.canvas-wrapper :deep(.world-label.is-source) { color: #e3edff; }
.canvas-wrapper :deep(.construction-label) { font-size: 10px; font-weight: 500; opacity: .9; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.canvas-wrapper :deep(.construction-gauge) { display: block; width: 44px; height: 4px; background: #0b1216cc; border: 1px solid #000a; border-radius: 2px; overflow: hidden; box-shadow: 0 1px 3px #0008; }
.canvas-wrapper :deep(.construction-gauge-fill) { display: block; height: 100%; background: var(--faction); }
.canvas-wrapper :deep(.construction-label.damaged) { color: #ffcf6e; }
.canvas-wrapper :deep(.construction-label.damaged .construction-gauge-fill) { background: #ffcf6e; }
.canvas-wrapper :deep(.army-label) { font-size: 13px; letter-spacing: .08em; padding: 4px 9px; border: 1px solid #6f9be8aa; background: #0e1d25a8; border-radius: 3px; z-index: 2; }
@media (max-width: 900px) { .instructions { max-width: 240px; font-size: 9px; } .factions { display: none; } .battle-header, .battle-footer { padding: 14px; } .army-panel { width: 150px; top: 84px; right: 10px; } .squad-panel { top: 84px; left: 10px; width: 170px; } .command-panel { padding: 8px; } .formation-buttons button { min-width: 36px; } }
@media (max-width: 550px) { .battle-brand .eyebrow { letter-spacing: .08em; font-size: 8px; } .clock { top: 8px; } .battle-actions button { padding: 7px; font-size: 9px; } .instructions { max-width: 145px; line-height: 1.6; } .army-panel { width: 124px; } .army dl { display: none; } .squad-list { display: none; } .title-help { line-height: 2; } }
</style>
