<script setup lang="ts">
// «Corregir texto» de una petición (feature 007, contracts/ui.md, research D6): la foto grande junto al `ImageTextPanel`
// editable de la feature 002 sobre `PATCH /api/files/<id>/text`; reenvía su `change`. Se carga diferida
// (`LazyPrayerTextDialog`), así el editor y Regle solo llegan al corregir. Con `autoRead`, una petición aún sin leer recibe
// la lectura de respaldo de siempre, como en Solicitudes.
import type { ImageText, PrayerRequest } from '#shared/types/api'

defineProps<{ request: PrayerRequest }>()
const emit = defineEmits<{ change: [text: ImageText], close: [] }>()

const m = messages.prayers
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
    <div class="modal-box flex max-h-[95dvh] w-11/12 max-w-5xl flex-col gap-4 p-4">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="min-w-0 flex-1 break-words text-lg font-semibold">{{ m.textDialogTitle(request.senderName) }}</h2>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="m.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <div class="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
        <!-- Caja de proporción fija (como la tarjeta): el diálogo no salta mientras llega la foto. -->
        <div class="aspect-[4/3] max-h-[45dvh] w-full self-start rounded-box bg-base-200 md:max-h-[70dvh]">
          <img
            :src="request.previewUrl"
            :alt="`Foto enviada por ${request.senderName}`"
            decoding="async"
            class="size-full rounded-box object-contain"
          >
        </div>
        <ImageTextPanel
          :endpoint="`/api/files/${request.id}/text`"
          :initial="request.text"
          editable
          auto-read
          @change="text => emit('change', text)"
        />
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ m.close }}</button>
    </div>
  </dialog>
</template>
