<script setup lang="ts">
// «Ver elegidas» (feature 007): lista compacta de las peticiones elegidas, también las que el filtro oculta, con «Quitar».
// Se carga diferido (`LazyPrayerSelectionDialog`).
import type { PrayerRequest } from '#shared/types/api'

defineProps<{ items: PrayerRequest[] }>()
const emit = defineEmits<{ remove: [id: string], close: [] }>()

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
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="flex-1 text-lg font-semibold">{{ m.reviewTitle }}</h2>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="m.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <p class="text-sm text-base-content/70" role="status">{{ m.selected(items.length) }}</p>

      <ul class="flex min-h-0 flex-col gap-2 overflow-y-auto" :aria-label="m.reviewTitle">
        <li v-for="item in items" :key="item.id" class="flex items-start gap-3 rounded-box border border-base-300 p-3">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="break-words font-medium">{{ item.senderName }}</span>
            <span class="line-clamp-3 whitespace-pre-line break-words text-sm text-base-content/80">{{ item.text.text }}</span>
          </div>
          <button type="button" class="btn btn-ghost" :aria-label="`${m.remove} la petición de ${item.senderName}`" @click="emit('remove', item.id)">
            <Icon name="lucide:x" class="size-4" aria-hidden="true" />
            {{ m.remove }}
          </button>
        </li>
      </ul>

      <div class="modal-action mt-0">
        <button type="button" class="btn" @click="close">{{ m.close }}</button>
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ m.close }}</button>
    </div>
  </dialog>
</template>
