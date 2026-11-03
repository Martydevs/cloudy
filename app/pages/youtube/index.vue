<script setup lang="ts">
// Página YouTube (feature 005, contracts/ui.md § /youtube): pegar un enlace, listas del equipo e historial compartido
// con selección múltiple y descarga por lotes de 10.
import type { YoutubeFormat, YoutubeHistoryItem, YoutubePlaylist, YoutubePlaylistDetail } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'YouTube · Cloudy' })

const api = useApi()
const toast = useToast()
const service = useYoutubeService()
const downloads = useYoutubeDownloads()
const navigating = ref(false)

async function open(videoId: string) {
  navigating.value = true
  try {
    await navigateTo(`/youtube/${videoId}`)
  }
  finally {
    navigating.value = false
  }
}

// ---- Listas
const { data: playlists, pending: playlistsPending, error: playlistsError, refresh: refreshPlaylists } = useYoutubePlaylistList()
const dialog = ref<{ playlistId?: string, videoId?: string, videoTitle?: string } | null>(null)

/** Descargar una lista: se piden sus videos y se encolan por lotes de 10, avisando cuántos archivos llegarán (SC-005). */
async function downloadPlaylist(playlist: YoutubePlaylist, format: YoutubeFormat) {
  try {
    const detail = await api<YoutubePlaylistDetail>(`/api/youtube/playlists/${playlist.id}`)
    const ids = detail.items.map(item => item.videoId)
    if (ids.length === 0) return
    const files = downloads.enqueue(ids, format, playlist.name)
    toast.info(messages.youtube.downloads.filesCount(files))
  }
  catch (error) {
    toast.error(serverMessage(error, messages.youtube.load.playlist))
  }
}

// ---- Historial y selección (sobrevive a un error de descarga; se limpia con «Limpiar»)
const selected = useState<string[]>('youtube-history-selected', () => [])

function downloadSelection(format: YoutubeFormat) {
  const files = downloads.enqueue(selected.value, format, 'Selección')
  if (files > 1) toast.info(messages.youtube.downloads.filesCount(files))
}

function addToPlaylist(video: YoutubeHistoryItem) {
  dialog.value = { videoId: video.videoId, videoTitle: video.title }
}

// ---- Sección inferior: Historial (con selección) o Descargas (últimos videos descargados). El historial se oculta sin
// desmontarlo para conservar sus páginas cargadas y la selección; Descargas se carga la primera vez que se abre.
type Section = 'history' | 'downloads'
const SECTIONS: { value: Section, label: string }[] = [
  { value: 'history', label: 'Historial' },
  { value: 'downloads', label: 'Descargas' },
]
const section = useState<Section>('youtube-section', () => 'history')
const downloadsOpened = ref(section.value === 'downloads')
watch(section, (value) => {
  if (value === 'downloads') downloadsOpened.value = true
})
const sectionHeadingId = useId()
const sectionTitle = computed(() => SECTIONS.find(s => s.value === section.value)!.label)
</script>

<template>
  <div class="flex flex-col gap-8" :class="{ 'pb-40 sm:pb-24': selected.length > 0 && section === 'history' }">
    <div class="flex flex-col gap-4">
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">YouTube</h1>
        <p class="text-base-content/70">Pega el enlace de un video para verlo y descargarlo como video o audio.</p>
      </header>

      <YoutubeServiceBanner
        v-if="service.state.value !== 'up' && service.state.value !== 'unknown'"
        :state="service.state.value"
        @retry="service.retry()"
      />

      <YoutubeUrlInput :busy="navigating" @submit="open" />
    </div>

    <YoutubePlaylistRow
      :playlists="playlists?.items ?? null"
      :pending="playlistsPending"
      :error="playlistsError"
      @retry="refreshPlaylists()"
      @open="playlist => (dialog = { playlistId: playlist.id })"
      @download="downloadPlaylist"
    />

    <section class="flex flex-col gap-3" :aria-labelledby="sectionHeadingId">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h2 :id="sectionHeadingId" class="text-lg font-semibold">{{ sectionTitle }}</h2>
        <div class="join" role="group" aria-label="Cambiar de sección">
          <button
            v-for="option in SECTIONS"
            :key="option.value"
            type="button"
            class="btn join-item"
            :class="{ 'btn-primary': section === option.value }"
            :aria-pressed="section === option.value"
            @click="section = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </header>

      <YoutubeHistoryList v-show="section === 'history'" v-model:selected="selected" @playlist="addToPlaylist" />
      <LazyYoutubeDownloadsGrid v-if="downloadsOpened" v-show="section === 'downloads'" />
    </section>

    <YoutubeSelectionBar
      v-if="selected.length > 0 && section === 'history'"
      :count="selected.length"
      @download="downloadSelection"
      @clear="selected = []"
    />

    <LazyYoutubePlaylistDialog
      v-if="dialog"
      :playlist-id="dialog.playlistId"
      :video-id="dialog.videoId"
      :video-title="dialog.videoTitle"
      @close="dialog = null"
    />
  </div>
</template>
