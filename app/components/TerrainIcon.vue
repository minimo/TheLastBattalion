<script setup lang="ts">
import type { MapType } from '~/types/game'

defineProps<{ type: MapType }>()

// Ink drawings that stay sharp on the parchment at small sizes.
const paths: Record<MapType, string> = {
  standard: 'M3 21 12 6 21 21M9 11l3 3 3-3M19 18l5-10 5 10h-3l4 6H18l4-6h-3M24 24v4M3 26c4-3 7 3 11 0',
  meadow: 'M2 24c5-8 12-8 17 0M15 23c5-6 10-6 15 0M7 23v-6m0 4-3-3m3 2 3-4M24 13v-4m-2 2h4M3 28h26',
  forest: 'M9 27v-5M9 22l-5 0 3-5-2 0 4-7 4 7-2 0 3 5ZM23 27v-6M23 21h-6l4-6h-3l5-9 5 9h-3l4 6ZM3 28h26',
  snowfield: 'M2 26c6-5 11-5 16-1s8 3 12 0M16 4v14M10 7.500l12 7M22 7.500l-12 7M16 8l-2-2m2 2 2-2M16 14l-2 2m2-2 2 2',
  desert: 'M2 24c5-8 9-10 15-2M12 26c6-10 11-10 18-2M3 28h26M22 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  wasteland: 'M3 26h26M5 26l3-8 5-1 4 9M18 26l3-5h5l3 5M21 17V5m0 7-5-4m5 1 4-4M9 20l2 3',
  demonland: 'M6 27V13h5v5h4V9h4v9h3v-5h4v14H6M4 13l5-5 4 5M12 9l5-6 5 6M20 13l4-5 5 5M14 27v-5h5v5',
}
</script>

<template>
  <svg class="terrain-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[type]" />
  </svg>
</template>

<style scoped>
.terrain-icon { display: block; flex: none; width: 30px; height: 30px; }
</style>
