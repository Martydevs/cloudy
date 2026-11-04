<script setup lang="ts">
// Diálogo «Guardar en el drive» para varios videos (selección del historial o una lista): casillas con todos marcados
// por defecto y confirmación con el conteo. El formato ya se eligió en el menú de origen. Se carga diferido
// (`LazyYoutubeDriveDialog`).
import type { YoutubeDriveFormat } from '#shared/constants/youtube'
import { youtubeFormatLabel } from '#shared/constants/youtube'

export interface DriveDialogVideo {
  videoId: string
  title: string
  thumbnailUrl: string | null
  durationSeconds: number | null
}

const props = defineProps<{ videos: DriveDialogVideo[], format: YoutubeDriveFormat, heading: string }>()
const emit = defineEmits<{ confirm: [videos: DriveDialogVideo[]], close: [] }>()

const drive = useYoutubeDriveImport()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const checked = ref(new Set(props.videos.map(video => video.videoId)))

/** Un video con una importación en curso no se puede volver a elegir. */
const busy = (videoId: string) => {
  const current = drive.of(videoId)
  return !!current && drive.isActive(current.stage)
}
const selectable = computed(() => props.videos.filter(video => !busy(video.videoId)))
const chosen = computed(() => selectable.value.filter(video => checked.value.has(video.videoId)))
const allChecked = computed(() => selectable.value.length > 0 && chosen.value.length === selectable.value.length)

function toggle(videoId: string) {
  const next = new Set(checked.value)
  if (!next.delete(videoId)) next.add(videoId)
  checked.value = next
}

function toggleAll() {
  checked.value = allChecked.value ? new Set() : new Set(selectable.value.map(video => video.videoId))
}

function confirm() {
  if (chosen.value.length === 0) return
  emit('confirm', chosen.value)
  close()
}

onMounted(() => {
  dialog.value?.showModal()
})

function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="flex-1 break-words text-lg font-semibold">{{ heading }}</h2>
        <button type="button" class="btn btn-ghost btn-square" aria-label="Cerrar" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <p class="text-sm text-base-content/70">
        Elige qué videos guardar como <span class="font-medium text-base-content">{{ youtubeFormatLabel(format) }}</span>.
      </p>
      <p v-if="format !== 'mp3'" class="text-sm text-base-content/70">{{ messages.youtube.drive.tooLargeNote }}</p>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="btn" :disabled="selectable.length === 0" @click="toggleAll">
          {{ allChecked ? 'Quitar todos' : 'Marcar todos' }}
        </button>
        <p class="text-sm text-base-content/70" role="status">{{ pluralize(chosen.length, 'marcado', 'marcados') }}</p>
      </div>

      <ul class="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="Videos para guardar en el drive">
        <li v-for="video in videos" :key="video.videoId">
          <label
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-box border border-base-300 p-2"
            :class="{ 'cursor-not-allowed opacity-60': busy(video.videoId) }"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-primary"
              :checked="checked.has(video.videoId) && !busy(video.videoId)"
              :disabled="busy(video.videoId)"
              :aria-label="`Guardar ${video.title}`"
              @change="toggle(video.videoId)"
            >
            <span class="relative w-20 shrink-0 overflow-hidden rounded-box bg-base-300">
              <img v-if="video.thumbnailUrl" :src="video.thumbnailUrl" alt="" width="80" height="45" loading="lazy" class="aspect-video w-full object-cover">
              <span v-else class="flex aspect-video items-center justify-center"><Icon name="lucide:film" class="size-5 text-base-content/40" aria-hidden="true" /></span>
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="line-clamp-2 break-words font-medium">{{ video.title }}</span>
              <span v-if="busy(video.videoId)" class="text-sm text-base-content/70">Ya se está guardando</span>
              <span v-else-if="video.durationSeconds !== null" class="text-sm text-base-content/70">
                <span aria-hidden="true">{{ formatDuration(video.durationSeconds) }}</span>
                <span class="sr-only">{{ spokenDuration(video.durationSeconds) }}</span>
              </span>
            </span>
          </label>
        </li>
      </ul>

      <div class="modal-action mt-0">
        <button type="button" class="btn" @click="close">Cancelar</button>
        <button type="button" class="btn btn-primary" :disabled="chosen.length === 0" @click="confirm">
          <Icon name="lucide:hard-drive-upload" class="size-5" aria-hidden="true" />
          {{ messages.youtube.drive.confirm(chosen.length) }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">Cerrar</button>
    </div>
  </dialog>
</template>
