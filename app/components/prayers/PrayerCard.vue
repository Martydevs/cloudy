<script setup lang="ts">
// Tarjeta seleccionable de una petición (feature 007, contracts/ui.md § Tarjeta seleccionable): una casilla real con
// aspecto circular dentro de una etiqueta estirada sobre toda la tarjeta (Espacio, estado anunciado y foco gratis); los
// botones y enlaces quedan por encima y no cambian la selección. La foto no tiene miniatura: recibe su `src` solo al
// acercarse al viewport, dentro de una caja de proporción fija.
import type { PrayerRequest } from '#shared/types/api'
import { hasIllegibleMark, isLongText, splitIllegible } from '#shared/prayers'

const props = withDefaults(defineProps<{
  request: PrayerRequest
  selected?: boolean
  disabled?: boolean
  /** Por qué no se puede elegir (va en `aria-describedby`). */
  disabledReason?: string | null
  /** Primera tarjeta: su foto es la candidata a LCP, así que sale desde el SSR con prioridad alta en vez de esperar. */
  priority?: boolean
}>(), { selected: false, disabled: false, disabledReason: null, priority: false })
const emit = defineEmits<{ toggle: [], fix: [] }>()

const m = messages.prayers
const { timeAgo } = useRelativeTime()
const reasonId = useId()

// Foto diferida: el `src` llega una vez, cuando la tarjeta se acerca a la pantalla (200 px de margen).
const root = useTemplateRef<HTMLElement>('root')
const near = useElementVisibility(root, { rootMargin: '200px', once: true })
const photoFailed = ref(false)

const text = computed(() => props.request.text)
const chunks = computed(() => (text.value.status === 'ready' && text.value.text ? splitIllegible(text.value.text) : []))
const toFix = computed(() => hasIllegibleMark(text.value.text))
const long = computed(() => isLongText(text.value.text))
const hasText = computed(() => text.value.status === 'ready' && !!text.value.text?.trim())
/** «Corregir texto» con texto o tras un fallo; «Escribir transcripción» sin texto; nada mientras se lee o sin lectura posible (409). */
const fixLabel = computed(() => {
  if (hasText.value || text.value.status === 'failed') return m.fix
  if (text.value.status === 'ready' || text.value.status === 'empty' || text.value.status === 'pending') return m.write
  return null
})

const failedMessage = computed(() => {
  switch (text.value.error) {
    case 'quota_exceeded': return messages.imageText.failedQuota
    case 'invalid_input': return messages.imageText.failedPermanent
    default: return messages.imageText.failedRetryable
  }
})
</script>

<template>
  <article
    ref="root"
    class="card relative overflow-hidden border bg-base-100"
    :class="selected ? 'border-primary ring-2 ring-primary' : 'border-base-300'"
    :aria-label="m.card(request.senderName)"
  >
    <!-- Toda la tarjeta es el objetivo de la casilla (por encima de la foto y los textos); lo interactivo va encima (z-10). -->
    <label class="absolute inset-0 z-[5] rounded-box" :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'">
      <input
        type="checkbox"
        class="radio radio-primary absolute right-3 top-3 z-10 size-7 border-2 bg-base-100 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
        :checked="selected"
        :disabled="disabled"
        :aria-label="m.pick(request.senderName)"
        :aria-describedby="disabled && disabledReason ? reasonId : undefined"
        @change="emit('toggle')"
      >
    </label>
    <Icon
      v-if="selected"
      name="lucide:check"
      class="pointer-events-none absolute right-4 top-4 z-10 size-5 text-primary-content"
      aria-hidden="true"
    />

    <!-- Sin `relative`: la etiqueta estirada (posicionada) debe quedar encima de la foto para recibir el clic. -->
    <div class="aspect-[4/3] w-full bg-base-200">
      <img
        v-if="(priority || near) && !photoFailed"
        :src="request.previewUrl"
        :alt="`Foto enviada por ${request.senderName}`"
        decoding="async"
        :fetchpriority="priority ? 'high' : 'low'"
        class="size-full object-cover"
        @error="photoFailed = true"
      >
      <div v-else-if="photoFailed" class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-base-content/70">
        <Icon name="lucide:image-off" class="size-8" aria-hidden="true" />
        <span class="text-sm">{{ m.noPreview }}</span>
        <span class="max-w-full break-words text-xs">{{ request.name }}</span>
      </div>
      <div v-else class="skeleton size-full rounded-none motion-reduce:animate-none" />
    </div>

    <div class="flex min-w-0 flex-col gap-2 p-4">
      <div class="flex min-w-0 flex-col">
        <h3 class="break-words font-semibold">{{ request.senderName }}</h3>
        <p class="text-sm text-base-content/70">{{ m.approved(timeAgo(request.approvedAt)) }}</p>
        <p class="text-sm text-base-content/70">{{ m.sent }} <LocalTime :iso="request.sentAt" /></p>
      </div>
      <p v-if="request.note" class="break-words text-sm italic text-base-content/80">{{ request.note }}</p>

      <div v-if="selected || text.editedAt || toFix || long" class="flex flex-wrap gap-1">
        <span v-if="selected" class="badge badge-primary">{{ m.chosen }}</span>
        <span v-if="text.editedAt" class="badge badge-ghost">{{ m.edited }}</span>
        <!-- `text-base-content`: el texto de `badge-soft` en `warning` no llega a AA en `cloudy-light` (1,77:1). -->
        <span v-if="toFix" class="badge badge-warning badge-soft text-base-content">
          <Icon name="lucide:triangle-alert" class="size-4" aria-hidden="true" />
          {{ m.toFix }}
        </span>
        <span v-if="long" class="badge badge-info badge-soft">{{ m.long }}</span>
      </div>

      <!-- Transcripción como texto (nunca v-html); las marcas de ilegible resaltadas sin depender del color. -->
      <p v-if="hasText" class="whitespace-pre-line break-words text-sm">
        <template v-for="(chunk, i) in chunks" :key="i">
          <span v-if="chunk.mark" class="badge badge-warning badge-soft h-auto whitespace-normal align-baseline text-base-content">
            <Icon name="lucide:triangle-alert" class="size-3.5 shrink-0" aria-hidden="true" />{{ chunk.text }}
          </span>
          <template v-else>{{ chunk.text }}</template>
        </template>
      </p>
      <div v-else-if="text.status === 'reading'" class="flex flex-col gap-2" role="status">
        <span class="text-sm text-base-content/70">{{ messages.imageText.reading }}</span>
        <div class="skeleton h-4 w-full motion-reduce:animate-none" />
        <div class="skeleton h-4 w-2/3 motion-reduce:animate-none" />
      </div>
      <p v-else-if="text.status === 'pending'" class="text-sm text-base-content/70">{{ messages.imageText.notRead }}</p>
      <p v-else-if="text.status === 'failed'" class="text-sm text-base-content/70">{{ failedMessage }}</p>
      <p v-else-if="text.status === 'unavailable'" class="text-sm text-base-content/70">{{ messages.imageText.unavailable }}</p>
      <p v-else class="text-sm text-base-content/70">{{ messages.imageText.empty }}</p>

      <p v-if="disabled && disabledReason" :id="reasonId" class="text-sm text-base-content/70">{{ disabledReason }}</p>

      <div class="relative z-10 mt-1 flex flex-wrap gap-2">
        <button v-if="fixLabel" type="button" class="btn lg:btn-sm" @click="emit('fix')">
          <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
          {{ fixLabel }}
        </button>
        <a :href="request.previewUrl" target="_blank" rel="noopener" class="btn btn-ghost lg:btn-sm">
          <Icon name="lucide:external-link" class="size-4" aria-hidden="true" />
          {{ m.openPhoto }}
        </a>
      </div>
    </div>
  </article>
</template>
