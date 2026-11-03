// Listas de YouTube del equipo (feature 005, FR-015–FR-018): la fila Listas y las acciones con sus avisos. Tras cada
// cambio se refresca la fila (`youtube-playlists`) para que todas las vistas la muestren igual.
import type { YoutubePlaylist, YoutubePlaylistItem } from '#shared/types/api'
import { can } from '#shared/permissions'

export const PLAYLISTS_KEY = 'youtube-playlists'

/** La fila Listas (`GET /api/youtube/playlists`), compartida por clave. */
export function useYoutubePlaylistList() {
  return useApiFetch<{ items: YoutubePlaylist[] }>('/api/youtube/playlists', { key: PLAYLISTS_KEY, lazy: true })
}

export function useYoutubePlaylists() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { profile } = useMe()
  const m = messages.youtube.playlists

  const refreshList = () => refreshNuxtData(PLAYLISTS_KEY)

  /** Renombrar o eliminar: su autor o un administrador (la regla vive en `shared/permissions`). */
  function canManage(playlist: Pick<YoutubePlaylist, 'author'>): boolean {
    const me = profile.value
    return !!me && (playlist.author.userId === me.userId || can(me.role, 'youtube.moderate'))
  }

  async function create(name: string, videoId?: string): Promise<YoutubePlaylist | null> {
    try {
      const playlist = await api<YoutubePlaylist>('/api/youtube/playlists', { method: 'POST', body: { name, ...(videoId ? { videoId } : {}) } })
      toast.success(m.created(playlist.name))
      await refreshList()
      return playlist
    }
    catch (error) {
      toast.error(serverMessage(error, m.createFailed))
      return null
    }
  }

  async function rename(playlist: Pick<YoutubePlaylist, 'id'>, name: string): Promise<YoutubePlaylist | null> {
    try {
      const updated = await api<YoutubePlaylist>(`/api/youtube/playlists/${playlist.id}`, { method: 'PATCH', body: { name } })
      toast.success(m.renamed(updated.name))
      await refreshList()
      return updated
    }
    catch (error) {
      toast.error(serverMessage(error, m.renameFailed))
      return null
    }
  }

  /** Pide confirmación; los videos siguen en el historial. */
  async function remove(playlist: Pick<YoutubePlaylist, 'id' | 'name'>): Promise<boolean> {
    const ok = await confirm({
      title: `¿Eliminar la lista «${playlist.name}»?`,
      message: 'Los videos siguen en el historial; solo se borra la lista.',
      confirmLabel: 'Eliminar lista',
      danger: true,
    })
    if (!ok) return false
    try {
      await api(`/api/youtube/playlists/${playlist.id}`, { method: 'DELETE' })
      toast.success(m.deleted(playlist.name))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.deleteFailed))
      return false
    }
  }

  /** Agrega sin duplicar: si ya estaba, lo avisa (FR-018). */
  async function addVideo(playlist: Pick<YoutubePlaylist, 'id' | 'name'>, videoId: string): Promise<boolean> {
    try {
      const { added } = await api<{ added: boolean }>(`/api/youtube/playlists/${playlist.id}/items`, { method: 'POST', body: { videoId } })
      if (added) toast.success(m.added(playlist.name))
      else toast.info(m.already(playlist.name))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.addFailed))
      return false
    }
  }

  async function removeVideo(playlist: Pick<YoutubePlaylist, 'id' | 'name'>, item: Pick<YoutubePlaylistItem, 'videoId' | 'title'>): Promise<boolean> {
    const ok = await confirm({
      title: `¿Quitar «${item.title}» de «${playlist.name}»?`,
      message: 'El video sigue en el historial.',
      confirmLabel: 'Quitar',
      danger: true,
    })
    if (!ok) return false
    try {
      await api(`/api/youtube/playlists/${playlist.id}/items/${item.videoId}`, { method: 'DELETE' })
      toast.success(m.removed(item.title))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.removeFailed))
      return false
    }
  }

  return { canManage, create, rename, remove, addVideo, removeVideo, refreshList }
}
