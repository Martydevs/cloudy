<script setup lang="ts">
// Revisión del texto de las peticiones elegidas antes de generar. Lista las peticiones como tarjetas (miniatura, nombre y
// casilla «Verificada») junto al texto editable de la petición activa. Al abrir lee, una foto a la vez, las
// que todavía no tienen texto guardado (`usePrayerReview`). «Generar imágenes» solo se habilita con todas verificadas y sin
// cambios por guardar; el texto nunca sale de aquí hacia la generación: el servidor carga el verificado.
// El texto ocupa casi todo el espacio: la foto es opcional, oculta al abrir y se muestra con «Ver imagen» (en cualquier
// estado de la tarjeta). La elección vale para todo el diálogo, no por tarjeta. Oculta queda `inert`: ni Tab ni el lector
// de pantalla llegan a «Abrir foto». Se despliega con una transición solo de CSS (filas 0fr → 1fr; desde `lg`, ancho 0 → 2/5).
// Móvil primero: a pantalla completa bajo `md`, con las tarjetas en una fila desplazable y la foto encima del texto; desde
// `md`, dos columnas con alto fijo (el texto llena el alto); desde `lg`, la foto a la izquierda del texto.
// Se carga diferido (`LazyPrayerReviewDialog`).
import type { PrayerRequest } from '#shared/types/api'
import { PRAYER_PER_IMAGE, PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import { isLongText } from '#shared/prayers'
import { prayerTranscriptSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{
  /** Las peticiones elegidas, en el orden de las imágenes. */
  requests: PrayerRequest[]
  /** La página está creando la generación. */
  busy?: boolean
}>(), { busy: false })
const emit = defineEmits<{ close: [], generate: [], remove: [id: string] }>()

const m = messages.prayers.review
const p = messages.prayers
const review = usePrayerReview()
const { cards, phase, halted, announcement } = review
const { confirm } = useConfirm()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
const titleId = useId()
const textId = useId()
const textHintId = useId()
const textErrorId = useId()
const reasonId = useId()
const photoId = useId()

/** La foto de la petición activa, oculta al abrir; vale para todas las tarjetas. */
const showPhoto = ref(false)

// ---- petición activa y su texto en edición
const activeId = ref(props.requests[0]?.id ?? null)
const active = computed(() => cards.value.find(card => card.fileId === activeId.value) ?? cards.value[0] ?? null)
const { r$ } = useFormSchema({ text: '' }, prayerTranscriptSchema)
/** El texto se puede editar: ya hay uno leído o guardado, o la persona decidió escribirlo. */
const editable = computed(() => !!active.value && ['draft', 'verified', 'empty'].includes(active.value.status))
const dirty = computed(() => editable.value && r$.$value.text !== active.value!.text)
const saveError = ref('')
const textError = computed(() => r$.$errors.text[0] ?? saveError.value)
const length = computed(() => r$.$value.text.trim().length)

/** Carga en el editor el texto guardado de la petición activa y olvida los errores. */
function resetEditor() {
  saveError.value = ''
  r$.$reset({ toState: { text: active.value?.text ?? '' } })
}
// Cambió la petición activa, o llegó su texto (lectura terminada, guardado, «Volver a leer»): el editor lo toma. Mientras
// la persona edita, el texto guardado de esa petición no cambia por su cuenta, así que no pisa lo que escribe.
watch([() => active.value?.fileId, () => active.value?.status, () => active.value?.text], resetEditor, { immediate: true })

// En el teléfono las tarjetas van en una fila desplazable: la activa se lleva a la vista.
const cardList = useTemplateRef<HTMLElement>('cardList')
watch(() => active.value?.fileId, async () => {
  await nextTick()
  cardList.value?.querySelector('[aria-current="true"]')?.closest('li')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
})

/** Verificada de verdad: el servidor lo dice y no hay cambios sin guardar en su texto. */
const isVerified = (id: string) => cards.value.find(card => card.fileId === id)?.status === 'verified' && !(id === active.value?.fileId && dirty.value)
const stateLabel = (id: string) => {
  const card = cards.value.find(item => item.fileId === id)
  if (!card) return ''
  return id === active.value?.fileId && dirty.value ? m.states.unsaved : m.states[card.status]
}

/** La casilla sirve con un texto que verificar: el guardado o, en la petición activa, el que se está escribiendo. */
function canToggle(card: { fileId: string, status: string, text: string, saving?: boolean }) {
  if (card.saving || !['draft', 'verified', 'empty'].includes(card.status)) return false
  return card.text.trim() !== '' || (card.fileId === active.value?.fileId && dirty.value)
}

async function discardChanges(): Promise<boolean> {
  if (!dirty.value) return true
  return confirm({ title: m.discardTitle, message: m.discardBody, confirmLabel: m.discardConfirm, danger: true })
}

async function choose(id: string) {
  if (id === active.value?.fileId || !await discardChanges()) return
  activeId.value = id
}

async function save() {
  const card = active.value
  if (!card || card.saving) return
  saveError.value = ''
  const { valid, data } = await r$.$validate()
  if (!valid) return
  const result = await review.save(card.fileId, data.text.trim())
  if (!result.ok) saveError.value = result.message
}

/** La casilla de una tarjeta. En la activa con cambios, marcarla guarda lo escrito: verificar es aprobar lo que se ve. */
async function toggleVerified(id: string, event: Event) {
  const box = event.target as HTMLInputElement
  const wanted = box.checked
  // La casilla refleja el servidor: se revierte hasta que responda.
  box.checked = isVerified(id)
  if (wanted && id === active.value?.fileId && dirty.value) return save()
  await review.setVerified(id, wanted)
}

async function writeByHand(id: string) {
  review.writeByHand(id)
  await nextTick()
  textarea.value?.focus()
}

async function reread(id: string) {
  if (!await confirm({ title: m.rereadTitle, message: m.rereadBody, confirmLabel: m.reread })) return
  review.reread(id)
}

// ---- generar
const images = computed(() => Math.ceil(cards.value.length / PRAYER_PER_IMAGE))
const canGenerate = computed(() => review.allVerified.value && !dirty.value)
const reason = computed(() => {
  if (phase.value === 'loading' || phase.value === 'idle') return m.blockedLoading
  if (phase.value === 'error') return m.blockedError
  if (dirty.value) return m.blockedUnsaved
  if (review.pendingCount.value > 0) return m.blockedPending(review.pendingCount.value)
  return m.ready(images.value)
})

// ---- abrir y cerrar
// La selección puede perder peticiones con el diálogo abierto (ya no disponibles o quitadas aquí).
watch(() => props.requests, list => review.sync(list))

onMounted(() => {
  dialog.value?.showModal()
  void review.open(props.requests)
})
// Salir de la página o cerrar el diálogo deja de leer; lo ya leído o guardado sigue en el servidor.
onBeforeUnmount(() => review.close())

async function close() {
  if (!await discardChanges()) return
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex h-dvh max-h-dvh w-full max-w-full flex-col gap-4 rounded-none md:h-[min(90dvh,48rem)] md:max-h-[90dvh] md:max-w-5xl md:rounded-box">
      <header class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h2 :id="titleId" class="text-lg font-semibold">{{ m.title }}</h2>
          <p class="hidden text-sm text-base-content/70 sm:block">{{ m.intro }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="p.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>
      <!-- Cambios de estado (lectura lista o fallida, guardado, verificación) para lectores de pantalla. -->
      <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

      <div v-if="phase === 'loading' || phase === 'idle'" class="flex min-h-0 flex-1 flex-col gap-3">
        <span class="sr-only" role="status">{{ m.loading }}</span>
        <SkeletonList :rows="Math.min(requests.length, 4)" />
      </div>
      <div v-else-if="phase === 'error'" class="min-h-0 flex-1">
        <ErrorState :message="m.load" @retry="review.reload()" />
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col gap-4 md:flex-row-reverse">
        <!-- Tarjetas: una fila desplazable en el teléfono, una columna desde `md`. -->
        <ul ref="cardList" class="-m-1 flex shrink-0 gap-2 overflow-x-auto p-1 md:w-64 md:flex-col md:overflow-x-visible md:overflow-y-auto" :aria-label="m.list">
          <li
            v-for="card in cards"
            :key="card.fileId"
            class="relative flex w-60 shrink-0 items-center gap-1 rounded-box border bg-base-100 md:w-auto"
            :class="card.fileId === active?.fileId ? 'border-primary ring-2 ring-primary' : 'border-base-300'"
          >
            <button
              type="button"
              class="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-box p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :aria-label="m.card(card.request.senderName, stateLabel(card.fileId))"
              :aria-current="card.fileId === active?.fileId ? 'true' : undefined"
              @click="choose(card.fileId)"
            >
              <img :src="card.request.previewUrl" alt="" loading="lazy" decoding="async" class="size-12 shrink-0 rounded-field bg-base-200 object-cover">
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-medium">{{ card.request.senderName }}</span>
                <span class="flex items-center gap-1 text-sm text-base-content/70">
                  <span v-if="card.status === 'reading'" class="loading loading-spinner loading-xs motion-reduce:animate-none" aria-hidden="true" />
                  <Icon v-else-if="card.status === 'failed'" name="lucide:circle-alert" class="size-4 shrink-0 text-error" aria-hidden="true" />
                  <span class="truncate first-letter:uppercase">{{ stateLabel(card.fileId) }}</span>
                </span>
              </span>
            </button>
            <label class="flex size-11 shrink-0 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                class="checkbox checkbox-primary"
                :checked="isVerified(card.fileId)"
                :disabled="!canToggle(card)"
                :aria-label="m.verifiedBox(card.request.senderName)"
                @change="toggleVerified(card.fileId, $event)"
              >
            </label>
          </li>
        </ul>

        <!-- Petición activa: su texto, y la foto para comparar cuando se pide con «Ver imagen». -->
        <section v-if="active" class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto" :aria-label="p.card(active.request.senderName)">
          <div v-if="halted === 'quota_exceeded' || halted === 'not_configured'" role="alert" class="alert alert-error alert-soft">
            <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
            <span>{{ m.halted[halted] }}</span>
          </div>

          <div class="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
            <!-- La foto: se despliega hacia abajo en el teléfono (filas 0fr → 1fr) y hacia la derecha desde `lg` (ancho 0 → 2/5).
                 Oculta queda `inert`: ni Tab ni el lector de pantalla llegan a «Abrir foto». -->
            <div
              :id="photoId"
              class="grid shrink-0 grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,width] duration-200 ease-out motion-reduce:transition-none lg:grid-rows-[minmax(0,1fr)]"
              :class="showPhoto ? 'grid-rows-[1fr] lg:w-2/5' : 'grid-rows-[0fr] lg:w-0'"
              :inert="showPhoto ? undefined : true"
              :aria-hidden="showPhoto ? undefined : 'true'"
            >
              <div class="min-h-0 min-w-0 overflow-hidden">
                <figure class="flex flex-col gap-2 pb-3 lg:h-full lg:pr-4 lg:pb-0">
                  <div class="flex h-40 max-h-[40dvh] items-center justify-center overflow-hidden rounded-box bg-base-200 sm:h-56 lg:h-auto lg:max-h-none lg:min-h-0 lg:flex-1">
                    <img :key="active.fileId" :src="active.request.previewUrl" :alt="m.photoAlt(active.request.senderName)" decoding="async" class="max-h-full max-w-full object-contain">
                  </div>
                  <figcaption class="flex flex-wrap items-center justify-between gap-2">
                    <span class="min-w-0 break-words font-medium">{{ active.request.senderName }}</span>
                    <a :href="active.request.previewUrl" target="_blank" rel="noopener" class="btn btn-ghost lg:btn-sm">
                      <Icon name="lucide:external-link" class="size-4" aria-hidden="true" />
                      {{ m.openPhoto }}
                    </a>
                  </figcaption>
                </figure>
              </div>
            </div>

            <div class="flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0">
              <!-- En fila o leyéndose: se puede esperar o escribirla a mano. -->
              <div v-if="active.status === 'waiting' || active.status === 'reading'" class="flex flex-col items-start gap-3 rounded-box border border-base-300 p-4">
                <p class="flex items-center gap-2 text-base-content/80">
                  <span v-if="active.status === 'reading'" class="loading loading-spinner loading-sm motion-reduce:animate-none" aria-hidden="true" />
                  <Icon v-else name="lucide:hourglass" class="size-5" aria-hidden="true" />
                  {{ active.status === 'reading' ? m.readingHint : m.waitingHint }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <button v-if="!active.force" type="button" class="btn" @click="writeByHand(active.fileId)">
                    <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
                    {{ m.writeByHand }}
                  </button>
                  <button type="button" class="btn btn-ghost" :aria-expanded="showPhoto ? 'true' : 'false'" :aria-controls="photoId" @click="showPhoto = !showPhoto">
                    <Icon :name="showPhoto ? 'lucide:image-off' : 'lucide:image'" class="size-4" aria-hidden="true" />
                    {{ showPhoto ? m.hidePhoto : m.showPhoto }}
                  </button>
                </div>
              </div>

              <!-- La lectura falló: reintentar si sirve, escribir a mano o quitarla. -->
              <div v-else-if="active.status === 'failed'" class="flex flex-col gap-3">
                <div role="alert" class="alert alert-error alert-soft">
                  <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
                  <span>{{ active.error }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="active.retryable" type="button" class="btn btn-primary" @click="review.retry(active.fileId)">
                    <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
                    {{ m.retry }}
                  </button>
                  <button type="button" class="btn" @click="writeByHand(active.fileId)">
                    <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
                    {{ m.writeByHand }}
                  </button>
                  <button v-if="active.errorCode === 'unreadable_image'" type="button" class="btn btn-ghost" @click="emit('remove', active.fileId)">
                    <Icon name="lucide:x" class="size-4" aria-hidden="true" />
                    {{ m.removeFromSelection }}
                  </button>
                  <button type="button" class="btn btn-ghost" :aria-expanded="showPhoto ? 'true' : 'false'" :aria-controls="photoId" @click="showPhoto = !showPhoto">
                    <Icon :name="showPhoto ? 'lucide:image-off' : 'lucide:image'" class="size-4" aria-hidden="true" />
                    {{ showPhoto ? m.hidePhoto : m.showPhoto }}
                  </button>
                </div>
              </div>

              <form v-else class="flex flex-1 flex-col gap-3 lg:min-h-0" novalidate @submit.prevent="save">
                <!-- Un solo recuadro: etiqueta, texto y su pie (aviso y contador). El foco se ve en el borde del recuadro. -->
                <div
                  class="flex flex-1 flex-col rounded-box border bg-base-100 transition-colors focus-within:ring-2 motion-reduce:transition-none lg:min-h-0"
                  :class="textError ? 'border-error focus-within:ring-error' : 'border-base-300 focus-within:border-primary focus-within:ring-primary'"
                >
                  <label :for="textId" class="px-4 pt-3 text-sm font-medium text-base-content/80">{{ m.textLabel }}</label>
                  <p v-if="active.status === 'empty' && !dirty" class="mx-4 mt-2 flex items-start gap-2 text-sm text-base-content/80">
                    <Icon name="lucide:info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {{ m.emptyRead }}
                  </p>
                  <textarea
                    :id="textId"
                    ref="textarea"
                    v-model="r$.$value.text"
                    class="textarea textarea-ghost min-h-40 w-full flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-2 text-base leading-relaxed focus:bg-transparent focus:outline-hidden lg:min-h-32"
                    :aria-invalid="textError ? 'true' : undefined"
                    :aria-describedby="textError ? `${textErrorId} ${textHintId}` : textHintId"
                    @blur="r$.text?.$touch()"
                    @input="saveError = ''"
                  />
                  <div class="flex flex-col gap-1 border-t border-base-300 px-4 py-2 text-sm">
                    <p v-if="textError" :id="textErrorId" class="text-error">{{ textError }}</p>
                    <p :id="textHintId" class="flex flex-wrap justify-between gap-x-4 text-base-content/70">
                      <span>{{ isLongText(r$.$value.text) ? m.longText : m.textHint }}</span>
                      <span>{{ m.counter(length, PRAYER_TEXT_MAX_LENGTH) }}</span>
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="submit" class="btn btn-primary" :disabled="active.saving" :aria-busy="active.saving">
                    <span v-if="active.saving" class="loading loading-spinner loading-sm motion-reduce:animate-none" aria-hidden="true" />
                    <Icon v-else name="lucide:check" class="size-5" aria-hidden="true" />
                    {{ active.saving ? m.saving : m.save }}
                  </button>
                  <button type="button" class="btn btn-ghost" :disabled="active.saving" @click="reread(active.fileId)">
                    <Icon name="lucide:scan-text" class="size-4" aria-hidden="true" />
                    {{ m.reread }}
                  </button>
                  <button type="button" class="btn btn-ghost" :aria-expanded="showPhoto ? 'true' : 'false'" :aria-controls="photoId" @click="showPhoto = !showPhoto">
                    <Icon :name="showPhoto ? 'lucide:image-off' : 'lucide:image'" class="size-4" aria-hidden="true" />
                    {{ showPhoto ? m.hidePhoto : m.showPhoto }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>

      <footer class="flex flex-col gap-2 border-t border-base-300 pt-3 sm:flex-row sm:items-center sm:gap-3">
        <p :id="reasonId" class="flex-1 text-sm" role="status">
          <span v-if="phase === 'ready'" class="font-medium">{{ m.progress(cards.filter(card => isVerified(card.fileId)).length, cards.length) }}.</span>
          {{ reason }}
        </p>
        <div class="flex gap-2">
          <button type="button" class="btn" @click="close">{{ p.close }}</button>
          <button
            type="button"
            class="btn btn-primary flex-1 sm:flex-none"
            :disabled="!canGenerate || busy"
            :aria-busy="busy"
            :aria-describedby="reasonId"
            @click="emit('generate')"
          >
            <span v-if="busy" class="loading loading-spinner loading-sm motion-reduce:animate-none" aria-hidden="true" />
            <Icon v-else name="lucide:sparkles" class="size-5" aria-hidden="true" />
            {{ p.generate }}
          </button>
        </div>
      </footer>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ p.close }}</button>
    </div>
  </dialog>
</template>
