<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ dayTime: number }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let sky: HTMLImageElement | null = null
let frame: HTMLCanvasElement | null = null
let disposed = false
const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

function draw() {
  if (!canvas.value || !sky || !frame) return
  const ctx = canvas.value.getContext('2d')!
  ctx.setTransform(2, 0, 0, 2, 0, 0)
  ctx.clearRect(0, 0, 256, 128)
  const time = (props.dayTime % 1440 + 1440) % 1440
  const hour = Math.floor(time / 60), minutes = time % 60
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(128, 105, 97, 78, 0, Math.PI, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  const drawSky = (h: number, alpha: number) => {
    const elapsed = (h - 6 + 24) % 24
    ctx.globalAlpha = alpha
    ctx.drawImage(sky!, 192 + Math.floor(elapsed / 6) * 96 + .5, elapsed % 6 * 80 + 23.5, 95, 40, 31, 26, 194, 80)
  }
  drawSky(hour, 1)
  if (minutes < 45) drawSky((hour + 23) % 24, 1 - minutes / 45)
  ctx.globalAlpha = 1
  for (const [isSun, offset] of [[true, 720], [false, 0]] as const) {
    const angle = ((time - offset + 1800) % 1440) / 1440 * Math.PI * 2
    const x = 128 - Math.cos(angle) * 58
    const y = 105 - Math.sin(angle) * (isSun ? 52 : 58)
    ctx.drawImage(sky, isSun ? .5 : 32.5, 16.5, 31, 31, x - 19, y - 19, 38, 38)
  }
  ctx.drawImage(sky, 96.5, 776.5, 95, 23, 31, 89, 194, 22)
  ctx.restore()
  ctx.drawImage(frame, 0, -56, 256, 256)
}

onMounted(async () => {
  try {
    const [skyImage, relief] = await Promise.all([load('/assets/Denzi100225-4.png'), load('/assets/timedisplay_relief.png')])
    if (disposed) return
    sky = skyImage
    frame = document.createElement('canvas')
    frame.width = relief.width; frame.height = relief.height
    const ctx = frame.getContext('2d')!
    ctx.drawImage(relief, 0, 0)
    // Reuse the original 2D plate's black-background removal.
    const image = ctx.getImageData(0, 0, frame.width, frame.height)
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i]! < 40 && image.data[i + 1]! < 40 && image.data[i + 2]! < 40) image.data[i + 3] = 0
    }
    ctx.putImageData(image, 0, 0)
    draw()
  } catch (error) { console.error('時間表示プレートの読み込みに失敗しました', error) }
})
watch(() => props.dayTime, draw)
onUnmounted(() => { disposed = true; sky = null; frame = null })
</script>

<template>
  <canvas ref="canvas" class="time-plate" width="512" height="256" role="img" :aria-label="dayTime >= 360 && dayTime < 1080 ? '昼の時間帯' : '夜の時間帯'" />
</template>

<style scoped>
.time-plate { width: 224px; height: 112px; display: block; filter: drop-shadow(0 3px 6px #0008); }
@media (max-width: 550px) { .time-plate { width: 140px; height: 70px; } }
</style>
