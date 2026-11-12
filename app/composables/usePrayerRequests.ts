// Rejilla de la página Peticiones (feature 007, research D9; forma de `useSongHistory`): primera página con el SSR y las
// siguientes por cursor al llegar al final. Al cambiar la query (filtros de US4) se reinicia la lista; nunca repite ids.
import type { MaybeRefOrGetter } from 'vue'
import type { ImageText, Paginated, PrayerRequest } from '#shared/types/api'
import type { PrayersQuery } from '#shared/validation/prayers'

export function usePrayerRequests(query: MaybeRefOrGetter<PrayersQuery>) {
  const api = useApi()
  const params = computed(() => toValue(query))

  const { data: firstPage, error, pending, refresh } = useApiFetch<Paginated<PrayerRequest>>('/api/peticiones', {
    key: 'prayer-requests',
    lazy: true,
    query: params,
  })

  const more = ref<PrayerRequest[]>([])
  // Cursor derivado (no copiado en un `watch`): el SSR y la hidratación coinciden.
  const laterCursor = ref<{ value: string | null } | null>(null)
  const nextCursor = computed(() => (laterCursor.value ? laterCursor.value.value : firstPage.value?.nextCursor ?? null))
  const loadingMore = ref(false)
  const moreError = ref(false)
  /** Textos corregidos en esta página (`patchText`), por id. */
  const texts = ref<Record<string, ImageText>>({})
  watch(firstPage, () => {
    more.value = []
    laterCursor.value = null
    moreError.value = false
    texts.value = {}
  })

  const items = computed(() => {
    const seen = new Set<string>()
    return [...(firstPage.value?.items ?? []), ...more.value]
      .filter(item => !seen.has(item.id) && !!seen.add(item.id))
      .map(item => (texts.value[item.id] ? { ...item, text: texts.value[item.id]! } : item))
  })
  /** Se llegó al final de la lista (con la primera página ya cargada). */
  const done = computed(() => !!firstPage.value && !nextCursor.value)

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    moreError.value = false
    try {
      const page = await api<Paginated<PrayerRequest>>('/api/peticiones', { query: { ...params.value, cursor: nextCursor.value } })
      more.value = [...more.value, ...page.items]
      laterCursor.value = { value: page.nextCursor }
    }
    catch {
      moreError.value = true
    }
    finally {
      loadingMore.value = false
    }
  }

  /**
   * Tras corregir una transcripción: reemplaza el texto de esa tarjeta sin recargar ni mover el scroll. Va aparte de las páginas
   * (reasignar `firstPage` vaciaría las siguientes) y se olvida con una lista nueva, que ya trae el texto del servidor.
   */
  function patchText(id: string, text: ImageText) {
    texts.value = { ...texts.value, [id]: text }
  }

  return { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreError, nextCursor, done, patchText }
}
