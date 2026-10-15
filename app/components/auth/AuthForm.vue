<script setup lang="ts" generic="T">
import type { Validator } from '#shared/validation/core'

export interface FormField {
  name: string
  label: string
  type?: 'text' | 'email' | 'password'
  autocomplete?: string
  hint?: string
}

const props = withDefaults(defineProps<{
  legend: string
  fields: FormField[]
  validator: Validator<T>
  submitLabel: string
  loading?: boolean
  serverError?: string
  initial?: Record<string, string>
}>(), { loading: false, serverError: '', initial: () => ({}) })

const emit = defineEmits<{ submit: [data: T] }>()

const formId = useId()
const values = reactive<Record<string, string>>(
  Object.fromEntries(props.fields.map(f => [f.name, props.initial[f.name] ?? ''])),
)
const touched = reactive(new Set<string>())
// Antes de hidratar, un envío nativo recargaría la página; el botón espera a que Vue tome el control.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

const result = computed(() => props.validator({ ...values }))
const errors = computed<Record<string, string>>(() => result.value.ok ? {} : result.value.errors)
const visibleErrors = computed(() =>
  Object.fromEntries(Object.entries(errors.value).filter(([name]) => touched.has(name))),
)
const hasVisibleErrors = computed(() => Object.keys(visibleErrors.value).length > 0)

const inputId = (name: string) => `${formId}-${name}`
const errorId = (name: string) => `${formId}-${name}-error`

function onSubmit() {
  for (const field of props.fields) touched.add(field.name)
  const res = result.value
  if (!res.ok) {
    const first = props.fields.find(f => res.errors[f.name])
    if (first && import.meta.client) document.getElementById(inputId(first.name))?.focus()
    return
  }
  emit('submit', res.data)
}
</script>

<template>
  <form method="post" novalidate class="flex flex-col gap-4" @submit.prevent="onSubmit">
    <fieldset class="fieldset gap-3">
      <legend class="fieldset-legend text-xl">{{ legend }}</legend>
      <slot name="intro" />

      <div v-if="serverError" role="alert" class="alert alert-error alert-soft">
        <Icon name="lucide:circle-alert" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ serverError }}</span>
      </div>

      <div v-for="field in fields" :key="field.name" class="flex flex-col gap-1">
        <label :for="inputId(field.name)" class="label text-sm font-medium text-base-content">{{ field.label }}</label>
        <input
          :id="inputId(field.name)"
          v-model="values[field.name]"
          :name="field.name"
          :type="field.type ?? 'text'"
          :autocomplete="field.autocomplete"
          class="input w-full"
          :class="{ 'input-error': visibleErrors[field.name] }"
          :aria-invalid="visibleErrors[field.name] ? 'true' : undefined"
          :aria-describedby="visibleErrors[field.name] ? errorId(field.name) : undefined"
          @blur="touched.add(field.name)"
        >
        <p v-if="visibleErrors[field.name]" :id="errorId(field.name)" class="text-sm text-error">
          {{ visibleErrors[field.name] }}
        </p>
        <p v-else-if="field.hint" class="label text-sm">{{ field.hint }}</p>
      </div>
    </fieldset>

    <button type="submit" class="btn btn-primary w-full" :disabled="!hydrated || loading || hasVisibleErrors">
      <span v-if="loading" class="loading loading-spinner" aria-hidden="true" />
      {{ submitLabel }}
    </button>

    <slot name="footer" />
  </form>
</template>
