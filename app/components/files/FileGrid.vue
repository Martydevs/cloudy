<script setup lang="ts">
import type { FileItem, FolderItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

// `selectable` muestra una casilla en cada tarjeta; lo marcado (ids de archivos y carpetas) va en `v-model:selected`.
defineProps<{ folders: FolderItem[], items: FileItem[], selectable?: boolean }>()
const selected = defineModel<string[]>('selected', { default: () => [] })
const emit = defineEmits<{
  fileAction: [action: ItemAction, file: FileItem]
  folderAction: [action: ItemAction, folder: FolderItem]
}>()

const selectedSet = computed(() => new Set(selected.value))
function toggle(id: string) {
  selected.value = selectedSet.value.has(id) ? selected.value.filter(item => item !== id) : [...selected.value, id]
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul v-if="folders.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Carpetas">
      <li v-for="folder in folders" :key="folder.id">
        <FolderCard
          :folder="folder"
          :selectable="selectable"
          :selected="selectedSet.has(folder.id)"
          @toggle="toggle"
          @action="(a, f) => emit('folderAction', a, f)"
        />
      </li>
    </ul>
    <ul v-if="items.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Archivos">
      <li v-for="file in items" :key="file.id">
        <FileCard
          :file="file"
          :selectable="selectable"
          :selected="selectedSet.has(file.id)"
          @toggle="toggle"
          @action="(a, f) => emit('fileAction', a, f)"
        />
      </li>
    </ul>
  </div>
</template>
