<script setup lang="ts">
// Formulario de envío de invitados (extraído de /enviar, feature 003): nombre, nota, selector, cola y
// confirmación. Con `senderName` el nombre viene de la solicitud aprobada y es de solo lectura.
import { MAX_GUEST_FILES } from '#shared/constants/files'
import { check } from '#shared/validation/core'
import { note as noteField, senderName as senderNameField } from '#shared/validation/submissions'
import type { SubmissionResult } from '~/composables/useGuestSubmission'

const props = defineProps<{ createUrl: string, senderName?: string | null, disabled?: boolean }>()
const emit = defineEmits<{
  done: [result: SubmissionResult]
  /** Desde que se crea el envío hasta que termina o falla. */
  submitting: [active: boolean]
  /** 403/409 del envío con permiso: el acceso ya no vale; el mensaje es el del servidor. */
  denied: [message: string]
}>()

const NOTE_MAX = 500
const name = ref('')
const note = ref('')
const nameError = ref('')
const nameId = useId()
const noteId = useId()
const noteHintId = useId()
const fixedName = computed(() => !!props.senderName)

const submission = useGuestSubmission({ createUrl: props.createUrl })
const busy = computed(() => submission.status.value === 'submitting')
watch(busy, active => emit('submitting', active))
// El error del nombre desaparece en cuanto la persona corrige el campo.
watch(name, () => {
  nameError.value = ''
})

async function send() {
  nameError.value = fixedName.value ? '' : check(senderNameField(), name.value) ?? ''
  const noteProblem = check(noteField(), note.value)
  if (nameError.value || noteProblem) {
    if (noteProblem) submission.error.value = noteProblem
    return
  }
  const result = await submission.submit({ senderName: fixedName.value ? undefined : name.value.trim(), note: note.value.trim() })
  if (result) emit('done', result)
  else if (submission.errorStatus.value === 403 || submission.errorStatus.value === 409) emit('denied', submission.error.value)
}

function another() {
  submission.reset()
  note.value = ''
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
      <slot name="done-actions">
        <button type="button" class="btn btn-primary" @click="another">Enviar más archivos</button>
      </slot>
    </div>
  </section>

  <form v-else class="flex flex-col gap-5" novalidate @submit.prevent="send">
    <fieldset class="fieldset" :disabled="busy || disabled">
      <template v-if="fixedName">
        <span class="label">Tu nombre</span>
        <p class="flex min-h-11 items-center gap-2 font-medium">
          <Icon name="lucide:user-round" class="size-4 text-base-content/70" aria-hidden="true" />
          {{ senderName }}
        </p>
      </template>
      <template v-else>
        <label :for="nameId" class="label">Tu nombre</label>
        <input
          :id="nameId"
          v-model="name"
          type="text"
          class="input w-full"
          :class="{ 'input-error': nameError }"
          autocomplete="name"
          maxlength="80"
          required
          :aria-invalid="!!nameError || undefined"
          :aria-describedby="nameError ? `${nameId}-error` : undefined"
        >
        <p v-if="nameError" :id="`${nameId}-error`" class="text-sm text-error" role="alert">{{ nameError }}</p>
      </template>

      <label :for="noteId" class="label mt-2">Nota para el equipo (opcional)</label>
      <textarea
        :id="noteId"
        v-model="note"
        class="textarea w-full"
        rows="3"
        :maxlength="NOTE_MAX"
        :aria-describedby="noteHintId"
        placeholder="Por ejemplo: fotos del culto del domingo"
      />
      <p :id="noteHintId" class="text-right text-xs text-base-content/70">{{ note.length }} / {{ NOTE_MAX }}</p>
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
      <p class="flex items-start gap-2 text-sm text-base-content/70">
        <Icon name="lucide:scan-text" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ messages.imageText.guestNotice }}
      </p>
      <p class="flex items-start gap-2 text-sm text-base-content/70">
        <Icon name="lucide:shield-check" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ messages.imageText.guestPrivacy }}
      </p>
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
