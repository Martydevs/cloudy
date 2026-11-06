<script setup lang="ts">
// Fila «Colecciones» de /canciones (feature 006, FR-020, contracts/ui.md): desplazable en horizontal dentro de su contenedor,
// con sus cuatro estados y el botón **Nueva colección** en la cabecera y en el estado vacío.
import type { SongCollection } from '#shared/types/api'

defineProps<{ collections: SongCollection[] | null, pending: boolean, error: unknown, canManage?: (collection: SongCollection) => boolean }>()
const emit = defineEmits<{
  retry: []
  create: []
  open: [collection: SongCollection]
  generate: [collection: SongCollection]
  rename: [collection: SongCollection]
  remove: [collection: SongCollection]
}>()
const headingId = useId()
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3" :aria-labelledby="headingId">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 :id="headingId" class="text-lg font-semibold">Colecciones</h2>
      <button v-if="collections?.length" type="button" class="btn lg:btn-sm" @click="emit('create')">
        <Icon name="lucide:list-plus" class="size-4" aria-hidden="true" />
        {{ messages.songs.collection.new }}
      </button>
    </header>
    <SkeletonList v-if="!collections && pending" :rows="3" variant="grid" />
    <ErrorState v-else-if="error && !collections" :message="messages.songs.load.collections" @retry="emit('retry')" />
    <EmptyState v-else-if="!collections?.length" icon="lucide:list-music" title="Aún no hay colecciones" description="Crea la primera aquí o desde una canción.">
      <button type="button" class="btn btn-primary" @click="emit('create')">
        <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
        {{ messages.songs.collection.new }}
      </button>
    </EmptyState>
    <ul v-else class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Colecciones del equipo">
      <li v-for="collection in collections" :key="collection.id" class="flex">
        <SongCollectionCard
          :collection="collection"
          :can-manage="canManage?.(collection) ?? false"
          @open="emit('open', $event)"
          @generate="emit('generate', $event)"
          @rename="emit('rename', $event)"
          @remove="emit('remove', $event)"
        />
      </li>
    </ul>
  </section>
</template>
