<script setup lang="ts">
// «Imágenes generadas» (feature 007, contracts/ui.md): la cola de `usePrayerImages` en la propia página, con **Descartar todas**
// y una región viva que anuncia cada imagen lista o fallida. Se carga diferida (`LazyPrayerResults`).
const images = usePrayerImages()
const { confirm } = useConfirm()
const m = messages.prayers
const headingId = useId()

const previewing = ref<{ url: string, title: string } | null>(null)
const announcement = ref('')

watch(() => images.items.value.map(item => [item.key, item.status] as const), (now, before) => {
  const previous = new Map(before ?? [])
  for (const [key, status] of now) {
    if (previous.get(key) === status) continue
    const item = images.items.value.find(other => other.key === key)!
    if (status === 'done') announcement.value = m.generated(item.index)
    else if (status === 'failed') announcement.value = m.failedImage(item.index)
  }
})

function preview(key: string) {
  const item = images.items.value.find(other => other.key === key)
  if (item?.url) previewing.value = { url: item.url, title: m.resultAlt(item.index) }
}

async function dismissAll() {
  const ok = await confirm({ title: m.dismissAll, message: m.dismissAllConfirm, confirmLabel: m.dismissAll, danger: true })
  if (ok) images.dismissAll()
}
</script>

<template>
  <section class="flex flex-col gap-3" :aria-labelledby="headingId">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 :id="headingId" class="text-lg font-semibold">{{ m.resultsTitle }}</h2>
      <button type="button" class="btn btn-ghost" @click="dismissAll">{{ m.dismissAll }}</button>
    </div>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2" :aria-label="m.resultsTitle">
      <li v-for="item in images.items.value" :key="item.key">
        <PrayerResultCard
          :item="item"
          @download="images.download(item.key)"
          @preview="preview(item.key)"
          @regenerate="images.regenerate(item.key)"
          @retry="images.retry(item.key)"
          @cancel="images.cancel(item.key)"
          @dismiss="images.dismiss(item.key)"
        />
      </li>
    </ul>
    <LazyPrayerImagePreview v-if="previewing" :url="previewing.url" :title="previewing.title" @close="previewing = null" />
  </section>
</template>
