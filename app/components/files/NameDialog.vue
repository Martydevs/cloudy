<script setup lang="ts">
import type { Field } from '#shared/validation/core'

const props = withDefaults(defineProps<{
  title: string
  label: string
  initial?: string
  field: Field<string>
  confirmLabel?: string
  /** Texto fijo que se muestra después del campo (p. ej. la extensión, que no cambia). */
  suffix?: string
  loading?: boolean
  serverError?: string
}>(), { initial: '', confirmLabel: 'Guardar', suffix: '', loading: false, serverError: '' })

const emit = defineEmits<{ submit: [value: string], close: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const input = useTemplateRef<HTMLInputElement>('input')
const value = ref(props.initial)
const touched = ref(false)
const titleId = useId()
const inputId = useId()
const errorId = useId()

const result = computed(() => props.field(value.value))
const error = computed(() => (touched.value && !result.value.ok ? result.value.error : ''))

onMounted(() => {
  dialog.value?.showModal()
  nextTick(() => input.value?.select())
})

function submit() {
  touched.value = true
  if (result.value.ok) emit('submit', result.value.value)
}

function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <form class="modal-box flex flex-col gap-3" novalidate @submit.prevent="submit">
      <h2 :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
      <div v-if="serverError" role="alert" class="alert alert-error alert-soft">
        <Icon name="lucide:circle-alert" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ serverError }}</span>
      </div>
      <label :for="inputId" class="text-sm font-medium">{{ label }}</label>
      <div class="flex items-center gap-2">
        <input
          :id="inputId"
          ref="input"
          v-model="value"
          type="text"
          class="input w-full"
          :class="{ 'input-error': error }"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? errorId : undefined"
          @blur="touched = true"
        >
        <span v-if="suffix" class="shrink-0 text-base-content/70">{{ suffix }}</span>
      </div>
      <p v-if="error" :id="errorId" class="text-sm text-error">{{ error }}</p>
      <div class="modal-action">
        <button type="button" class="btn" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="loading || !!error">
          <span v-if="loading" class="loading loading-spinner" aria-hidden="true" />
          {{ confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>
