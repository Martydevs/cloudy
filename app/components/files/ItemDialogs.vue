<script setup lang="ts">
import type { FileItem } from '#shared/types/api'
import { fileName, folderName } from '#shared/validation/files'
import type { useItemActions } from '~/composables/useItemActions'
import { baseName } from '~/composables/useItemActions'

const props = defineProps<{ actions: ReturnType<typeof useItemActions> }>()

const folderField = folderName()
const fileField = fileName()
const dialog = computed(() => props.actions.dialog.value)
</script>

<template>
  <NameDialog
    v-if="dialog?.type === 'create'"
    title="Nueva carpeta"
    label="Nombre de la carpeta"
    :field="folderField"
    confirm-label="Crear carpeta"
    :loading="actions.busy.value"
    :server-error="actions.serverError.value"
    @submit="actions.submitName"
    @close="actions.close"
  />
  <NameDialog
    v-else-if="dialog?.type === 'rename'"
    :title="dialog.kind === 'folder' ? 'Renombrar carpeta' : 'Renombrar archivo'"
    label="Nombre nuevo"
    :initial="baseName(dialog.item, dialog.kind)"
    :suffix="dialog.kind === 'file' ? `.${(dialog.item as FileItem).extension}` : ''"
    :field="dialog.kind === 'folder' ? folderField : fileField"
    confirm-label="Renombrar"
    :loading="actions.busy.value"
    :server-error="actions.serverError.value"
    @submit="actions.submitName"
    @close="actions.close"
  />
  <LazyFolderPicker
    v-else-if="dialog?.type === 'move'"
    :title="`Mover «${dialog.item.name}» a…`"
    :exclude-id="dialog.kind === 'folder' ? dialog.item.id : null"
    :current-id="dialog.kind === 'folder' ? (dialog.item as { parentId: string | null }).parentId : (dialog.item as FileItem).folderId"
    @select="actions.submitMove"
    @close="actions.close"
  />
</template>
