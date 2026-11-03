<script setup lang="ts">
// Tarjeta de una lista (FR-016): 4 miniaturas, nombre, cantidad de videos y autor. El botón de descarga se ve siempre
// en móvil y, desde `lg:`, al pasar el puntero **o** al llegar con el teclado (nada depende solo de hover).
import type { YoutubeFormat, YoutubePlaylist } from '#shared/types/api'

const props = defineProps<{ playlist: YoutubePlaylist }>()
const emit = defineEmits<{ open: [playlist: YoutubePlaylist], download: [playlist: YoutubePlaylist, format: YoutubeFormat] }>()

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
    <!-- Descargar: siempre visible en móvil; en escritorio con hover y con foco (teclado). -->
    <div class="absolute right-2 top-2 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 motion-reduce:transition-none">
      <YoutubeFormatPicker
        :label="`Descargar ${playlist.name}`"
        icon="lucide:download"
        :disabled="playlist.itemCount === 0"
        icon-only
        @select="(format: YoutubeFormat) => emit('download', playlist, format)"
      />
    </div>
  </article>
</template>
