<script setup lang="ts">
// Fila «Colecciones» de /peticiones (feature 007, enmienda de historial; forma de `SongCollectionRow`): desplazable en
// horizontal dentro de su contenedor, con sus cuatro estados y **Nueva colección** en la cabecera y en el estado vacío. Llega
// con el SSR y su contenedor tiene un alto mínimo fijo en los cuatro estados, así no mueve el historial de debajo (CLS).
import type { PrayerImageCollection } from '#shared/types/api'

defineProps<{
  collections: PrayerImageCollection[] | null
  pending: boolean
  error: unknown
  canManage?: (collection: PrayerImageCollection) => boolean
}>()
const emit = defineEmits<{
  retry: []
  create: []
  open: [collection: PrayerImageCollection]
  rename: [collection: PrayerImageCollection]
  remove: [collection: PrayerImageCollection]
}>()
const m = messages.prayers.collection
const headingId = useId()
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3" :aria-labelledby="headingId">
    <header class="flex min-h-11 flex-wrap items-center justify-between gap-2">
      <h2 :id="headingId" class="text-lg font-semibold">{{ m.title }}</h2>
      <button v-if="collections?.length" type="button" class="btn lg:btn-sm" @click="emit('create')">
        <Icon name="lucide:list-plus" class="size-4" aria-hidden="true" />
        {{ m.new }}
      </button>
    </header>
    <div class="flex min-h-56 flex-col">
      <div v-if="!collections && pending" class="-mx-1 flex gap-3 overflow-hidden px-1 pb-2" aria-busy="true">
        <span class="sr-only" role="status">{{ m.loading }}</span>
        <div v-for="n in 4" :key="n" class="skeleton h-52 w-60 shrink-0 motion-reduce:animate-none sm:w-64" />
      </div>
      <ErrorState v-else-if="error && !collections" :message="m.load" @retry="emit('retry')" />
      <EmptyState v-else-if="!collections?.length" class="flex-1 justify-center" icon="lucide:images" :title="m.empty" :description="m.emptyHint">
        <button type="button" class="btn btn-primary" @click="emit('create')">
          <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
          {{ m.new }}
        </button>
      </EmptyState>
      <ul v-else class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" :aria-label="m.list">
        <li v-for="collection in collections" :key="collection.id" class="flex">
          <PrayerCollectionCard
            :collection="collection"
            :can-manage="canManage?.(collection) ?? false"
            @open="emit('open', $event)"
            @rename="emit('rename', $event)"
            @remove="emit('remove', $event)"
          />
        </li>
      </ul>
    </div>
  </section>
</template>
