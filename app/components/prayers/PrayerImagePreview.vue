<script setup lang="ts">
// «Ver en grande» (feature 007): la imagen generada a tamaño completo. Se carga diferida (`LazyPrayerImagePreview`); al
// cerrar, el foco vuelve a quien la abrió (lo hace `<dialog>` con `showModal`).
defineProps<{ url: string, title: string }>()
const emit = defineEmits<{ close: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()

onMounted(() => {
  dialog.value?.showModal()
})

function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[95dvh] w-11/12 max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <header class="flex items-center gap-2">
        <h2 :id="titleId" class="flex-1 font-semibold">{{ title }}</h2>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="messages.prayers.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>
      <img :src="url" :alt="title" class="min-h-0 w-full flex-1 rounded-box object-contain">
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ messages.prayers.close }}</button>
    </div>
  </dialog>
</template>
