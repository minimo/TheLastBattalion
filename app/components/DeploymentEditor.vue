<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { COMPANY_MAX_SQUADS, FORMATIONS, joinsCompany, SQUAD_SIZE } from '~/game/formation'
import {
  armyPool, COMPANY_TEMPLATES, deployedCount, deployLimit, DEPLOYMENT_PRESETS, hasFort, plannedCompanies, plannedGuideline, PLANNED_COMPANIES_MAX, presetDeployment, SQUAD_SIZE_MIN, SQUAD_SIZE_STEP,
  squadSizeMax, SQUADS_PER_TYPE_MAX, UNIT_TYPES, type DeploymentPlan,
} from '~/game/deployment'
import { GUIDELINES, guidelineOptions } from '~/game/guidelines'
import type { BattleMode, Guideline, UnitType } from '~/types/game'

const props = defineProps<{ mode: BattleMode; modeName: string; plan: DeploymentPlan; unitNames: Record<UnitType, string> }>()
const emit = defineEmits<{ change: [plan: DeploymentPlan]; save: [plan: DeploymentPlan]; close: [] }>()

/** 開戦するまでは手元の写しを編集し、変えるたびに戦場の布陣に映す。 */
const draft = ref<DeploymentPlan>({ formation: props.plan.formation, squads: props.plan.squads.map(sq => ({ ...sq })) })
const TYPE_MARK: Record<UnitType, string> = { infantry: '歩', pikeman: '槍', archer: '弓', cavalry: '騎', supply: '補', engineer: '工' }
watch(draft, plan => { if (plan.squads.length) emit('change', plan) }, { deep: true })
const pool = computed(() => armyPool(props.mode, 'player'))
const limit = computed(() => deployLimit(props.mode, 'player'))
const reinforced = computed(() => hasFort(props.mode, 'player'))
const deployed = computed(() => deployedCount(draft.value))
const room = computed(() => limit.value - deployed.value)
/** 兵種の小隊（中隊を組んだ小隊も含む。兵種ごとの上限はこれで数える）。 */
const squadsOf = (type: UnitType) => draft.value.squads.map((sq, index) => ({ ...sq, index })).filter(sq => sq.type === type)
/** 中隊に入らない兵種（工兵・補給兵）と、その小隊。歩兵・槍兵・弓兵・騎兵は必ず中隊に入れる。 */
const LOOSE_TYPES = UNIT_TYPES.filter(type => !joinsCompany(type))
const autoSquadsOf = (type: UnitType) => squadsOf(type).filter(sq => sq.company === undefined)
const typeTotal = (type: UnitType) => autoSquadsOf(type).reduce((sum, sq) => sum + sq.size, 0)
const canAdd = (type: UnitType) => room.value >= SQUAD_SIZE_MIN && squadsOf(type).length < SQUADS_PER_TYPE_MAX

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
/** 中隊（小隊の位置）か、中隊に入らない小隊の行動（選んでいなければ既定の行動）。 */
const guidelineOf = (indices: number[]) => plannedGuideline(draft.value, indices)
/** 行動を選ぶ。中隊はその小隊がみな同じ行動を持つ。 */
const setGuideline = (indices: number[], guideline: Guideline) => { for (const i of indices) draft.value.squads[i]!.guideline = guideline }
/** 中隊に入らない小隊の行動を、選べる行動の次のものへ替える（工兵は築城と修理）。 */
const cycleGuideline = (index: number) => {
  const options = guidelineOptions([draft.value.squads[index]!.type])
  setGuideline([index], options[(options.indexOf(guidelineOf([index])) + 1) % options.length]!)
}

const applyPreset = (key: string) => { draft.value = presetDeployment(key, props.mode, 'player') }
/** 部隊の人数を変える。布陣できる上限を超える分は増やさない。 */
const setSize = (index: number, size: number) => {
  const squad = draft.value.squads[index]!
  const max = Math.min(squadSizeMax(squad.type), squad.size + room.value)
  squad.size = Math.max(SQUAD_SIZE_MIN, Math.min(max, Math.round(Number.isFinite(size) ? size : squad.size)))
}
const step = (index: number, delta: number) => setSize(index, draft.value.squads[index]!.size + delta)
/** 兵種の部隊を1つ加える（人数は定員、上限が近ければ残りの人数。兵種ごとに SQUADS_PER_TYPE_MAX 部隊まで）。兵種の順に並べて、部隊の番号を兵種ごとの順にする。 */
const addSquad = (type: UnitType, company?: number) => {
  const size = Math.min(SQUAD_SIZE[type], room.value)
  if (size < SQUAD_SIZE_MIN || squadsOf(type).length >= SQUADS_PER_TYPE_MAX) return
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
        <span class="deploy-label">プリセット</span>
        <div class="deploy-buttons">
          <button class="wood-control" v-for="preset in DEPLOYMENT_PRESETS" :key="preset.key" :title="preset.description" @click="applyPreset(preset.key)">{{ preset.name }}<small>{{ preset.description }}</small></button>
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
        <span class="deploy-label">中隊を組む（兵種を混ぜてよい · 1中隊{{ COMPANY_MAX_SQUADS }}小隊まで）</span>
        <div class="deploy-buttons templates">
          <button class="wood-control" v-for="t in COMPANY_TEMPLATES" :key="t.key" :title="t.description" :disabled="room < SQUAD_SIZE_MIN || companies.length >= PLANNED_COMPANIES_MAX" @click="addCompany(t.types)">
            ＋ {{ t.name }}<small>{{ t.types.map(type => TYPE_MARK[type]).join('・') }}</small>
          </button>
        </div>
        <ul v-if="companies.length" class="deploy-types companies">
          <li v-for="(c, n) in companies" :key="c.company">
            <div class="type-head">
              <span>第{{ n + 1 }}中隊</span>
              <small>{{ c.squads.map(sq => TYPE_MARK[sq.type]).join('・') }} · {{ companyTotal(c.squads) }}人</small>
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
              <div v-for="sq in c.squads" :key="sq.index" class="squad-chip">
                <span class="squad-no">{{ unitNames[sq.type] }}</span>
                <button class="wood-control" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${SQUAD_SIZE_STEP}人減らす`" :disabled="sq.size <= SQUAD_SIZE_MIN" @click="step(sq.index, -SQUAD_SIZE_STEP)">−</button>
                <input class="metal-input" type="number" :value="sq.size" :min="SQUAD_SIZE_MIN" :max="squadSizeMax(sq.type)" :step="SQUAD_SIZE_STEP" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button class="wood-control" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${SQUAD_SIZE_STEP}人増やす`" :disabled="sq.size >= squadSizeMax(sq.type) || room <= 0" @click="step(sq.index, SQUAD_SIZE_STEP)">＋</button>
                <button class="wood-control remove" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を外す`" @click="removeSquad(sq.index)">×</button>
              </div>
              <span class="add-types">
                <button class="wood-control" v-for="type in UNIT_TYPES.filter(joinsCompany)" :key="type" :disabled="!canAddTo(c.company, type)" :title="`${unitNames[type]}の小隊を加える`" :aria-label="`第${n + 1}中隊に${unitNames[type]}の小隊を加える`" @click="addSquad(type, c.company)">＋{{ TYPE_MARK[type] }}</button>
              </span>
            </div>
          </li>
        </ul>
        <p class="deploy-note">組んだ中隊は陣でひとかたまりに並び（槍兵が前、弓兵が後ろ、騎兵が両翼）、中隊で動くときは一番遅い小隊に足並みをそろえます。弓兵に敵が迫ると、同じ中隊の近接の小隊が迎え撃ちます。</p>
        <p class="deploy-note">行動は命令のないときの動きです（既定は人数が一番多い兵種の行動）。開戦後は陣で構え、敵が近づくか命令をやり終えると行動に沿って動きます。</p>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">工兵・補給兵（中隊に入らず、小隊のまま動く）</span>
        <ul class="deploy-types">
          <li v-for="type in LOOSE_TYPES" :key="type">
            <div class="type-head">
              <span>{{ unitNames[type] }}</span>
              <small>{{ autoSquadsOf(type).length }}小隊 · {{ typeTotal(type) }}人</small>
              <button class="wood-control add" :disabled="!canAdd(type)" :aria-label="`${unitNames[type]}の小隊を加える`" @click="addSquad(type)">＋ 小隊</button>
            </div>
            <div class="squads">
              <div v-for="(sq, n) in autoSquadsOf(type)" :key="sq.index" class="squad-chip">
                <span class="squad-no">第{{ n + 1 }}</span>
                <button class="wood-control" :aria-label="`第${n + 1}${unitNames[type]}小隊を${SQUAD_SIZE_STEP}人減らす`" :disabled="sq.size <= SQUAD_SIZE_MIN" @click="step(sq.index, -SQUAD_SIZE_STEP)">−</button>
                <input class="metal-input" type="number" :value="sq.size" :min="SQUAD_SIZE_MIN" :max="squadSizeMax(type)" :step="SQUAD_SIZE_STEP" :aria-label="`第${n + 1}${unitNames[type]}小隊の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button class="wood-control" :aria-label="`第${n + 1}${unitNames[type]}小隊を${SQUAD_SIZE_STEP}人増やす`" :disabled="sq.size >= squadSizeMax(type) || room <= 0" @click="step(sq.index, SQUAD_SIZE_STEP)">＋</button>
                <button v-if="guidelineOptions([type]).length > 1" class="wood-control guideline-toggle" :title="`行動: ${GUIDELINES[guidelineOf([sq.index])].description}（押すと切り替え）`"
                  :aria-label="`第${n + 1}${unitNames[type]}小隊の行動 ${GUIDELINES[guidelineOf([sq.index])].name}（押すと切り替え）`" @click="cycleGuideline(sq.index)">{{ GUIDELINES[guidelineOf([sq.index])].name }}</button>
                <button class="wood-control remove" :aria-label="`第${n + 1}${unitNames[type]}小隊を外す`" @click="removeSquad(sq.index)">×</button>
              </div>
            </div>
          </li>
        </ul>
        <p class="deploy-note">1小隊 {{ SQUAD_SIZE_MIN }}〜定員の2倍まで。兵種ごとに{{ SQUADS_PER_TYPE_MAX }}小隊まで（中隊を組んだ小隊も数えます。10を超えた分は陣の2列目に並びます）。人数は軍の兵から割り当てます。</p>
      </div>

      <footer>
        <dl class="deploy-totals">
          <dt>軍の兵</dt><dd>{{ pool.toLocaleString() }}</dd>
          <dt>布陣</dt><dd>{{ deployed.toLocaleString() }} <small>/ 上限 {{ limit.toLocaleString() }}</small></dd>
          <template v-if="reinforced"><dt>予備兵（増援）</dt><dd>{{ (pool - deployed).toLocaleString() }}</dd></template>
          <template v-else><dt>増援</dt><dd class="warn">なし<small v-if="pool > deployed">（残り{{ pool - deployed }}人は戦場に出ません）</small></dd></template>
        </dl>
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
.deploy-totals { display: grid; grid-template-columns: auto auto; gap: 3px 14px; margin: 0; font-size: 12px; }
.deploy-totals dt { color: #6c5741; }
.deploy-totals dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.deploy-totals small { color: #6c5741; font-size: 10px; }
.deploy-totals .warn { color: #955016; }
.deploy-actions { display: flex; gap: 8px; }
.deploy-actions button { padding: 9px 22px; font-size: 13px; letter-spacing: .1em; }
@media (max-width: 550px) { .deploy-dock { top: 84px; right: 16px; bottom: 16px; } .deploy-panel { padding: 8px; } footer { bottom: -8px; margin: 0 -8px -8px; padding: 10px 8px; } .deploy-buttons small { display: none; } }
</style>
