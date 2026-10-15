<script setup lang="ts">
import { ACCEPT_ATTRIBUTE } from '#shared/constants/files'

const emit = defineEmits<{ files: [files: File[]] }>()

const zone = useTemplateRef<HTMLElement>('zone')
const input = useTemplateRef<HTMLInputElement>('input')
const hintId = useId()
const inputId = useId()
const labelId = useId()

const { isOverDropZone } = useDropZone(zone, {
  onDrop: (files) => {
    if (files?.length) emit('files', files)
  },
})

function choose() {
  input.value?.click()
}

// Un <input type="file"> real (oculto) en lugar de `useFileDialog`: se puede etiquetar y
// lo usan tanto los lectores de pantalla como los e2e (`setInputFiles`).
function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files?.length) emit('files', [...target.files])
  target.value = ''
}
</script>

<template>
  <div
    ref="zone"
    role="button"
    tabindex="0"
    class="flex cursor-pointer flex-col items-center gap-2 rounded-box border-2 border-dashed p-6 text-center transition-colors"
    :class="isOverDropZone ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary'"
    :aria-describedby="hintId"
    :aria-labelledby="labelId"
    @click="choose"
    @keydown.enter.prevent="choose"
    @keydown.space.prevent="choose"
  >
    <Icon name="lucide:cloud-upload" class="size-10 text-primary" aria-hidden="true" />
    <!-- El nombre accesible es el texto visible (WCAG 2.5.3, "label in name"). -->
    <p :id="labelId" class="font-medium">
      <span class="hidden sm:inline">Arrastra archivos aquí o </span><span class="link link-primary">elige archivos</span>
    </p>
    <p :id="hintId" class="text-sm text-base-content/70">
      Imágenes, audio, video, presentaciones y documentos. Máximo 100 MB por archivo.
    </p>
    <label :for="inputId" class="sr-only">Elegir archivos</label>
    <input
      :id="inputId"
      ref="input"
      type="file"
      multiple
      :accept="ACCEPT_ATTRIBUTE"
      class="sr-only"
      tabindex="-1"
      @click.stop
      @change="onChange"
    >
  </div>
</template>
