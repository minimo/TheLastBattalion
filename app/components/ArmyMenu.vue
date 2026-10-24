<script setup lang="ts">
import { FORMATIONS } from '~/game/formation'
import type { FormationType } from '~/types/game'
import { ARMY_ACTIONS } from './battleUi'

/** 全軍の陣形と命令（操作バーの「全軍」と、全軍の旗の長押しメニューで共通）。 */
defineProps<{ formation: FormationType }>()
const emit = defineEmits<{ formation: [type: FormationType]; order: [order: 'charge' | 'hold' | 'retreat'] }>()
</script>

<template>
  <div class="army-menu">
    <span class="army-menu-title">全軍の陣形</span>
    <button v-for="f in FORMATIONS" :key="f.type" class="army-menu-item" :class="{ active: formation === f.type }" @click="emit('formation', f.type)">{{ f.name }}<small>{{ f.description }}</small></button>
    <span class="army-menu-title">全軍への命令</span>
    <div class="army-menu-orders">
      <button v-for="action in ARMY_ACTIONS" :key="action.order" class="army-menu-item" @click="emit('order', action.order)">{{ action.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.army-menu { display: flex; flex-direction: column; min-width: 220px; }
.army-menu-title { padding: 8px 16px 3px; font-size: 10px; letter-spacing: .14em; color: #c5af83; }
.army-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; margin: 0; padding: 6px 16px; background: none; border: 0; border-radius: 0; color: #e4e2da; font-size: 13px; text-align: left; cursor: pointer; }
.army-menu-item small { font-size: 10px; color: #8f9a9b; }
.army-menu-item:hover { background: #22303a; color: #fff; transform: none; }
.army-menu-item.active { color: #f2e8cf; background: #3a3121; }
.army-menu-orders { display: flex; padding: 2px 8px 4px; gap: 4px; }
.army-menu-orders .army-menu-item { align-items: center; padding: 7px 4px; border: 1px solid #44545a; border-radius: 3px; }
.army-menu-orders .army-menu-item:hover { border-color: #c2a875; }
</style>
