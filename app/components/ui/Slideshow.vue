<script setup lang="ts" generic="T extends { key: string }">
// Pase de diapositivas genérico (enmienda «Página de generación» de Peticiones; reutilizable en colecciones u otras
// páginas): un escenario grande de proporción fija (sin saltos de diseño), ‹ › con vuelta al principio, ← → del teclado
// con el foco dentro, deslizar en táctil, un pie anunciado con cortesía y una fila de miniaturas desplazable en horizontal
// que lleva la actual a la vista. Opcionalmente, una casilla por miniatura para elegir varias. No sabe qué es cada
// diapositiva: el contenido llega por ranuras y los textos por `labels` (los pone la página). La lógica vive en
// `useSlideshow`.
const props = withDefaults(defineProps<{
  slides: readonly T[]
  labels: { region: string, prev: string, next: string, thumbs: string }
  /** Nombre accesible de cada miniatura. */
  thumbLabel: (slide: T, index: number) => string
  /** Muestra las casillas de las miniaturas. */
  selectable?: boolean
  /** Qué diapositivas se pueden elegir (las demás no llevan casilla). */
  canSelect?: (slide: T) => boolean
  selectLabel?: (slide: T, index: number) => string
  /** Parámetro de la query con la posición (1-based); `false` para no tocar la URL. */
  query?: string | false
  /** URL que conviene precargar de una diapositiva vecina, o `null`. */
  preload?: (slide: T) => string | null
  /** Clase de proporción del escenario. */
  stageClass?: string
}>(), {
  selectable: false,
  canSelect: () => true,
  selectLabel: (_slide: T, index: number) => String(index + 1),
  query: false,
  preload: undefined,
  stageClass: 'aspect-[1376/768]',
})

/** Índice actual (0-based). */
const index = defineModel<number>('index', { default: 0 })
/** Claves elegidas en el modo selección. */
const selected = defineModel<string[]>('selected', { default: () => [] })

defineSlots<{
  header?(): unknown
  /** Solo se pinta la diapositiva actual. `first`: todavía nadie cambió de diapositiva (primera pintura). */
  slide(props: { slide: T, index: number, first: boolean }): unknown
  /** `near`: la miniatura está cerca del borde visible de la fila (pedir su imagen solo entonces). */
  thumb(props: { slide: T, index: number, near: boolean, active: boolean }): unknown
  caption?(props: { slide: T, index: number, total: number }): unknown
  actions?(props: { slide: T | undefined, index: number }): unknown
}>()

const root = useTemplateRef<HTMLElement>('root')
const stage = useTemplateRef<HTMLElement>('stage')
const row = useTemplateRef<HTMLElement>('row')

const { total, next, prev, go, moved } = useSlideshow({ count: () => props.slides.length, index, root, stage, query: props.query })
const current = computed(() => props.slides[index.value])
const reducedMotion = usePreferredReducedMotion()

function toggle(key: string) {
  selected.value = selected.value.includes(key) ? selected.value.filter(other => other !== key) : [...selected.value, key]
}

/** Centra la miniatura actual dentro de la fila sin mover la página. */
function revealActive(smooth: boolean) {
  const list = row.value
  const item = list?.querySelector<HTMLElement>('[aria-current="true"]')?.closest('li')
  if (!list || !item) return
  const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2
  list.scrollTo({ left: Math.max(0, left), behavior: smooth && reducedMotion.value !== 'reduce' ? 'smooth' : 'auto' })
}

watch(index, () => nextTick(() => revealActive(true)))
onMounted(() => revealActive(false))

// Precarga de la anterior y la siguiente cuando el navegador está libre: cambiar de diapositiva no espera a la red.
const preloaded = new Set<string>()
function preloadNeighbours() {
  if (!props.preload || total.value < 2) return
  for (const i of [index.value + 1, index.value - 1]) {
    const slide = props.slides[((i % total.value) + total.value) % total.value]
    const url = slide ? props.preload(slide) : null
    if (!url || preloaded.has(url)) continue
    preloaded.add(url)
    const img = new Image()
    img.decoding = 'async'
    img.src = url
  }
}
if (import.meta.client) {
  watch([index, () => props.slides], () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(preloadNeighbours, { timeout: 2000 })
    else setTimeout(preloadNeighbours, 300)
  }, { immediate: true })
}
</script>

<template>
  <section ref="root" class="flex min-w-0 flex-col gap-4" :aria-label="labels.region" aria-roledescription="carrusel">
    <slot name="header" />

    <div class="relative">
      <div ref="stage" class="relative w-full touch-pan-y overflow-hidden rounded-box bg-base-200" :class="stageClass">
        <slot v-if="current" name="slide" :slide="current" :index="index" :first="!moved" />
      </div>
      <template v-if="total > 1">
        <button
          type="button"
          class="btn btn-circle absolute left-2 top-1/2 z-10 -translate-y-1/2 border-base-300 bg-base-100/90 shadow"
          :aria-label="labels.prev"
          @click="prev"
        >
          <Icon name="lucide:chevron-left" class="size-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="btn btn-circle absolute right-2 top-1/2 z-10 -translate-y-1/2 border-base-300 bg-base-100/90 shadow"
          :aria-label="labels.next"
          @click="next"
        >
          <Icon name="lucide:chevron-right" class="size-6" aria-hidden="true" />
        </button>
      </template>
    </div>

    <p v-if="current && $slots.caption" class="min-h-6 text-sm text-base-content/80" aria-live="polite" aria-atomic="true">
      <slot name="caption" :slide="current" :index="index" :total="total" />
    </p>

    <ul v-if="total > 0" ref="row" class="relative -mx-1 flex snap-x gap-2 overflow-x-auto p-1 pb-3" :aria-label="labels.thumbs">
      <li v-for="(slide, i) in slides" :key="slide.key" class="relative w-28 shrink-0 snap-start sm:w-36">
        <button
          type="button"
          class="block aspect-[1376/768] w-full overflow-hidden rounded-box border-2 bg-base-200 focus-visible:outline-offset-2"
          :class="i === index ? 'border-primary ring-2 ring-primary' : 'border-base-300'"
          :aria-current="i === index ? 'true' : undefined"
          :aria-label="thumbLabel(slide, i)"
          @click="go(i)"
        >
          <SlideshowThumb v-slot="{ near }" :scroll-root="row">
            <slot name="thumb" :slide="slide" :index="i" :near="near" :active="i === index" />
          </SlideshowThumb>
        </button>
        <label v-if="selectable && canSelect(slide)" class="absolute left-0 top-0 z-10 flex size-11 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            class="checkbox checkbox-primary"
            :checked="selected.includes(slide.key)"
            :aria-label="selectLabel(slide, i)"
            @change="toggle(slide.key)"
          >
        </label>
      </li>
    </ul>

    <slot name="actions" :slide="current" :index="index" />
  </section>
</template>
