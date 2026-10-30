<script setup lang="ts">
import { ACCEPT_ATTRIBUTE, MAX_GUEST_FILES } from '#shared/constants/files'

const props = withDefaults(defineProps<{
  /** "Abrir cámara" en teléfonos y tabletas (solo páginas de invitados, feature 003). */
  camera?: boolean
  cameraDisabled?: boolean
  /** Fotos que caben todavía en el envío. */
  maxPhotos?: number
}>(), { camera: false, cameraDisabled: false, maxPhotos: MAX_GUEST_FILES })
const emit = defineEmits<{ files: [files: File[]] }>()

const zone = useTemplateRef<HTMLElement>('zone')
const input = useTemplateRef<HTMLInputElement>('input')
const hintId = useId()
const inputId = useId()

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

// Solo se consulta la disponibilidad si la página ofrece la cámara.
const cameraAvailable = props.camera ? useCameraAvailability().available : computed(() => false)
const cameraOpen = ref(false)
</script>

<template>
  <!-- Toda la zona acepta clic y arrastre; el control accesible es el botón, cuyo nombre es solo su texto visible (WCAG 2.5.3). -->
  <div
    ref="zone"
    class="flex cursor-pointer flex-col items-center gap-2 rounded-box border-2 border-dashed p-6 text-center transition-colors"
    :class="isOverDropZone ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary'"
    @click="choose"
  >
    <Icon name="lucide:cloud-upload" class="size-10 text-primary" aria-hidden="true" />
    <button type="button" class="btn btn-ghost h-auto min-h-11 whitespace-normal font-medium" :aria-describedby="hintId" @click.stop="choose">
      <span class="hidden sm:inline">Arrastra archivos aquí o </span><span class="link link-primary">elige archivos</span>
    </button>
    <!-- Espacio reservado: el botón aparece tras hidratar (la disponibilidad solo se sabe en el cliente) sin mover el diseño. -->
    <div v-if="camera" data-camera-slot class="flex min-h-11 items-center justify-center">
      <button
        v-if="cameraAvailable"
        type="button"
        class="btn btn-outline"
        :disabled="cameraDisabled"
        :aria-describedby="hintId"
        @click.stop="cameraOpen = true"
      >
        <Icon name="lucide:camera" class="size-4" aria-hidden="true" />
        {{ messages.camera.open }}
      </button>
    </div>
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
    <!-- Fuera del flujo de clics de la zona: el diálogo es modal. -->
    <LazyCameraCapture
      v-if="cameraOpen"
      :open="cameraOpen"
      :max-photos="maxPhotos"
      @click.stop
      @photo="file => emit('files', [file])"
      @close="cameraOpen = false"
    />
  </div>
</template>
