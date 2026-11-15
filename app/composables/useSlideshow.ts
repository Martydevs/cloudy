// Lógica de un pase de diapositivas genérico (`ui/Slideshow.vue`): índice actual con vuelta al principio/final, flechas
// ← → del teclado solo cuando el foco está dentro del componente, deslizar en pantallas táctiles y, opcionalmente, el
// índice en la query (`?i=3`, 1-based) para que recargar o compartir el enlace abra la misma diapositiva. No sabe qué hay
// en cada diapositiva.
import type { MaybeRefOrGetter, Ref } from 'vue'

export interface SlideshowOptions {
  /** Cuántas diapositivas hay (puede ser 0 mientras cargan). */
  count: MaybeRefOrGetter<number>
  /** Índice actual (0-based), normalmente un `defineModel`. */
  index: Ref<number>
  /** Raíz del componente: el teclado solo cuenta con el foco dentro. */
  root: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** Zona que se puede deslizar con el dedo (el escenario). */
  stage?: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** Nombre del parámetro de la query que guarda la posición (1-based); `false` para no tocar la URL. */
  query?: string | false
}

/** Los controles de formulario usan las flechas: ahí no se cambia de diapositiva. */
function ownsArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)
}

export function useSlideshow({ count, index, root, stage, query = false }: SlideshowOptions) {
  const total = computed(() => Math.max(0, toValue(count)))
  const route = useRoute()
  const router = useRouter()
  /** La persona ya cambió de diapositiva: la primera pintura terminó (prioridad alta solo al principio). */
  const moved = ref(false)

  // Posición inicial desde la query (también en el SSR).
  if (query) {
    const raw = Number(route.query[query])
    if (Number.isInteger(raw) && raw >= 1) index.value = raw - 1
  }

  // Si la lista se acorta (o llega después que la query), el índice queda dentro.
  watch(total, (n) => {
    if (n > 0 && index.value > n - 1) index.value = n - 1
    if (index.value < 0) index.value = 0
  }, { immediate: true })

  function go(i: number) {
    const n = total.value
    if (n === 0) return
    const next = ((i % n) + n) % n
    if (next === index.value) return
    moved.value = true
    index.value = next
  }

  const next = () => go(index.value + 1)
  const prev = () => go(index.value - 1)

  if (query) {
    // `replace`: cambiar de diapositiva no llena el historial del navegador.
    watch(index, (i) => {
      if (total.value === 0 || String(route.query[query]) === String(i + 1)) return
      void router.replace({ query: { ...route.query, [query]: String(i + 1) }, hash: route.hash })
    })
  }

  onKeyStroke(['ArrowLeft', 'ArrowRight'], (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ownsArrows(event.target)) return
    const el = toValue(root)
    if (!el || !el.contains(document.activeElement)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft') prev()
    else next()
  }, { target: () => toValue(root) ?? null })

  if (stage) {
    useSwipe(() => toValue(stage) ?? null, {
      threshold: 40,
      onSwipeEnd(_event, direction) {
        if (direction === 'left') next()
        else if (direction === 'right') prev()
      },
    })
  }

  return { total, next, prev, go, moved }
}
