// Descargas guardadas del equipo (sección «Descargas» de /youtube): primera página con el SSR y las siguientes al llegar
// al final (centinela visible). Una descarga nueva refresca la primera página con `refreshDownloadHistory`.
import type { YoutubeDownloadItem, YoutubeDownloadsPage } from '#shared/types/api'
import { YOUTUBE_HISTORY_PAGE } from '#shared/constants/youtube'

export const DOWNLOAD_HISTORY_KEY = 'youtube-download-history'

export const refreshDownloadHistory = () => refreshNuxtData(DOWNLOAD_HISTORY_KEY)

export function useYoutubeDownloadHistory() {
  const api = useApi()
  const query = { limit: YOUTUBE_HISTORY_PAGE }

  const { data: firstPage, error, pending, refresh } = useApiFetch<YoutubeDownloadsPage>('/api/youtube/downloads', {
    key: DOWNLOAD_HISTORY_KEY,
    lazy: true,
    query,
  })

  const more = ref<YoutubeDownloadItem[]>([])
  const nextCursor = ref<string | null>(null)
  const loadingMore = ref(false)
  const moreFailed = ref(false)
  watch(firstPage, (page) => {
    more.value = []
    nextCursor.value = page?.nextCursor ?? null
    moreFailed.value = false
  }, { immediate: true })

  // Un video descargado de nuevo sube a la primera página: no se repite si ya venía en una página siguiente.
  const items = computed(() => {
    const seen = new Set<string>()
    return [...(firstPage.value?.items ?? []), ...more.value].filter((item) => {
      if (seen.has(item.videoId)) return false
      seen.add(item.videoId)
      return true
    })
  })

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    moreFailed.value = false
    try {
      const page = await api<YoutubeDownloadsPage>('/api/youtube/downloads', { query: { ...query, cursor: nextCursor.value } })
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

  return { items, firstPage, error, pending, refresh, loadMore, loadingMore, moreFailed, nextCursor }
}
