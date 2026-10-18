<script setup lang="ts">
import type { Comment } from '#shared/types/api'
import { COMMENT_MAX_LENGTH, commentInput } from '#shared/validation/comments'

const props = defineProps<{ comment: Comment }>()
const emit = defineEmits<{ updated: [comment: Comment], deleted: [id: string] }>()

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()

const editing = ref(false)
const draft = ref('')
const touched = ref(false)
const saving = ref(false)
const serverError = ref('')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const inputId = useId()
const hintId = useId()
const errorId = useId()

const result = computed(() => commentInput({ body: draft.value }))
const error = computed(() => serverError.value || (touched.value && !result.value.ok ? result.value.errors.body : ''))
const url = computed(() => `/api/comments/${props.comment.id}`)
// Mismo texto que el resto de la app (`timeAgo`), con una hora de referencia que se refresca cada
// 30 s: el hilo puede quedar abierto mucho tiempo.
const now = useNow({ scheduler: cb => useIntervalFn(cb, 30_000) })
const ago = computed(() => timeAgo(props.comment.createdAt, now.value))

function startEdit() {
  draft.value = props.comment.body
  touched.value = false
  serverError.value = ''
  editing.value = true
  nextTick(() => textarea.value?.focus())
}

function stopEdit() {
  editing.value = false
  nextTick(() => editButton.value?.focus())
}

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode
}

/** 404: el comentario ya no existe (p. ej. lo borró un admin); se quita del hilo. */
function gone() {
  toast.info(messages.comments.gone)
  emit('deleted', props.comment.id)
}

async function save() {
  touched.value = true
  serverError.value = ''
  if (!result.value.ok) return
  if (result.value.data.body === props.comment.body) return stopEdit()
  saving.value = true
  try {
    const updated = await api<Comment>(url.value, { method: 'PATCH', body: { body: result.value.data.body } })
    emit('updated', updated)
    toast.success(messages.comments.updated)
    stopEdit()
  }
  catch (error) {
    const status = statusOf(error)
    if (status === 404) gone()
    else if (status === 422) serverError.value = serverMessage(error, messages.comments.review)
    else toast.error(serverMessage(error, messages.comments.saveFailed))
  }
  finally {
    saving.value = false
  }
}

async function destroy() {
  const ok = await confirm({
    title: '¿Eliminar este comentario?',
    message: 'No se puede deshacer.',
    confirmLabel: 'Eliminar',
    danger: true,
  })
  if (!ok) return
  try {
    await api(url.value, { method: 'DELETE' })
    emit('deleted', props.comment.id)
    toast.success(messages.comments.deleted)
  }
  catch (error) {
    if (statusOf(error) === 404) gone()
    else toast.error(serverMessage(error, messages.comments.deleteFailed))
  }
}
</script>

<template>
  <li class="flex flex-col gap-2 rounded-box bg-base-200 p-3">
    <p class="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span class="font-medium">{{ comment.author.name }}</span>
      <time :datetime="comment.createdAt" :title="formatDateTime(comment.createdAt)" class="text-base-content/70">
        {{ ago }}
      </time>
      <span v-if="comment.editedAt" class="text-base-content/70">(editado)</span>
    </p>

    <form v-if="editing" class="flex flex-col gap-2" novalidate @submit.prevent="save">
      <label :for="inputId" class="sr-only">Editar comentario</label>
      <textarea
        :id="inputId"
        ref="textarea"
        v-model="draft"
        rows="3"
        class="textarea w-full"
        :class="{ 'textarea-error': error }"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${hintId} ${errorId}` : hintId"
        @blur="touched = true"
        @keydown.esc.prevent="stopEdit"
        @keydown.ctrl.enter.prevent="save"
        @keydown.meta.enter.prevent="save"
      />
      <div class="flex items-start justify-between gap-2 text-sm">
        <p v-if="error" :id="errorId" class="text-error">{{ error }}</p>
        <span
          :id="hintId"
          class="ml-auto shrink-0"
          :class="draft.trim().length > COMMENT_MAX_LENGTH ? 'text-error' : 'text-base-content/70'"
        >{{ draft.trim().length }}/{{ COMMENT_MAX_LENGTH }}</span>
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost lg:btn-sm" @click="stopEdit">Cancelar</button>
        <button type="submit" class="btn btn-primary lg:btn-sm" :disabled="saving">
          <span v-if="saving" class="loading loading-spinner" aria-hidden="true" />
          Guardar
        </button>
      </div>
    </form>
    <p v-else class="whitespace-pre-wrap break-words">{{ comment.body }}</p>

    <div v-if="!editing && (comment.canEdit || comment.canDelete)" class="flex justify-end gap-1">
      <button
        v-if="comment.canEdit"
        ref="editButton"
        type="button"
        class="btn btn-ghost lg:btn-sm"
        :aria-label="`Editar comentario de ${comment.author.name}`"
        @click="startEdit"
      >
        <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
        Editar
      </button>
      <button
        v-if="comment.canDelete"
        type="button"
        class="btn btn-ghost text-error lg:btn-sm"
        :aria-label="`Eliminar comentario de ${comment.author.name}`"
        @click="destroy"
      >
        <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
        Eliminar
      </button>
    </div>
  </li>
</template>
