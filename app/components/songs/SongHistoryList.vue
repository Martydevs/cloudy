<script setup lang="ts">
// Historial de Canciones (feature 006, FR-027–FR-030, contracts/ui.md): rejilla con casillas para la selección múltiple,
// página siguiente al llegar al final, acciones por entrada (abrir, agregar a colección, generar, quitar) y sus cuatro
// estados. Con `recent` es la fila de la ficha: 12 canciones sin la actual, sin casillas. La selección es del padre
// (`v-model:selected`, en `useState`) para sobrevivir a un reintento.
import type { SongHistoryItem } from '#shared/types/api'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = withDefaults(defineProps<{ recent?: boolean, exclude?: string }>(), { recent: false, exclude: undefined })
const selected = defineModel<string[]>('selected', { default: () => [] })
const emit = defineEmits<{ collection: [song: SongHistoryItem], generate: [songs: SongHistoryItem[]] }>()

const history = useSongHistory({ exclude: () => props.exclude, recent: props.recent })
const { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor } = history
const { timeAgo } = useRelativeTime()

const selectedSet = computed(() => new Set(selected.value))

function toggle(id: string) {
  selected.value = selectedSet.value.has(id) ? selected.value.filter(s => s !== id) : [...selected.value, id]
}

const menu: ActionMenuItem[] = [
  { key: 'open', label: 'Abrir', icon: 'lucide:file-text' },
  { key: 'collection', label: messages.songs.collection.addTo, icon: 'lucide:list-plus' },
  { key: 'generate', label: messages.songs.present.action, icon: 'lucide:presentation' },
  { key: 'remove', label: 'Quitar del historial', icon: 'lucide:trash-2', danger: true },
]

async function onAction(key: string, song: SongHistoryItem) {
  if (key === 'open') await navigateTo(`/canciones/${song.id}`)
  else if (key === 'collection') emit('collection', song)
  else if (key === 'generate') emit('generate', [song])
  else if (await history.remove(song)) selected.value = selected.value.filter(id => id !== song.id)
}

function viewer(song: SongHistoryItem) {
  return song.viewedBy?.active ? song.viewedBy.name : messages.youtube.inactiveUser
}

// Página siguiente cuando el centinela del final entra en pantalla.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel)
watch(sentinelVisible, (visible) => {
  if (visible) loadMore()
})

/** Las canciones cargadas con esos IDs, en el orden pedido. */
function songsOf(ids: readonly string[]): SongHistoryItem[] {
  const byId = new Map(items.value.map(song => [song.id, song]))
  return ids.flatMap(id => byId.get(id) ?? [])
}

defineExpose({ refresh, songsOf })
</script>

<template>
  <div class="flex flex-col gap-3">
    <SkeletonList v-if="!firstPage && pending" :rows="recent ? 3 : 6" variant="grid" />
    <ErrorState v-else-if="error && !firstPage" :message="messages.songs.load.history" @retry="refresh()" />
    <EmptyState
      v-else-if="items.length === 0"
      icon="lucide:history"
      :title="recent ? 'Todavía no hay otras canciones' : 'Todavía no hay canciones'"
      :description="recent ? 'Las canciones que abra el equipo aparecerán aquí.' : 'Pega el primer enlace arriba.'"
    />
    <ul v-else-if="recent" class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Canciones consultadas recientemente">
      <li v-for="song in items" :key="song.id" class="flex">
        <NuxtLink :to="`/canciones/${song.id}`" class="card w-56 shrink-0 snap-start border border-base-300 bg-base-100 p-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary sm:w-64">
          <span class="line-clamp-2 min-h-12 break-words font-medium leading-6">{{ song.title }}</span>
          <span class="min-h-5 truncate text-sm text-base-content/70">{{ song.artist }}</span>
          <span class="truncate text-sm text-base-content/70">{{ viewer(song) }} · {{ timeAgo(song.viewedAt) }}</span>
        </NuxtLink>
      </li>
    </ul>
    <template v-else>
      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Canciones consultadas">
        <li v-for="song in items" :key="song.id">
          <article class="card relative border bg-base-100" :class="selectedSet.has(song.id) ? 'border-primary ring-2 ring-primary' : 'border-base-300'">
            <NuxtLink :to="`/canciones/${song.id}`" class="flex flex-col gap-1 rounded-box p-3 pl-14 pr-12 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary">
              <span class="line-clamp-2 min-h-12 break-words font-medium leading-6">{{ song.title }}</span>
              <span class="min-h-5 truncate text-sm text-base-content/70">{{ song.artist }}</span>
              <span class="truncate text-sm text-base-content/70">{{ viewer(song) }} · {{ timeAgo(song.viewedAt) }}</span>
            </NuxtLink>
            <!-- Casilla con área táctil de 44 px. -->
            <label class="absolute left-1 top-1 flex size-11 cursor-pointer items-center justify-center rounded-box">
              <input
                type="checkbox"
                class="checkbox checkbox-primary"
                :checked="selectedSet.has(song.id)"
                :aria-label="`Seleccionar ${song.title}`"
                @change="toggle(song.id)"
              >
            </label>
            <div class="absolute bottom-2 right-1">
              <ActionMenu :label="`Acciones de ${song.title}`" :items="menu" @select="key => onAction(key, song)" />
            </div>
          </article>
        </li>
      </ul>
      <div ref="sentinel" class="flex min-h-11 justify-center py-2">
        <span v-if="loadingMore" class="loading loading-spinner motion-reduce:animate-none" aria-label="Cargando más canciones" />
        <ErrorState v-else-if="moreFailed" :message="messages.songs.load.moreHistory" @retry="loadMore()" />
        <button v-else-if="nextCursor" type="button" class="btn" @click="loadMore()">Cargar más</button>
      </div>
    </template>
  </div>
</template>
