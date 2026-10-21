<script setup lang="ts">
import type { FileItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

const props = withDefaults(defineProps<{ file: FileItem, compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ action: [action: ItemAction, file: FileItem] }>()

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
  <article class="group relative flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-2 focus-within:border-primary hover:border-primary">
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
        <span v-if="file.matchedIn === 'text'" class="badge badge-primary badge-sm my-0.5 self-start">En el texto</span>
        <!-- Tamaño y fecha en líneas distintas: en una sola, junto al hueco del menú, la fecha quedaba recortada. -->
        <span class="truncate text-xs text-base-content/70">
          {{ formatBytes(file.sizeBytes) }}<template v-if="compact"> · {{ timeAgo(file.createdAt) }}</template>
        </span>
        <time v-if="!compact" :datetime="file.createdAt" class="text-xs text-base-content/70">{{ timeAgo(file.createdAt) }}</time>
      </div>
    </NuxtLink>
    <span v-if="file.origin === 'guest'" class="badge badge-secondary badge-sm absolute left-3 top-3">invitado</span>
    <!-- Sobre la miniatura, para no recortar más la línea de metadatos de la tarjeta. -->
    <CommentCount :count="file.commentCount" class="badge badge-neutral badge-sm absolute right-3 top-3" />
    <div v-if="!compact" class="absolute bottom-1 right-1">
      <ActionMenu :label="`Acciones de ${file.name}`" :items="menu" @select="onSelect" />
    </div>
  </article>
</template>
