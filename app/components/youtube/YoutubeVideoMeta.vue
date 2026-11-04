<script setup lang="ts">
// Datos del video y sus acciones (FR-006–FR-008, FR-013, FR-015): Descargar (con formato), Guardar en el drive (audio o
// video, con su avance), Crear lista y Abrir en ventana nueva. La pantalla completa es la del reproductor de YouTube. En móvil se apilan; desde `sm:` van en fila.
import type { YoutubeFormat, YoutubeVideoDetail } from '#shared/types/api'
import { BLOCK_REASON_MESSAGES, YOUTUBE_DRIVE_FORMATS } from '#shared/constants/youtube'
import type { YoutubeDriveFormat } from '#shared/constants/youtube'

const props = defineProps<{ video: YoutubeVideoDetail }>()
const emit = defineEmits<{ playlist: [], openWindow: [] }>()

const downloads = useYoutubeDownloads()
const drive = useYoutubeDriveImport()
const format = ref<YoutubeFormat>('mp4_720')
const driveFormat = ref<YoutubeDriveFormat>('mp3')
const reasonId = useId()

const blocked = computed(() => (props.video.downloadable ? null : BLOCK_REASON_MESSAGES[props.video.reason ?? 'unavailable']))
const driveImport = computed(() => drive.of(props.video.videoId))
const driveBusy = computed(() => !!driveImport.value && drive.isActive(driveImport.value.stage))
const driveStage = computed(() => {
  const stage = driveImport.value?.stage
  return stage === 'queued' || stage === 'preparing' || stage === 'downloading' || stage === 'uploading' ? messages.youtube.drive[stage] : null
})
const heights = computed(() => [...props.video.availableHeights].sort((a, b) => b - a))

function download(chosen: YoutubeFormat) {
  downloads.enqueue([props.video.videoId], chosen, props.video.title)
}

function saveToDrive(chosen: YoutubeDriveFormat) {
  void drive.start({ videoId: props.video.videoId, title: props.video.title }, chosen)
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
      <div :title="blocked ?? undefined" class="w-full sm:w-auto">
        <YoutubeFormatPicker
          v-model="driveFormat"
          :label="messages.youtube.drive.action"
          icon="lucide:hard-drive-upload"
          :formats="YOUTUBE_DRIVE_FORMATS"
          :primary="false"
          :disabled="!video.downloadable || driveBusy"
          block
          @select="saveToDrive"
        />
      </div>
      <button type="button" class="btn btn-block sm:w-auto" @click="emit('playlist')">
        <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
        Crear lista
      </button>
      <button type="button" class="btn btn-block sm:w-auto" @click="emit('openWindow')">
        <Icon name="lucide:external-link" class="size-5" aria-hidden="true" />
        Abrir en ventana nueva
      </button>
    </div>
    <div v-if="driveStage && driveImport" class="flex flex-col gap-1" aria-busy="true">
      <p class="flex items-center justify-between gap-2 text-sm" role="status">
        <span>{{ driveStage }}</span>
        <span class="tabular-nums" aria-hidden="true">{{ driveImport.progress }} %</span>
      </p>
      <progress class="progress progress-primary w-full" :value="driveImport.progress" max="100" :aria-label="driveStage" />
    </div>
    <p v-else-if="driveImport?.stage === 'error'" role="alert" class="text-sm text-error">{{ driveImport.message }}</p>
    <p v-else-if="driveImport?.stage === 'done'" role="status" class="flex items-center gap-1 text-sm">
      <Icon name="lucide:check" class="size-4" aria-hidden="true" />
      {{ messages.youtube.drive.done(driveImport.message ?? '') }}
    </p>
    <p v-if="blocked" :id="reasonId" class="text-sm text-error">{{ blocked }}</p>
    <p class="text-sm text-base-content/70">{{ messages.youtube.compliance }}</p>
  </section>
</template>
