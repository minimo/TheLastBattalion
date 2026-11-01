<script setup lang="ts">
import type { StartTime } from '~/types/game'

defineProps<{ time: StartTime }>()

// Ink drawings in the same style as the terrain icons.
const paths: Record<StartTime, string> = {
  dawn: 'M3 23h26M9 23a7 7 0 0 1 14 0M16 4v8M12.5 7.5 16 4l3.5 3.5M7 27h18M6 15l2 2M26 15l-2 2',
  noon: 'M11 16a5 5 0 1 0 10 0 5 5 0 1 0-10 0M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8',
  dusk: 'M3 23h26M9 23a7 7 0 0 1 14 0M16 4v8M12.5 8.5 16 12l3.5-3.5M7 27h18M6 15l2 2M26 15l-2 2',
  midnight: 'M20 6.3a10 10 0 1 0 5.4 14.1A8 8 0 0 1 20 6.3ZM7 4v4M5 6h4M26 7v2M25 8h2',
}
</script>

<template>
  <svg class="time-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[time]" />
  </svg>
</template>

<style scoped>
.time-icon { display: block; flex: none; width: 30px; height: 30px; }
</style>
