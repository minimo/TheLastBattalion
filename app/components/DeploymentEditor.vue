<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { COMPANY_MAX_SQUADS, FORMATIONS, SQUAD_SIZE } from '~/game/formation'
import {
  armyPool, COMPANY_TEMPLATES, deployedCount, deployLimit, DEPLOYMENT_PRESETS, hasFort, plannedCompanies, PLANNED_COMPANIES_MAX, presetDeployment, SQUAD_SIZE_MIN, SQUAD_SIZE_STEP,
  squadSizeMax, SQUADS_PER_TYPE_MAX, UNIT_TYPES, type DeploymentPlan,
} from '~/game/deployment'
import type { BattleMode, UnitType } from '~/types/game'

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
/** 中隊を組んでいない（開戦時に自動で中隊に分ける）兵種の小隊。 */
const autoSquadsOf = (type: UnitType) => squadsOf(type).filter(sq => sq.company === undefined)
const typeTotal = (type: UnitType) => autoSquadsOf(type).reduce((sum, sq) => sum + sq.size, 0)
const canAdd = (type: UnitType) => room.value >= SQUAD_SIZE_MIN && squadsOf(type).length < SQUADS_PER_TYPE_MAX

/** 編成で組んだ中隊（番号の順）と、その小隊。 */
const companies = computed(() => plannedCompanies(draft.value).map(({ company, indices }) => ({ company, squads: indices.map(index => ({ ...draft.value.squads[index]!, index })) })))
const nextCompany = () => Math.max(0, ...draft.value.squads.map(sq => sq.company ?? 0)) + 1
/** 中隊にもう1小隊入れられるか。 */
const canAddTo = (company: number, type: UnitType) => canAdd(type) && draft.value.squads.filter(sq => sq.company === company).length < COMPANY_MAX_SQUADS
/** ひな形の兵種で中隊を組む（足りない人数・上限で入らない小隊は飛ばす）。 */
const addCompany = (types: UnitType[]) => {
  if (companies.value.length >= PLANNED_COMPANIES_MAX) return
  const company = nextCompany()
  for (const type of types) addSquad(type, company)
}
/** 中隊を解き、小隊は自動で中隊に分ける側へ戻す。 */
const disbandCompany = (company: number) => { for (const sq of draft.value.squads) if (sq.company === company) delete sq.company }
const removeCompany = (company: number) => { draft.value.squads = draft.value.squads.filter(sq => sq.company !== company) }
const companyTotal = (squads: { size: number }[]) => squads.reduce((sum, sq) => sum + sq.size, 0)

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
  const at = draft.value.squads.reduce((last, sq, i) => UNIT_TYPES.indexOf(sq.type) <= UNIT_TYPES.indexOf(type) ? i + 1 : last, 0)
  draft.value.squads.splice(at, 0, company === undefined ? { type, size } : { type, size, company })
}
const removeSquad = (index: number) => { draft.value.squads.splice(index, 1) }
const save = () => { if (draft.value.squads.length) emit('save', draft.value) }
</script>

<template>
  <div class="deploy-dock">
    <section class="deploy-panel" role="dialog" aria-modal="true" aria-labelledby="deploy-title">
      <header>
        <h2 id="deploy-title">部隊編成</h2>
        <span class="deploy-mode">{{ modeName }} · 人間軍</span>
      </header>

      <div class="deploy-group">
        <span class="deploy-label">プリセット</span>
        <div class="deploy-buttons">
          <button v-for="preset in DEPLOYMENT_PRESETS" :key="preset.key" :title="preset.description" @click="applyPreset(preset.key)">{{ preset.name }}<small>{{ preset.description }}</small></button>
        </div>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">開戦時の陣</span>
        <div class="deploy-buttons formations" role="radiogroup" aria-label="開戦時の陣">
          <button v-for="f in FORMATIONS" :key="f.type" role="radio" :aria-checked="draft.formation === f.type" :class="{ active: draft.formation === f.type }" :title="f.description" @click="draft.formation = f.type">{{ f.name }}</button>
        </div>
        <p class="deploy-note">{{ FORMATIONS.find(f => f.type === draft.formation)!.description }}</p>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">中隊を組む（兵種を混ぜてよい · 1中隊{{ COMPANY_MAX_SQUADS }}小隊まで）</span>
        <div class="deploy-buttons templates">
          <button v-for="t in COMPANY_TEMPLATES" :key="t.key" :title="t.description" :disabled="room < SQUAD_SIZE_MIN || companies.length >= PLANNED_COMPANIES_MAX" @click="addCompany(t.types)">
            ＋ {{ t.name }}<small>{{ t.types.map(type => TYPE_MARK[type]).join('・') }}</small>
          </button>
        </div>
        <ul v-if="companies.length" class="deploy-types companies">
          <li v-for="(c, n) in companies" :key="c.company">
            <div class="type-head">
              <span>第{{ n + 1 }}中隊</span>
              <small>{{ c.squads.map(sq => TYPE_MARK[sq.type]).join('・') }} · {{ companyTotal(c.squads) }}人</small>
              <span class="company-actions">
                <button class="add" :aria-label="`第${n + 1}中隊を解いて、小隊を自動の中隊に戻す`" @click="disbandCompany(c.company)">解く</button>
                <button class="add" :aria-label="`第${n + 1}中隊を外す`" @click="removeCompany(c.company)">×</button>
              </span>
            </div>
            <div class="squads">
              <div v-for="sq in c.squads" :key="sq.index" class="squad-chip">
                <span class="squad-no">{{ unitNames[sq.type] }}</span>
                <button :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${SQUAD_SIZE_STEP}人減らす`" :disabled="sq.size <= SQUAD_SIZE_MIN" @click="step(sq.index, -SQUAD_SIZE_STEP)">−</button>
                <input type="number" :value="sq.size" :min="SQUAD_SIZE_MIN" :max="squadSizeMax(sq.type)" :step="SQUAD_SIZE_STEP" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を${SQUAD_SIZE_STEP}人増やす`" :disabled="sq.size >= squadSizeMax(sq.type) || room <= 0" @click="step(sq.index, SQUAD_SIZE_STEP)">＋</button>
                <button class="remove" :aria-label="`第${n + 1}中隊の${unitNames[sq.type]}を外す`" @click="removeSquad(sq.index)">×</button>
              </div>
              <span class="add-types">
                <button v-for="type in UNIT_TYPES" :key="type" :disabled="!canAddTo(c.company, type)" :title="`${unitNames[type]}の小隊を加える`" :aria-label="`第${n + 1}中隊に${unitNames[type]}の小隊を加える`" @click="addSquad(type, c.company)">＋{{ TYPE_MARK[type] }}</button>
              </span>
            </div>
          </li>
        </ul>
        <p class="deploy-note">組んだ中隊は陣でひとかたまりに並び（槍兵が前、弓兵が後ろ、騎兵が両翼）、中隊で動くときは一番遅い小隊に足並みをそろえます。弓兵に敵が迫ると、同じ中隊の近接の小隊が迎え撃ちます。</p>
      </div>

      <div class="deploy-group">
        <span class="deploy-label">{{ companies.length ? 'そのほかの小隊（陣で隣り合う同じ兵種で自動で中隊に分ける）' : '部隊（兵種と人数。陣で隣り合う同じ兵種で自動で中隊に分ける）' }}</span>
        <ul class="deploy-types">
          <li v-for="type in UNIT_TYPES" :key="type">
            <div class="type-head">
              <span>{{ unitNames[type] }}</span>
              <small>{{ autoSquadsOf(type).length }}小隊 · {{ typeTotal(type) }}人</small>
              <button class="add" :disabled="!canAdd(type)" :aria-label="`${unitNames[type]}の小隊を加える`" @click="addSquad(type)">＋ 小隊</button>
            </div>
            <div class="squads">
              <div v-for="(sq, n) in autoSquadsOf(type)" :key="sq.index" class="squad-chip">
                <span class="squad-no">第{{ n + 1 }}</span>
                <button :aria-label="`第${n + 1}${unitNames[type]}小隊を${SQUAD_SIZE_STEP}人減らす`" :disabled="sq.size <= SQUAD_SIZE_MIN" @click="step(sq.index, -SQUAD_SIZE_STEP)">−</button>
                <input type="number" :value="sq.size" :min="SQUAD_SIZE_MIN" :max="squadSizeMax(type)" :step="SQUAD_SIZE_STEP" :aria-label="`第${n + 1}${unitNames[type]}小隊の人数`"
                  @change="setSize(sq.index, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(draft.squads[sq.index]!.size)">
                <button :aria-label="`第${n + 1}${unitNames[type]}小隊を${SQUAD_SIZE_STEP}人増やす`" :disabled="sq.size >= squadSizeMax(type) || room <= 0" @click="step(sq.index, SQUAD_SIZE_STEP)">＋</button>
                <button class="remove" :aria-label="`第${n + 1}${unitNames[type]}小隊を外す`" @click="removeSquad(sq.index)">×</button>
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
          <button class="secondary" @click="emit('close')">戻る</button>
          <button :disabled="!draft.squads.length" @click="save">開戦する →</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.deploy-dock { position: absolute; z-index: 30; top: 96px; right: 20px; bottom: 20px; width: min(540px, calc(100% - 32px)); display: flex; align-items: flex-start; pointer-events: none; }
.deploy-panel { pointer-events: auto; width: 100%; max-height: 100%; overflow-y: auto; box-sizing: border-box; padding: 20px 24px; background: #121b22f2; border: 1px solid #a48d5f; border-radius: 6px; color: #dfe3df; text-align: left; }
header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
h2 { margin: 0; font: 400 22px Georgia, serif; letter-spacing: .1em; color: #f2e8cf; }
.deploy-mode { font-size: 12px; color: #a6b0b0; letter-spacing: .08em; }
.deploy-group { margin-bottom: 16px; }
.deploy-label { display: block; margin-bottom: 6px; font-size: 11px; letter-spacing: .14em; color: #c5af83; }
.deploy-note { margin: 6px 0 0; font-size: 11px; color: #97a3a4; }
button { margin: 0; padding: 6px 12px; font-size: 12px; background: #1d242b; border: 1px solid #5d6466; border-radius: 3px; color: #dfe3df; cursor: pointer; }
button:hover:not(:disabled) { border-color: #c2a875; }
button:disabled { opacity: .4; cursor: default; }
button.active { border-color: #c2a875; background: #3a3121; color: #f2e8cf; }
.deploy-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.deploy-buttons button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.deploy-buttons small { font-size: 10px; color: #97a3a4; }
.deploy-buttons.formations button { min-width: 56px; align-items: center; }
.deploy-types { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.deploy-types li { padding: 8px 10px; background: #0b1318; border: 1px solid #2c383d; border-radius: 4px; }
.type-head { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.type-head small { color: #97a3a4; font-size: 11px; font-variant-numeric: tabular-nums; }
.type-head .add { margin-left: auto; padding: 3px 10px; font-size: 11px; }
.templates button { min-width: 64px; }
.companies { margin-top: 8px; }
.company-actions { margin-left: auto; display: flex; gap: 4px; }
.company-actions .add { margin-left: 0; }
.add-types { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.add-types button { padding: 2px 6px; font-size: 11px; }
.squads { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.squads:empty { display: none; }
.squad-chip { display: flex; align-items: center; gap: 2px; padding: 2px 4px; background: #17222a; border: 1px solid #3a474d; border-radius: 3px; font-size: 11px; }
.squad-no { margin: 0 4px 0 2px; color: #97a3a4; }
.squad-chip button { padding: 1px 6px; font-size: 12px; line-height: 1.2; }
.squad-chip .remove { margin-left: 2px; background: transparent; border-color: transparent; color: #9aa7a8; }
.squad-chip input { width: 42px; padding: 2px; background: #0b1318; color: #fff; border: 1px solid #3a474d; border-radius: 2px; text-align: center; font: 12px system-ui; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
.squad-chip input::-webkit-inner-spin-button, .squad-chip input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
footer { position: sticky; bottom: -20px; margin: 0 -24px -20px; padding: 12px 24px 16px; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; background: #121b22; border-top: 1px solid #2c383d; }
.deploy-totals { display: grid; grid-template-columns: auto auto; gap: 3px 14px; margin: 0; font-size: 12px; }
.deploy-totals dt { color: #97a3a4; }
.deploy-totals dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.deploy-totals small { color: #97a3a4; font-size: 10px; }
.deploy-totals .warn { color: #e8b25a; }
.deploy-actions { display: flex; gap: 8px; }
.deploy-actions button { padding: 9px 22px; font-size: 13px; letter-spacing: .1em; }
.deploy-actions button:not(.secondary) { border-color: #c2a875; color: #f2e8cf; }
.deploy-actions .secondary { background: transparent; }
@media (max-width: 550px) { .deploy-dock { top: 84px; right: 16px; bottom: 16px; } .deploy-panel { padding: 16px; } footer { bottom: -16px; margin: 0 -16px -16px; padding: 12px 16px; } .deploy-buttons small { display: none; } }
</style>
