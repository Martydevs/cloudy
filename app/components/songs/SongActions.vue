<script setup lang="ts">
// Acciones de la ficha de una canción (feature 006, contracts/ui.md § Página de canción): **Generar presentación** (primario,
// con la nota de la letra en blanco; deshabilitado mientras se genera y con una letra de más de 300 líneas, mostrando el motivo),
// **Agregar a colección** (crear una o elegir una existente) y **Volver a obtener la letra** (la confirmación vive en `useSongs`). No hay selector de color (research D12). A 360 px los
// botones ocupan el ancho y se acomodan en filas, en el orden del DOM.
import type { SongDetail } from '#shared/types/api'
import { LYRICS_MAX_LINES } from '#shared/constants/songs'

const props = defineProps<{ song: SongDetail, generating?: boolean, refreshing?: boolean }>()
const emit = defineEmits<{ generate: [], collection: [], refresh: [] }>()

const reasonId = useId()
const hintId = useId()
const tooLong = computed(() => props.song.lineCount > LYRICS_MAX_LINES)
</script>

<template>
  <section class="flex flex-col gap-2" aria-label="Acciones de la canción">
    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
      <button
        type="button"
        class="btn btn-primary btn-block sm:w-auto"
        :disabled="generating || tooLong"
        :aria-describedby="tooLong ? `${reasonId} ${hintId}` : hintId"
        @click="emit('generate')"
      >
        <span v-if="generating" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else name="lucide:presentation" class="size-5" aria-hidden="true" />
        {{ messages.songs.present.action }}
      </button>
      <button type="button" class="btn btn-block sm:w-auto" @click="emit('collection')">
        <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
        {{ messages.songs.collection.addTo }}
      </button>
      <button type="button" class="btn btn-block sm:w-auto" :disabled="refreshing" @click="emit('refresh')">
        <span v-if="refreshing" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
        {{ messages.songs.refresh.action }}
      </button>
    </div>
    <p v-if="tooLong" :id="reasonId" class="text-sm text-error">{{ messages.songs.present.tooLongReason }}</p>
    <p :id="hintId" class="text-sm text-base-content/70">{{ messages.songs.present.whiteHint }}</p>
  </section>
</template>
