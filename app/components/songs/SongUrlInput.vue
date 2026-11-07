<script setup lang="ts">
// Campo grande para pegar el enlace de una canción de Letras.com (feature 006, FR-004–FR-006, contracts/ui.md). Valida con
// `songUrlSchema` (la regla `parseLetrasUrl` de `shared/`) y emite el enlace ya normalizado. Durante el rastreo muestra la
// espera; un error del servidor (`error`) aparece junto al campo y el texto pegado se conserva. El interruptor «Agregar a la
// cola» (`v-model:batchMode`) cambia la acción del envío de «Ver letra» a «Agregar» (a la cola del .zip); quien lo usa decide qué
// hacer con el enlace.
import { parseLetrasUrl } from '#shared/validation/songs'
import { songUrlSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ busy?: boolean, error?: string | null }>(), { busy: false, error: null })
const emit = defineEmits<{ submit: [url: string] }>()
const batchMode = defineModel<boolean>('batchMode', { default: false })
const m = messages.songs.present

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
      <button
        type="button"
        class="btn btn-lg btn-block sm:w-auto"
        :class="{ 'btn-active': batchMode }"
        :aria-pressed="batchMode ? 'true' : 'false'"
        @click="batchMode = !batchMode"
      >
        <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
        {{ m.batchMode }}
      </button>
      <button type="submit" class="btn btn-primary btn-lg btn-block sm:w-auto" :disabled="submitting || busy">
        <span v-if="busy" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else :name="batchMode ? 'lucide:plus' : 'lucide:search'" class="size-5" aria-hidden="true" />
        {{ batchMode ? m.queueAdd : messages.songs.fetch.action }}
      </button>
    </div>
    <p v-if="batchMode" class="text-sm text-base-content/70">{{ m.batchModeHint }}</p>
    <!-- La región de estado existe siempre (vacía se oculta): una región que aparece ya con su texto no se anuncia de forma fiable. -->
    <div role="status" class="empty:hidden">
      <p v-if="busy" class="text-sm text-base-content/70">{{ messages.songs.fetch.searching }}</p>
    </div>
    <p v-if="!busy && message" :id="errorId" role="alert" class="text-sm text-error">{{ message }}</p>
  </form>
</template>
