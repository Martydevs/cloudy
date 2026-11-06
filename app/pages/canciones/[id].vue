<script setup lang="ts">
// Ficha de una canción (feature 006, contracts/ui.md § /canciones/<id>): metadatos → acciones → letra, en ese orden.
// Abrirla registra la vista en el historial compartido (FR-027) y despierta el servicio de presentaciones (FR-018: el mismo
// `cloudy-api` de YouTube, con su aviso).
definePageMeta({
  layout: 'dashboard',
  access: 'private',
  roles: ['editor', 'admin'],
  // Cada canción es una ficha nueva.
  key: route => route.path,
})

const route = useRoute()
const songId = computed(() => String(route.params.id ?? ''))
const { data: song, error, pending, refresh } = useSong(songId)
useHead({ title: () => `${song.value?.title ?? 'Canción'} · Canciones · Cloudy` })

const notFound = computed(() => !song.value && error.value?.statusCode === 404)

const service = useYoutubeService()
const bannerState = computed(() => (service.state.value === 'up' || service.state.value === 'unknown' ? null : service.state.value))

const presentations = useSongPresentations()
const generating = computed(() => !!song.value && presentations.isBusy(song.value.id))
function generate() {
  if (song.value) presentations.enqueue([{ id: song.value.id, title: song.value.title }])
}

const collectionDialog = ref(false)
const recentHeading = useId()

const songs = useSongs()
const refreshing = ref(false)
async function refreshLyrics() {
  if (!song.value) return
  refreshing.value = true
  try {
    const updated = await songs.refreshLyrics(song.value.id)
    if (updated) song.value = updated
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/canciones" class="btn btn-ghost self-start">
      <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
      Volver a Canciones
    </NuxtLink>

    <YoutubeServiceBanner v-if="bannerState" :state="bannerState" @retry="service.retry()" />

    <SkeletonList v-if="!song && pending" :rows="4" />

    <div v-else-if="notFound" role="alert" class="alert alert-error alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
      <span class="flex-1">{{ messages.songs.notFound }}</span>
      <NuxtLink to="/canciones" class="btn">Volver a Canciones</NuxtLink>
    </div>

    <ErrorState v-else-if="!song && error" :message="messages.songs.load.song" @retry="refresh()" />

    <template v-else-if="song">
      <SongMeta :song="song" />
      <SongActions :song="song" :generating="generating" :refreshing="refreshing" @generate="generate" @collection="collectionDialog = true" @refresh="refreshLyrics" />
      <SongLyrics :stanzas="song.lyrics" />
    </template>

    <section class="flex min-w-0 flex-col gap-3" :aria-labelledby="recentHeading">
      <h2 :id="recentHeading" class="text-lg font-semibold">Historial reciente</h2>
      <SongHistoryList recent :exclude="songId" />
    </section>

    <LazySongCollectionDialog v-if="collectionDialog && song" :song-id="song.id" :song-title="song.title" @close="collectionDialog = false" />
  </div>
</template>
