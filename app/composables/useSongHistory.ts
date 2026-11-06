// Historial compartido de Canciones (feature 006, FR-027–FR-029; clon de `useYoutubeHistory`): primera página con el SSR, las
// siguientes al llegar al final (centinela visible), quitar con confirmación y la variante «reciente» de la ficha (12, sin la
// canción actual).
import type { MaybeRefOrGetter } from 'vue'
import type { SongHistoryItem, SongHistoryPage } from '#shared/types/api'
import { SONG_HISTORY_PAGE, SONG_RECENT_LIMIT } from '#shared/constants/songs'

export const SONG_HISTORY_KEY = 'songs-history'

export function useSongHistory({ exclude, recent = false }: { exclude?: MaybeRefOrGetter<string | undefined>, recent?: boolean } = {}) {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const limit = recent ? SONG_RECENT_LIMIT : SONG_HISTORY_PAGE
  const query = computed(() => {
    const skip = toValue(exclude)
    return { limit, ...(skip ? { exclude: skip } : {}) }
  })

  const { data: firstPage, error, pending, refresh } = useApiFetch<SongHistoryPage>('/api/songs/history', {
    key: recent ? `songs-history-recent-${toValue(exclude) ?? ''}` : SONG_HISTORY_KEY,
    lazy: true,
    query,
  })

  const more = ref<SongHistoryItem[]>([])
  const removed = ref<Set<string>>(new Set())
  // Cursor derivado (no copiado en un `watch`), como en YouTube: así el SSR pinta «Cargar más» y la hidratación coincide.
  const laterCursor = ref<{ value: string | null } | null>(null)
  const nextCursor = computed(() => (recent ? null : laterCursor.value ? laterCursor.value.value : firstPage.value?.nextCursor ?? null))
  const loadingMore = ref(false)
  const moreFailed = ref(false)
  watch(firstPage, () => {
    more.value = []
    removed.value = new Set()
    laterCursor.value = null
    moreFailed.value = false
  })

  const items = computed(() => [...(firstPage.value?.items ?? []), ...more.value].filter(item => !removed.value.has(item.id)))

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    moreFailed.value = false
    try {
      const page = await api<SongHistoryPage>('/api/songs/history', { query: { ...query.value, cursor: nextCursor.value } })
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

  /** Quita del historial con confirmación; sus colecciones la conservan. */
  async function remove(item: Pick<SongHistoryItem, 'id' | 'title'>): Promise<boolean> {
    const ok = await confirm({
      title: messages.songs.history.removeConfirm(item.title),
      message: 'Se quita para todo el equipo.',
      confirmLabel: 'Quitar',
      danger: true,
    })
    if (!ok) return false
    try {
      await api(`/api/songs/history/${item.id}`, { method: 'DELETE' })
      removed.value = new Set([...removed.value, item.id])
      toast.success(messages.songs.history.removed(item.title))
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, messages.songs.history.removeFailed))
      return false
    }
  }

  return { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor, remove }
}
