// Detalle de una colección con sus canciones (contracts/api.md § 9): la colección y sus elementos en un solo viaje, sin letras.
import { setResponseHeader } from 'h3'
import type { SongCollectionDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<SongCollectionDetail> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const [[row], items] = await useDb().batch([collectionQuery(id), collectionItemsQuery(id)])
  if (!row) throw collectionNotFound()
  return { ...toSongCollection(row), items: items.map(toSongCollectionItem) }
})
