<script setup lang="ts">
// Campo grande para pegar el enlace de una canción de Letras.com (feature 006, FR-004–FR-006, contracts/ui.md). Valida con
// `songUrlSchema` (la regla `parseLetrasUrl` de `shared/`) y emite el enlace ya normalizado. Durante el rastreo muestra la
// espera; un error del servidor (`error`) aparece junto al campo y el texto pegado se conserva.
import { parseLetrasUrl } from '#shared/validation/songs'
import { songUrlSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ busy?: boolean, error?: string | null }>(), { busy: false, error: null })
const emit = defineEmits<{ submit: [url: string] }>()

const { r$ } = useFormSchema({ url: '' }, songUrlSchema)
const input = useTemplateRef<HTMLInputElement>('input')
const inputId = useId()
const errorId = useId()
const submitting = ref(false)

const message = computed(() => r$.$errors.url[0] ?? props.error ?? '')

async function submit() {
  if (submitting.value || props.busy) return
  submitting.value = true
  try {
    const { valid } = await r$.$validate()
    const parsed = parseLetrasUrl(r$.$value.url)
    if (!valid || !parsed.ok) {
      input.value?.focus()
      return
    }
    emit('submit', parsed.url)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-2" novalidate :aria-busy="busy ? 'true' : undefined" @submit.prevent="submit">
    <label :for="inputId" class="font-medium">Enlace de Letras.com</label>
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        :id="inputId"
        ref="input"
        v-model="r$.$value.url"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://www.letras.com/artista/cancion/"
        class="input input-lg w-full"
        :class="{ 'input-error': message }"
        :aria-invalid="message ? 'true' : undefined"
        :aria-describedby="message ? errorId : undefined"
        @blur="r$.url?.$touch()"
      >
      <button type="submit" class="btn btn-primary btn-lg btn-block sm:w-auto" :disabled="submitting || busy">
        <span v-if="busy" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else name="lucide:search" class="size-5" aria-hidden="true" />
        Ver letra
      </button>
    </div>
    <p v-if="busy" role="status" class="text-sm text-base-content/70">{{ messages.songs.fetch.searching }}</p>
    <p v-else-if="message" :id="errorId" role="alert" class="text-sm text-error">{{ message }}</p>
  </form>
</template>
