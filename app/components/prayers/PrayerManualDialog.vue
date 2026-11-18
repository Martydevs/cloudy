<script setup lang="ts">
// Alta manual de una petición desde /peticiones («Agregar petición»). Los mismos campos que `/upload` (reutiliza
// `GuestUploadForm`), con el nombre de quien tiene la sesión en solo lectura y solo imágenes. Al terminar la subida la
// petición ya está aprobada: no pasa por Solicitudes. Se carga diferido (`LazyPrayerManualDialog`).
import type { SubmissionResult } from '~/composables/useGuestSubmission'

const emit = defineEmits<{ close: [], done: [result: SubmissionResult] }>()

const m = messages.prayers.manual
const p = messages.prayers
const { profile } = useMe()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const introId = useId()
/** Con la subida en curso el diálogo no se cierra: la petición se crearía sin que la página se entere. */
const busy = ref(false)

const completeUrl = (id: string) => `/api/peticiones/manual/${id}/complete`

onMounted(() => {
  dialog.value?.showModal()
})

function close() {
  if (busy.value) return
  dialog.value?.close()
  emit('close')
}

function done(result: SubmissionResult) {
  busy.value = false
  dialog.value?.close()
  emit('done', result)
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" :aria-describedby="introId" @cancel.prevent="close">
    <!-- La caja no se desplaza: lo hace el cuerpo, bajo la cabecera. Así el foco inicial cae en «Cerrar» y no en la caja
         (un contenedor desplazable es enfocable y, siendo el primero, se llevaría el foco del diálogo). -->
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4 sm:max-w-xl">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="flex-1 text-lg font-semibold">{{ m.title }}</h2>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="p.close" :disabled="busy" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>
      <!-- `px-1`: el anillo de foco de los campos no se recorta en el contenedor desplazable. -->
      <div class="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1">
        <p :id="introId" class="text-base-content/70">{{ m.intro }}</p>
        <GuestUploadForm
          create-url="/api/peticiones/manual"
          :complete-url="completeUrl"
          :fixed-name="profile?.name ?? ''"
          :submit-label="m.submit"
          images-only
          hide-done
          @busy="value => (busy = value)"
          @done="done"
        />
      </div>
      <p v-if="busy" class="sr-only" role="status">{{ m.busy }}</p>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ p.close }}</button>
    </div>
  </dialog>
</template>
