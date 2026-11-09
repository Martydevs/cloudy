<script setup lang="ts">
// Página Canciones (feature 006, contracts/ui.md § /canciones): pegar el enlace de una canción de Letras.com para ver su letra,
// las colecciones del equipo y el historial compartido con selección múltiple y generación por lotes. En modo cola, cada enlace
// pegado se agrega a la cola del .zip (`SongBatchQueue`) en vez de abrir la ficha.
import type { SongHistoryItem } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Canciones · Cloudy' })

// Despierta el servicio de presentaciones al abrir la página y comparte el aviso de YouTube (FR-018, research D11).
const service = useYoutubeService()
const bannerState = computed(() => (service.state.value === 'up' || service.state.value === 'unknown' ? null : service.state.value))

const songs = useSongs()
const searching = ref(false)
const fetchError = ref<string | null>(null)

// ---- Cola del .zip (un solo dueño: `useSongPresentationQueue`)
const queue = useSongPresentationQueue()
// Ref de primer nivel para que `v-model:batch-mode` funcione en la plantilla.
const { batchMode } = queue

// ---- Colecciones
const collections = useSongCollections()
const { data: collectionList, pending: collectionsPending, error: collectionsError, refresh: refreshCollections } = useSongCollectionList()
/** `{}` = crear vacía; `collectionId` = ver; `songId` = guardar una canción. */
const dialog = ref<{ collectionId?: string, songId?: string, songTitle?: string } | null>(null)

// ---- Historial y selección (sobrevive a un reintento; se limpia con «Limpiar» o al generar)

const selected = useState<string[]>('songs-history-selected', () => [])
const historyList = useTemplateRef<{ songsOf: (ids: readonly string[]) => SongHistoryItem[] }>('historyList')
const historyHeading = useId()

async function generateSongs(songs: SongHistoryItem[]) {
  return collections.generateSongs(songs.map(song => ({ id: song.id, title: song.title })))
}

async function generateSelection() {
  const songs = historyList.value?.songsOf(selected.value) ?? []
  if (await generateSongs(songs) > 0) selected.value = []
}

/** «Descargar en un .zip» de la barra: la selección pasa por la cola, así hay un solo resultado (el panel de arriba). */
async function zipSelection() {
  queue.replaceWith(historyList.value?.songsOf(selected.value) ?? [])
  if ((await queue.generate())?.ok) selected.value = []
}

function addToCollection(song: SongHistoryItem) {
  dialog.value = { songId: song.id, songTitle: song.title }
}

async function open(url: string) {
  searching.value = true
  fetchError.value = null
  try {
    if (!batchMode.value) {
      fetchError.value = await songs.open(url)
      return
    }
    // Antes de rastrear: una canción que no cabe en la cola no debe gastar crédito de Apify.
    if (queue.full.value) {
      fetchError.value = messages.songs.present.queueFull
      return
    }
    const { song, error } = await songs.fetchSong(url)
    if (!song) {
      fetchError.value = error
      return
    }
    if (queue.add(song) === 'full') fetchError.value = messages.songs.present.queueFull
  }
  finally {
    searching.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8" :class="{ 'pb-56 sm:pb-24': selected.length > 0 }">
    <div class="flex flex-col gap-4">
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">Canciones</h1>
        <p class="text-base-content/70">Pega el enlace de una canción de Letras.com para ver su letra y descargar la presentación.</p>
      </header>

      <YoutubeServiceBanner v-if="bannerState" :state="bannerState" @retry="service.retry()" />

      <SongUrlInput v-model:batch-mode="batchMode" :busy="searching" :error="fetchError" @submit="open" />

      <LazySongBatchQueue v-if="queue.visible.value" />
    </div>

    <SongCollectionRow
      :collections="collectionList?.items ?? null"
      :pending="collectionsPending"
      :error="collectionsError"
      :can-manage="collections.canManage"
      @retry="refreshCollections()"
      @create="dialog = {}"
      @open="collection => (dialog = { collectionId: collection.id })"
      @generate="collection => collections.generate(collection)"
      @rename="collection => (dialog = { collectionId: collection.id })"
      @remove="collection => collections.remove(collection)"
    />

    <section class="flex flex-col gap-3" :aria-labelledby="historyHeading">
      <h2 :id="historyHeading" class="text-lg font-semibold">Historial</h2>
      <SongHistoryList ref="historyList" v-model:selected="selected" @collection="addToCollection" @generate="generateSongs" />
    </section>

    <SongSelectionBar
      v-if="selected.length > 0"
      :count="selected.length"
      :busy="queue.pending.value"
      @generate="generateSelection"
      @clear="selected = []"
      @zip="zipSelection"
    />

    <LazySongCollectionDialog
      v-if="dialog"
      :collection-id="dialog.collectionId"
      :song-id="dialog.songId"
      :song-title="dialog.songTitle"
      @close="dialog = null"
    />
  </div>
</template>
