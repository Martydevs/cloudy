<script setup lang="ts">
// Reproductor con el tema de Cloudy (FR-012–FR-014, research D5): `<video>` nativo sin `controls` y una barra propia.
// La fuente es una copia 720p que se prepara solo al pulsar Reproducir. Pantalla completa sobre el contenedor (no
// sobre el `<video>`) para conservar la barra (US4). Se carga diferido (`LazyYoutubePlayer`).
import type { PlaybackState } from '~/composables/useYoutubePlayback'

const props = withDefaults(defineProps<{
  videoId: string
  poster?: string | null
  title?: string
  initialJobId?: string | null
  /** Ocupa todo el alto disponible (ventana externa) en lugar de 16:9. */
  fill?: boolean
}>(), { poster: null, title: '', initialJobId: null, fill: false })

const emit = defineEmits<{ state: [state: PlaybackState, jobId: string | null] }>()

const playback = useYoutubePlayback(() => props.videoId, { initialJobId: props.initialJobId })
const { state, progress, src, jobId, message } = playback

const container = useTemplateRef<HTMLElement>('container')
const video = useTemplateRef<HTMLVideoElement>('video')
const { playing, currentTime, duration, volume, muted, waiting } = useMediaControls(video)
const { isFullscreen, toggle: toggleFullscreen, exit: exitFullscreen } = useFullscreen(container)

const statusId = useId()

watch([state, jobId], ([s, id]) => emit('state', s, id), { immediate: true })

// Al quedar lista tras pulsar Reproducir, arranca sola (el navegador puede bloquearlo: entonces basta con pulsar).
watch(state, async (s) => {
  if (s !== 'ready' || !playback.autoplay.value) return
  await nextTick()
  video.value?.play().catch(() => {})
})

// Renovar la firma conserva la posición.
let resumeAt = 0
async function onVideoError() {
  resumeAt = currentTime.value
  await playback.renew()
}
function onLoadedMetadata() {
  if (resumeAt > 0 && video.value) {
    video.value.currentTime = resumeAt
    resumeAt = 0
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function togglePlay() {
  if (!video.value) return
  if (video.value.paused) video.value.play().catch(() => {})
  else video.value.pause()
}
function seekBy(seconds: number) {
  currentTime.value = clamp(currentTime.value + seconds, 0, duration.value || 0)
}
function volumeBy(delta: number) {
  volume.value = Math.round(clamp(volume.value + delta, 0, 1) * 100) / 100
  if (volume.value > 0) muted.value = false
}

async function fullscreen() {
  if (state.value !== 'ready') return
  await toggleFullscreen()
}

// Atajos con el foco en el reproductor (no en sus botones ni barras, que ya responden al teclado por sí mismos).
const SHORTCUTS = [' ', 'k', 'K', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'F']
onKeyStroke(SHORTCUTS, (event) => {
  if (state.value !== 'ready') return
  const target = event.target as HTMLElement | null
  if (target !== container.value && target !== video.value) return
  event.preventDefault()
  switch (event.key) {
    case ' ': case 'k': case 'K': togglePlay(); break
    case 'ArrowLeft': seekBy(-5); break
    case 'ArrowRight': seekBy(5); break
    case 'ArrowUp': volumeBy(0.1); break
    case 'ArrowDown': volumeBy(-0.1); break
    case 'f': case 'F': void fullscreen(); break
  }
}, { target: container })

onScopeDispose(() => {
  if (isFullscreen.value) void exitFullscreen()
})

const timeText = computed(() => `${formatDuration(currentTime.value)} / ${formatDuration(duration.value)}`)
const positionText = computed(() => `${spokenDuration(currentTime.value)} de ${spokenDuration(duration.value)}`)

defineExpose({ fullscreen, state, jobId, isFullscreen })
</script>

<template>
  <div
    ref="container"
    tabindex="0"
    class="flex w-full flex-col overflow-hidden rounded-box bg-neutral text-neutral-content outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
    :class="{ 'h-full': isFullscreen, 'flex-1 self-stretch': fill, 'rounded-none': isFullscreen }"
    :aria-label="title ? `Reproductor: ${title}` : 'Reproductor'"
    role="region"
  >
    <div class="relative w-full" :class="fill || isFullscreen ? 'min-h-0 flex-1' : 'aspect-video'">
      <!-- Póster: la miniatura del video, con dimensiones declaradas (sin saltos de diseño). -->
      <img
        v-if="poster && state !== 'ready'"
        :src="poster"
        alt=""
        width="480"
        height="360"
        class="absolute inset-0 size-full object-cover"
        :class="{ 'opacity-40': state !== 'idle' }"
      >

      <div v-if="state === 'idle'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral/40 p-4 text-center">
        <button type="button" class="btn btn-primary btn-circle btn-xl" aria-label="Preparar y reproducir" @click="playback.prepare()">
          <Icon name="lucide:play" class="size-8" aria-hidden="true" />
        </button>
        <p class="max-w-xs rounded-box bg-neutral/80 px-3 py-1 text-sm">{{ messages.youtube.player.idleHint }}</p>
      </div>

      <div v-else-if="state === 'preparing'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p :id="statusId" role="status" class="rounded-box bg-neutral/80 px-3 py-1">{{ messages.youtube.player.preparing(progress) }}</p>
        <progress class="progress progress-primary w-2/3 max-w-sm" :value="progress" max="100" :aria-labelledby="statusId" />
        <button type="button" class="btn" @click="playback.cancel()">Cancelar</button>
      </div>

      <div v-else-if="state === 'error'" class="absolute inset-0 flex items-center justify-center p-4">
        <div role="alert" class="alert alert-error flex max-w-md flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
          <span class="flex-1">{{ message ?? messages.youtube.player.failed }}</span>
          <button type="button" class="btn" @click="playback.prepare()">
            <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      </div>

      <div v-else-if="state === 'expired'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p class="rounded-box bg-neutral/80 px-3 py-1">{{ messages.youtube.player.expired }}</p>
        <button type="button" class="btn btn-primary" @click="playback.prepare()">
          <Icon name="lucide:rotate-ccw" class="size-4" aria-hidden="true" />
          Preparar de nuevo
        </button>
      </div>

      <template v-else>
        <video
          ref="video"
          :src="src ?? undefined"
          class="absolute inset-0 size-full bg-neutral object-contain"
          playsinline
          preload="metadata"
          :poster="poster ?? undefined"
          @error="onVideoError"
          @loadedmetadata="onLoadedMetadata"
          @click="togglePlay"
        />
        <span v-if="waiting" class="loading loading-spinner loading-lg absolute left-1/2 top-1/2 -translate-1/2 motion-reduce:animate-none" aria-label="Cargando" />
      </template>
    </div>

    <!-- Barra de controles (solo con el video listo): botones ≥ 44 px, todo operable con teclado. -->
    <div v-if="state === 'ready'" class="flex flex-wrap items-center gap-1 bg-neutral px-2 py-1 sm:gap-2">
      <button type="button" class="btn btn-ghost btn-square text-neutral-content" :aria-label="playing ? 'Pausar' : 'Reproducir'" @click="togglePlay">
        <Icon :name="playing ? 'lucide:pause' : 'lucide:play'" class="size-5" aria-hidden="true" />
      </button>
      <input
        v-model.number="currentTime"
        type="range"
        min="0"
        :max="duration || 0"
        step="0.1"
        class="range range-primary range-xs order-last min-h-11 w-full sm:order-none sm:w-auto sm:flex-1"
        aria-label="Posición"
        :aria-valuetext="positionText"
      >
      <span class="min-w-24 text-center text-sm tabular-nums">{{ timeText }}</span>
      <button
        type="button"
        class="btn btn-ghost btn-square text-neutral-content"
        :aria-label="muted ? 'Activar sonido' : 'Silenciar'"
        :aria-pressed="muted"
        @click="muted = !muted"
      >
        <Icon :name="muted || volume === 0 ? 'lucide:volume-x' : 'lucide:volume-2'" class="size-5" aria-hidden="true" />
      </button>
      <input
        v-model.number="volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        class="range range-xs min-h-11 w-20 sm:w-24"
        aria-label="Volumen"
        :aria-valuetext="`${Math.round(volume * 100)} %`"
      >
      <button
        type="button"
        class="btn btn-ghost btn-square ml-auto text-neutral-content"
        :aria-label="isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'"
        @click="fullscreen"
      >
        <Icon :name="isFullscreen ? 'lucide:minimize' : 'lucide:maximize'" class="size-5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
