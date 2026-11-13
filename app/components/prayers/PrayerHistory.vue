<script setup lang="ts">
// «Historial de imágenes generadas» (feature 007, enmienda de historial): arriba la cola en curso de `usePrayerImages`
// (en cola, generándose, fallida o cancelada) y debajo las imágenes guardadas, la más reciente primero, con desplazamiento
// infinito y sus cuatro estados. Una región viva anuncia cada imagen lista o fallida. La página la carga diferida y la
// hidrata cuando el navegador está libre (`LazyPrayerHistory hydrate-on-idle`): está bajo el pliegue y no entra en el JS inicial.
import type { PrayerGeneratedImage } from '#shared/types/api'

const emit = defineEmits<{ collection: [image: PrayerGeneratedImage] }>()

const images = usePrayerImages()
const history = usePrayerHistory()
const { items, firstPage, error, loading, loadingMore, moreFailed, done } = history
const toast = useToast()
const m = messages.prayers
const h = messages.prayers.history
const { timeAgo } = useRelativeTime()
const headingId = useId()

const previewing = ref<{ url: string, title: string } | null>(null)

function preview(image: PrayerGeneratedImage) {
  previewing.value = { url: image.previewUrl, title: h.alt(h.count(image.requestCount), timeAgo(image.createdAt)) }
}

function regenerate(image: PrayerGeneratedImage) {
  if (images.regenerateFrom(image.fileIds) > 0) toast.info(m.regenerateQueued)
}

// Página siguiente cuando el centinela se acerca a la pantalla.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel, { rootMargin: '400px' })
watch(sentinelVisible, (visible) => {
  if (visible && !done.value && !moreFailed.value) void history.loadMore()
})
</script>

<template>
  <section class="flex flex-col gap-3" :aria-labelledby="headingId">
    <div class="flex flex-col gap-1">
      <h2 :id="headingId" class="text-lg font-semibold">{{ h.title }}</h2>
      <p class="text-sm text-base-content/70">{{ h.retention }}</p>
    </div>
    <p class="sr-only" aria-live="polite">{{ images.announcement.value }}</p>

    <ul v-if="images.hasItems.value" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" :aria-label="h.inProgress">
      <li v-for="item in images.items.value" :key="item.key">
        <PrayerResultCard
          :item="item"
          @regenerate="images.regenerate(item.key)"
          @retry="images.retry(item.key)"
          @cancel="images.cancel(item.key)"
          @dismiss="images.dismiss(item.key)"
        />
      </li>
    </ul>

    <div v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      <span class="sr-only" role="status">{{ h.loading }}</span>
      <div v-for="n in 3" :key="n" class="skeleton aspect-[1376/768] w-full motion-reduce:animate-none" />
    </div>
    <ErrorState v-else-if="error && !firstPage" :message="h.load" @retry="history.refresh()" />
    <EmptyState v-else-if="items.length === 0 && !images.hasItems.value" icon="lucide:images" :title="h.empty" :description="h.emptyHint" />
    <template v-else-if="items.length > 0">
      <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" :aria-label="h.list">
        <li v-for="image in items" :key="image.id" class="flex flex-col">
          <PrayerHistoryCard
            class="h-full"
            :image="image"
            :can-remove="history.canRemove(image)"
            @preview="preview(image)"
            @collection="emit('collection', image)"
            @regenerate="regenerate(image)"
            @remove="history.remove(image)"
          />
        </li>
      </ul>

      <div ref="sentinel" class="flex min-h-11 flex-col items-center gap-4">
        <div v-if="loadingMore" class="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" :aria-label="h.loadMore">
          <div v-for="n in 3" :key="n" class="skeleton aspect-[1376/768] w-full motion-reduce:animate-none" />
        </div>
        <ErrorState v-else-if="moreFailed" class="w-full" :message="h.loadMoreError" @retry="history.loadMore()" />
        <p v-else-if="done" class="py-2 text-sm text-base-content/70">{{ h.end }}</p>
        <button v-else type="button" class="btn" @click="history.loadMore()">{{ h.more }}</button>
      </div>
    </template>

    <LazyPrayerImagePreview v-if="previewing" :url="previewing.url" :title="previewing.title" @close="previewing = null" />
  </section>
</template>
