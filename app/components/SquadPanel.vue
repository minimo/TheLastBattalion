<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '~/stores/game'
import { CONSTRUCTION } from '~/game/battleConfig'
import type { SquadSummary } from '~/stores/game'
import type { UnitType } from '~/types/game'
import { ARMY_NAME, ORDER_NAME, TIRED_BELOW, UNIT_NAME, UNIT_TYPES, squadName, squadNeedsCare } from './battleUi'

/** 左側の部隊パネル。選んだ部隊の状態と、自軍の部隊を兵種ごとにまとめた一覧（開閉式）。 */
const props = defineProps<{ selectedId: number | null; listOpen: boolean }>()
const emit = defineEmits<{ focus: [squadId: number] }>()
const gameStore = useGameStore()

const selected = computed(() => gameStore.squads.find(sq => sq.id === props.selectedId))
const groups = computed(() => UNIT_TYPES
  .map(type => ({ type, squads: gameStore.squads.filter(sq => sq.owner === 'player' && sq.type === type) }))
  .filter(group => group.squads.length))
const expanded = ref(new Set<UnitType>())
const toggle = (type: UnitType) => {
  const next = new Set(expanded.value)
  if (!next.delete(type)) next.add(type)
  expanded.value = next
}
const percent = (value: number, max: number) => `${Math.max(0, Math.min(100, value / max * 100))}%`

const constructionStatus = (squad: SquadSummary) => {
  const site = squad.construction
  if (!site) return ''
  const name = CONSTRUCTION[site.kind].name
  if (squad.order === 'demolish') return `${name}を破壊中`
  return site.complete ? `${name}を修理中` : `${name}を建設中`
}
/** 一覧の状態欄（指示・建設・矢・補給回数・体力）。 */
const squadStatus = (squad: SquadSummary) => {
  if (squad.order === 'resupply') return ORDER_NAME.resupply
  const parts = [ORDER_NAME[squad.order]]
  if (squad.construction && squad.order === 'build') parts.push(squad.construction.complete ? '修理' : `${squad.construction.progress}%`)
  if (squad.maxArrows > 0) parts.push(`矢${Math.round(squad.arrows / squad.maxArrows * 100)}%`)
  if (squad.maxSupplies > 0) parts.push(`残${squad.supplies}回`)
  if (squad.stamina < TIRED_BELOW) parts.push('疲労')
  return parts.join('・')
}
</script>

<template>
  <aside class="squad-panel" aria-label="部隊">
    <div v-if="selected" class="squad-card" role="status">
      <div class="card-head">
        <span class="unit-name" :class="selected.owner">{{ ARMY_NAME[selected.owner] }} · {{ squadName(selected) }}</span>
        <span class="card-order">{{ ORDER_NAME[selected.order] }}</span>
      </div>
      <div class="meter">
        <span>人数</span><div class="bar"><span :style="{ width: percent(selected.count, selected.size) }"></span></div><b>{{ selected.count }}/{{ selected.size }}</b>
      </div>
      <div class="meter" :class="{ tired: selected.stamina < TIRED_BELOW }">
        <span>体力</span><div class="bar stamina"><span :style="{ width: percent(selected.stamina, 100) }"></span></div><b>{{ selected.stamina < TIRED_BELOW ? '疲労' : selected.stamina }}</b>
      </div>
      <div v-if="selected.maxArrows > 0" class="meter">
        <span>矢</span><div class="bar ammo"><span :style="{ width: percent(selected.arrows, selected.maxArrows) }"></span></div><b>{{ selected.arrows }}</b>
      </div>
      <div v-if="selected.maxSupplies > 0" class="meter">
        <span>補給</span><div class="bar ammo"><span :style="{ width: percent(selected.supplies, selected.maxSupplies) }"></span></div><b>{{ selected.supplies }}回</b>
      </div>
      <div v-if="selected.construction" class="meter">
        <span>{{ constructionStatus(selected) }}</span>
        <div class="bar build"><span :style="{ width: `${selected.construction.complete || selected.order === 'demolish' ? selected.construction.hp : selected.construction.progress}%` }"></span></div>
        <b>{{ selected.construction.complete || selected.order === 'demolish' ? selected.construction.hp : selected.construction.progress }}%</b>
      </div>
    </div>
    <div v-if="listOpen" class="squad-list">
      <p v-if="!groups.length" class="empty">部隊がいません</p>
      <section v-for="group in groups" :key="group.type">
        <button class="group-head" :aria-expanded="expanded.has(group.type)" @click="toggle(group.type)">
          <span class="caret">{{ expanded.has(group.type) ? '▾' : '▸' }}</span>
          <span>{{ UNIT_NAME.player[group.type] }}</span>
          <span v-if="group.squads.some(squadNeedsCare)" class="care" title="矢・体力・補給が心もとない部隊がいます">⚠</span>
          <b>{{ group.squads.length }}部隊 · {{ group.squads.reduce((sum, sq) => sum + sq.count, 0) }}</b>
        </button>
        <ul v-if="expanded.has(group.type)">
          <li v-for="squad in group.squads" :key="squad.id">
            <button class="squad-row" :class="{ selected: squad.id === selectedId }" :aria-label="`${squadName(squad)} ${squad.count}人 ${ORDER_NAME[squad.order]}`" @click="emit('focus', squad.id)">
              <span>{{ squadName(squad) }}</span><span class="order" :class="{ low: squadNeedsCare(squad) }">{{ squadStatus(squad) }}</span><b>{{ squad.count }}</b>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.squad-panel { position: absolute; z-index: 6; left: 16px; top: 112px; bottom: 150px; width: 236px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.squad-card, .squad-list { pointer-events: auto; background: #0e1d25e6; border: 1px solid #44545a; border-radius: 6px; }
.squad-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #b8c4c5; flex: none; }
.card-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.unit-name { font-size: 12px; color: #e8ecea; }
.unit-name.player { color: #9fc0f5; }
.unit-name.cpu { color: #f1907f; }
.card-order { color: #c5af83; white-space: nowrap; }
.meter { display: grid; grid-template-columns: 34px 1fr 44px; gap: 8px; align-items: center; }
.meter:has(.build) { grid-template-columns: auto 1fr 36px; }
.meter b { font-weight: 500; text-align: right; font-variant-numeric: tabular-nums; color: #dfe6e4; }
.meter.tired b { color: #e8b25a; }
.bar { height: 4px; background: #00000080; border-radius: 2px; overflow: hidden; }
.bar span { display: block; height: 100%; background: #8bd38f; }
.bar.stamina span { background: #7fb6e8; }
.meter.tired .bar.stamina span { background: #e08b5a; }
.bar.ammo span { background: #e2c27a; }
.bar.build span { background: #c9a36b; }
.squad-list { padding: 4px; overflow-y: auto; min-height: 0; }
.squad-list ul { list-style: none; margin: 0 0 4px; padding: 0 0 0 10px; display: flex; flex-direction: column; gap: 1px; }
.empty { margin: 6px 8px; font-size: 11px; color: #8f9a9b; }
.group-head, .squad-row { width: 100%; margin: 0; background: transparent; border: 1px solid transparent; border-radius: 4px; color: #c6cfcd; cursor: pointer; text-align: left; }
.group-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px; }
.group-head b { margin-left: auto; font-weight: 400; font-size: 11px; color: #9fc0f5; font-variant-numeric: tabular-nums; }
.caret { width: 10px; color: #c5af83; }
.care { color: #e8b25a; }
.squad-row { display: grid; grid-template-columns: 1fr auto 28px; gap: 6px; align-items: center; padding: 4px 8px; font-size: 10px; }
.group-head:hover, .squad-row:hover { border-color: #526469; transform: none; }
.squad-row.selected { border-color: #fff1c2; color: #fff; }
.squad-row .order { color: #8fa3a6; }
.squad-row .order.low { color: #e8b25a; }
.squad-row b { text-align: right; color: #9fc0f5; font-weight: 500; font-variant-numeric: tabular-nums; }
@media (max-width: 900px) { .squad-panel { top: 100px; left: 10px; width: 200px; } }
@media (max-width: 550px) { .squad-panel { width: calc(100% - 20px); max-width: 260px; bottom: 170px; } }
</style>
