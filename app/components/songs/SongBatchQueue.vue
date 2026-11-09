<script setup lang="ts">
// Cola del `.zip` de Canciones (contracts/ui.md): las canciones agregadas en modo cola (o desde «Descargar en un .zip» de la
// barra de selección), hasta 3, con **Generar N presentaciones (.zip)**, el resultado de cada canción tras generar, **Descargar
// de nuevo** y **Vaciar**. Lee `useSongPresentationQueue()` (como `SongPresentationTray` lee su cola); va diferida en
// `/canciones` (`LazySongBatchQueue`) y solo aparece tras agregar una canción.
const queue = useSongPresentationQueue()
const m = messages.songs.present

const { items, count, pending, result, canRedownload } = queue

const rows = computed(() => items.value.map(song => ({ song, outcome: queue.resultOf(song.id) })))
const failedCount = computed(() => (result.value?.ok ? result.value.items.filter(item => item.status === 'failed').length : 0))
const retryable = computed(() => result.value?.ok === false && result.value.retryable)
const primaryLabel = computed(() => (retryable.value ? m.retry : m.zipGenerate(count.value)))

// Anuncio para lectores de pantalla: solo cuando cambia (la cola, la espera o el resultado).
const status = computed(() => {
  if (pending.value) return `${m.zipRunningLabel}…`
  if (result.value?.ok) return m.zipDone(queue.doneCount.value)
  if (result.value) return result.value.error
  return pluralize(count.value, 'canción en la cola', 'canciones en la cola')
})
const announcement = ref('')
watch(status, (text) => {
  announcement.value = text
})
</script>

<template>
  <section
    role="region"
    :aria-label="m.queueTitle"
    :aria-busy="pending ? 'true' : 'false'"
    class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4"
  >
    <header class="flex items-center gap-2">
      <Icon name="lucide:file-archive" class="size-5 shrink-0 text-primary" aria-hidden="true" />
      <h2 class="flex-1 font-semibold">{{ m.queueTitle }}</h2>
      <span class="badge badge-soft badge-primary">{{ m.queueCount(count) }}</span>
    </header>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

    <ul v-if="count > 0" :aria-label="m.queueList" class="flex flex-col gap-2">
      <li v-for="{ song, outcome } in rows" :key="song.id" class="flex items-start gap-2 rounded-box border border-base-300 p-3">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="break-words font-medium">{{ song.title }}</span>
          <span v-if="song.artist" class="text-sm text-base-content/70">{{ song.artist }}</span>
          <template v-if="outcome && !pending">
            <p v-if="outcome.status === 'done'" class="flex items-center gap-1 text-sm text-base-content/80">
              <Icon name="lucide:check" class="size-4 shrink-0 text-success" aria-hidden="true" />
              {{ m.done(outcome.slideCount) }}
            </p>
            <p v-else-if="outcome.message" class="text-sm text-error">{{ outcome.message }}</p>
            <p v-if="outcome.arrangedBy === 'fallback'" class="text-sm text-base-content/80">{{ m.fallback }}</p>
          </template>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-square shrink-0"
          :aria-label="`${m.queueRemove} ${song.title}`"
          :disabled="pending"
          @click="queue.remove(song.id)"
        >
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div v-if="pending" class="flex flex-col gap-1">
      <progress class="progress progress-primary w-full" :aria-label="m.zipRunningLabel" />
      <p class="text-sm text-base-content/70">{{ m.zipRunning }}</p>
    </div>
    <template v-else-if="result">
      <p v-if="failedCount > 0" class="text-sm text-base-content/80">{{ m.zipPartial(failedCount) }}</p>
      <p v-if="!result.ok" role="alert" class="text-sm text-error">{{ result.error }}</p>
    </template>

    <div class="flex flex-col gap-2 sm:flex-row">
      <button type="button" class="btn btn-primary btn-block sm:w-auto" :disabled="pending || count === 0" @click="queue.generate()">
        <span v-if="pending" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else :name="retryable ? 'lucide:refresh-cw' : 'lucide:file-archive'" class="size-5" aria-hidden="true" />
        {{ primaryLabel }}
      </button>
      <button v-if="canRedownload" type="button" class="btn btn-block sm:w-auto" :disabled="pending" @click="queue.redownload()">
        <Icon name="lucide:download" class="size-5" aria-hidden="true" />
        {{ m.redownload }}
      </button>
      <button type="button" class="btn btn-ghost btn-block sm:w-auto" :disabled="pending" @click="queue.clear()">
        <Icon name="lucide:trash-2" class="size-5" aria-hidden="true" />
        {{ m.queueClear }}
      </button>
    </div>
  </section>
</template>
