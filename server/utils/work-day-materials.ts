// Material adjunto a un día de trabajo (`/calendario`): referencias, nunca copias, a colecciones de canciones, listas de
// YouTube y carpetas del drive. Todo el SQL de `work_day_materials` vive aquí (los endpoints no tocan drizzle;
// `architecture.spec.ts`). Las lecturas se agrupan por tipo, sin N+1, y se componen en el `db.batch` de `work-days.ts`.
// Una carpeta en la papelera no se muestra ni se cuenta; al purgarla (o al borrar una colección o lista) la cascada quita
// el adjunto.
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { WORK_DAY_MATERIAL_ITEMS } from '#shared/constants/calendar'
import type { WorkDayMaterial, WorkDayMaterialType } from '#shared/types/api'
import {
  folders,
  songCollectionItems,
  songCollections,
  songs,
  workDayMaterials,
  youtubePlaylistItems,
  youtubePlaylists,
  youtubeVideos,
} from '../db/schema'

export interface MaterialRefs {
  songCollectionIds: string[]
  youtubePlaylistIds: string[]
  folderIds: string[]
}

/**
 * Adjuntos visibles de cada día de una consulta sobre `work_days` (subconsulta correlacionada, sin N+1). El día exterior va
 * con su nombre calificado en crudo: en una consulta sin join drizzle imprime la columna como `"id"` a secas y Postgres la
 * resolvería contra `m.id`, la tabla interior (el conteo daría siempre 0; mismo caso que `folderItemCountSql`).
 */
export function materialCountSql(): SQL<number> {
  const day = sql.raw('"work_days"."id"')
  return sql<number>`(
    SELECT count(*)::int FROM work_day_materials m
    LEFT JOIN folders f ON f.id = m.folder_id
    WHERE m.work_day_id = ${day} AND (m.folder_id IS NULL OR f.deleted_at IS NULL)
  )`
}

/** Lo que sigue existiendo de lo elegido, una consulta por tipo (una lista vacía no devuelve filas). */
export function existingMaterialQueries(refs: MaterialRefs) {
  const db = useDb()
  return [
    db.select({ id: songCollections.id }).from(songCollections).where(inArray(songCollections.id, refs.songCollectionIds)),
    db.select({ id: youtubePlaylists.id }).from(youtubePlaylists).where(inArray(youtubePlaylists.id, refs.youtubePlaylistIds)),
    db.select({ id: folders.id }).from(folders).where(and(inArray(folders.id, refs.folderIds), isNull(folders.deletedAt))),
  ] as const
}

/** Ids elegidos que ya no existen (o, si es una carpeta, que está en la papelera). */
export function missingMaterials(refs: MaterialRefs, found: readonly (readonly { id: string }[])[]): string[] {
  const existing = new Set(found.flat().map(row => row.id))
  return [...refs.songCollectionIds, ...refs.youtubePlaylistIds, ...refs.folderIds].filter(id => !existing.has(id))
}

/** Una sola sentencia con todos los adjuntos del día, o `null` si no eligió ninguno. */
export function insertMaterialsQuery(workDayId: string, refs: MaterialRefs, userId: string, now: Date) {
  const base = { workDayId, addedBy: userId, addedAt: now }
  const rows = [
    ...refs.songCollectionIds.map(songCollectionId => ({ ...base, songCollectionId })),
    ...refs.youtubePlaylistIds.map(youtubePlaylistId => ({ ...base, youtubePlaylistId })),
    ...refs.folderIds.map(folderId => ({ ...base, folderId })),
  ]
  return rows.length > 0 ? useDb().insert(workDayMaterials).values(rows) : null
}

export function deleteMaterialsQuery(workDayId: string) {
  return useDb().delete(workDayMaterials).where(eq(workDayMaterials.workDayId, workDayId))
}

/** Las cinco lecturas del material de un día: los adjuntos de cada tipo y los elementos de colecciones y listas. */
export function dayMaterialQueries(workDayId: string) {
  const db = useDb()
  const ofDay = eq(workDayMaterials.workDayId, workDayId)
  return [
    db.select({
      refId: songCollections.id,
      name: songCollections.name,
      itemCount: sql<number>`(SELECT count(*)::int FROM song_collection_items i WHERE i.collection_id = ${songCollections.id})`,
    })
      .from(workDayMaterials)
      .innerJoin(songCollections, eq(workDayMaterials.songCollectionId, songCollections.id))
      .where(ofDay)
      .orderBy(asc(workDayMaterials.addedAt), asc(songCollections.id)),
    db.select({
      refId: youtubePlaylists.id,
      name: youtubePlaylists.name,
      itemCount: sql<number>`(SELECT count(*)::int FROM youtube_playlist_items i WHERE i.playlist_id = ${youtubePlaylists.id})`,
    })
      .from(workDayMaterials)
      .innerJoin(youtubePlaylists, eq(workDayMaterials.youtubePlaylistId, youtubePlaylists.id))
      .where(ofDay)
      .orderBy(asc(workDayMaterials.addedAt), asc(youtubePlaylists.id)),
    db.select({
      refId: folders.id,
      name: folders.name,
      itemCount: sql<number>`(
        (SELECT count(*) FROM folders c WHERE c.parent_id = ${folders.id} AND c.deleted_at IS NULL)
        + (SELECT count(*) FROM files x WHERE x.folder_id = ${folders.id} AND x.deleted_at IS NULL AND x.upload_status = 'ready')
      )::int`,
    })
      .from(workDayMaterials)
      .innerJoin(folders, eq(workDayMaterials.folderId, folders.id))
      .where(and(ofDay, isNull(folders.deletedAt)))
      .orderBy(asc(workDayMaterials.addedAt), asc(folders.id)),
    db.select({ refId: songCollectionItems.collectionId, id: songs.id, title: songs.title })
      .from(workDayMaterials)
      .innerJoin(songCollectionItems, eq(songCollectionItems.collectionId, workDayMaterials.songCollectionId))
      .innerJoin(songs, eq(songCollectionItems.songId, songs.id))
      .where(ofDay)
      .orderBy(asc(songCollectionItems.addedAt), asc(songs.id)),
    db.select({ refId: youtubePlaylistItems.playlistId, id: youtubeVideos.videoId, title: youtubeVideos.title })
      .from(workDayMaterials)
      .innerJoin(youtubePlaylistItems, eq(youtubePlaylistItems.playlistId, workDayMaterials.youtubePlaylistId))
      .innerJoin(youtubeVideos, eq(youtubePlaylistItems.videoId, youtubeVideos.videoId))
      .where(ofDay)
      .orderBy(desc(youtubePlaylistItems.addedAt), asc(youtubeVideos.videoId)),
  ] as const
}

interface MaterialRow { refId: string, name: string, itemCount: number | string | null }
interface MaterialItemRow { refId: string, id: string, title: string }

/** Arma el material del detalle: colecciones, listas y carpetas, cada una con hasta 50 de sus elementos. */
export function toWorkDayMaterials(
  collections: readonly MaterialRow[],
  playlists: readonly MaterialRow[],
  folderRows: readonly MaterialRow[],
  collectionSongs: readonly MaterialItemRow[],
  playlistVideos: readonly MaterialItemRow[],
): WorkDayMaterial[] {
  const build = (type: WorkDayMaterialType, rows: readonly MaterialRow[], items: readonly MaterialItemRow[]) =>
    rows.map((row): WorkDayMaterial => ({
      type,
      refId: row.refId,
      name: row.name,
      itemCount: Number(row.itemCount ?? 0),
      items: items.filter(item => item.refId === row.refId).slice(0, WORK_DAY_MATERIAL_ITEMS).map(({ id, title }) => ({ id, title })),
    }))
  return [
    ...build('song_collection', collections, collectionSongs),
    ...build('youtube_playlist', playlists, playlistVideos),
    ...build('folder', folderRows, []),
  ]
}
