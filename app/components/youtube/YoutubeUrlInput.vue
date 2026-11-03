<script setup lang="ts">
// Campo grande para pegar el enlace de un video (FR-004, FR-005, contracts/ui.md). Valida con `youtubeUrlSchema`
// (la regla `parseYoutubeUrl` de `shared/`) y emite solo el ID: `t`, `list`, `si`… se descartan.
import { parseYoutubeUrl } from '#shared/validation/youtube'
import { youtubeUrlSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })
const emit = defineEmits<{ submit: [videoId: string] }>()

const { r$ } = useFormSchema({ url: '' }, youtubeUrlSchema)
const input = useTemplateRef<HTMLInputElement>('input')
const inputId = useId()
const errorId = useId()
const submitting = ref(false)

const error = computed(() => r$.$errors.url[0] ?? '')

async function submit() {
  if (submitting.value || props.busy) return
  submitting.value = true
  try {
    const { valid } = await r$.$validate()
    const parsed = parseYoutubeUrl(r$.$value.url)
    if (!valid || !parsed.ok) {
      input.value?.focus()
      return
    }
    emit('submit', parsed.videoId)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-2" novalidate @submit.prevent="submit">
    <label :for="inputId" class="font-medium">Enlace de YouTube</label>
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        :id="inputId"
        ref="input"
        v-model="r$.$value.url"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="Pega aquí el enlace de un video"
        class="input input-lg w-full"
        :class="{ 'input-error': error }"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        @blur="r$.url?.$touch()"
      >
      <button type="submit" class="btn btn-primary btn-lg btn-block sm:w-auto" :disabled="submitting || busy">
        <span v-if="submitting || busy" class="loading loading-spinner" aria-hidden="true" />
        <Icon v-else name="lucide:search" class="size-5" aria-hidden="true" />
        Ver video
      </button>
    </div>
    <p v-if="error" :id="errorId" class="text-sm text-error">{{ error }}</p>
  </form>
</template>
