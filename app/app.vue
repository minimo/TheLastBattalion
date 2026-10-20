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
