<script setup lang="ts">
// Tarjeta de una colección de imágenes (feature 007, enmienda de historial; forma de `SongCollectionCard` sin «Generar»):
// ícono, nombre, cantidad de imágenes y autor. Toda la tarjeta abre la colección; el menú ⋯ se ve siempre (nada depende de hover).
import type { PrayerImageCollection } from '#shared/types/api'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = defineProps<{ collection: PrayerImageCollection, canManage?: boolean }>()
const emit = defineEmits<{
  open: [collection: PrayerImageCollection]
  rename: [collection: PrayerImageCollection]
  remove: [collection: PrayerImageCollection]
}>()

const m = messages.prayers.collection

const menu = computed<ActionMenuItem[]>(() => [
  { key: 'open', label: m.open, icon: 'lucide:images' },
  ...(props.canManage
    ? [
        { key: 'rename', label: m.rename, icon: 'lucide:pencil' },
        { key: 'remove', label: m.remove, icon: 'lucide:trash-2', danger: true },
      ]
    : []),
])

function onSelect(key: string) {
  if (key === 'rename') emit('rename', props.collection)
  else if (key === 'remove') emit('remove', props.collection)
  else emit('open', props.collection)
}

const authorId = useId()
const author = computed(() => (props.collection.author.active ? props.collection.author.name : messages.youtube.inactiveUser))
const count = computed(() => m.count(props.collection.itemCount))
</script>

<template>
  <article class="card relative w-60 shrink-0 snap-start border border-base-300 bg-base-100 sm:w-64">
    <button
      type="button"
      class="flex flex-col rounded-box text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="m.openLabel(collection.name, count)"
      :aria-describedby="authorId"
      @click="emit('open', collection)"
    >
      <span class="flex h-20 items-center justify-center rounded-t-box bg-base-200">
        <Icon name="lucide:images" class="size-8 text-primary" aria-hidden="true" />
      </span>
      <span class="card-body gap-1 p-3 pr-14">
        <span class="line-clamp-2 min-h-12 break-words font-semibold leading-6">{{ collection.name }}</span>
        <span class="text-sm text-base-content/70">{{ count }}</span>
        <span :id="authorId" class="truncate text-sm text-base-content/70">{{ m.createdBy(author) }}</span>
      </span>
    </button>
    <ActionMenu class="absolute bottom-2 right-2" :label="m.options(collection.name)" :items="menu" floating @select="onSelect" />
  </article>
</template>
