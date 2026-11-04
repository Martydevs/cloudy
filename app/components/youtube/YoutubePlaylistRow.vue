<script setup lang="ts">
// Fila «Listas» de /youtube (FR-016, contracts/ui.md): desplazable en horizontal dentro de su contenedor, sin mover la
// página, con sus cuatro estados.
import type { YoutubeFormat, YoutubePlaylist } from '#shared/types/api'
import type { YoutubeDriveFormat } from '#shared/constants/youtube'

defineProps<{ playlists: YoutubePlaylist[] | null, pending: boolean, error: unknown }>()
const emit = defineEmits<{
  retry: []
  open: [playlist: YoutubePlaylist]
  download: [playlist: YoutubePlaylist, format: YoutubeFormat]
  drive: [playlist: YoutubePlaylist, format: YoutubeDriveFormat]
}>()
const headingId = useId()
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3" :aria-labelledby="headingId">
    <h2 :id="headingId" class="text-lg font-semibold">Listas</h2>
    <SkeletonList v-if="!playlists && pending" :rows="3" variant="grid" />
    <ErrorState v-else-if="error && !playlists" :message="messages.youtube.load.playlists" @retry="emit('retry')" />
    <EmptyState
      v-else-if="!playlists?.length"
      icon="lucide:list-video"
      title="Aún no hay listas"
      description="Abre un video y pulsa Crear lista."
    />
    <ul v-else class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Listas del equipo">
      <li v-for="playlist in playlists" :key="playlist.id" class="flex">
        <YoutubePlaylistCard
          :playlist="playlist"
          @open="emit('open', $event)"
          @download="(p, format) => emit('download', p, format)"
          @drive="(p, format) => emit('drive', p, format)"
        />
      </li>
    </ul>
  </section>
</template>
