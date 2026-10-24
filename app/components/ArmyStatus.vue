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
    <div v-if="gameStore.summary[army].hasFort" class="fort-bar" :aria-label="`本陣の耐久 ${Math.ceil(gameStore.summary[army].fortHp)}`">
      <span :style="{ width: percent(gameStore.summary[army].fortHp, gameStore.summary[army].fortMaxHp) }"></span>
    </div>
    <p v-else class="no-fort">砦なし · 全滅で敗北</p>
    <dl class="army-details">
      <template v-for="type in UNIT_TYPES" :key="type"><dt>{{ UNIT_NAME[props.army][type] }}</dt><dd>{{ gameStore.summary[army][type] }}</dd></template>
      <template v-if="gameStore.summary[army].hasFort"><dt>予備兵</dt><dd>{{ gameStore.summary[army].reserves }}</dd></template>
      <dt>撃破</dt><dd>{{ gameStore.summary[army].killed }}</dd>
      <template v-if="gameStore.summary[army].deserted"><dt>逃走</dt><dd>{{ gameStore.summary[army].deserted }}</dd></template>
    </dl>
  </div>
</template>

<style scoped>
.army-status { position: relative; width: 200px; padding: 8px 12px; cursor: default; user-select: none; }
.army-head { display: flex; align-items: baseline; gap: 10px; font-size: 11px; letter-spacing: .08em; color: #c6cfcd; }
.army-total { font: 600 18px system-ui; font-variant-numeric: tabular-nums; }
.player .army-total { color: #9fc0f5; }
.cpu .army-total { color: #f1907f; }
.cpu .army-head { flex-direction: row-reverse; }
.fort-bar { height: 5px; margin-top: 6px; background: #00000080; border: 1px solid #0006; border-radius: 3px; overflow: hidden; }
.fort-bar span { display: block; height: 100%; transition: width .2s; }
.player .fort-bar span { background: #6f9be8; }
.cpu .fort-bar { transform: scaleX(-1); }
.cpu .fort-bar span { background: #e0614f; }
.no-fort { margin: 5px 0 0; font-size: 10px; color: #c9a36b; }
.cpu .no-fort { text-align: right; }
.army-details { display: none; position: absolute; top: 100%; left: 0; right: 0; grid-template-columns: 1fr auto; gap: 3px 8px; margin: 2px 0 0; padding: 10px 12px; background: #0e1d25ee; border: 1px solid #44545a; border-radius: 6px; font-size: 11px; color: #b8c4c5; }
.army-details dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: #dfe6e4; }
.army-status:hover .army-details, .army-status.open .army-details { display: grid; }
@media (max-width: 900px) { .army-status { width: 150px; padding: 8px 6px; } }
@media (max-width: 550px) { .army-status { width: 96px; } .army-name { display: none; } .army-total { font-size: 15px; } .no-fort { font-size: 9px; } }
</style>
