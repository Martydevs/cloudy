<script setup lang="ts">
import type { FileItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

const props = withDefaults(defineProps<{
  file: FileItem
  compact?: boolean
  /** Muestra la casilla de selección múltiple (Archivos). */
  selectable?: boolean
  selected?: boolean
}>(), { compact: false, selectable: false, selected: false })
const emit = defineEmits<{ action: [action: ItemAction, file: FileItem], toggle: [id: string] }>()

const href = computed(() => `/archivos/ver/${props.file.id}`)
const menu = computed(() => fileMenuItems(props.file.id))
// Referencia de tiempo segura para el SSR; sustituye al util del mismo nombre en esta plantilla.
const { timeAgo } = useRelativeTime()

function onSelect(key: string) {
  if (key === 'open') navigateTo(href.value)
  else emit('action', key as ItemAction, props.file)
}
</script>

<template>
  <article
    class="group relative flex flex-col gap-2 rounded-box border bg-base-100 p-2 focus-within:border-primary hover:border-primary"
    :class="selected ? 'border-primary ring-2 ring-primary' : 'border-base-300'"
  >
    <NuxtLink :to="href" class="flex flex-col gap-2 rounded-field" :aria-label="`Abrir ${file.name}`">
      <div class="flex aspect-square items-center justify-center overflow-hidden rounded-field bg-base-200">
        <img
          v-if="file.hasThumbnail"
          :src="`/api/files/${file.id}/thumbnail`"
          :alt="file.name"
          loading="lazy"
          decoding="async"
          width="320"
          height="320"
          class="size-full object-cover"
        >
        <Icon v-else :name="fileIcon(file.category)" class="size-10 text-base-content/60" aria-hidden="true" />
      </div>
      <div class="flex min-w-0 flex-col px-1" :class="{ 'pr-10': !compact }">
        <span class="truncate text-sm font-medium" :title="file.name">{{ file.name }}</span>
        <!-- Búsqueda (feature 002): la consulta coincidió con el texto leído de la imagen, no con el nombre. -->
        <!-- Tamaño y fecha en líneas distintas: en una sola, junto al hueco del menú, la fecha quedaba recortada. -->
        <span class="truncate text-xs text-base-content/70">
          {{ formatBytes(file.sizeBytes) }}<template v-if="compact"> · {{ timeAgo(file.createdAt) }}</template>
        </span>
        <time v-if="!compact" :datetime="file.createdAt" class="text-xs text-base-content/70">{{ timeAgo(file.createdAt) }}</time>
      </div>
    </NuxtLink>
    <!-- Casilla siempre visible, con área táctil de 44 px, sobre la esquina de la miniatura. -->
    <label v-if="selectable" class="absolute left-1 top-1 flex size-11 cursor-pointer items-center justify-center rounded-box">
      <input
        type="checkbox"
        class="checkbox checkbox-primary"
        :checked="selected"
        :aria-label="`Seleccionar ${file.name}`"
        @change="emit('toggle', file.id)"
      >
    </label>
    <span v-if="file.origin === 'guest'" class="badge badge-secondary badge-sm absolute top-3" :class="selectable ? 'left-14' : 'left-3'">invitado</span>
    <!-- Sobre la miniatura, para no recortar más la línea de metadatos de la tarjeta. -->
    <CommentCount :count="file.commentCount" class="badge badge-neutral badge-sm absolute right-3 top-3" />
    <div v-if="!compact" class="absolute bottom-1 right-1">
      <ActionMenu :label="`Acciones de ${file.name}`" :items="menu" @select="onSelect" />
    </div>
  </article>
</template>
