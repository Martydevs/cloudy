<script setup lang="ts">
// Tarjeta de una lista (FR-016): 4 miniaturas, nombre, cantidad de videos y autor. El botón de descarga se ve siempre
// en móvil y, desde `lg:`, al pasar el puntero **o** al llegar con el teclado (nada depende solo de hover).
import type { YoutubeFormat, YoutubePlaylist } from '#shared/types/api'
import type { YoutubeDriveFormat } from '#shared/constants/youtube'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = defineProps<{ playlist: YoutubePlaylist }>()
const emit = defineEmits<{
  open: [playlist: YoutubePlaylist]
  download: [playlist: YoutubePlaylist, format: YoutubeFormat]
  drive: [playlist: YoutubePlaylist, format: YoutubeDriveFormat]
}>()

// Opciones de la lista: las descargas (por lotes) y «Guardar en el drive» (el diálogo deja elegir cuáles videos).
const menu: ActionMenuItem[] = [
  { key: 'download:mp4_720', label: 'Descargar video 720p', icon: 'lucide:film' },
  { key: 'download:mp4_1080', label: 'Descargar video 1080p', icon: 'lucide:film' },
  { key: 'download:mp3', label: 'Descargar audio MP3', icon: 'lucide:music' },
  { key: 'drive:mp4_720', label: 'Guardar en el drive: video 720p', icon: 'lucide:hard-drive-upload' },
  { key: 'drive:mp3', label: 'Guardar en el drive: audio MP3', icon: 'lucide:hard-drive-upload' },
]

function onSelect(key: string) {
  const [action, format] = key.split(':') as ['download' | 'drive', YoutubeFormat]
  if (action === 'download') emit('download', props.playlist, format)
  else emit('drive', props.playlist, format as YoutubeDriveFormat)
}

const covers = computed(() => Array.from({ length: 4 }, (_, i) => props.playlist.covers[i] ?? null))
const author = computed(() => (props.playlist.author.active ? props.playlist.author.name : messages.youtube.inactiveUser))
const count = computed(() => pluralize(props.playlist.itemCount, 'video', 'videos'))
</script>

<template>
  <article class="group card relative w-60 shrink-0 snap-start border border-base-300 bg-base-100 sm:w-64">
    <button
      type="button"
      class="flex flex-col rounded-box text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`Abrir la lista ${playlist.name}, ${count}`"
      @click="emit('open', playlist)"
    >
      <span class="grid aspect-video grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-t-box bg-base-300">
        <template v-for="(cover, i) in covers" :key="i">
          <img v-if="cover" :src="cover" alt="" width="160" height="90" loading="lazy" class="size-full object-cover">
          <span v-else class="flex items-center justify-center bg-base-200">
            <Icon name="lucide:film" class="size-5 text-base-content/40" aria-hidden="true" />
          </span>
        </template>
      </span>
      <span class="card-body gap-1 p-3">
        <span class="line-clamp-2 min-h-12 break-words font-semibold leading-6">{{ playlist.name }}</span>
        <span class="text-sm text-base-content/70">{{ count }}</span>
        <span class="truncate text-sm text-base-content/70">Creada por {{ author }}</span>
      </span>
    </button>
    <!-- Opciones (descargar / guardar en el drive): siempre visibles en móvil; en escritorio con hover y con foco (teclado). -->
    <div class="absolute right-1 top-1 rounded-box bg-base-100/80 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 motion-reduce:transition-none">
      <ActionMenu
        :label="`Opciones de ${playlist.name}`"
        :items="menu"
        :disabled="playlist.itemCount === 0"
        floating
        @select="onSelect"
      />
    </div>
  </article>
</template>
