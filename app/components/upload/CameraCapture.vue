<script setup lang="ts">
// Cámara dentro de Cloudy (feature 003, FR-016a–FR-016d): vista en vivo, revisar ("Repetir" / "Usar foto") y
// varias fotos por envío. A pantalla completa en el teléfono, con los botones al alcance del pulgar. Se carga
// diferida (`LazyCameraCapture`) y solo pide el permiso al abrirse.
const props = defineProps<{ open: boolean, maxPhotos: number }>()
const emit = defineEmits<{ photo: [file: File], close: [] }>()

const camera = useCameraCapture()
const toast = useToast()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const video = useTemplateRef<HTMLVideoElement>('video')
const shutter = useTemplateRef<HTMLButtonElement>('shutter')
const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')
const titleId = useId()

const review = shallowRef<File | null>(null)
const reviewUrl = useObjectUrl(review)
const added = ref(0)
/** Espacio del envío al abrir: `maxPhotos` baja con cada foto agregada y no debe contarse dos veces. */
const limit = ref(props.maxPhotos)
const announcement = ref('')
const captureFailed = ref(false)
let opener: HTMLElement | null = null

const errorKey = computed(() => (captureFailed.value ? 'failed' : camera.errorKey.value))
const live = computed(() => !!camera.stream.value && !review.value && !errorKey.value)

watchEffect(() => {
  if (video.value) video.value.srcObject = camera.stream.value ?? null
}, { flush: 'post' })

async function show() {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  review.value = null
  added.value = 0
  limit.value = props.maxPhotos
  announcement.value = ''
  captureFailed.value = false
  if (!dialog.value?.open) dialog.value?.showModal()
  closeButton.value?.focus()
  await camera.start()
  await nextTick()
  if (live.value) shutter.value?.focus()
}

/** Apaga la cámara, cierra y devuelve el foco a quien la abrió. */
function close() {
  camera.stop()
  review.value = null
  if (dialog.value?.open) dialog.value.close()
  emit('close')
  opener?.focus()
  opener = null
}

onMounted(() => {
  if (props.open) show()
})
watch(() => props.open, (open) => {
  if (open) show()
  else if (dialog.value?.open) close()
})

// Cambiar de pestaña cierra la cámara: deja de usarse al instante (spec, edge cases).
const visibility = useDocumentVisibility()
watch(visibility, (state) => {
  if (state !== 'visible' && props.open) close()
})

async function takePhoto() {
  if (!video.value) return
  try {
    review.value = await camera.capture(video.value)
    announcement.value = messages.camera.ready
  }
  catch {
    captureFailed.value = true
  }
}

function retake() {
  review.value = null
  nextTick(() => shutter.value?.focus())
}

function usePhoto() {
  const file = review.value
  if (!file) return
  emit('photo', file)
  added.value++
  review.value = null
  announcement.value = messages.camera.addedOne
  if (added.value >= limit.value) {
    toast.info(messages.camera.limit)
    close()
  }
  else {
    nextTick(() => shutter.value?.focus())
  }
}
</script>

<template>
  <dialog ref="dialog" class="modal lg:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex h-dvh max-h-dvh w-full max-w-none flex-col gap-3 rounded-none p-3 lg:h-auto lg:max-h-[90dvh] lg:max-w-2xl lg:rounded-box lg:p-6">
      <header class="flex items-center justify-between gap-2">
        <h2 :id="titleId" class="text-lg font-semibold">Cámara</h2>
        <span v-if="added" class="badge badge-outline">{{ messages.camera.added(added) }}</span>
      </header>
      <p aria-live="polite" class="sr-only">{{ announcement }}</p>

      <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-box bg-neutral text-neutral-content lg:aspect-video lg:flex-none">
        <video v-show="live" ref="video" autoplay muted playsinline class="size-full object-contain" />
        <img v-if="review && reviewUrl" :src="reviewUrl" alt="Foto tomada, lista para revisar" class="size-full object-contain">
        <div v-if="camera.starting.value" class="flex flex-col items-center gap-3 p-4" aria-busy="true">
          <div class="skeleton size-24 rounded-full" />
          <p>{{ messages.camera.opening }}</p>
        </div>
        <div v-else-if="errorKey" class="flex flex-col items-center gap-3 p-4">
          <p role="alert" class="alert alert-error">{{ messages.camera[errorKey] }}</p>
          <button type="button" class="btn" @click="close">Cerrar</button>
        </div>
      </div>

      <footer v-if="!errorKey" class="flex items-center justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
        <template v-if="review">
          <button type="button" class="btn flex-1" @click="retake">
            <Icon name="lucide:rotate-ccw" class="size-4" aria-hidden="true" />
            {{ messages.camera.retake }}
          </button>
          <button type="button" class="btn btn-primary flex-1" @click="usePhoto">
            <Icon name="lucide:check" class="size-4" aria-hidden="true" />
            {{ messages.camera.use }}
          </button>
        </template>
        <template v-else>
          <button ref="closeButton" type="button" class="btn btn-ghost min-h-11" :aria-label="messages.camera.close" @click="close">
            <Icon name="lucide:x" class="size-5" aria-hidden="true" />
            {{ messages.camera.close }}
          </button>
          <button
            v-if="live"
            ref="shutter"
            type="button"
            class="btn btn-circle btn-primary size-16"
            :aria-label="messages.camera.take"
            @click="takePhoto"
          >
            <Icon name="lucide:circle" class="size-10" aria-hidden="true" />
          </button>
        </template>
      </footer>
    </div>
  </dialog>
</template>
