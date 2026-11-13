// Colecciones de imágenes de Peticiones (feature 007, enmienda de historial; forma de `useSongCollections`): la fila
// Colecciones y sus acciones con avisos. Tras cada cambio se refresca la fila (`prayer-collections`) para que todas las vistas
// la muestren igual. Las colecciones guardan imágenes ya generadas: no generan.
import type { PrayerGeneratedImage, PrayerImageCollection } from '#shared/types/api'
import { can } from '#shared/permissions'

export const PRAYER_COLLECTIONS_KEY = 'prayer-collections'

/** La fila Colecciones (`GET /api/peticiones/colecciones`), compartida por clave; llega con el SSR. */
export function usePrayerCollectionList() {
  return useApiFetch<{ items: PrayerImageCollection[] }>('/api/peticiones/colecciones', { key: PRAYER_COLLECTIONS_KEY, lazy: true })
}

export function usePrayerCollections() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { profile } = useMe()
  const m = messages.prayers.collection

  const refreshList = () => refreshNuxtData(PRAYER_COLLECTIONS_KEY)

  /** Renombrar o eliminar: su autor o un administrador (la regla vive en `shared/permissions`). */
  function canManage(collection: Pick<PrayerImageCollection, 'author'>): boolean {
    const me = profile.value
    return !!me && (collection.author.userId === me.userId || can(me.role, 'prayers.moderate'))
  }

  /** Crea una colección, vacía o con una imagen. */
  async function create(name: string, imageId?: string): Promise<PrayerImageCollection | null> {
    try {
      const collection = await api<PrayerImageCollection>('/api/peticiones/colecciones', { method: 'POST', body: { name, ...(imageId ? { imageId } : {}) } })
      toast.success(m.created(collection.name))
      await refreshList()
      return collection
    }
    catch (error) {
      toast.error(serverMessage(error, m.createFailed))
      return null
    }
  }

  async function rename(collection: Pick<PrayerImageCollection, 'id'>, name: string): Promise<PrayerImageCollection | null> {
    try {
      const updated = await api<PrayerImageCollection>(`/api/peticiones/colecciones/${collection.id}`, { method: 'PATCH', body: { name } })
      toast.success(m.renamed(updated.name))
      await refreshList()
      return updated
    }
    catch (error) {
      toast.error(serverMessage(error, m.renameFailed))
      return null
    }
  }

  /** Pide confirmación; las imágenes siguen en el historial. */
  async function remove(collection: Pick<PrayerImageCollection, 'id' | 'name'>): Promise<boolean> {
    const ok = await confirm({ title: m.deleteConfirm(collection.name), message: m.deleteBody, confirmLabel: m.remove, danger: true })
    if (!ok) return false
    try {
      await api(`/api/peticiones/colecciones/${collection.id}`, { method: 'DELETE' })
      toast.success(m.deleted(collection.name))
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.deleteFailed))
      return false
    }
  }

  /** Agrega sin duplicar: si ya estaba, lo avisa. */
  async function addImage(collection: Pick<PrayerImageCollection, 'id' | 'name'>, imageId: string): Promise<boolean> {
    try {
      const { added } = await api<{ added: boolean }>(`/api/peticiones/colecciones/${collection.id}/items`, { method: 'POST', body: { imageId } })
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

  async function removeImage(collection: Pick<PrayerImageCollection, 'id'>, image: Pick<PrayerGeneratedImage, 'id'>): Promise<boolean> {
    const ok = await confirm({ title: m.removeConfirm, message: m.removeBody, confirmLabel: m.removeItem, danger: true })
    if (!ok) return false
    try {
      await api(`/api/peticiones/colecciones/${collection.id}/items/${image.id}`, { method: 'DELETE' })
      toast.success(m.removed)
      await refreshList()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.removeFailed))
      return false
    }
  }

  return { canManage, create, rename, remove, addImage, removeImage, refreshList }
}
