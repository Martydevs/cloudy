// Historial de imágenes de peticiones (feature 007, enmienda de historial; forma de `useSongHistory`): la primera página se
// pide en el navegador (`server: false`: la sección está bajo el pliegue y no entra en el LCP), las siguientes al llegar al
// final, y las recién generadas entran arriba sin volver a pedir la lista (`PRAYER_HISTORY_ADDED_KEY`, las escribe
// `usePrayerImages`). Eliminar pide confirmación y solo lo puede su autora o un administrador.
import type { Paginated, PrayerGeneratedImage } from '#shared/types/api'
import { PRAYER_HISTORY_PAGE } from '#shared/constants/prayers'
import { can } from '#shared/permissions'

export const PRAYER_HISTORY_KEY = 'prayer-history'
/** Imágenes generadas en esta visita que todavía no trajo la primera página. */
export const PRAYER_HISTORY_ADDED_KEY = 'prayer-history-added'

export function usePrayerHistory() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { profile } = useMe()
  const m = messages.prayers.history
  const query = { limit: PRAYER_HISTORY_PAGE }

  const { data: firstPage, error, status, refresh } = useApiFetch<Paginated<PrayerGeneratedImage>>('/api/peticiones/imagenes', {
    key: PRAYER_HISTORY_KEY,
    server: false,
    lazy: true,
    query,
  })

  const added = useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => [])
  const more = ref<PrayerGeneratedImage[]>([])
  const removed = ref<Set<string>>(new Set())
  const laterCursor = ref<{ value: string | null } | null>(null)
  const nextCursor = computed(() => (laterCursor.value ? laterCursor.value.value : firstPage.value?.nextCursor ?? null))
  const loadingMore = ref(false)
  const moreFailed = ref(false)

  watch(firstPage, (page) => {
    more.value = []
    removed.value = new Set()
    laterCursor.value = null
    moreFailed.value = false
    // Las que ya trae la página dejan de ser «agregadas».
    const ids = new Set(page?.items.map(image => image.id) ?? [])
    added.value = added.value.filter(image => !ids.has(image.id))
  })

  /** Sin datos todavía: antes de la primera respuesta (`idle` en el SSR y la hidratación, luego `pending`). */
  const loading = computed(() => !firstPage.value && (status.value === 'idle' || status.value === 'pending'))

  const items = computed(() => {
    const seen = new Set<string>()
    return [...added.value, ...(firstPage.value?.items ?? []), ...more.value].filter((image) => {
      if (seen.has(image.id) || removed.value.has(image.id)) return false
      seen.add(image.id)
      return true
    })
  })

  const done = computed(() => !!firstPage.value && !nextCursor.value)

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    moreFailed.value = false
    try {
      const page = await api<Paginated<PrayerGeneratedImage>>('/api/peticiones/imagenes', { query: { ...query, cursor: nextCursor.value } })
      more.value = [...more.value, ...page.items]
      laterCursor.value = { value: page.nextCursor }
    }
    catch {
      moreFailed.value = true
    }
    finally {
      loadingMore.value = false
    }
  }

  /** Eliminar: quien la generó o un administrador (la regla vive en `shared/permissions`). */
  function canRemove(image: Pick<PrayerGeneratedImage, 'author'>): boolean {
    const me = profile.value
    return !!me && (image.author.userId === me.userId || can(me.role, 'prayers.moderate'))
  }

  /** Elimina con confirmación; también sale de sus colecciones. */
  async function remove(image: Pick<PrayerGeneratedImage, 'id'>): Promise<boolean> {
    const ok = await confirm({ title: m.removeConfirm, message: m.removeBody, confirmLabel: m.remove, danger: true })
    if (!ok) return false
    try {
      await api(`/api/peticiones/imagenes/${image.id}`, { method: 'DELETE' })
      removed.value = new Set([...removed.value, image.id])
      added.value = added.value.filter(other => other.id !== image.id)
      toast.success(m.removed)
      await refreshNuxtData(PRAYER_COLLECTIONS_KEY)
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.removeFailed))
      return false
    }
  }

  return { items, firstPage, error, loading, refresh, loadMore, loadingMore, moreFailed, done, canRemove, remove }
}
