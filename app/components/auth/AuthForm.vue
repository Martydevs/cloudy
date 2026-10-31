<script setup lang="ts" generic="T extends Record<string, string>">
import type { ZodMiniType } from 'zod/mini'

export interface FormField {
  name: string
  label: string
  type?: 'text' | 'email' | 'password'
  autocomplete?: string
  hint?: string
}

// Por dentro el estado es un registro de textos: Regle no puede inferir sobre el genérico `T`, que solo se usa
// en la prop `schema` y en el evento `submit`.
type FormState = Record<string, string>

const props = withDefaults(defineProps<{
  legend: string
  fields: FormField[]
  /** Esquema zod de los campos (texto); puede comparar campos, p. ej. confirmar la contraseña. */
  schema: ZodMiniType<T, T>
  submitLabel: string
  loading?: boolean
  serverError?: string
  initial?: Record<string, string>
}>(), { loading: false, serverError: '', initial: () => ({}) })

const emit = defineEmits<{ submit: [data: T] }>()

const formId = useId()
const values = reactive<FormState>(
  Object.fromEntries(props.fields.map(f => [f.name, props.initial[f.name] ?? ''])),
)
const { r$ } = useFormSchema(values, props.schema as unknown as ZodMiniType<FormState, FormState>)
// Antes de hidratar, un envío nativo recargaría la página; el botón espera a que Vue tome el control.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

const inputId = (name: string) => `${formId}-${name}`
const errorId = (name: string) => `${formId}-${name}-error`
/** Primer error visible del campo (tras salir de él o enviar). */
const errorOf = (name: string): string | undefined => r$.$errors[name]?.[0]

/** Como el servidor: recorta todo salvo las contraseñas y pasa los correos a minúsculas. */
function normalize(data: FormState): T {
  return Object.fromEntries(props.fields.map((field) => {
    const raw = data[field.name] ?? ''
    if (field.type === 'password') return [field.name, raw]
    return [field.name, field.type === 'email' ? raw.trim().toLowerCase() : raw.trim()]
  })) as T
}

async function onSubmit() {
  const { valid, data } = await r$.$validate()
  if (!valid) {
    const first = props.fields.find(f => r$.$fields[f.name]?.$invalid)
    if (first) document.getElementById(inputId(first.name))?.focus()
    return
  }
  emit('submit', normalize(data))
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
          v-model="r$.$value[field.name]"
          :name="field.name"
          :type="field.type ?? 'text'"
          :autocomplete="field.autocomplete"
          class="input w-full"
          :class="{ 'input-error': errorOf(field.name) }"
          :aria-invalid="errorOf(field.name) ? 'true' : undefined"
          :aria-describedby="errorOf(field.name) ? errorId(field.name) : undefined"
          @blur="r$.$fields[field.name]?.$touch()"
        >
        <p v-if="errorOf(field.name)" :id="errorId(field.name)" class="text-sm text-error">
          {{ errorOf(field.name) }}
        </p>
        <p v-else-if="field.hint" class="label text-sm">{{ field.hint }}</p>
      </div>
    </fieldset>

    <button type="submit" class="btn btn-primary w-full" :disabled="!hydrated || loading || r$.$error">
      <span v-if="loading" class="loading loading-spinner" aria-hidden="true" />
      {{ submitLabel }}
    </button>

    <slot name="footer" />
  </form>
</template>
