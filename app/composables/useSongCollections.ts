// Colecciones de canciones del equipo (feature 006, FR-020–FR-024): la fila Colecciones y sus acciones con avisos. Tras cada
// cambio se refresca la fila (`song-collections`) para que todas las vistas la muestren igual. Generar una colección encola
// una presentación por canción, tras avisar cuántos archivos llegarán.
import type { SongCollection, SongCollectionDetail, SongCollectionItem } from '#shared/types/api'
import { can } from '#shared/permissions'

export const COLLECTIONS_KEY = 'song-collections'

/** La fila Colecciones (`GET /api/songs/collections`), compartida por clave. */
export function useSongCollectionList() {
  return useApiFetch<{ items: SongCollection[] }>('/api/songs/collections', { key: COLLECTIONS_KEY, lazy: true })
}

export function useSongCollections() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { profile } = useMe()
  const presentations = useSongPresentations()
  const m = messages.songs.collection

  const refreshList = () => refreshNuxtData(COLLECTIONS_KEY)

  /** Renombrar o eliminar: su autor o un administrador (la regla vive en `shared/permissions`). */
  function canManage(collection: Pick<SongCollection, 'author'>): boolean {
    const me = profile.value
    return !!me && (collection.author.userId === me.userId || can(me.role, 'songs.moderate'))
  }

  /** Crea una colección, vacía o con una canción. */
  async function create(name: string, songId?: string): Promise<SongCollection | null> {
    try {
      const collection = await api<SongCollection>('/api/songs/collections', { method: 'POST', body: { name, ...(songId ? { songId } : {}) } })
      toast.success(m.created(collection.name))
      await refreshList()
      return collection
    }
    catch (error) {
      toast.error(serverMessage(error, m.createFailed))
      return null
    }
  }

  async function rename(collection: Pick<SongCollection, 'id'>, name: string): Promise<SongCollection | null> {
    try {
      const updated = await api<SongCollection>(`/api/songs/collections/${collection.id}`, { method: 'PATCH', body: { name } })
      toast.success(m.renamed(updated.name))
      await refreshList()
      return updated
    }
    catch (error) {
      toast.error(serverMessage(error, m.renameFailed))
      return null
    }
  }

  /** Pide confirmación; las canciones siguen en el historial. */
  async function remove(collection: Pick<SongCollection, 'id' | 'name'>): Promise<boolean> {
    const ok = await confirm({ title: m.deleteConfirm(collection.name), confirmLabel: 'Eliminar colección', danger: true })
    if (!ok) return false
    try {
      await api(`/api/songs/collections/${collection.id}`, { method: 'DELETE' })
      toast.success(m.deleted(collection.name))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.deleteFailed))
      return false
    }
  }

  /** Agrega sin duplicar: si ya estaba, lo avisa (FR-023). */
  async function addSong(collection: Pick<SongCollection, 'id' | 'name'>, songId: string): Promise<boolean> {
    try {
      const { added } = await api<{ added: boolean }>(`/api/songs/collections/${collection.id}/items`, { method: 'POST', body: { songId } })
      if (added) toast.success(m.added(collection.name))
      else toast.info(m.already(collection.name))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.addFailed))
      return false
    }
  }

  async function removeSong(collection: Pick<SongCollection, 'id'>, item: Pick<SongCollectionItem, 'id' | 'title'>): Promise<boolean> {
    const ok = await confirm({ title: m.removeConfirm(item.title), message: 'La canción sigue en el historial.', confirmLabel: 'Quitar', danger: true })
    if (!ok) return false
    try {
      await api(`/api/songs/collections/${collection.id}/items/${item.id}`, { method: 'DELETE' })
      toast.success(m.removed(item.title))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.removeFailed))
      return false
    }
  }

  /** Confirma cuántos archivos llegarán y encola una presentación por canción (FR-024). Devuelve cuántas se encolaron. */
  async function generateSongs(songs: readonly { id: string, title: string }[]): Promise<number> {
    if (songs.length === 0) return 0
    if (songs.length > 1) {
      const ok = await confirm({
        title: messages.songs.present.confirmMany(songs.length),
        message: presentations.filesFor(songs.length),
        confirmLabel: messages.songs.present.confirmMany(songs.length),
      })
      if (!ok) return 0
    }
    return presentations.enqueue(songs)
  }

  /** Carga la colección y genera sus canciones. */
  async function generate(collection: Pick<SongCollection, 'id'>): Promise<number> {
    try {
      const detail = await api<SongCollectionDetail>(`/api/songs/collections/${collection.id}`)
      return await generateSongs(detail.items)
    }
    catch (error) {
      toast.error(serverMessage(error, messages.songs.load.collection))
      return 0
    }
  }

  return { canManage, create, rename, remove, addSong, removeSong, generate, generateSongs, refreshList }
}
