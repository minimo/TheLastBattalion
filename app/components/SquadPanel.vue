<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '~/stores/game'
import { CONSTRUCTION } from '~/game/battleConfig'
import { GUIDELINES } from '~/game/guidelines'
import type { CompanySummary, SquadSummary } from '~/stores/game'
import { ARMY_NAME, ORDER_NAME, TIRED_BELOW, companyName, companyTypes, squadName, squadNeedsCare } from './battleUi'

/** 左側の部隊パネル。選んだ小隊・中隊の状態と、自軍の部隊を中隊ごとにまとめた一覧（大隊 › 中隊 › 小隊、開閉式）。 */
const props = defineProps<{ selectedId: number | null; selectedCompanyId: number | null; listOpen: boolean }>()
const emit = defineEmits<{ focus: [squadId: number]; focusCompany: [companyId: number] }>()
const gameStore = useGameStore()

const squadsOf = (company: CompanySummary) => company.squadIds.map(id => gameStore.squads.find(sq => sq.id === id)).filter((sq): sq is SquadSummary => !!sq)
const selected = computed(() => gameStore.squads.find(sq => sq.id === props.selectedId))
const selectedCompany = computed(() => gameStore.companies.find(c => c.id === props.selectedCompanyId))
/** 選んだ小隊の属する中隊。 */
const parentCompany = computed(() => selected.value && gameStore.companies.find(c => c.id === selected.value!.companyId))
const groups = computed(() => gameStore.companies.filter(c => c.owner === 'player' && c.squadIds.length).map(company => ({ company, squads: squadsOf(company) })))
/** 中隊に入らない自軍の小隊（工兵・補給兵）。選んで小隊ごとに指示できる。 */
const loose = computed(() => gameStore.squads.filter(sq => sq.owner === 'player' && !gameStore.companies.some(c => c.id === sq.companyId)))
const total = computed(() => groups.value.reduce((sum, g) => sum + g.company.count, 0) + loose.value.reduce((sum, sq) => sum + sq.count, 0))
const expanded = ref(new Set<number>())
const toggle = (id: number) => {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}
/** 中隊の小隊の指示（全員同じならその指示、ばらばらなら「各自」）。 */
const companyOrder = (squads: SquadSummary[]) => new Set(squads.map(sq => sq.order)).size === 1 ? ORDER_NAME[squads[0]!.order] : '各自'
/** 部隊の行動（「待機」で止めていれば、そう添える）。 */
const guidelineLabel = (unit: { guideline: CompanySummary['guideline']; directive: CompanySummary['directive'] }) => `行動 · ${GUIDELINES[unit.guideline].name}${unit.directive === 'wait' ? '（待機中）' : ''}`
const percent = (value: number, max: number) => `${Math.max(0, Math.min(100, value / max * 100))}%`

const constructionStatus = (squad: SquadSummary) => {
  const site = squad.construction
  if (!site) return ''
  const name = CONSTRUCTION[site.kind].name
  if (squad.order === 'demolish') return `${name}を破壊中`
  if (squad.order === 'occupy') return `${name}を占領中`
  return site.complete ? `${name}を修理中` : `${name}を建設中`
}
/** 建設物の欄のゲージ: 占領は占領の進み具合、破壊と完成後（修理）は耐久、建設中は進み具合。 */
const constructionMeter = (squad: SquadSummary) => {
  const site = squad.construction!
  if (squad.order === 'occupy') return site.occupation
  return site.complete || squad.order === 'demolish' ? site.hp : site.progress
}
/** 一覧の状態欄（指示・建設・矢・補給回数・体力）。 */
const squadStatus = (squad: SquadSummary) => {
  if (squad.order === 'resupply') return ORDER_NAME.resupply
  const parts = [ORDER_NAME[squad.order]]
  if (squad.construction && squad.order === 'build') parts.push(squad.construction.complete ? '修理' : `${squad.construction.progress}%`)
  if (squad.construction && squad.order === 'occupy') parts.push(`${squad.construction.occupation}%`)
  if (squad.maxArrows > 0) parts.push(`矢${Math.round(squad.arrows / squad.maxArrows * 100)}%`)
  if (squad.maxSupplies > 0) parts.push(`残${squad.supplies}回`)
  if (squad.stamina < TIRED_BELOW) parts.push('疲労')
  return parts.join('・')
}
</script>

<template>
  <aside class="squad-panel" aria-label="部隊">
    <div v-if="selected" class="squad-card parchment-window" role="status">
      <div class="card-head">
        <span class="unit-name" :class="selected.owner">{{ ARMY_NAME[selected.owner] }} · {{ squadName(selected) }}</span>
        <span v-if="selected.owner === 'player'" class="card-order">{{ ORDER_NAME[selected.order] }}</span>
      </div>
      <span v-if="selected.owner === 'player' && !parentCompany" class="card-types">{{ guidelineLabel(selected) }}</span>
      <button v-if="parentCompany" class="card-parent" :aria-label="`${companyName(parentCompany)}を選ぶ`" @click="emit('focusCompany', parentCompany.id)">{{ companyName(parentCompany) }} · {{ companyTypes(parentCompany) }} ›</button>
      <template v-if="selected.owner === 'player'">
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
        <div class="bar build"><span :style="{ width: `${constructionMeter(selected)}%` }"></span></div>
        <b>{{ constructionMeter(selected) }}%</b>
      </div>
      </template>
    </div>
    <div v-else-if="selectedCompany" class="squad-card parchment-window" role="status">
      <div class="card-head">
        <span class="unit-name" :class="selectedCompany.owner">{{ ARMY_NAME[selectedCompany.owner] }} · {{ companyName(selectedCompany) }}</span>
        <span v-if="selectedCompany.owner === 'player'" class="card-order">{{ companyOrder(squadsOf(selectedCompany)) }}</span>
      </div>
      <template v-if="selectedCompany.owner === 'player'">
      <span class="card-types">{{ companyTypes(selectedCompany) }} · {{ selectedCompany.squadIds.length }}小隊</span>
      <span class="card-types">{{ guidelineLabel(selectedCompany) }}</span>
      <div class="meter">
        <span>人数</span><div class="bar"><span :style="{ width: percent(selectedCompany.count, selectedCompany.size) }"></span></div><b>{{ selectedCompany.count }}/{{ selectedCompany.size }}</b>
      </div>
      <ul class="card-squads">
        <li v-for="squad in squadsOf(selectedCompany)" :key="squad.id">
          <div class="squad-row" :aria-label="`${squadName(squad)} ${squad.count}人 ${ORDER_NAME[squad.order]}`">
            <span>{{ squadName(squad) }}</span><span class="order" :class="{ low: squadNeedsCare(squad) }">{{ squadStatus(squad) }}</span><b>{{ squad.count }}</b>
          </div>
        </li>
      </ul>
      </template>
    </div>
    <div v-if="listOpen" class="squad-list parchment-window parchment-scroll">
      <p v-if="!groups.length && !loose.length" class="empty">部隊がいません</p>
      <p v-else class="battalion">大隊 · {{ groups.length }}中隊{{ loose.length ? ` · ${loose.length}小隊` : '' }} · {{ total }}人</p>
      <section v-for="group in groups" :key="group.company.id">
        <div class="group-head wood-control" :class="{ selected: group.company.id === selectedCompanyId }">
          <button class="caret" :aria-expanded="expanded.has(group.company.id)" :aria-label="`${companyName(group.company)}の小隊を${expanded.has(group.company.id) ? '閉じる' : '開く'}`" @click="toggle(group.company.id)">{{ expanded.has(group.company.id) ? '▾' : '▸' }}</button>
          <button class="company-name" :aria-pressed="group.company.id === selectedCompanyId" :aria-label="`${companyName(group.company)}（${companyTypes(group.company)}） ${group.company.count}人を選ぶ`" @click="emit('focusCompany', group.company.id)">
            <span><span class="control-check" aria-hidden="true">✓</span> {{ companyName(group.company) }}</span><small>{{ companyTypes(group.company) }} · {{ GUIDELINES[group.company.guideline].name }}</small>
            <span v-if="group.squads.some(squadNeedsCare)" class="care" title="矢・体力・補給が心もとない小隊がいます">⚠</span>
            <b>{{ group.squads.length }}小隊 · {{ group.company.count }}</b>
          </button>
        </div>
        <ul v-if="expanded.has(group.company.id)">
          <li v-for="squad in group.squads" :key="squad.id">
            <!-- 中隊の小隊は選べないので、一覧でも状態を示すだけ。 -->
            <div class="squad-row" :aria-label="`${squadName(squad)} ${squad.count}人 ${ORDER_NAME[squad.order]}`">
              <span>{{ squadName(squad) }}</span><span class="order" :class="{ low: squadNeedsCare(squad) }">{{ squadStatus(squad) }}</span><b>{{ squad.count }}</b>
            </div>
          </li>
        </ul>
      </section>
      <section v-if="loose.length">
        <p class="loose-head">中隊に入らない小隊</p>
        <ul>
          <li v-for="squad in loose" :key="squad.id">
            <button class="squad-row loose wood-control" :class="{ selected: squad.id === selectedId }" :aria-pressed="squad.id === selectedId" :aria-label="`${squadName(squad)} ${squad.count}人 ${ORDER_NAME[squad.order]}を選ぶ`" @click="emit('focus', squad.id)">
              <span><span class="control-check" aria-hidden="true">✓</span> {{ squadName(squad) }}</span><span class="order" :class="{ low: squadNeedsCare(squad) }">{{ squadStatus(squad) }}</span><b>{{ squad.count }}</b>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.squad-panel { position: absolute; z-index: 6; left: 16px; top: 112px; bottom: 150px; width: 236px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.squad-card, .squad-list { pointer-events: auto; }
.squad-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #59432e; flex: none; }
.card-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.unit-name { font-size: 12px; color: #39291d; }
.unit-name.player { color: #274d7b; }
.unit-name.cpu { color: #943c2b; }
.card-order { color: #70502d; white-space: nowrap; }
.meter { display: grid; grid-template-columns: 34px 1fr 44px; gap: 8px; align-items: center; }
.meter:has(.build) { grid-template-columns: auto 1fr 36px; }
.meter b { font-weight: 500; text-align: right; font-variant-numeric: tabular-nums; color: #39291d; }
.meter.tired b { color: #955016; }
.bar { height: 4px; background: #76562c30; border-radius: 2px; overflow: hidden; }
.bar span { display: block; height: 100%; background: #54743e; }
.bar.stamina span { background: #416b8a; }
.meter.tired .bar.stamina span { background: #a44c24; }
.bar.ammo span { background: #9b742c; }
.bar.build span { background: #896329; }
.squad-list { padding: 4px; overflow-y: auto; overflow-x: hidden; min-height: 0; }
/* Keep the scroll ends compact for the narrow troop list at every screen width. */
.squad-list.parchment-scroll { border-width: 32px 10px 34px; border-image-width: 32px 10px 34px; }
.squad-list ul { list-style: none; margin: 0 0 4px; padding: 0 0 0 10px; display: flex; flex-direction: column; gap: 1px; }
.empty { margin: 6px 8px; font-size: 11px; color: #725b43; }
.battalion { margin: 4px 8px 6px; font-size: 10px; letter-spacing: .12em; color: #70502d; }
.card-types { color: #705940; font-size: 10px; }
.card-parent { align-self: flex-start; margin: 0; padding: 0; background: none; border: 0; color: #705940; font-size: 10px; cursor: pointer; }
.card-parent:hover { color: #805522; transform: none; }
.card-squads { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 140px; overflow-y: auto; overflow-x: hidden; }
.company-name, .caret, .squad-row { margin: 0; cursor: pointer; text-align: left; }
.company-name, .caret, .squad-row:not(.wood-control) { background: transparent; border: 1px solid transparent; border-radius: 4px; color: #4e3b29; }
.squad-row { cursor: default; }
.squad-row.loose { cursor: pointer; }
.loose-head { margin: 6px 0 2px; padding: 0 8px; font-size: 10px; color: #705940; }
.squad-row { width: 100%; box-sizing: border-box; }
.group-head { display: flex; align-items: center; gap: 2px; margin-bottom: 4px; }
.company-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; padding: 6px 8px 6px 2px; font-size: 12px; }
.company-name small { font-size: 10px; color: #705940; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.company-name b { margin-left: auto; font-weight: 400; font-size: 11px; color: #274d7b; font-variant-numeric: tabular-nums; white-space: nowrap; }
.caret { width: 22px; padding: 6px 0 6px 6px; color: #70502d; font-size: 12px; }
.care { color: #955016; }
.squad-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 28px; gap: 6px; align-items: center; padding: 4px 8px; font-size: 10px; }
/* 長い小隊名は省略して、行が枠からはみ出して横スクロールが出ないようにする。 */
.squad-row > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.squad-row .order { white-space: nowrap; }
.company-name:hover, .caret:hover { border-color: #936b3b; transform: none; }
.squad-row .order { color: #705940; }
.squad-row .order.low { color: #955016; }
.squad-row b { text-align: right; color: #274d7b; font-weight: 500; font-variant-numeric: tabular-nums; }
/* Only interactive rows are wooden; subordinate status text stays on the paper. */
.group-head .company-name, .group-head .caret { color: #f2e0ba; text-shadow: 0 1px 2px #000; }
.group-head .company-name { gap: 3px; padding-block: 8px; }
.group-head .company-name > span:first-child { white-space: nowrap; }
.group-head .company-name small { color: #d6bf98; }
.group-head .company-name b, .squad-row.wood-control b { color: #b4d5ff; }
.group-head .care, .squad-row.wood-control .order.low { color: #ffd073; }
.squad-row.wood-control .order { color: #dbc49e; }
.squad-row.wood-control { padding-block: 7px; }
.group-head .caret { flex: none; width: 18px; padding-left: 3px; }
@media (max-width: 900px) { .squad-panel { top: 100px; left: 10px; width: 200px; } }
@media (max-width: 550px) { .squad-panel { width: calc(100% - 20px); max-width: 260px; bottom: 170px; } }
</style>
