<script setup lang="ts">
import GameCanvas from '~/components/GameCanvas.vue'
</script>

<template>
  <div class="app-container">
    <main class="game-view">
      <GameCanvas />
    </main>
  </div>
</template>

<style>
/* Global reset/base styles */
body {
  margin: 0;
  padding: 0;
  background: #121212;
  color: #e0e0e0;
  font-family: 'Outfit', 'Inter', system-ui, sans-serif;
  overflow: hidden;
}

/* Scrollbars matched to the panel palette (Firefox / Chromium use scrollbar-color, Safari the pseudo-elements) */
* {
  scrollbar-width: thin;
  scrollbar-color: #5d6466 transparent;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #5d6466;
  border: 2px solid transparent;
  border-radius: 4px;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background-color: #a48d5f;
}

::-webkit-scrollbar-corner {
  background: transparent;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

.game-view {
  flex: 1;
  position: relative;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
}
</style>
