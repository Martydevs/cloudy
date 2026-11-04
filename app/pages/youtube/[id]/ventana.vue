<script setup lang="ts">
// Ventana externa del reproductor (FR-013, research D14): una página de Cloudy (misma sesión) con el reproductor
// incrustado de YouTube ocupando la ventana; arranca sola porque se abre con un clic.
import type { YoutubeVideoDetail } from '#shared/types/api'
import { YOUTUBE_VIDEO_ID_RE } from '#shared/constants/youtube'

definePageMeta({
  layout: 'player',
  access: 'private',
  roles: ['editor', 'admin'],
  validate: route => YOUTUBE_VIDEO_ID_RE.test(String(route.params.id)),
})

const route = useRoute()
const videoId = computed(() => String(route.params.id ?? ''))

// Los datos del video para el título y el póster (la ficha ya lo registró en el historial).
const { data: video } = useApiFetch<YoutubeVideoDetail>(() => `/api/youtube/videos/${videoId.value}`, { server: false, lazy: true })
const title = computed(() => video.value?.title ?? 'Video')
useHead({ title: () => `${title.value} · Cloudy` })

function closeWindow() {
  window.close()
}
</script>

<template>
  <div class="flex min-h-dvh flex-col gap-2 p-2 sm:p-4">
    <header class="flex items-center gap-2">
      <h1 class="min-w-0 flex-1 truncate font-semibold">{{ title }}</h1>
      <ThemeToggle />
      <button type="button" class="btn" @click="closeWindow">
        <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        Cerrar ventana
      </button>
    </header>
    <div class="flex min-h-0 flex-1">
      <YoutubePlayer
        :video-id="videoId"
        :poster="video?.thumbnailUrl ?? null"
        :title="title"
        fill
        autoplay
      />
    </div>
  </div>
</template>
