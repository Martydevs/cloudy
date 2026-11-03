<script setup lang="ts">
// Datos del video y sus acciones (FR-006–FR-008, FR-013, FR-015): Descargar (con formato), Crear lista y, con el
// reproductor listo, Pantalla completa y Abrir en ventana nueva. En móvil se apilan; desde `sm:` van en fila.
import type { YoutubeFormat, YoutubeVideoDetail } from '#shared/types/api'
import { BLOCK_REASON_MESSAGES } from '#shared/constants/youtube'

const props = withDefaults(defineProps<{ video: YoutubeVideoDetail, playerReady?: boolean }>(), { playerReady: false })
const emit = defineEmits<{ playlist: [], fullscreen: [], openWindow: [] }>()

const downloads = useYoutubeDownloads()
const format = ref<YoutubeFormat>('mp4_720')
const reasonId = useId()
const hintId = useId()

const blocked = computed(() => (props.video.downloadable ? null : BLOCK_REASON_MESSAGES[props.video.reason ?? 'unavailable']))
const heights = computed(() => [...props.video.availableHeights].sort((a, b) => b - a))

function download(chosen: YoutubeFormat) {
  downloads.enqueue([props.video.videoId], chosen, props.video.title)
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="Datos del video">
    <h1 class="break-words text-xl font-semibold sm:text-2xl">{{ video.title }}</h1>
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/70">
      <span v-if="video.channel" class="flex items-center gap-1">
        <Icon name="lucide:user-round" class="size-4" aria-hidden="true" />
        {{ video.channel }}
      </span>
      <span v-if="video.durationSeconds !== null" class="flex items-center gap-1">
        <Icon name="lucide:clock" class="size-4" aria-hidden="true" />
        <span aria-hidden="true">{{ formatDuration(video.durationSeconds) }}</span>
        <span class="sr-only">Duración: {{ spokenDuration(video.durationSeconds) }}</span>
      </span>
    </p>
    <ul v-if="heights.length" class="flex flex-wrap gap-1" aria-label="Calidades disponibles">
      <li v-for="height in heights" :key="height" class="badge badge-outline">{{ height }}p</li>
    </ul>

    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
      <div :title="blocked ?? undefined" class="w-full sm:w-auto" :aria-describedby="blocked ? reasonId : undefined">
        <YoutubeFormatPicker
          v-model="format"
          label="Descargar"
          :heights="video.availableHeights"
          :disabled="!video.downloadable"
          block
          @select="download"
        />
      </div>
      <button type="button" class="btn btn-block sm:w-auto" @click="emit('playlist')">
        <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
        Crear lista
      </button>
      <button
        type="button"
        class="btn btn-block sm:w-auto"
        :disabled="!playerReady"
        :aria-describedby="playerReady ? undefined : hintId"
        @click="emit('fullscreen')"
      >
        <Icon name="lucide:maximize" class="size-5" aria-hidden="true" />
        Pantalla completa
      </button>
      <button
        type="button"
        class="btn btn-block sm:w-auto"
        :disabled="!playerReady"
        :aria-describedby="playerReady ? undefined : hintId"
        @click="emit('openWindow')"
      >
        <Icon name="lucide:external-link" class="size-5" aria-hidden="true" />
        Abrir en ventana nueva
      </button>
    </div>
    <p v-if="blocked" :id="reasonId" class="text-sm text-error">{{ blocked }}</p>
    <p v-if="!playerReady" :id="hintId" class="text-sm text-base-content/70">{{ messages.youtube.player.actionsHint }}</p>
    <p class="text-sm text-base-content/70">{{ messages.youtube.compliance }}</p>
  </section>
</template>
