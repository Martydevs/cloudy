<script setup lang="ts">
// Tarjeta de un video del historial (FR-024): miniatura 16:9 con duración, título, canal, quién y cuándo lo abrió,
// casilla opcional para la selección múltiple y su menú de acciones.
import type { YoutubeHistoryItem } from '#shared/types/api'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = withDefaults(defineProps<{ video: YoutubeHistoryItem, selectable?: boolean, selected?: boolean, compact?: boolean }>(), {
  selectable: false,
  selected: false,
  compact: false,
})
export type YoutubeCardAction = 'open' | 'playlist' | 'download-mp4' | 'download-mp3' | 'drive-mp4' | 'drive-mp3' | 'remove'

const emit = defineEmits<{ toggle: [videoId: string], action: [key: YoutubeCardAction, video: YoutubeHistoryItem] }>()

const { timeAgo } = useRelativeTime()
const viewer = computed(() => {
  const person = props.video.viewedBy
  return !person ? messages.youtube.inactiveUser : person.active ? person.name : messages.youtube.inactiveUser
})

const menu: ActionMenuItem[] = [
  { key: 'open', label: 'Abrir', icon: 'lucide:play' },
  { key: 'playlist', label: 'Agregar a lista', icon: 'lucide:list-plus' },
  { key: 'download-mp4', label: 'Descargar video 720p', icon: 'lucide:film' },
  { key: 'download-mp3', label: 'Descargar audio MP3', icon: 'lucide:music' },
  { key: 'drive-mp4', label: 'Guardar en el drive: video 720p', icon: 'lucide:hard-drive-upload' },
  { key: 'drive-mp3', label: 'Guardar en el drive: audio MP3', icon: 'lucide:hard-drive-upload' },
  { key: 'remove', label: 'Quitar del historial', icon: 'lucide:trash-2', danger: true },
]
</script>

<template>
  <article
    class="card relative border bg-base-100"
    :class="[selected ? 'border-primary ring-2 ring-primary' : 'border-base-300', compact ? 'w-56 shrink-0 snap-start sm:w-64' : '']"
  >
    <NuxtLink :to="`/youtube/${video.videoId}`" class="flex flex-col rounded-box outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary">
      <span class="relative block aspect-video overflow-hidden rounded-t-box bg-base-300">
        <img v-if="video.thumbnailUrl" :src="video.thumbnailUrl" alt="" width="320" height="180" loading="lazy" class="size-full object-cover">
        <span v-else class="flex size-full items-center justify-center"><Icon name="lucide:film" class="size-8 text-base-content/40" aria-hidden="true" /></span>
        <span v-if="video.durationSeconds !== null" class="badge badge-neutral absolute bottom-2 right-2">
          <span aria-hidden="true">{{ formatDuration(video.durationSeconds) }}</span>
          <span class="sr-only">{{ spokenDuration(video.durationSeconds) }}</span>
        </span>
      </span>
      <span class="flex flex-col gap-1 p-3 pr-12">
        <span class="line-clamp-2 min-h-12 break-words font-medium leading-6">{{ video.title }}</span>
        <span class="min-h-5 truncate text-sm text-base-content/70">{{ video.channel }}</span>
        <span class="truncate text-sm text-base-content/70">{{ viewer }} · {{ timeAgo(video.viewedAt) }}</span>
      </span>
    </NuxtLink>

    <!-- Casilla con área táctil de 44 px. -->
    <label v-if="selectable" class="absolute left-1 top-1 flex size-11 cursor-pointer items-center justify-center rounded-box">
      <input
        type="checkbox"
        class="checkbox checkbox-primary"
        :checked="selected"
        :aria-label="`Seleccionar ${video.title}`"
        @change="emit('toggle', video.videoId)"
      >
    </label>
    <!-- En la fila con desplazamiento de la ficha (`compact`) el menú quedaría recortado: ahí basta con abrir el video. -->
    <div v-if="!compact" class="absolute bottom-2 right-1">
      <ActionMenu :label="`Acciones de ${video.title}`" :items="menu" @select="key => emit('action', key as YoutubeCardAction, video)" />
    </div>
  </article>
</template>
