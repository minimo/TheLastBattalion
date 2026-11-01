<script setup lang="ts">
import { GUIDELINES } from '~/game/guidelines'
import type { Guideline } from '~/types/game'

/** 部隊の行動の選択（操作バーの「行動」）。 */
defineProps<{ guideline: Guideline; options: Guideline[] }>()
const emit = defineEmits<{ select: [guideline: Guideline] }>()
</script>

<template>
  <div class="guideline-menu" role="radiogroup" aria-label="行動">
    <span class="guideline-menu-title">行動（命令のないときの動き）</span>
    <button v-for="g in options" :key="g" class="guideline-menu-item" role="radio" :aria-checked="guideline === g" :class="{ active: guideline === g }" @click="emit('select', g)">
      <span><span class="check" aria-hidden="true">{{ guideline === g ? '✓' : '' }}</span>{{ GUIDELINES[g].name }}</span><small>{{ GUIDELINES[g].description }}</small>
    </button>
  </div>
</template>

<style scoped>
.guideline-menu { display: flex; flex-direction: column; min-width: 240px; max-width: 320px; }
.guideline-menu-title { padding: 8px 16px 3px; font-size: 10px; letter-spacing: .14em; color: #70502d; }
.guideline-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; margin: 0; padding: 6px 16px; background: none; border: 0; border-radius: 0; color: #493522; font-size: 13px; text-align: left; cursor: pointer; }
.guideline-menu-item small { font-size: 10px; color: #725b43; white-space: normal; }
.guideline-menu-item:hover { background: #b58c4d33; color: #352315; transform: none; }
.guideline-menu-item.active { color: #352315; background: #c5a16a; }
.check { display: inline-block; width: 1.1em; }
</style>
