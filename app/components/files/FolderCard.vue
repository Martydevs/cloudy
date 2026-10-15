<script setup lang="ts">
import type { FolderItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

const props = defineProps<{ folder: FolderItem & { path?: string[] } }>()
const emit = defineEmits<{ action: [action: ItemAction, folder: FolderItem] }>()

const href = computed(() => `/archivos/${props.folder.id}`)

function onSelect(key: string) {
  if (key === 'open') navigateTo(href.value)
  else emit('action', key as ItemAction, props.folder)
}
</script>

<template>
  <article class="relative flex items-center gap-2 rounded-box border border-base-300 bg-base-100 p-2 focus-within:border-primary hover:border-primary">
    <NuxtLink :to="href" class="flex min-w-0 flex-1 items-center gap-3 rounded-field p-1" :aria-label="`Abrir carpeta ${folder.name}`">
      <Icon name="lucide:folder" class="size-8 shrink-0 text-primary" aria-hidden="true" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate font-medium" :title="folder.name">{{ folder.name }}</span>
        <span class="truncate text-xs text-base-content/70">
          <template v-if="folder.path?.length">{{ folder.path.join(' / ') }}</template>
          <template v-else-if="folder.itemCount !== undefined">{{ folder.itemCount === 1 ? '1 elemento' : `${folder.itemCount} elementos` }}</template>
        </span>
      </span>
    </NuxtLink>
    <ActionMenu :label="`Acciones de la carpeta ${folder.name}`" :items="folderMenuItems" @select="onSelect" />
  </article>
</template>
