// Rejilla de la página Peticiones (feature 007, research D9; forma de `useSongHistory`): primera página con el SSR y las
// siguientes por cursor al llegar al final. Al cambiar la query (filtros de US4) se reinicia la lista; nunca repite ids.
import type { MaybeRefOrGetter } from 'vue'
import type { Paginated, PrayerRequest } from '#shared/types/api'
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
  watch(firstPage, () => {
    more.value = []
    laterCursor.value = null
    moreError.value = false
  })

  const items = computed(() => {
    const seen = new Set<string>()
    return [...(firstPage.value?.items ?? []), ...more.value]
      .filter(item => !seen.has(item.id) && !!seen.add(item.id))
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

  return { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreError, nextCursor, done }
}
