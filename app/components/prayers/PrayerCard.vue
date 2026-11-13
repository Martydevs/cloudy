<script setup lang="ts">
// Tarjeta seleccionable de una petición (feature 007, contracts/ui.md § Tarjeta seleccionable): una casilla real (el
// mismo `checkbox checkbox-primary` que las listas de Archivos; su aspecto es el predeterminado del tema, en
// globals.css) dentro de una etiqueta estirada sobre toda la tarjeta (Espacio, estado anunciado y foco gratis); los
// botones y enlaces quedan por encima y no cambian la selección. La foto no tiene miniatura: recibe su `src` solo al
// acercarse al viewport, dentro de una caja de proporción fija.
import type { PrayerRequest } from '#shared/types/api'

const props = withDefaults(defineProps<{
  request: PrayerRequest
  selected?: boolean
  disabled?: boolean
  /** Por qué no se puede elegir (va en `aria-describedby`). */
  disabledReason?: string | null
  /** Primera tarjeta: su foto es la candidata a LCP, así que sale desde el SSR con prioridad alta en vez de esperar. */
  priority?: boolean
  /** Contenedor desplazable de la fila: la foto se pide al acercarse a su borde y no solo al de la pantalla. */
  scrollRoot?: HTMLElement | null
}>(), { selected: false, disabled: false, disabledReason: null, priority: false, scrollRoot: null })
const emit = defineEmits<{ toggle: [] }>()

const m = messages.prayers
const { timeAgo } = useRelativeTime()
const reasonId = useId()

// Foto diferida: el `src` llega una vez, cuando la tarjeta se acerca a la pantalla o a su fila (200 px de margen).
const root = useTemplateRef<HTMLElement>('root')
const near = useElementVisibility(root, { scrollTarget: () => props.scrollRoot, rootMargin: '200px', once: true })
const photoFailed = ref(false)
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
        class="checkbox checkbox-primary absolute right-3 top-3 z-10"
        :checked="selected"
        :disabled="disabled"
        :aria-label="m.pick(request.senderName)"
        :aria-describedby="disabled && disabledReason ? reasonId : undefined"
        @change="emit('toggle')"
      >
    </label>

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

      <div v-if="selected" class="flex flex-wrap gap-1">
        <span class="badge badge-primary">{{ m.chosen }}</span>
      </div>

      <p v-if="disabled && disabledReason" :id="reasonId" class="text-sm text-base-content/70">{{ disabledReason }}</p>

      <div class="relative z-10 mt-1 flex flex-wrap gap-2">
        <a :href="request.previewUrl" target="_blank" rel="noopener" class="btn btn-ghost lg:btn-sm">
          <Icon name="lucide:external-link" class="size-4" aria-hidden="true" />
          {{ m.openPhoto }}
        </a>
      </div>
    </div>
  </article>
</template>
