<script setup lang="ts">
import type { FileItem } from '#shared/types/api'

const props = defineProps<{ file: FileItem }>()

// El contenido se sirve con una redirección a una URL firmada; audio y video piden rangos al bucket.
const src = computed(() => `/api/files/${props.file.id}/content`)
const isPdf = computed(() => props.file.extension === 'pdf')
const failed = ref(false)
</script>

<template>
  <div class="flex min-h-48 items-center justify-center overflow-hidden rounded-box border border-base-300 bg-base-200">
    <img
      v-if="file.category === 'image' && file.extension !== 'heic' && !failed"
      :src="src"
      :alt="file.name"
      class="max-h-[70dvh] w-auto max-w-full object-contain"
      decoding="async"
      @error="failed = true"
    >
    <!-- Controles nativos: accesibles por teclado y lector de pantalla en todos los navegadores. -->
    <audio
      v-else-if="file.category === 'audio'"
      :src="src"
      controls
      preload="metadata"
      class="w-full max-w-xl p-4"
      :aria-label="`Reproducir ${file.name}`"
    />
    <video
      v-else-if="file.category === 'video'"
      :src="src"
      controls
      preload="metadata"
      playsinline
      class="max-h-[70dvh] w-full"
      :aria-label="`Reproducir ${file.name}`"
    />
    <iframe
      v-else-if="isPdf"
      :src="src"
      :title="`Vista previa de ${file.name}`"
      class="h-[70dvh] w-full"
      loading="lazy"
    />
    <div v-else class="flex flex-col items-center gap-3 p-8 text-center">
      <Icon :name="fileIcon(file.category)" class="size-16 text-base-content/60" aria-hidden="true" />
      <p class="text-base-content/70">Este formato no tiene vista previa.</p>
      <a :href="`${src}?download=1`" class="btn btn-primary" download>
        <Icon name="lucide:download" class="size-4" aria-hidden="true" />
        Descargar
      </a>
    </div>
  </div>
</template>
