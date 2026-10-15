<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  open?: boolean
}>(), { message: '', confirmLabel: 'Confirmar', danger: false, open: false })

const emit = defineEmits<{ confirm: [], cancel: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton')
const titleId = useId()
const messageId = useId()

function sync(open: boolean) {
  const el = dialog.value
  if (!el) return
  if (open && !el.open) {
    el.showModal()
    // Foco inicial en la opción segura (Constitución VI).
    nextTick(() => cancelButton.value?.focus())
  }
  else if (!open && el.open) {
    el.close()
  }
}

watch(() => props.open, sync, { flush: 'post' })
onMounted(() => sync(props.open))
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    :aria-labelledby="titleId"
    :aria-describedby="message ? messageId : undefined"
    @keydown.esc.prevent="emit('cancel')"
    @cancel.prevent="emit('cancel')"
  >
    <div class="modal-box">
      <h2 :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
      <p v-if="message" :id="messageId" class="py-4 text-base-content/80">{{ message }}</p>
      <slot />
      <div class="modal-action">
        <button ref="cancelButton" type="button" class="btn" @click="emit('cancel')">Cancelar</button>
        <button type="button" class="btn" :class="danger ? 'btn-error' : 'btn-primary'" @click="emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="emit('cancel')">Cerrar</button>
    </div>
  </dialog>
</template>
