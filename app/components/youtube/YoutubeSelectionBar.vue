<script setup lang="ts">
// Barra de la selección múltiple del historial (FR-020): fija abajo, al alcance del pulgar, sobre la bandeja de
// descargas si está abierta (`--youtube-tray-h`) y respetando el área segura inferior.
import type { YoutubeFormat } from '#shared/types/api'

const props = defineProps<{ count: number }>()
const emit = defineEmits<{ download: [format: YoutubeFormat], clear: [] }>()

const { filesFor } = useYoutubeDownloads()
const format = ref<YoutubeFormat>('mp3')
const files = computed(() => filesFor(props.count))
</script>

<template>
  <div
    class="fixed inset-x-0 z-30 border-t border-base-300 bg-base-100 px-4 pt-3 shadow-2xl lg:left-auto lg:right-1/2 lg:w-[min(48rem,calc(100%-2rem))] lg:translate-x-1/2 lg:rounded-box lg:border"
    :style="{ bottom: 'var(--youtube-tray-h, 0px)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }"
    role="region"
    aria-label="Selección"
  >
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <p class="flex-1 font-medium" role="status">
        {{ pluralize(count, 'seleccionado', 'seleccionados') }}
        <span v-if="files > 1" class="block text-sm font-normal text-base-content/70 sm:inline sm:pl-2">{{ messages.youtube.downloads.filesCount(files) }}</span>
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <YoutubeFormatPicker v-model="format" label="Descargar selección" top block @select="f => emit('download', f)" />
        <button type="button" class="btn btn-ghost btn-block sm:w-auto" @click="emit('clear')">Limpiar</button>
      </div>
    </div>
  </div>
</template>
