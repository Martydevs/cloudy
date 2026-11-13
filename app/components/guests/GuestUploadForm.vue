<script setup lang="ts">
// Formulario de envío de invitados en un solo paso (`/upload`): nombre, nota, selector, cola y confirmación.
// El envío llega directo a la cola de Solicitudes del equipo.
import { MAX_GUEST_FILES } from '#shared/constants/files'
import { NOTE_MAX, SENDER_NAME_MAX } from '#shared/validation/submissions'
import type { SubmissionResult } from '~/composables/useGuestSubmission'

const props = defineProps<{ createUrl: string, disabled?: boolean }>()
const emit = defineEmits<{ done: [result: SubmissionResult] }>()

const nameId = useId()
const noteId = useId()
const noteHintId = useId()

const { r$ } = useFormSchema({ name: '', note: '' }, guestSubmissionSchema)
const nameError = computed(() => r$.$errors.name[0] ?? '')

const submission = useGuestSubmission({ createUrl: props.createUrl })
const busy = computed(() => submission.status.value === 'submitting')
// El error del nombre desaparece en cuanto la persona corrige el campo.
watch(() => r$.$value.name, () => r$.name.$reset())

async function send() {
  const { valid, data } = await r$.$validate()
  if (!valid) {
    // La nota no tiene error en línea: su problema se muestra en el aviso del formulario.
    const noteProblem = r$.$errors.note[0]
    if (noteProblem) submission.error.value = noteProblem
    return
  }
  const result = await submission.submit({
    senderName: data.name.trim(),
    note: (data.note ?? '').trim(),
  })
  if (result) emit('done', result)
}

function another() {
  submission.reset()
  r$.$reset({ toState: { name: r$.$value.name, note: '' } })
}
</script>

<template>
  <section v-if="submission.status.value === 'done'" class="card border border-base-300 bg-base-100">
    <div class="card-body items-center gap-3 text-center">
      <Icon name="lucide:circle-check" class="size-12 text-success" aria-hidden="true" />
      <h2 class="text-xl font-semibold">¡Gracias! Recibimos tu envío</h2>
      <p class="text-base-content/70">El equipo lo revisará pronto. Te avisamos por fuera de Cloudy si hace falta algo más.</p>
      <!-- Sin `alert-soft`: en el tema claro pondría texto amarillo sobre base-100 (1.85:1). -->
      <p v-if="submission.result.value?.rejected" role="status" class="alert alert-warning">
        <Icon name="lucide:circle-alert" class="size-5" aria-hidden="true" />
        <span>{{ submission.result.value.rejected === 1 ? 'Un archivo no pasó la verificación y no se incluyó.' : `${submission.result.value.rejected} archivos no pasaron la verificación y no se incluyeron.` }}</span>
      </p>
      <button type="button" class="btn btn-primary" @click="another">Enviar más archivos</button>
    </div>
  </section>

  <form v-else class="flex flex-col gap-5" novalidate @submit.prevent="send">
    <fieldset class="fieldset" :disabled="busy || disabled">
      <label :for="nameId" class="label">Tu nombre</label>
      <input
        :id="nameId"
        v-model="r$.$value.name"
        type="text"
        class="input w-full"
        :class="{ 'input-error': nameError }"
        autocomplete="name"
        :maxlength="SENDER_NAME_MAX"
        required
        :aria-invalid="!!nameError || undefined"
        :aria-describedby="nameError ? `${nameId}-error` : undefined"
      >
      <p v-if="nameError" :id="`${nameId}-error`" class="text-sm text-error" role="alert">{{ nameError }}</p>

      <label :for="noteId" class="label mt-2">Nota para el equipo (opcional)</label>
      <textarea
        :id="noteId"
        v-model="r$.$value.note"
        class="textarea w-full"
        rows="3"
        :maxlength="NOTE_MAX"
        :aria-describedby="noteHintId"
        placeholder="Por ejemplo: fotos del culto del domingo"
      />
      <p :id="noteHintId" class="text-right text-xs text-base-content/70">{{ r$.$value.note.length }} / {{ NOTE_MAX }}</p>
    </fieldset>

    <div class="flex flex-col gap-3">
      <!-- "Abrir cámara" en teléfonos y tabletas (feature 003, US2); cada foto cuenta en el límite del envío. -->
      <DropZone
        v-if="submission.items.value.length < MAX_GUEST_FILES && !busy && !disabled"
        camera
        :camera-disabled="submission.items.value.length >= MAX_GUEST_FILES"
        :max-photos="MAX_GUEST_FILES - submission.items.value.length"
        @files="submission.add"
      />
      <p class="text-sm text-base-content/70">Hasta {{ MAX_GUEST_FILES }} archivos por envío.</p>
      <UploadQueue v-if="submission.items.value.length" :items="submission.items.value" @cancel="submission.remove" />
    </div>

    <p v-if="submission.error.value" role="alert" class="alert alert-error alert-soft">
      <Icon name="lucide:circle-alert" class="size-5" aria-hidden="true" />
      <span>{{ submission.error.value }}</span>
    </p>

    <button type="submit" class="btn btn-primary w-full sm:w-auto sm:self-end" :disabled="busy || disabled">
      <span v-if="busy" class="loading loading-spinner loading-sm" aria-hidden="true" />
      <Icon v-else name="lucide:send" class="size-4" aria-hidden="true" />
      {{ busy ? 'Enviando…' : 'Enviar' }}
    </button>
  </form>
</template>
