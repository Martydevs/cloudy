<script setup lang="ts">
import type { FileItem, FolderItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

defineProps<{ folders: (FolderItem & { path?: string[] })[], items: FileItem[] }>()
const emit = defineEmits<{
  fileAction: [action: ItemAction, file: FileItem]
  folderAction: [action: ItemAction, folder: FolderItem]
}>()
// Referencia de tiempo segura para el SSR; sustituye al util del mismo nombre en esta plantilla.
const { timeAgo } = useRelativeTime()

function onFile(key: string, file: FileItem) {
  if (key === 'open') navigateTo(`/archivos/ver/${file.id}`)
  else emit('fileAction', key as ItemAction, file)
}

function onFolder(key: string, folder: FolderItem) {
  if (key === 'open') navigateTo(`/archivos/${folder.id}`)
  else emit('folderAction', key as ItemAction, folder)
}
</script>

<template>
  <ul class="list rounded-box border border-base-300 bg-base-100" aria-label="Carpetas y archivos">
    <li v-for="folder in folders" :key="folder.id" class="list-row items-center">
      <Icon name="lucide:folder" class="size-8 text-primary" aria-hidden="true" />
      <NuxtLink :to="`/archivos/${folder.id}`" class="list-col-grow flex min-w-0 flex-col rounded-field">
        <span class="truncate font-medium">{{ folder.name }}</span>
        <span class="truncate text-xs text-base-content/70">
          {{ folder.path?.length ? folder.path.join(' / ') : 'Carpeta' }}
        </span>
      </NuxtLink>
      <ActionMenu :label="`Acciones de la carpeta ${folder.name}`" :items="folderMenuItems" @select="key => onFolder(key, folder)" />
    </li>
    <li v-for="file in items" :key="file.id" class="list-row items-center">
      <div class="flex size-10 items-center justify-center overflow-hidden rounded-field bg-base-200">
        <img
          v-if="file.hasThumbnail"
          :src="`/api/files/${file.id}/thumbnail`"
          :alt="file.name"
          loading="lazy"
          decoding="async"
          width="40"
          height="40"
          class="size-full object-cover"
        >
        <Icon v-else :name="fileIcon(file.category)" class="size-6 text-base-content/60" aria-hidden="true" />
      </div>
      <NuxtLink :to="`/archivos/ver/${file.id}`" class="list-col-grow flex min-w-0 flex-col rounded-field">
        <span class="flex items-center gap-2">
          <span class="truncate font-medium" :title="file.name">{{ file.name }}</span>
          <span v-if="file.origin === 'guest'" class="badge badge-secondary badge-sm">invitado</span>
          <CommentCount :count="file.commentCount" class="text-xs text-base-content/70" />
        </span>
        <span class="truncate text-xs text-base-content/70">
          <template v-if="file.path?.length">{{ file.path.join(' / ') }} · </template>
          {{ file.uploadedBy?.name ?? file.guestName ?? 'Invitado' }} · {{ timeAgo(file.createdAt) }} · {{ formatBytes(file.sizeBytes) }}
        </span>
      </NuxtLink>
      <ActionMenu :label="`Acciones de ${file.name}`" :items="fileMenuItems(file.id)" @select="key => onFile(key, file)" />
    </li>
  </ul>
</template>
