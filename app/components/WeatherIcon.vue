<script setup lang="ts">
import type { WeatherChoice } from '~/types/game'

defineProps<{ weather: WeatherChoice }>()

// Ink drawings in the same style as the terrain and time icons.
const CLOUD = 'M8 20a5 5 0 0 1 1-9.900A7 7 0 0 1 22.500 9 5.500 5.500 0 0 1 24 20Z'
const paths: Record<WeatherChoice, string> = {
  auto: 'M10 11a6 6 0 1 1 9 5.200c-2 1.200-3 2.300-3 4.800M16 26v.5M5 6l2 2M27 6l-2 2',
  clear: 'M11 16a5 5 0 1 0 10 0 5 5 0 1 0-10 0M16 4v4M16 24v4M4 16h4M24 16h4M7.500 7.500l2.800 2.800M21.700 21.700l2.800 2.800M7.500 24.500l2.800-2.800M21.700 10.300l2.800-2.800',
  cloudy: `${CLOUD}M5 26h22`,
  rain: `${CLOUD}M11 23l-2 5M17 23l-2 5M23 23l-2 5`,
  fog: 'M4 9h17M8 14h20M4 19h18M10 24h18M24 9h4M4 24h3',
}
</script>

<template>
  <svg class="weather-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[weather]" />
  </svg>
</template>

<style scoped>
.weather-icon { display: block; flex: none; width: 30px; height: 30px; }
</style>
