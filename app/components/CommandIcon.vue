<script setup lang="ts">
import type { CommandIcon } from './battleUi'

defineProps<{ name: CommandIcon }>()
</script>

<template>
  <!-- 線画のSVGをマスクに使い、色は文字色（currentColor）で塗る。 -->
  <span class="command-icon" :style="{ '--icon': `url(/icons/command/${name}.svg)` }" aria-hidden="true"></span>
</template>

<style scoped>
.command-icon { display: block; width: 24px; height: 24px; flex: none; background: currentColor; -webkit-mask: var(--icon) center / contain no-repeat; mask: var(--icon) center / contain no-repeat; }
</style>
