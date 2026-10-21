<script setup lang="ts">
// Modo edición del texto de una imagen (feature 002, contracts/ui): solo el formulario, sin peticiones.
import { MAX_IMAGE_TEXT_LENGTH } from '#shared/constants/image-text'

const props = defineProps<{ modelValue: string, saving?: boolean }>()
const emit = defineEmits<{ save: [text: string], cancel: [] }>()

const draft = ref(props.modelValue)
const inputId = useId()
const counterId = useId()
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

const length = computed(() => draft.value.trim().length)
const tooLong = computed(() => length.value > MAX_IMAGE_TEXT_LENGTH)
const canSave = computed(() => length.value > 0 && !tooLong.value && !props.saving)

/** «10 000»: miles separados por un espacio, como en el resto de contadores en español. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

onMounted(() => textarea.value?.focus())

function submit() {
  if (canSave.value) emit('save', draft.value.trim())
}
</script>

<template>
  <form class="flex flex-col gap-2" novalidate @submit.prevent="submit" @keydown.esc.prevent="emit('cancel')">
    <label :for="inputId" class="text-sm font-medium">Texto de la imagen</label>
    <textarea
      :id="inputId"
      ref="textarea"
      v-model="draft"
      class="textarea w-full"
      :class="{ 'textarea-error': tooLong }"
      rows="6"
      :aria-describedby="counterId"
      :aria-invalid="tooLong || length === 0"
    />
    <p :id="counterId" class="text-right text-sm" :class="tooLong ? 'text-error' : 'text-base-content/70'">
      {{ grouped(length) }} / {{ grouped(MAX_IMAGE_TEXT_LENGTH) }}
    </p>
    <div class="flex flex-wrap justify-end gap-2">
      <button type="button" class="btn lg:btn-sm" @click="emit('cancel')">Cancelar</button>
      <button type="submit" class="btn btn-primary lg:btn-sm" :disabled="!canSave">
        <span v-if="saving" class="loading loading-spinner loading-sm" aria-hidden="true" />
        <Icon v-else name="lucide:check" class="size-4" aria-hidden="true" />
        Guardar
      </button>
    </div>
  </form>
</template>
