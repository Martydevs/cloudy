<script setup lang="ts">
// Sección «Historial» de /youtube (FR-019, FR-023–FR-025; el título y el interruptor con «Descargas» son de la página):
// rejilla con selección múltiple, página siguiente al llegar al final y sus cuatro estados. La selección es del padre
// (`v-model:selected`, en `useState`) para sobrevivir a un reintento.
import type { YoutubeFormat, YoutubeHistoryItem } from '#shared/types/api'
import type { YoutubeCardAction } from './YoutubeVideoCard.vue'

const downloads = useYoutubeDownloads()
const selected = defineModel<string[]>('selected', { default: () => [] })
const emit = defineEmits<{ download: [videoIds: string[], format: YoutubeFormat], playlist: [video: YoutubeHistoryItem] }>()

const history = useYoutubeHistory()
const { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor } = history

const selectedSet = computed(() => new Set(selected.value))

function toggle(videoId: string) {
  selected.value = selectedSet.value.has(videoId)
    ? selected.value.filter(id => id !== videoId)
    : [...selected.value, videoId]
}

async function onAction(key: YoutubeCardAction, video: YoutubeHistoryItem) {
  if (key === 'open') await navigateTo(`/youtube/${video.videoId}`)
  else if (key === 'playlist') emit('playlist', video)
  else if (key === 'download-mp4') downloads.enqueue([video.videoId], 'mp4_720', video.title)
  else if (key === 'download-mp3') downloads.enqueue([video.videoId], 'mp3', video.title)
  else if (await history.remove(video)) selected.value = selected.value.filter(id => id !== video.videoId)
}

// Página siguiente cuando el centinela del final entra en pantalla.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel)
watch(sentinelVisible, (visible) => {
  if (visible) loadMore()
})

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-col gap-3">
    <SkeletonList v-if="!firstPage && pending" :rows="6" variant="grid" />
    <ErrorState v-else-if="error && !firstPage" :message="messages.youtube.load.history" @retry="refresh()" />
    <EmptyState v-else-if="items.length === 0" icon="lucide:history" title="Todavía no hay videos" description="Pega el primer enlace arriba." />
    <template v-else>
      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Videos consultados">
        <li v-for="video in items" :key="video.videoId">
          <YoutubeVideoCard
            :video="video"
            selectable
            :selected="selectedSet.has(video.videoId)"
            @toggle="toggle"
            @action="onAction"
          />
        </li>
      </ul>
      <div ref="sentinel" class="flex min-h-11 justify-center py-2">
        <span v-if="loadingMore" class="loading loading-spinner" aria-label="Cargando más videos" />
        <ErrorState v-else-if="moreFailed" :message="messages.youtube.load.moreHistory" @retry="loadMore()" />
        <button v-else-if="nextCursor" type="button" class="btn" @click="loadMore()">Cargar más</button>
      </div>
    </template>
  </div>
</template>
