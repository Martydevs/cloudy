<script setup lang="ts">
// Datos de la canción (feature 006, contracts/ui.md § Página de canción): título, artista, origen y cuándo se obtuvo la letra.
import type { SongDetail } from '#shared/types/api'

defineProps<{ song: SongDetail }>()

const { timeAgo } = useRelativeTime()
</script>

<template>
  <section class="flex flex-col gap-2" aria-label="Datos de la canción">
    <h1 class="break-words text-xl font-semibold sm:text-2xl">{{ song.title }}</h1>
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/70">
      <span v-if="song.artist" class="flex items-center gap-1">
        <Icon name="lucide:mic-vocal" class="size-4" aria-hidden="true" />
        {{ song.artist }}
      </span>
      <span class="flex items-center gap-1">
        <Icon name="lucide:clock" class="size-4" aria-hidden="true" />
        Obtenida {{ timeAgo(song.updatedAt) }}
      </span>
    </p>
    <a :href="song.sourceUrl" target="_blank" rel="noopener noreferrer" class="link link-hover inline-flex min-h-11 items-center gap-1 self-start">
      <Icon name="lucide:external-link" class="size-4" aria-hidden="true" />
      Ver en Letras.com
      <span class="sr-only">(se abre en otra pestaña)</span>
    </a>
  </section>
</template>
