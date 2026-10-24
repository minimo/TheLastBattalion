<script setup lang="ts">
import { ref } from 'vue'
import { useGameStore } from '~/stores/game'
import type { Army } from '~/types/game'
import { ARMY_NAME, UNIT_NAME, UNIT_TYPES } from './battleUi'

/** 操作バーの「メニュー」。戦況の詳細・操作説明・陣営・戦場の情報と、タイトルへ戻る。 */
defineProps<{ modeName: string; mapName: string }>()
const emit = defineEmits<{ close: []; title: [] }>()
const gameStore = useGameStore()
const armies: Army[] = ['player', 'cpu']
const copied = ref(false)
const copySeed = async () => {
  try { await navigator.clipboard.writeText(gameStore.seed); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* コピーできない環境では表示だけ */ }
}
</script>

<template>
  <section class="battle-menu" role="dialog" aria-label="メニュー">
    <header>
      <h2>THE LAST BATTALION</h2>
      <button class="close" aria-label="メニューを閉じる" @click="emit('close')">×</button>
    </header>

    <div class="menu-group">
      <span class="menu-label">戦場</span>
      <p>{{ modeName }} · {{ mapName }}</p>
      <p class="seed">SEED <code>{{ gameStore.seed }}</code><button class="small" @click="copySeed">{{ copied ? 'コピーしました' : 'コピー' }}</button></p>
    </div>

    <div class="menu-group">
      <span class="menu-label">戦況</span>
      <table>
        <thead><tr><th></th><th v-for="army in armies" :key="army" :class="army">{{ ARMY_NAME[army] }}</th></tr></thead>
        <tbody>
          <tr><th>総数</th><td v-for="army in armies" :key="army">{{ gameStore.summary[army].total }}</td></tr>
          <tr v-for="type in UNIT_TYPES" :key="type"><th>{{ UNIT_NAME.player[type] }}</th><td v-for="army in armies" :key="army">{{ gameStore.summary[army][type] }}</td></tr>
          <tr><th>予備兵</th><td v-for="army in armies" :key="army">{{ gameStore.summary[army].hasFort ? gameStore.summary[army].reserves : '—' }}</td></tr>
          <tr><th>撃破</th><td v-for="army in armies" :key="army">{{ gameStore.summary[army].killed }}</td></tr>
          <tr><th>逃走</th><td v-for="army in armies" :key="army">{{ gameStore.summary[army].deserted }}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="menu-group">
      <span class="menu-label">陣営</span>
      <p><span class="dot player"></span>人間軍は昼に強い · <span class="dot cpu"></span>魔王軍は夜に強い</p>
    </div>

    <div class="menu-group">
      <span class="menu-label">操作</span>
      <dl class="help">
        <dt>部隊の旗をドラッグ</dt><dd>移動 · 敵部隊へ攻撃 · 敵の建設物へ破壊 · 自陣へ退却 · 敵陣へ突撃</dd>
        <dt></dt><dd>補給部隊を味方へ落とすと補給 · 工兵を川へ落とすと橋</dd>
        <dt>全軍の旗をドラッグ</dt><dd>陣全体を移動</dd>
        <dt>旗を長押し</dt><dd>指示のメニュー（表示中は一時停止）</dd>
        <dt>兵士をクリック</dt><dd>部隊を選択（操作バーに指示が出る）</dd>
        <dt>Space</dt><dd>一時停止（停止中も指示できる）</dd>
        <dt>Esc / R</dt><dd>ドラッグ・建設の取り消し / 柵の向きを変える</dd>
        <dt>カメラ</dt><dd>何もない場所を左ドラッグで回転 · 右 / Shift＋左ドラッグでパン · ホイールでズーム · 2本指で回転・ピンチでズーム</dd>
      </dl>
    </div>

    <button class="title" @click="emit('title')">タイトルへ戻る</button>
  </section>
</template>

<style scoped>
.battle-menu { position: absolute; z-index: 31; right: 16px; bottom: 120px; width: min(380px, calc(100% - 32px)); max-height: calc(100% - 240px); overflow-y: auto; box-sizing: border-box; padding: 16px 20px; background: #121b22f4; border: 1px solid #a48d5f; border-radius: 8px; color: #dfe3df; font-size: 12px; box-shadow: 0 8px 24px #000a; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
h2 { margin: 0; font: 400 15px Georgia, serif; letter-spacing: .14em; color: #f2e8cf; }
button { margin: 0; cursor: pointer; font: inherit; }
.close { padding: 0 6px; font-size: 18px; background: none; border: 0; color: #9aa7a8; }
.menu-group { padding: 10px 0; border-top: 1px solid #2c383d; }
.menu-label { display: block; margin-bottom: 6px; font-size: 10px; letter-spacing: .16em; color: #c5af83; }
p { margin: 0 0 4px; color: #c6cfcd; }
.seed { display: flex; align-items: center; gap: 8px; }
code { font: 12px monospace; color: #f2e8cf; letter-spacing: .06em; }
.small { margin-left: auto; padding: 3px 10px; font-size: 11px; background: #1d242b; border: 1px solid #5d6466; border-radius: 3px; color: #dfe3df; }
.small:hover { border-color: #c2a875; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 2px 4px; font-weight: 400; text-align: right; }
th:first-child { text-align: left; color: #97a3a4; }
thead th.player { color: #9fc0f5; }
thead th.cpu { color: #f1907f; }
.dot { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; vertical-align: middle; }
.dot.player { background: #6f9be8; }
.dot.cpu { background: #e0614f; }
.help { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 11px; }
.help dt { color: #e2cf9f; white-space: nowrap; }
.help dd { margin: 0; color: #b8c4c5; }
.title { width: 100%; margin-top: 6px; padding: 9px; background: transparent; border: 1px solid #5d6466; border-radius: 4px; color: #e9dab9; letter-spacing: .12em; }
.title:hover { border-color: #c2a875; }
@media (max-width: 550px) { .battle-menu { right: 8px; left: 8px; width: auto; bottom: 110px; max-height: calc(100% - 200px); } .help { grid-template-columns: 1fr; } }
</style>
