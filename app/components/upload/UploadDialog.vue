<script setup lang="ts">
import type { FileItem } from '#shared/types/api'

const props = defineProps<{ folderId: string | null }>()
const emit = defineEmits<{ close: [], uploaded: [files: FileItem[]] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const { confirm } = useConfirm()

const uploader = useUploader({
  folderId: () => props.folderId,
  onSettled: files => emit('uploaded', files),
})

onMounted(() => dialog.value?.showModal())

async function close() {
  if (uploader.busy.value) {
    const stop = await confirm({
      title: '¿Cancelar las subidas en curso?',
      message: 'Los archivos que todavía no terminaron no se guardarán.',
      confirmLabel: 'Cancelar subidas',
      danger: true,
    })
    if (!stop) return
    uploader.cancelAll()
  }
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4">
      <div class="flex items-center justify-between gap-2">
        <h2 :id="titleId" class="text-lg font-semibold">Subir archivos</h2>
        <button type="button" class="btn btn-ghost btn-square" aria-label="Cerrar" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </div>
      <p class="text-sm text-base-content/70">
        {{ folderId ? 'Se guardarán en la carpeta actual.' : 'Se guardarán en Archivos (raíz).' }}
      </p>
      <DropZone @files="uploader.add" />
      <div v-if="uploader.items.value.length" class="min-h-0 overflow-y-auto">
        <UploadQueue :items="uploader.items.value" @retry="uploader.retry" @cancel="uploader.cancel" />
      </div>
      <div class="modal-action mt-0">
        <button type="button" class="btn" @click="close">{{ uploader.busy.value ? 'Cancelar' : 'Listo' }}</button>
      </div>
    </div>
  </dialog>
</template>
