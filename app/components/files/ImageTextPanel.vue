<script setup lang="ts">
// Texto leído de una imagen (feature 002, contracts/ui): un estado por vista, copiar, reintentar, volver a
// leer y, si es editable, corregir el texto a mano.
import type { ImageText } from '#shared/types/api'

const props = withDefaults(defineProps<{
  endpoint: string
  initial?: ImageText | null
  editable?: boolean
  autoRead?: boolean
  /** Versión de la tarjeta de Solicitudes: el texto se trunca a 6 líneas con "Ver todo". */
  compact?: boolean
  /** HEIC apta por tamaño: si no está disponible es porque se subió sin copia para lectura. */
  heic?: boolean
  /** Encabezado; en Solicitudes nombra el archivo para distinguir varios paneles. */
  title?: string
}>(), { initial: null, editable: false, autoRead: false, compact: false, heic: false, title: 'Texto de la imagen' })

const { state, loading, error, load, read, copy, save } = useImageText(() => props.endpoint, {
  initial: props.initial,
  autoRead: props.autoRead,
})
const { confirm } = useConfirm()

const titleId = useId()
const expanded = ref(false)
const editing = ref(false)
const saving = ref(false)
const editButton = useTemplateRef<HTMLButtonElement>('editButton')

const status = computed(() => state.value?.status ?? null)
/** Carga inicial, lectura de respaldo en la petición o lectura en curso en segundo plano. */
const reading = computed(() => !error.value && (
  loading.value || !state.value || status.value === 'reading' || (status.value === 'pending' && props.autoRead)
))

const failedMessage = computed(() => {
  switch (state.value?.error) {
    case 'quota_exceeded':
      return messages.imageText.failedQuota
    case 'invalid_input':
      return messages.imageText.failedPermanent
    default:
      return messages.imageText.failedRetryable
  }
})

const editedLabel = computed(() => {
  if (!state.value?.editedAt) return ''
  return state.value.editedBy ? messages.imageText.editedBy(state.value.editedBy) : messages.imageText.edited
})

/** Muestra "Ver todo" solo si el texto puede pasar de 6 líneas. */
const truncatable = computed(() => {
  const text = state.value?.text ?? ''
  return props.compact && (text.split('\n').length > 6 || text.length > 280)
})

const menu = [{ key: 'reread', label: 'Volver a leer', icon: 'lucide:refresh-cw' }]

/** Volver a leer reemplaza una corrección manual: antes se confirma (Constitución VI). */
async function reread() {
  if (state.value?.editedAt) {
    const ok = await confirm({
      title: messages.imageText.confirmReread,
      message: 'Volver a leer la imagen reemplaza el texto corregido a mano.',
      confirmLabel: 'Volver a leer',
    })
    if (!ok) return
  }
  await read(true)
}

function onSelect(key: string) {
  if (key === 'reread') reread()
}

async function stopEditing() {
  editing.value = false
  await nextTick()
  editButton.value?.focus()
}

async function onSave(text: string) {
  saving.value = true
  const saved = await save(text)
  saving.value = false
  if (saved) await stopEditing()
}
</script>

<template>
  <section class="card border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="card-body gap-3" :class="{ 'p-4': compact }">
      <div class="flex items-center gap-2">
        <h2 :id="titleId" class="flex min-w-0 flex-1 items-center gap-2 font-semibold" :class="compact ? 'text-base' : 'text-lg'">
          <Icon name="lucide:scan-text" class="size-5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 break-words">{{ title }}</span>
        </h2>
        <ActionMenu
          v-if="editable && status === 'ready' && !loading && !editing"
          label="Más acciones del texto"
          :items="menu"
          @select="onSelect"
        />
      </div>

      <div aria-live="polite" class="flex flex-col gap-3">
        <ErrorState v-if="error" :message="error" @retry="load()" />

        <div v-else-if="reading" class="flex flex-col gap-3 motion-reduce:[&_.skeleton]:animate-none">
          <p class="text-sm text-base-content/70">{{ messages.imageText.reading }}</p>
          <SkeletonList :rows="compact ? 2 : 3" variant="list" />
        </div>

        <ImageTextEditor
          v-else-if="editing"
          :model-value="state?.text ?? ''"
          :saving="saving"
          @save="onSave"
          @cancel="stopEditing"
        />

        <template v-else-if="status === 'ready'">
          <span v-if="editedLabel" class="badge badge-ghost self-start">{{ editedLabel }}</span>
          <p
            class="whitespace-pre-line break-words"
            :class="{ 'line-clamp-6': truncatable && !expanded }"
          >{{ state?.text }}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn lg:btn-sm" @click="copy()">
              <Icon name="lucide:copy" class="size-4" aria-hidden="true" />
              Copiar texto
            </button>
            <button v-if="editable" ref="editButton" type="button" class="btn lg:btn-sm" @click="editing = true">
              <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
              Editar
            </button>
            <button
              v-if="truncatable"
              type="button"
              class="btn btn-ghost lg:btn-sm"
              :aria-expanded="expanded"
              @click="expanded = !expanded"
            >
              {{ expanded ? 'Ver menos' : 'Ver todo' }}
            </button>
          </div>
        </template>

        <EmptyState v-else-if="status === 'empty'" icon="lucide:scan-text" :title="messages.imageText.empty">
          <button type="button" class="btn lg:btn-sm" @click="reread()">
            <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
            Volver a leer
          </button>
          <button v-if="editable" ref="editButton" type="button" class="btn lg:btn-sm" @click="editing = true">
            <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
            Escribir el texto
          </button>
        </EmptyState>

        <ErrorState
          v-else-if="status === 'failed'"
          :message="failedMessage"
          :retryable="state?.error !== 'invalid_input'"
          @retry="read(true)"
        />

        <p v-else-if="status === 'pending'" class="text-sm text-base-content/70">{{ messages.imageText.notRead }}</p>

        <p v-else-if="status === 'unavailable'" class="text-sm text-base-content/70">
          {{ heic ? messages.imageText.unavailableHeic : messages.imageText.unavailable }}
        </p>
      </div>
    </div>
  </section>
</template>
