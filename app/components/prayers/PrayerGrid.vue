<script setup lang="ts">
// Fila de peticiones aprobadas (feature 007, contracts/ui.md): una sola fila de tarjetas desplazable en horizontal dentro de su
// contenedor (forma de `PrayerCollectionRow`), así no crece hacia abajo ni empuja las colecciones y el historial. Al final de la
// fila, el centinela del desplazamiento infinito con sus estados: esqueleto mientras carga, error con «Reintentar» (sin perder
// lo cargado), «Cargar más» para teclado y el aviso de fin. Desde `sm`, dos botones recorren la fila (con ratón no hay gesto).
import type { PrayerRequest } from '#shared/types/api'

const props = defineProps<{
  items: PrayerRequest[]
  loadingMore: boolean
  moreError: boolean
  done: boolean
  isSelected: (id: string) => boolean
  limitReached: boolean
}>()
const emit = defineEmits<{ 'toggle': [request: PrayerRequest], 'load-more': [], 'retry-more': [] }>()

const m = messages.prayers

/** Con el tope alcanzado, solo las ya elegidas siguen activas. */
function reason(request: PrayerRequest): string | null {
  if (props.isSelected(request.id)) return null
  return props.limitReached ? m.limitReached : null
}

const scroller = useTemplateRef<HTMLElement>('scroller')

// Página siguiente cuando el centinela se acerca al borde derecho de la fila (no de la pantalla: la fila se recorre en horizontal).
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel, { scrollTarget: scroller, rootMargin: '0px 600px 0px 0px' })
watch(sentinelVisible, (visible) => {
  if (visible && !props.done && !props.moreError) emit('load-more')
})

// Botones anterior/siguiente: deshabilitados en cada extremo y ocultos si todo cabe.
const { arrivedState, measure } = useScroll(scroller)
watch(() => props.items.length, () => nextTick(measure))
onMounted(measure)
const overflows = computed(() => !(arrivedState.left && arrivedState.right))

function step(direction: 1 | -1) {
  const el = scroller.value
  if (!el) return
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: smooth ? 'smooth' : 'auto' })
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <div v-if="overflows" class="hidden justify-end sm:flex" role="group" :aria-label="m.rowNav">
      <div class="join">
        <button type="button" class="btn join-item btn-square lg:btn-sm" :disabled="arrivedState.left" :aria-label="m.rowPrev" @click="step(-1)">
          <Icon name="lucide:chevron-left" class="size-5" aria-hidden="true" />
        </button>
        <button type="button" class="btn join-item btn-square lg:btn-sm" :disabled="arrivedState.right" :aria-label="m.rowNext" @click="step(1)">
          <Icon name="lucide:chevron-right" class="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- `p-1`: el anillo de la tarjeta elegida (`ring-2`) no se recorta en el contenedor desplazable. -->
    <div ref="scroller" class="-mx-1 flex snap-x scroll-px-1 gap-4 overflow-x-auto overscroll-x-contain p-1 pb-3">
      <ul class="flex gap-4" aria-label="Peticiones aprobadas">
        <li v-for="(request, index) in items" :key="request.id" class="flex w-72 shrink-0 snap-start sm:w-80">
          <PrayerCard
            class="w-full"
            :request="request"
            :priority="index === 0"
            :selected="isSelected(request.id)"
            :disabled="!!reason(request)"
            :disabled-reason="reason(request)"
            :scroll-root="scroller"
            @toggle="emit('toggle', request)"
          />
        </li>
      </ul>

      <div ref="sentinel" class="flex shrink-0 snap-start items-center justify-center" :class="loadingMore || moreError ? 'w-72 sm:w-80' : 'min-w-44 px-2'">
        <div v-if="loadingMore" class="w-full" role="status" :aria-label="m.loadMore">
          <PrayerCardSkeleton />
        </div>
        <ErrorState v-else-if="moreError" class="w-full" :message="m.loadMoreError" @retry="emit('retry-more')" />
        <p v-else-if="done" class="text-center text-sm text-base-content/70">{{ m.end }}</p>
        <button v-else type="button" class="btn" @click="emit('load-more')">Cargar más</button>
      </div>
    </div>
  </div>
</template>
