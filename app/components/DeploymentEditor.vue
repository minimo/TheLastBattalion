<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { COMPANY_MAX_SQUADS, FORMATIONS, joinsCompany, SQUAD_SIZE } from '~/game/formation'
import {
  armyBudget, COMPANY_TEMPLATES, deployedCost, deployedCount, deployLimit, DEPLOYMENT_PRESETS, DEPLOYMENT_SCALES, hasFort, plannedCompanies, plannedGuideline, PLANNED_COMPANIES_MAX, presetDeployment, squadCost,
  squadSizeMin, squadSizeStep, squadSizeMax, SQUADS_PER_TYPE_MAX, UNIT_TYPES, type DeploymentPlan, type DeploymentScale,
} from '~/game/deployment'
import { UNIT_COST } from '~/game/battleConfig'
import { GUIDELINES, guidelineOptions } from '~/game/guidelines'
import type { BattleMode, Guideline, UnitType } from '~/types/game'

const props = defineProps<{ mode: BattleMode; modeName: string; plan: DeploymentPlan; unitNames: Record<UnitType, string> }>()
const emit = defineEmits<{ change: [plan: DeploymentPlan]; save: [plan: DeploymentPlan]; close: [] }>()

/** 開戦するまでは手元の写しを編集し、変えるたびに戦場の布陣に映す。 */
const draft = ref<DeploymentPlan>({ formation: props.plan.formation, squads: props.plan.squads.map(sq => ({ ...sq })) })
const TYPE_MARK: Record<UnitType, string> = { infantry: '歩', pikeman: '槍', archer: '弓', cavalry: '騎', supply: '補', engineer: '工', scout: '偵' }
watch(draft, plan => { if (plan.squads.length) emit('change', plan) }, { deep: true })
/** 軍の予算と、布陣に使った予算。兵は兵種ごとの予算（UNIT_COST）を払って布陣し、残りが予備（増援）になる。 */
const budget = computed(() => armyBudget(props.mode, 'player'))
const spent = computed(() => deployedCost(draft.value))
/** 布陣できる人数の上限と、布陣した人数。 */
const limit = computed(() => deployLimit(props.mode, 'player'))
const reinforced = computed(() => hasFort(props.mode, 'player'))
const deployed = computed(() => deployedCount(draft.value))
/** 兵種の兵をあと何人増やせるか（残りの予算と、人数の上限の小さい方）。 */
const room = (type: UnitType) => Math.max(0, Math.min(limit.value - deployed.value, Math.floor((budget.value - spent.value) / UNIT_COST[type])))
/** 増やせないときの理由（ボタンの説明に添える）。 */
const shortage = (type: UnitType) => limit.value - deployed.value < squadSizeStep(type) ? '布陣できる人数の上限です' : budget.value - spent.value < squadSizeStep(type) * UNIT_COST[type] ? '予算が足りません' : ''
/** 予算の使いみち（兵種ごと。補給兵・工兵・偵察兵はまとめる）。 */
const SPEND_GROUPS: { key: string; name: string; mark: string; types: UnitType[] }[] = [
  { key: 'infantry', name: props.unitNames.infantry, mark: '歩', types: ['infantry'] },
  { key: 'pikeman', name: props.unitNames.pikeman, mark: '槍', types: ['pikeman'] },
  { key: 'archer', name: props.unitNames.archer, mark: '弓', types: ['archer'] },
  { key: 'cavalry', name: props.unitNames.cavalry, mark: '騎', types: ['cavalry'] },
  { key: 'support', name: '工兵・補給兵・偵察兵', mark: '支', types: ['supply', 'engineer', 'scout'] },
]
const spendingOf = (plan: DeploymentPlan) => SPEND_GROUPS.map(group => ({ ...group, cost: plan.squads.filter(sq => group.types.includes(sq.type)).reduce((sum, sq) => sum + squadCost(sq.type, sq.size), 0) })).filter(group => group.cost > 0)
const spending = computed(() => spendingOf(draft.value))
const groupOf = (type: UnitType) => SPEND_GROUPS.find(group => group.types.includes(type))!.key
/** 兵種の小隊（中隊を組んだ小隊も含む。兵種ごとの上限はこれで数える）。 */
const squadsOf = (type: UnitType) => draft.value.squads.map((sq, index) => ({ ...sq, index })).filter(sq => sq.type === type)
/** 中隊に入らない兵種（工兵・補給兵・偵察兵）と、その小隊。歩兵・槍兵・弓兵・騎兵は必ず中隊に入れる。 */
const LOOSE_TYPES = UNIT_TYPES.filter(type => !joinsCompany(type))
const autoSquadsOf = (type: UnitType) => squadsOf(type).filter(sq => sq.company === undefined)
const typeTotal = (type: UnitType) => autoSquadsOf(type).reduce((sum, sq) => sum + sq.size, 0)
const canAdd = (type: UnitType) => room(type) >= squadSizeMin(type) && squadsOf(type).length < SQUADS_PER_TYPE_MAX

/** 編成で組んだ中隊（番号の順）と、その小隊。 */
const companies = computed(() => plannedCompanies(draft.value).map(({ company, indices }) => ({ company, squads: indices.map(index => ({ ...draft.value.squads[index]!, index })) })))
const nextCompany = () => Math.max(0, ...draft.value.squads.map(sq => sq.company ?? 0)) + 1
/** 中隊にもう1小隊入れられるか。 */
const canAddTo = (company: number, type: UnitType) => joinsCompany(type) && canAdd(type) && draft.value.squads.filter(sq => sq.company === company).length < COMPANY_MAX_SQUADS
/** ひな形の兵種で中隊を組む（足りない人数・上限で入らない小隊は飛ばす）。 */
const addCompany = (types: UnitType[]) => {
  if (companies.value.length >= PLANNED_COMPANIES_MAX) return
  const company = nextCompany()
  for (const type of types) addSquad(type, company)
}
const removeCompany = (company: number) => { draft.value.squads = draft.value.squads.filter(sq => sq.company !== company) }
const companyTotal = (squads: { size: number }[]) => squads.reduce((sum, sq) => sum + sq.size, 0)
const companyCost = (squads: { type: UnitType; size: number }[]) => squads.reduce((sum, sq) => sum + squadCost(sq.type, sq.size), 0)
/** ひな形の中隊を定員で組むのにかかる予算。 */
const templateCost = (types: UnitType[]) => types.reduce((sum, type) => sum + squadCost(type, SQUAD_SIZE[type]), 0)
/** 中隊（小隊の位置）か、中隊に入らない小隊の行動（選んでいなければ既定の行動）。 */
const guidelineOf = (indices: number[]) => plannedGuideline(draft.value, indices)
/** 行動を選ぶ。中隊はその小隊がみな同じ行動を持つ。 */
const setGuideline = (indices: number[], guideline: Guideline) => { for (const i of indices) draft.value.squads[i]!.guideline = guideline }
/** 中隊に入らない小隊の行動を、選べる行動の次のものへ替える（工兵は築城と修理）。 */
const cycleGuideline = (index: number) => {
  const options = guidelineOptions([draft.value.squads[index]!.type])
  setGuideline([index], options[(options.indexOf(guidelineOf([index])) + 1) % options.length]!)
}

/**
 * プリセット（兵の構成）と布陣の規模。どちらかを選ぶと、その組み合わせで編成を組み直す。
 * 今の編成がどのプリセットとも違えば（手で変えた編成）、プリセットには印が付かない。増援のない攻め手は規模を選ばない。
 */
const same = (a: DeploymentPlan, b: DeploymentPlan) => JSON.stringify(a) === JSON.stringify(b)
const matchPreset = (scale: DeploymentScale) => DEPLOYMENT_PRESETS.find(preset => same(draft.value, presetDeployment(preset.key, props.mode, 'player', scale)))?.key
const scale = ref<DeploymentScale>(DEPLOYMENT_SCALES.find(s => matchPreset(s.key))?.key ?? 'standard')
const activePreset = computed(() => matchPreset(scale.value))
/** 最後に選んだプリセット（規模を変えたときに組み直す構成）。 */
let lastPreset = activePreset.value ?? 'default'
const applyPreset = (key: string) => { lastPreset = key; draft.value = presetDeployment(key, props.mode, 'player', scale.value) }
const applyScale = (key: DeploymentScale) => { scale.value = key; applyPreset(activePreset.value ?? lastPreset) }
/** プリセットの人数と、予算の使いみち（ボタンに、下の予算の帯と同じ色の帯で出す）。 */
const presets = computed(() => DEPLOYMENT_PRESETS.map(preset => { const plan = presetDeployment(preset.key, props.mode, 'player', scale.value); return { ...preset, count: deployedCount(plan), cost: deployedCost(plan), spending: spendingOf(plan) } }))
/** 部隊の人数を変える。予算と布陣できる上限を超える分は増やさない。 */
const setSize = (index: number, size: number) => {
  const squad = draft.value.squads[index]!
  const max = Math.min(squadSizeMax(squad.type), squad.size + room(squad.type))
  squad.size = Math.max(squadSizeMin(squad.type), Math.min(max, Math.round(Number.isFinite(size) ? size : squad.size)))
}
const step = (index: number, delta: number) => setSize(index, draft.value.squads[index]!.size + delta)
/** 兵種の部隊を1つ加える（人数は定員、予算か上限が近ければ出せるだけの人数。兵種ごとに SQUADS_PER_TYPE_MAX 部隊まで）。兵種の順に並べて、部隊の番号を兵種ごとの順にする。 */
const addSquad = (type: UnitType, company?: number) => {
  const size = Math.min(SQUAD_SIZE[type], Math.floor(room(type) / squadSizeStep(type)) * squadSizeStep(type))
  if (size < squadSizeMin(type) || squadsOf(type).length >= SQUADS_PER_TYPE_MAX) return
  if (company !== undefined && !canAddTo(company, type)) return
  // 歩兵・槍兵・弓兵・騎兵は中隊の外には加えない。
  if (company === undefined && joinsCompany(type)) return
  const at = draft.value.squads.reduce((last, sq, i) => UNIT_TYPES.indexOf(sq.type) <= UNIT_TYPES.indexOf(type) ? i + 1 : last, 0)
  draft.value.squads.splice(at, 0, company === undefined ? { type, size } : { type, size, company })
}
const removeSquad = (index: number) => { draft.value.squads.splice(index, 1) }
const save = () => { if (draft.value.squads.length) emit('save', draft.value) }

/**
 * 巻物を巻いて編成を隠す（下の軸が上の軸まで巻き上がる）。
 * 戦場の描画と同時でも滑らかに動くよう、動かすのは transform だけにして、高さは動き終えてから変える。
 * 枠を上げた分だけ中の紙を下げるので、紙はその場に留まり、枠の下の端で隠れていく。下の軸は枠に付けた写しが代わりに上がる。
 */
const ROLL_MS = 300
const ROLL_EASING = 'cubic-bezier(.4, 0, .2, 1)'
const panel = ref<HTMLElement | null>(null)
const scroll = ref<HTMLElement | null>(null)
const rolled = ref(false)
const rolling = ref(false)
/** 巻く前のスクロール位置（開いたら戻す）。 */
let openScroll = 0
let rollAnimations: Animation[] = []
const toggleRolled = () => {
  const el = panel.value, frame = scroll.value
  if (!el || !frame) return
  rolled.value = !rolled.value
  // 動いている途中なら、同じ動きを逆に戻す。
  if (rollAnimations.length) { for (const animation of rollAnimations) animation.reverse(); return }
  const style = getComputedStyle(el)
  const closed = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  if (rolled.value) openScroll = el.scrollTop
  else {
    el.style.height = ''
    el.style.paddingBlock = ''
    el.style.overflow = ''
    el.scrollTop = openScroll
  }
  const distance = el.offsetHeight - closed
  rolling.value = true
  const timing = { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ROLL_MS, easing: ROLL_EASING, fill: 'both' as const, direction: rolled.value ? 'normal' as const : 'reverse' as const }
  rollAnimations = [
    frame.animate({ transform: ['translateY(0)', `translateY(${-distance}px)`] }, timing),
    el.animate({ transform: ['translateY(0)', `translateY(${distance}px)`] }, timing),
  ]
  rollAnimations[0]!.onfinish = () => {
    if (rolled.value) {
      el.style.height = `${closed}px`
      el.style.paddingBlock = '0'
      el.style.overflow = 'hidden'
    }
    for (const animation of rollAnimations) animation.cancel()
    rollAnimations = []
    rolling.value = false
  }
}
onUnmounted(() => { for (const animation of rollAnimations) animation.cancel() })
</script>

<template>
  <div class="deploy-dock">
    <div class="deploy-scroll">
      <button class="roll-toggle" type="button" :aria-expanded="!rolled" aria-controls="deploy-panel" @click="toggleRolled">{{ rolled ? '編成を開く' : '編成を隠す' }}<span aria-hidden="true">{{ rolled ? '▼' : '▲' }}</span></button>
      <div ref="scroll" class="deploy-clip" :class="{ rolling }">
      <div v-show="rolling" class="roll-edge" aria-hidden="true"></div>
      <section id="deploy-panel" ref="panel" class="deploy-panel parchment-window parchment-scroll" :inert="rolled" role="dialog" aria-modal="true" aria-labelledby="deploy-title">
      <header>
        <h2 id="deploy-title">部隊編成</h2>
        <span class="deploy-mode">{{ modeName }} · 人間軍</span>
      </header>

      <div class="deploy-group">
        <div class="label-row">
          <span class="deploy-label">プリセット</span>
          <div v-if="reinforced" class="segment" role="radiogroup" aria-label="布陣の規模">
            <span class="deploy-label">規模</span>
            <button class="wood-control" v-for="s in DEPLOYMENT_SCALES" :key="s.key" role="radio" :aria-checked="!!activePreset && scale === s.key" :class="{ active: activePreset && scale === s.key }" :title="s.description" @click="applyScale(s.key)">{{ s.name }}</button>
          </div>
        </div>
        <div class="deploy-buttons presets" role="radiogroup" aria-label="プリセット">
          <button class="wood-control" v-for="preset in presets" :key="preset.key" role="radio" :aria-checked="activePreset === preset.key" :class="{ active: activePreset === preset.key }" :title="preset.description" @click="applyPreset(preset.key)">
            <span class="preset-name"><span class="control-check" aria-hidden="true">✓</span>{{ preset.name }}<small>{{ preset.count.toLocaleString() }}人</small></span>
            <span class="mix" aria-hidden="true"><i v-for="g in preset.spending" :key="g.key" :class="g.key" :style="{ width: `${g.cost / preset.cost * 100}%` }"></i></span>
          </button>
        </div>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">開戦時の陣</span>
        <div class="deploy-buttons formations" role="radiogroup" aria-label="開戦時の陣">
          <button class="wood-control" v-for="f in FORMATIONS" :key="f.type" role="radio" :aria-checked="draft.formation === f.type" :class="{ active: draft.formation === f.type }" :title="f.description" @click="draft.formation = f.type"><span class="control-check" aria-hidden="true">✓</span>{{ f.name }}</button>
        </div>
        <p class="deploy-note">{{ FORMATIONS.find(f => f.type === draft.formation)!.description }}</p>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">中隊を加える</span>
        <div class="deploy-buttons templates">
          <button class="wood-control" v-for="t in COMPANY_TEMPLATES" :key="t.key" :title="[t.description, shortage(t.types[0]!)].filter(Boolean).join(' · ')" :disabled="!canAdd(t.types[0]!) || companies.length >= PLANNED_COMPANIES_MAX" @click="addCompany(t.types)">
            ＋ {{ t.name }}<small>{{ t.types.map(type => TYPE_MARK[type]).join('・') }}<span class="cost">{{ templateCost(t.types) }}</span></small>
          </button>
        </div>
        <ul v-if="companies.length" class="deploy-types companies">
          <li v-for="(c, n) in companies" :key="c.company">
            <div class="type-head">
              <span>第{{ n + 1 }}中隊</span>
              <small>{{ c.squads.length }}/{{ COMPANY_MAX_SQUADS }}小隊 · {{ companyTotal(c.squads) }}人</small>
              <span class="cost" title="この中隊の予算">{{ companyCost(c.squads).toLocaleString() }}</span>
              <span class="company-actions">
                <button class="wood-control add" :aria-label="`第${n + 1}中隊を外す`" @click="removeCompany(c.company)">×</button>
              </span>
            </div>
            <div class="guidelines" role="radiogroup" :aria-label="`第${n + 1}中隊の行動`">
              <span class="guidelines-label">行動</span>
              <button v-for="g in guidelineOptions(c.squads.map(sq => sq.type))" :key="g" class="wood-control" role="radio" :aria-checked="guidelineOf(c.squads.map(sq => sq.index)) === g"
                :class="{ active: guidelineOf(c.squads.map(sq => sq.index)) === g }" :title="GUIDELINES[g].description" @click="setGuideline(c.squads.map(sq => sq.index), g)">
                <span class="control-check" aria-hidden="true">✓</span>{{ GUIDELINES[g].name }}
              </button>
            </div>
            <div class="squads">
              <div v-for="sq in c.squads" :key="sq.index" class="squad-chip" :class="groupOf(sq.type)">
                <span class="squad-no">{{ unitNames[sq.type] }}</span>
                <button class="wood-control" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${squadSizeStep(sq.type)}人減らす`" :disabled="sq.size <= squadSizeMin(sq.type)" @click="step(sq.index, -squadSizeStep(sq.type))">−</button>
                <input class="metal-input" type="number" :value="sq.size" :min="squadSizeMin(sq.type)" :max="squadSizeMax(sq.type)" :step="squadSizeStep(sq.type)" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button class="wood-control" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${squadSizeStep(sq.type)}人増やす`" :disabled="sq.size >= squadSizeMax(sq.type) || room(sq.type) < squadSizeStep(sq.type)" :title="shortage(sq.type)" @click="step(sq.index, squadSizeStep(sq.type))">＋</button>
                <button class="wood-control remove" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を外す`" @click="removeSquad(sq.index)">×</button>
              </div>
              <span class="add-types">
                <button class="wood-control" v-for="type in UNIT_TYPES.filter(joinsCompany)" :key="type" :disabled="!canAddTo(c.company, type)" :title="`${unitNames[type]}の小隊を加える（予算 ${squadCost(type, SQUAD_SIZE[type])}）`" :aria-label="`第${n + 1}中隊に${unitNames[type]}の小隊を加える`" @click="addSquad(type, c.company)">＋{{ TYPE_MARK[type] }}</button>
              </span>
            </div>
          </li>
        </ul>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">工兵・補給兵・偵察兵（中隊に入らない）</span>
        <ul class="deploy-types">
          <li v-for="type in LOOSE_TYPES" :key="type">
            <div class="type-head">
              <span>{{ unitNames[type] }}</span>
              <small>{{ autoSquadsOf(type).length }}小隊 · {{ typeTotal(type) }}人</small>
              <span v-if="autoSquadsOf(type).length" class="cost" :title="`${unitNames[type]}の予算`">{{ companyCost(autoSquadsOf(type)).toLocaleString() }}</span>
              <button class="wood-control add" :disabled="!canAdd(type)" :title="shortage(type)" :aria-label="`${unitNames[type]}の小隊を加える（予算 ${squadCost(type, SQUAD_SIZE[type])}）`" @click="addSquad(type)">＋<span class="cost">{{ squadCost(type, SQUAD_SIZE[type]) }}</span></button>
            </div>
            <div class="squads">
              <div v-for="(sq, n) in autoSquadsOf(type)" :key="sq.index" class="squad-chip support">
                <span class="squad-no">第{{ n + 1 }}</span>
                <button class="wood-control" :aria-label="`第${n + 1}${unitNames[type]}小隊を${squadSizeStep(type)}人減らす`" :disabled="sq.size <= squadSizeMin(type)" @click="step(sq.index, -squadSizeStep(type))">−</button>
                <input class="metal-input" type="number" :value="sq.size" :min="squadSizeMin(type)" :max="squadSizeMax(type)" :step="squadSizeStep(type)" :aria-label="`第${n + 1}${unitNames[type]}小隊の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button class="wood-control" :aria-label="`第${n + 1}${unitNames[type]}小隊を${squadSizeStep(type)}人増やす`" :disabled="sq.size >= squadSizeMax(type) || room(type) < squadSizeStep(type)" :title="shortage(type)" @click="step(sq.index, squadSizeStep(type))">＋</button>
                <button v-if="guidelineOptions([type]).length > 1" class="wood-control guideline-toggle" :title="`行動: ${GUIDELINES[guidelineOf([sq.index])].description}（押すと切り替え）`"
                  :aria-label="`第${n + 1}${unitNames[type]}小隊の行動 ${GUIDELINES[guidelineOf([sq.index])].name}（押すと切り替え）`" @click="cycleGuideline(sq.index)">{{ GUIDELINES[guidelineOf([sq.index])].name }}</button>
                <button class="wood-control remove" :aria-label="`第${n + 1}${unitNames[type]}小隊を外す`" @click="removeSquad(sq.index)">×</button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <footer>
        <div class="deploy-budget">
          <div class="budget-head">
            <span>予算 <strong :class="{ warn: budget - spent < 10 }">{{ spent.toLocaleString() }}</strong> / {{ budget.toLocaleString() }}</span>
            <span>兵 <strong :class="{ warn: deployed >= limit }">{{ deployed.toLocaleString() }}</strong> / {{ limit.toLocaleString() }}人</span>
          </div>
          <div class="budget-bar" role="img" :aria-label="`予算の使いみち: ${spending.map(g => `${g.name} ${g.cost}`).join('、')}、残り ${budget - spent}`">
            <span v-for="g in spending" :key="g.key" :class="g.key" :style="{ width: `${g.cost / budget * 100}%` }" :title="`${g.name} ${g.cost.toLocaleString()}`">{{ g.mark }}</span>
            <span class="rest" :class="{ warn: !reinforced }" :title="reinforced ? '使わなかった軍事費は、開戦後の増援に使われます' : 'この戦いは増援がないため、残した軍事費は使われません'">残り {{ (budget - spent).toLocaleString() }}</span>
          </div>
          <span class="costs-label">兵士1人あたりの配置コスト</span>
          <ul class="unit-costs" aria-label="兵士1人あたりの配置コスト">
            <li v-for="type in UNIT_TYPES" :key="type" :title="`${unitNames[type]}1人あたりの配置コスト`"><i :class="groupOf(type)"></i>{{ TYPE_MARK[type] }}<span class="cost">{{ UNIT_COST[type] }}</span></li>
          </ul>
        </div>
        <div class="deploy-actions">
          <button class="wood-control secondary" @click="emit('close')">戻る</button>
          <button class="wood-control wood-primary" :disabled="!draft.squads.length" @click="save">開戦する →</button>
        </div>
      </footer>
      </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deploy-dock { position: absolute; z-index: 30; top: 96px; right: 20px; bottom: 20px; width: min(540px, calc(100% - 32px)); display: flex; align-items: flex-start; pointer-events: none; }
.deploy-scroll { position: relative; width: 100%; max-height: 100%; display: flex; flex-direction: column; }
.deploy-clip { position: relative; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.deploy-clip.rolling, .deploy-clip.rolling .deploy-panel { will-change: transform; }
/* 巻いている間だけ、紙の下の軸（枠の下の端で隠れる）の代わりに枠といっしょに上がる写し。 */
.roll-edge { position: absolute; z-index: 1; bottom: 0; left: 0; right: 0; box-sizing: border-box; height: 60px; border: solid transparent; border-width: 0 24px 60px; border-image: url('/images/ui/scroll-window-handrolled.png') 0 110 250 / 0 24px 60px / 0 stretch; pointer-events: none; }
.deploy-panel { pointer-events: auto; width: 100%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 8px 12px; color: #39291d; text-align: left; }
/* 動かない上の軸の上に載せる。 */
.roll-toggle { position: absolute; z-index: 2; top: 16px; right: 44px; display: flex; align-items: center; gap: 6px; padding: 4px 10px; pointer-events: auto; border: 1px solid #94703d; border-top-color: #c9a767; border-radius: 3px; background: var(--ui-wood-surface); background-color: var(--ui-wood-base); background-blend-mode: normal, screen; box-shadow: 0 1px 3px #29150a80; color: #f0dfbd; font-size: 11px; letter-spacing: .08em; text-shadow: 0 1px 2px #160a03; }
.roll-toggle:hover { filter: brightness(1.13); }
.roll-toggle:focus-visible { outline: 2px solid #70491f; outline-offset: 2px; }
.roll-toggle span { font-size: 9px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px; margin-bottom: 14px; }
h2 { margin: 0; font: 400 22px Georgia, serif; letter-spacing: .1em; color: #352315; }
.deploy-mode { font-size: 12px; color: #69533d; letter-spacing: .08em; }
.deploy-group { margin-bottom: 16px; }
.deploy-label { display: block; margin-bottom: 6px; font-size: 11px; letter-spacing: .14em; color: #70502d; }
.deploy-note { margin: 6px 0 0; font-size: 11px; color: #6c5741; }
button { margin: 0; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.deploy-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.deploy-buttons button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.deploy-buttons small { font-size: 10px; }
.deploy-buttons.formations button { min-width: 64px; flex-direction: row; align-items: center; justify-content: center; gap: 5px; }
.deploy-types { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.deploy-types li { padding: 8px 10px; background: #ead2a5; border: 1px solid #af8b5659; border-radius: 4px; }
.type-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13px; }
.type-head small { color: #6c5741; font-size: 11px; font-variant-numeric: tabular-nums; }
.type-head .add { margin-left: auto; padding: 3px 10px; font-size: 11px; }
.templates button { min-width: 64px; }
.companies { margin-top: 8px; }
.company-actions { margin-left: auto; display: flex; gap: 4px; }
.company-actions .add { margin-left: 0; }
.add-types { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.add-types button { padding: 2px 6px; font-size: 11px; }
.squads { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.guidelines { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-top: 6px; }
.guidelines-label { margin-right: 4px; font-size: 11px; color: #6c5741; }
.guidelines button { display: flex; align-items: center; gap: 3px; padding: 2px 7px; font-size: 11px; }
.squad-chip .guideline-toggle { margin-left: 4px; padding: 1px 6px; font-size: 11px; }
.squads:empty { display: none; }
.squad-chip { display: flex; align-items: center; gap: 2px; padding: 2px 4px; background: #e0c394; border: 1px solid #a27b4970; border-radius: 3px; font-size: 11px; }
.squad-no { margin: 0 4px 0 2px; color: #6c5741; }
.squad-chip button { min-width: 24px; min-height: 24px; padding: 1px 5px; font-size: 12px; line-height: 1.2; }
.squad-chip button::after, .add-types button::after { display: none; }
.squad-chip .remove { margin-left: 2px; }
.squad-chip input { width: 42px; min-height: 24px; padding: 2px; text-align: center; font: 12px system-ui; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
.squad-chip input::-webkit-inner-spin-button, .squad-chip input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
footer { position: sticky; bottom: -8px; margin: 0 -12px -8px; padding: 12px; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; background: #eed8af; border-top: 1px solid #af8b5659; }
/* 予算の札: 暗い札の数字は、どこでもその兵にかかる予算を表す。 */
.cost { display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 8px; background: #4a3421; color: #f3dfb6; font: 10px/15px system-ui; font-variant-numeric: tabular-nums; letter-spacing: 0; text-shadow: none; vertical-align: 1px; }
button .cost { background: #24130a; }
.unit-costs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 11px; color: #6c5741; }
.unit-costs .cost { margin-left: 2px; }
.costs-label { display: block; margin-top: 6px; font-size: 10px; letter-spacing: .08em; color: #70502d; }
.label-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
.label-row .deploy-label { margin: 0; }
.segment { display: flex; align-items: center; gap: 3px; }
.segment .deploy-label { margin-right: 4px; }
.segment button { padding: 3px 9px; font-size: 11px; }
.segment button::after { display: none; }
.presets button { min-width: 76px; }
.presets button { align-items: stretch; }
.preset-name { display: flex; align-items: baseline; gap: 5px; }
.preset-name small { margin-left: auto; }
/* 兵種の色。予算の帯・プリセットの帯・小隊の札・凡例で同じ色を使う。 */
.infantry { --type-color: #7d5a36; }
.pikeman { --type-color: #56704a; }
.archer { --type-color: #a8782a; }
.cavalry { --type-color: #8a4334; }
.support { --type-color: #56687a; }
.mix { display: flex; height: 5px; overflow: hidden; border-radius: 2px; background: #24130a; }
.mix i { background: var(--type-color); filter: brightness(1.45); }
.unit-costs i { display: inline-block; width: 7px; height: 7px; margin-right: 3px; border-radius: 1px; background: var(--type-color); }
.squad-chip { border-left: 4px solid var(--type-color) !important; }
.deploy-budget { flex: 1 1 240px; min-width: 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.budget-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; color: #6c5741; }
.budget-head strong { color: #39291d; font-size: 14px; font-weight: 600; }
.deploy-budget .warn { color: #955016; }
/* 使った予算を兵種ごとに積み、残り（予備）は空きのまま見せる。 */
.budget-bar { display: flex; height: 16px; margin: 4px 0; overflow: hidden; border: 1px solid #8f6f43; border-radius: 3px; background: #d9bd8c; box-shadow: inset 0 1px 2px #5a3c1a55; }
.budget-bar span { background: var(--type-color); min-width: 0; overflow: hidden; box-sizing: border-box; border-right: 1px solid #eed8af; color: #f6e7c6; font-size: 10px; line-height: 16px; text-align: center; transition: width .2s; }
.budget-bar .rest { flex: 1; border: 0; padding: 0 5px; color: #6c5741; text-align: right; white-space: nowrap; }
.deploy-actions { display: flex; gap: 8px; }
.deploy-actions button { padding: 9px 22px; font-size: 13px; letter-spacing: .1em; }
@media (max-width: 550px) { .deploy-dock { top: 84px; right: 16px; bottom: 16px; } .deploy-panel { padding: 8px; } footer { bottom: -8px; margin: 0 -8px -8px; padding: 10px 8px; } .deploy-buttons small { display: none; } }
</style>
