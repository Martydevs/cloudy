<script setup lang="ts">
// Ficha de un video (feature 005, contracts/ui.md § /youtube/:id): reproductor incrustado, datos, acciones e historial reciente.
// Abrirla registra el video en el historial compartido (FR-022). El reproductor solo necesita el ID de la URL: se muestra
// al instante, sin esperar a la sonda del servicio (que puede tardar o estar dormido); los datos y las acciones llegan
// después, con su esqueleto, y cualquier error del servicio aparece debajo del reproductor.
import type { YoutubeVideoDetail } from '#shared/types/api'
import { BLOCK_REASON_MESSAGES, isBlockReason, YOUTUBE_VIDEO_ID_RE } from '#shared/constants/youtube'

definePageMeta({
  layout: 'dashboard',
  access: 'private',
  roles: ['editor', 'admin'],
  // Cada video es una ficha nueva (el reproductor y su copia no se comparten al pasar de un video a otro).
  key: route => route.path,
  // Solo IDs con la forma de YouTube; el resto es un 404.
  validate: route => YOUTUBE_VIDEO_ID_RE.test(String(route.params.id)),
})

const route = useRoute()
const videoId = computed(() => String(route.params.id ?? ''))

const service = useYoutubeService()
const { data: video, error, pending, refresh } = useApiFetch<YoutubeVideoDetail>(() => `/api/youtube/videos/${videoId.value}`, {
  server: false,
  lazy: true,
})
useHead({ title: () => `${video.value?.title ?? 'Video'} · YouTube · Cloudy` })

// El error de `useFetch` es un `NuxtError`: trae el estado y, en `data`, el cuerpo que respondió el servidor.
// Con la ficha ya cargada un error viejo no cuenta: al despertar el servicio, el aviso se va con los datos.
const status = computed(() => (error.value && !video.value ? error.value.statusCode ?? 0 : null))
const sleeping = computed(() => status.value === 503 || status.value === 429)
const videoError = computed(() => {
  if (status.value !== 404) return null
  const body = error.value?.data as { message?: string, data?: { code?: unknown } } | undefined
  const code = body?.data?.code
  return isBlockReason(code) ? BLOCK_REASON_MESSAGES[code] : body?.message || messages.youtube.load.video
})
// Los dos motores del servicio fallaron con este video (502): se dice la causa, no un error genérico de carga.
const loadError = computed(() => (error.value && !video.value ? engineFailureMessage(error.value) : null) ?? messages.youtube.load.video)

// Servicio dormido: se muestra el aviso y, en cuanto despierta, la ficha se vuelve a pedir sola (SC-010).
watch(sleeping, (asleep) => {
  if (asleep) service.markWaking()
})
watch(() => service.state.value, (state) => {
  if (state === 'up' && sleeping.value) refresh()
})

const bannerState = computed(() => {
  if (status.value === 429) return 'busy' as const
  const s = service.state.value
  if (s === 'up' || s === 'unknown') return sleeping.value ? 'waking' as const : null
  // La ficha llegó, así que el servicio ya respondió aunque el siguiente ping tarde en notarlo.
  if (s === 'waking' && video.value) return null
  return s
})

function retry() {
  service.retry()
  refresh()
}

// Reproductor (US4): el incrustado de YouTube; la ventana externa lo muestra a ventana completa.
function openWindow() {
  window.open(`/youtube/${videoId.value}/ventana`, 'cloudy-player', 'popup,width=1100,height=640')
}

const playlistDialog = ref(false)

// Historial reciente (US3): 12, sin el video actual, sin casillas.
const recent = useYoutubeHistory({ exclude: videoId, recent: true })
const recentHeading = useId()
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/youtube" class="btn btn-ghost self-start">
      <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
      Volver a YouTube
    </NuxtLink>

    <YoutubeServiceBanner v-if="bannerState" :state="bannerState" @retry="retry" />

    <YoutubePlayer :video-id="videoId" :poster="video?.thumbnailUrl" :title="video?.title" />

    <!-- Reserva el alto de `YoutubeVideoMeta` (título, canal, calidades, 4 acciones y aviso) para que al llegar los datos nada salte (CLS). -->
    <div v-if="!video && (pending || status === null)" class="flex flex-col gap-3" aria-busy="true">
      <span class="sr-only" role="status">Cargando el video…</span>
      <div class="skeleton h-7 w-3/4 sm:h-8" />
      <div class="skeleton h-6 w-1/3" />
      <div class="skeleton h-6 w-1/2" />
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div v-for="n in 4" :key="n" class="skeleton h-[45px] w-full sm:w-44" />
      </div>
      <div class="skeleton h-5 w-2/3" />
    </div>

    <div v-else-if="videoError" role="alert" class="alert alert-error alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
      <span class="flex-1">{{ videoError }}</span>
      <NuxtLink to="/youtube" class="btn">Volver a YouTube</NuxtLink>
    </div>

    <template v-else-if="!video && sleeping" />

    <ErrorState v-else-if="!video && error" :message="loadError" @retry="refresh()" />

    <YoutubeVideoMeta v-else-if="video" :video="video" @playlist="playlistDialog = true" @open-window="openWindow" />

    <section class="flex min-w-0 flex-col gap-3" :aria-labelledby="recentHeading">
      <h2 :id="recentHeading" class="text-lg font-semibold">Historial reciente</h2>
      <SkeletonList v-if="!recent.firstPage.value && recent.pending.value" :rows="3" variant="grid" />
      <ErrorState v-else-if="recent.error.value && !recent.firstPage.value" :message="messages.youtube.load.history" @retry="recent.refresh()" />
      <EmptyState v-else-if="recent.items.value.length === 0" icon="lucide:history" title="Todavía no hay otros videos" description="Los videos que abra el equipo aparecerán aquí." />
      <ul v-else class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Videos consultados recientemente">
        <li v-for="item in recent.items.value" :key="item.videoId" class="flex">
          <YoutubeVideoCard :video="item" compact />
        </li>
      </ul>
    </section>

    <LazyYoutubePlaylistDialog
      v-if="playlistDialog && video"
      :video-id="video.videoId"
      :video-title="video.title"
      @close="playlistDialog = false"
    />
  </div>
</template>
