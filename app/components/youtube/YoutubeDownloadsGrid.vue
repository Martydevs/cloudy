<script setup lang="ts">
// Sección «Descargas» de /youtube: los últimos videos que el equipo descargó, en una rejilla de miniaturas (sin tarjetas):
// miniatura 16:9 con duración y formato, título y quién la bajó y cuándo. Página siguiente al llegar al final y sus
// cuatro estados. El título y el interruptor con «Historial» son de la página.
import { youtubeFormatLabel } from '#shared/constants/youtube'
import type { YoutubeDownloadItem } from '#shared/types/api'

const { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor } = useYoutubeDownloadHistory()
const { timeAgo } = useRelativeTime()

const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel)
watch(sentinelVisible, (visible) => {
  if (visible) loadMore()
})

function person(item: YoutubeDownloadItem) {
  return item.downloadedBy?.active ? item.downloadedBy.name : messages.youtube.inactiveUser
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-col gap-3">
    <SkeletonList v-if="!firstPage && pending" :rows="6" variant="grid" />
    <ErrorState v-else-if="error && !firstPage" :message="messages.youtube.load.downloads" @retry="refresh()" />
    <EmptyState v-else-if="items.length === 0" icon="lucide:download" title="Todavía no hay descargas" description="Descarga un video y aparecerá aquí." />
    <template v-else>
      <ul class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Videos descargados">
        <li v-for="item in items" :key="item.videoId">
          <NuxtLink
            :to="`/youtube/${item.videoId}`"
            class="group flex flex-col gap-2 rounded-box outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span class="relative block aspect-video overflow-hidden rounded-box bg-base-300">
              <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="" width="320" height="180" loading="lazy" class="size-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none">
              <span v-else class="flex size-full items-center justify-center"><Icon name="lucide:film" class="size-8 text-base-content/40" aria-hidden="true" /></span>
              <span class="badge badge-neutral absolute left-2 top-2">{{ youtubeFormatLabel(item.format) }}</span>
              <span v-if="item.durationSeconds !== null" class="badge badge-neutral absolute bottom-2 right-2">
                <span aria-hidden="true">{{ formatDuration(item.durationSeconds) }}</span>
                <span class="sr-only">{{ spokenDuration(item.durationSeconds) }}</span>
              </span>
            </span>
            <span class="flex flex-col">
              <span class="line-clamp-2 min-h-10 break-words text-sm font-medium leading-5">{{ item.title }}</span>
              <span class="truncate text-xs text-base-content/70">{{ person(item) }} · {{ timeAgo(item.downloadedAt) }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
      <div ref="sentinel" class="flex min-h-11 justify-center py-2">
        <span v-if="loadingMore" class="loading loading-spinner" aria-label="Cargando más descargas" />
        <ErrorState v-else-if="moreFailed" :message="messages.youtube.load.moreDownloads" @retry="loadMore()" />
        <button v-else-if="nextCursor" type="button" class="btn" @click="loadMore()">Cargar más</button>
      </div>
    </template>
  </div>
</template>
