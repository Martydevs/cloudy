// Historial compartido de YouTube (feature 005, FR-023–FR-026): primera página con el SSR, las siguientes al llegar al
// final (centinela visible), quitar con confirmación y la variante «reciente» de la ficha (12, sin el video actual).
import type { YoutubeHistoryItem, YoutubeHistoryPage } from '#shared/types/api'
import { YOUTUBE_HISTORY_PAGE, YOUTUBE_RECENT_LIMIT } from '#shared/constants/youtube'

export function useYoutubeHistory({ exclude, recent = false }: { exclude?: MaybeRefOrGetter<string | undefined>, recent?: boolean } = {}) {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const limit = recent ? YOUTUBE_RECENT_LIMIT : YOUTUBE_HISTORY_PAGE
  const query = computed(() => {
    const skip = toValue(exclude)
    return { limit, ...(skip ? { exclude: skip } : {}) }
  })

  const { data: firstPage, error, pending, refresh } = useApiFetch<YoutubeHistoryPage>('/api/youtube/history', {
    key: recent ? `youtube-history-recent-${toValue(exclude) ?? ''}` : 'youtube-history',
    lazy: true,
    query,
  })

  const more = ref<YoutubeHistoryItem[]>([])
  const removed = ref<Set<string>>(new Set())
  const nextCursor = ref<string | null>(null)
  const loadingMore = ref(false)
  const moreFailed = ref(false)
  watch(firstPage, (page) => {
    more.value = []
    removed.value = new Set()
    nextCursor.value = recent ? null : page?.nextCursor ?? null
    moreFailed.value = false
  }, { immediate: true })

  const items = computed(() => [...(firstPage.value?.items ?? []), ...more.value].filter(item => !removed.value.has(item.videoId)))

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    moreFailed.value = false
    try {
      const page = await api<YoutubeHistoryPage>('/api/youtube/history', { query: { ...query.value, cursor: nextCursor.value } })
      more.value = [...more.value, ...page.items]
      nextCursor.value = page.nextCursor
    }
    catch {
      moreFailed.value = true
    }
    finally {
      loadingMore.value = false
    }
  }

  /** Quita del historial con confirmación; las listas lo conservan. */
  async function remove(item: Pick<YoutubeHistoryItem, 'videoId' | 'title'>): Promise<boolean> {
    const ok = await confirm({
      title: `¿Quitar «${item.title}» del historial?`,
      message: 'Se quita para todo el equipo. Si está en alguna lista, la lista lo conserva.',
      confirmLabel: 'Quitar',
      danger: true,
    })
    if (!ok) return false
    try {
      await api(`/api/youtube/history/${item.videoId}`, { method: 'DELETE' })
      removed.value = new Set([...removed.value, item.videoId])
      toast.success(messages.youtube.history.removed(item.title))
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, messages.youtube.history.removeFailed))
      return false
    }
  }

  return { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor, remove }
}
