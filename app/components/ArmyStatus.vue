<script setup lang="ts">
import { ref } from 'vue'
import { useGameStore } from '~/stores/game'
import type { Army } from '~/types/game'
import { ARMY_NAME, UNIT_NAME, UNIT_TYPES } from './battleUi'

/** 片方の軍の戦況。普段は総数と本陣の耐久だけを出し、乗せる（タップする）と内訳を開く。 */
const props = defineProps<{ army: Army }>()
const gameStore = useGameStore()
const open = ref(false)
const percent = (value: number, max: number) => `${Math.max(0, Math.min(100, value / max * 100))}%`
</script>

<template>
  <div class="army-status" :class="[army, { open }]" @click="open = !open">
    <div class="army-head">
      <span class="army-name">{{ ARMY_NAME[army] }}</span>
      <b class="army-total">{{ gameStore.summary[army].total.toLocaleString() }}</b>
    </div>
    <div v-if="gameStore.summary[army].hasFort" class="fort-bar" role="meter" :aria-label="`${ARMY_NAME[army]}の本陣耐久`" :aria-valuenow="Math.max(0, Math.ceil(gameStore.summary[army].fortHp))" :aria-valuemin="0" :aria-valuemax="gameStore.summary[army].fortMaxHp" :title="`本陣の耐久 ${Math.ceil(gameStore.summary[army].fortHp)} / ${gameStore.summary[army].fortMaxHp}`">
      <span :style="{ width: percent(gameStore.summary[army].fortHp, gameStore.summary[army].fortMaxHp) }"></span>
    </div>
    <p v-else class="no-fort">砦なし · 全滅で敗北</p>
    <dl class="army-details parchment-window">
      <template v-for="type in UNIT_TYPES" :key="type"><dt>{{ UNIT_NAME[props.army][type] }}</dt><dd>{{ gameStore.summary[army][type] }}</dd></template>
      <template v-if="gameStore.summary[army].hasFort"><dt>予備兵</dt><dd>{{ gameStore.summary[army].reserves }}</dd></template>
      <dt>撃破</dt><dd>{{ gameStore.summary[army].killed }}</dd>
      <template v-if="gameStore.summary[army].deserted"><dt>逃走</dt><dd>{{ gameStore.summary[army].deserted }}</dd></template>
    </dl>
  </div>
</template>

<style scoped>
.army-status { position: relative; box-sizing: border-box; width: 224px; max-width: calc((100vw - 264px) / 2); padding: 9px 12px; border: 3px solid #927043; border-top-color: #d5b77b; border-right-color: #a58350; border-bottom-color: #5c3d21; border-radius: 4px; background: linear-gradient(#170d0670, #100804a6), url('/images/ui/command-walnut.png') center / 320px auto; box-shadow: inset 0 0 0 1px #38220f, inset 0 2px 6px #0008, 0 3px 8px #0009; cursor: pointer; user-select: none; }
/* Small brass pins stay in the frame, clear of names and durability bars. */
.army-status::after { content: ''; position: absolute; inset: -2px; pointer-events: none; background: radial-gradient(circle at 2px 2px, #f7df9f 0 1px, #67451e 1.5px 2px, transparent 2.5px) top left, radial-gradient(circle at 2px 2px, #f7df9f 0 1px, #67451e 1.5px 2px, transparent 2.5px) top right, radial-gradient(circle at 2px 2px, #f7df9f 0 1px, #67451e 1.5px 2px, transparent 2.5px) bottom left, radial-gradient(circle at 2px 2px, #f7df9f 0 1px, #67451e 1.5px 2px, transparent 2.5px) bottom right; background-size: 4px 4px; background-repeat: no-repeat; }
.army-status:hover, .army-status.open { border-top-color: #ffe2a0; box-shadow: inset 0 0 0 1px #b88f4c88, 0 3px 8px #0009; }
.army-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11px; letter-spacing: .08em; color: #e2c78e; text-shadow: 0 1px 2px #000; }
.army-name { white-space: nowrap; }
.army-total { font: 600 20px system-ui; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.player .army-total { color: #b4d5ff; }
.cpu .army-total { color: #ffb3a0; }
.cpu .army-head { flex-direction: row-reverse; }
.fort-bar { position: relative; height: 8px; margin-top: 7px; background: #130d08; border: 1px solid #ad884d; border-bottom-color: #dbba7c; border-radius: 2px; overflow: hidden; box-shadow: 0 1px 0 #000b, inset 0 1px 3px #000; }
.fort-bar::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(20% - 1px), #110b0866 calc(20% - 1px), #110b0866 20%); }
.fort-bar span { display: block; height: 100%; box-shadow: inset 0 1px #ffffff66, inset 0 -1px #0005; transition: width .2s; }
.player .fort-bar span { background: linear-gradient(#a1c6ed, #5f8ebf 48%, #355d89); }
.cpu .fort-bar { transform: scaleX(-1); }
.cpu .fort-bar span { background: linear-gradient(#f1a08a, #c65c46 48%, #813626); }
.no-fort { margin: 7px 0 0; font-size: 10px; line-height: 1.3; color: #dfc08a; }
.cpu .no-fort { text-align: right; }
.army-details { display: none; position: absolute; z-index: 1; top: 100%; left: -3px; right: -3px; box-sizing: border-box; min-width: 156px; grid-template-columns: 1fr auto; gap: 3px 8px; margin: 0; padding: 10px 12px; font-size: 11px; color: #59432e; }
.cpu .army-details { left: auto; width: calc(100% + 6px); }
.army-details dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: #39291d; }
.army-status:hover .army-details, .army-status.open .army-details { display: grid; }
@media (max-width: 900px) { .army-status { width: 162px; padding: 8px; } .army-total { font-size: 18px; } }
@media (max-width: 550px) {
  .army-status { width: 108px; max-width: calc((100vw - 168px) / 2); padding: 6px; }
  .army-head, .cpu .army-head { flex-direction: column; align-items: flex-start; gap: 1px; }
  .cpu .army-head { align-items: flex-end; }
  .army-name { font-size: 10px; letter-spacing: .02em; }
  .army-total { font-size: 16px; }
  .fort-bar { height: 6px; margin-top: 4px; }
  .no-fort { margin-top: 4px; font-size: 9px; }
  .army-details { padding: 6px 8px; }
}
@media (prefers-reduced-motion: reduce) { .fort-bar span { transition: none; } }
</style>
