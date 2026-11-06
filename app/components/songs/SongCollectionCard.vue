<script setup lang="ts">
// Tarjeta de una colección (feature 006, FR-020, FR-024): ícono, nombre, cantidad de canciones y autor. El botón de generar y
// el menú ⋯ se ven siempre en móvil y, desde `lg:`, al pasar el puntero **o** al llegar con el teclado (nada depende solo de hover).
import type { SongCollection } from '#shared/types/api'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = defineProps<{ collection: SongCollection, canManage?: boolean }>()
const emit = defineEmits<{
  open: [collection: SongCollection]
  generate: [collection: SongCollection]
  rename: [collection: SongCollection]
  remove: [collection: SongCollection]
}>()

const menu = computed<ActionMenuItem[]>(() => [
  { key: 'open', label: 'Ver canciones', icon: 'lucide:list-music' },
  ...(props.canManage
    ? [
        { key: 'rename', label: 'Renombrar', icon: 'lucide:pencil' },
        { key: 'remove', label: 'Eliminar colección', icon: 'lucide:trash-2', danger: true },
      ]
    : []),
])

function onSelect(key: string) {
  if (key === 'rename') emit('rename', props.collection)
  else if (key === 'remove') emit('remove', props.collection)
  else emit('open', props.collection)
}

const author = computed(() => (props.collection.author.active ? props.collection.author.name : messages.youtube.inactiveUser))
const count = computed(() => pluralize(props.collection.itemCount, 'canción', 'canciones'))
</script>

<template>
  <article class="group card relative w-60 shrink-0 snap-start border border-base-300 bg-base-100 sm:w-64">
    <button
      type="button"
      class="flex flex-col rounded-box text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`Abrir la colección ${collection.name}, ${count}`"
      @click="emit('open', collection)"
    >
      <span class="flex h-20 items-center justify-center rounded-t-box bg-base-200">
        <Icon name="lucide:list-music" class="size-8 text-primary" aria-hidden="true" />
      </span>
      <span class="card-body gap-1 p-3 pb-14">
        <span class="line-clamp-2 min-h-12 break-words font-semibold leading-6">{{ collection.name }}</span>
        <span class="text-sm text-base-content/70">{{ count }}</span>
        <span class="truncate text-sm text-base-content/70">Creada por {{ author }}</span>
      </span>
    </button>
    <!-- Generar y opciones: siempre visibles en móvil; en escritorio con hover y con foco (teclado). -->
    <div class="absolute inset-x-3 bottom-3 flex items-center gap-2 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 motion-reduce:transition-none">
      <button
        type="button"
        class="btn btn-primary btn-soft flex-1 lg:btn-sm"
        :disabled="collection.itemCount === 0"
        :aria-label="`Generar las presentaciones de ${collection.name}`"
        @click="emit('generate', collection)"
      >
        <Icon name="lucide:presentation" class="size-4" aria-hidden="true" />
        Generar
      </button>
      <ActionMenu :label="`Opciones de ${collection.name}`" :items="menu" floating @select="onSelect" />
    </div>
  </article>
</template>
