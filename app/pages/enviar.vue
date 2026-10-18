<script setup lang="ts">
import { MAX_GUEST_FILES } from '#shared/constants/files'
import { check } from '#shared/validation/core'
import { note as noteField, senderName as senderNameField } from '#shared/validation/submissions'

definePageMeta({ layout: 'public', access: 'public' })
useHead({ title: 'Enviar archivos · Cloudy' })

const NOTE_MAX = 500
const senderName = ref('')
const note = ref('')
const nameError = ref('')
const nameId = useId()
const noteId = useId()
const noteHintId = useId()

const submission = useGuestSubmission()
const busy = computed(() => submission.status.value === 'submitting')
// El error del nombre desaparece en cuanto la persona corrige el campo.
watch(senderName, () => {
  nameError.value = ''
})

async function send() {
  nameError.value = check(senderNameField(), senderName.value) ?? ''
  const noteProblem = check(noteField(), note.value)
  if (nameError.value || noteProblem) {
    if (noteProblem) submission.error.value = noteProblem
    return
  }
  await submission.submit({ senderName: senderName.value.trim(), note: note.value.trim() })
}

function another() {
  submission.reset()
  note.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Envía tus archivos</h1>
      <p class="text-base-content/70">Fotos, audios, videos o presentaciones para el equipo de producción. No necesitas cuenta.</p>
    </header>

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
      <fieldset class="fieldset" :disabled="busy">
        <label :for="nameId" class="label">Tu nombre</label>
        <input
          :id="nameId"
          v-model="senderName"
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
        <DropZone v-if="submission.items.value.length < MAX_GUEST_FILES && !busy" @files="submission.add" />
        <p class="text-sm text-base-content/70">Hasta {{ MAX_GUEST_FILES }} archivos por envío.</p>
        <UploadQueue v-if="submission.items.value.length" :items="submission.items.value" @cancel="submission.remove" />
      </div>

      <p v-if="submission.error.value" role="alert" class="alert alert-error alert-soft">
        <Icon name="lucide:circle-alert" class="size-5" aria-hidden="true" />
        <span>{{ submission.error.value }}</span>
      </p>

      <button type="submit" class="btn btn-primary w-full sm:w-auto sm:self-end" :disabled="busy">
        <span v-if="busy" class="loading loading-spinner loading-sm" aria-hidden="true" />
        <Icon v-else name="lucide:send" class="size-4" aria-hidden="true" />
        {{ busy ? 'Enviando…' : 'Enviar' }}
      </button>
    </form>
  </div>
</template>
