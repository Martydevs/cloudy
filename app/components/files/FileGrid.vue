<script setup lang="ts">
import type { FileItem, FolderItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

defineProps<{ folders: FolderItem[], items: FileItem[] }>()
const emit = defineEmits<{
  fileAction: [action: ItemAction, file: FileItem]
  folderAction: [action: ItemAction, folder: FolderItem]
}>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul v-if="folders.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Carpetas">
      <li v-for="folder in folders" :key="folder.id">
        <FolderCard :folder="folder" @action="(a, f) => emit('folderAction', a, f)" />
      </li>
    </ul>
    <ul v-if="items.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Archivos">
      <li v-for="file in items" :key="file.id">
        <FileCard :file="file" @action="(a, f) => emit('fileAction', a, f)" />
      </li>
    </ul>
  </div>
</template>
