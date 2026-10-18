<script setup lang="ts">
import { COMMENT_MAX_LENGTH, commentInput } from '#shared/validation/comments'

const props = defineProps<{ fileId: string }>()

const root = useTemplateRef<HTMLElement>('root')
const thread = useCommentThread(() => props.fileId, root)
const { comments, error: loadError, status } = thread
const toast = useToast()

const body = ref('')
const touched = ref(false)
const sending = ref(false)
const fieldError = ref('')
const formError = ref('')
const titleId = useId()
const inputId = useId()
const hintId = useId()
const errorId = useId()

const result = computed(() => commentInput({ body: body.value }))
const error = computed(() => fieldError.value || (touched.value && !result.value.ok ? result.value.errors.body : ''))
const length = computed(() => body.value.trim().length)

watch(body, () => {
  fieldError.value = ''
})

async function submit() {
  touched.value = true
  formError.value = ''
  if (!result.value.ok) return
  sending.value = true
  try {
    await thread.post(result.value.data.body)
    body.value = ''
    touched.value = false
    toast.success('Comentario publicado')
  }
  catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 422) fieldError.value = serverMessage(err, 'Revisa el comentario')
    else if (statusCode === 409) formError.value = 'Este archivo está en la papelera. Restáuralo desde la Papelera para poder comentar.'
    else formError.value = serverMessage(err, 'No pudimos publicar el comentario. Inténtalo de nuevo.')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <section ref="root" class="card border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="card-body gap-4">
      <h2 :id="titleId" class="flex items-center gap-2 text-lg font-semibold">
        <Icon name="lucide:message-circle" class="size-5" aria-hidden="true" />
        Comentarios
        <span v-if="comments.length" class="badge badge-ghost">{{ comments.length }}</span>
      </h2>

      <ErrorState v-if="loadError" message="No pudimos cargar los comentarios." @retry="thread.refresh()" />
      <SkeletonList v-else-if="status !== 'success'" :rows="2" />
      <EmptyState
        v-else-if="comments.length === 0"
        icon="lucide:message-circle"
        title="Sé el primero en comentar"
        description="Deja una nota para el equipo sobre este archivo."
      />
      <ul v-else class="flex flex-col gap-3" aria-label="Comentarios" aria-live="polite">
        <CommentItem
          v-for="comment in comments"
          :key="comment.id"
          :comment="comment"
          @updated="thread.replace"
          @deleted="thread.remove"
        />
      </ul>

      <form class="flex flex-col gap-2" novalidate @submit.prevent="submit">
        <div v-if="formError" role="alert" class="alert alert-error alert-soft">
          <Icon name="lucide:circle-alert" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ formError }}</span>
        </div>
        <label :for="inputId" class="text-sm font-medium">Escribe un comentario</label>
        <textarea
          :id="inputId"
          v-model="body"
          rows="3"
          class="textarea w-full"
          :class="{ 'textarea-error': error }"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? `${hintId} ${errorId}` : hintId"
          @blur="touched = body.length > 0"
          @keydown.ctrl.enter.prevent="submit"
          @keydown.meta.enter.prevent="submit"
        />
        <div class="flex items-start justify-between gap-2 text-sm">
          <p v-if="error" :id="errorId" class="text-error">{{ error }}</p>
          <span
            :id="hintId"
            class="ml-auto shrink-0"
            :class="length > COMMENT_MAX_LENGTH ? 'text-error' : 'text-base-content/70'"
          >{{ length }}/{{ COMMENT_MAX_LENGTH }}</span>
        </div>
        <button type="submit" class="btn btn-primary self-end lg:btn-sm" :disabled="sending">
          <span v-if="sending" class="loading loading-spinner" aria-hidden="true" />
          <Icon v-else name="lucide:send" class="size-4" aria-hidden="true" />
          Comentar
        </button>
      </form>
    </div>
  </section>
</template>
