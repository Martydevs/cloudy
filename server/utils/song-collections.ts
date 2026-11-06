// Colecciones de canciones del equipo (feature 006, data-model.md, research D7, D17). La fila Colecciones trae el conteo por
// subconsulta en la misma sentencia (sin N+1) y ninguna lectura selecciona `songs.lyrics`. Renombrar o eliminar: su autor o
// quien tiene `songs.moderate` (admin); agregar o quitar canciones, cualquier persona del equipo (FR-021, FR-022).
import { asc, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { SongCollection, SongCollectionItem } from '#shared/types/api'
import type { Role } from '#shared/permissions'
import { can } from '#shared/permissions'
import { profiles, songCollectionItems, songCollections, songs } from '../db/schema'
import { toSongPerson } from './songs'

export const FORBIDDEN_COLLECTION_MESSAGE = 'Solo quien la creó o un administrador puede cambiar esta colección.'
export const COLLECTION_NOT_FOUND_MESSAGE = 'Esa colección ya no existe.'
export const SONG_GONE_MESSAGE = 'Esa canción ya no está guardada. Ábrela de nuevo e inténtalo otra vez.'

/** Columnas de una colección con su autor y el conteo de canciones. */
export const collectionColumns = {
  id: songCollections.id,
  name: songCollections.name,
  createdBy: songCollections.createdBy,
  createdAt: songCollections.createdAt,
  updatedAt: songCollections.updatedAt,
  authorName: profiles.name,
  authorStatus: profiles.status,
  itemCount: sql<number>`(SELECT count(*)::int FROM song_collection_items i WHERE i.collection_id = ${songCollections.id})`,
}

export interface CollectionRow {
  id: string
  name: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
  authorName: string | null
  authorStatus: string | null
  itemCount: number | string | null
}

/** Todas las colecciones (son decenas), la más reciente primero. */
export function listCollectionsQuery() {
  return useDb()
    .select(collectionColumns)
    .from(songCollections)
    .leftJoin(profiles, eq(songCollections.createdBy, profiles.userId))
    .orderBy(desc(songCollections.updatedAt), asc(songCollections.id))
}

export function collectionQuery(id: string) {
  return useDb()
    .select(collectionColumns)
    .from(songCollections)
    .leftJoin(profiles, eq(songCollections.createdBy, profiles.userId))
    .where(eq(songCollections.id, id))
    .limit(1)
}

/** Canciones de una colección en el orden en que se agregaron, con quién las agregó (mismo select, sin la letra). */
export function collectionItemsQuery(id: string) {
  return useDb()
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      sourceUrl: songs.sourceUrl,
      addedAt: songCollectionItems.addedAt,
      addedBy: songCollectionItems.addedBy,
      adderName: profiles.name,
      adderStatus: profiles.status,
    })
    .from(songCollectionItems)
    .innerJoin(songs, eq(songCollectionItems.songId, songs.id))
    .leftJoin(profiles, eq(songCollectionItems.addedBy, profiles.userId))
    .where(eq(songCollectionItems.collectionId, id))
    .orderBy(asc(songCollectionItems.addedAt), asc(songs.id))
}

export type CollectionItemRow = Awaited<ReturnType<typeof collectionItemsQuery>>[number]

export function toSongCollection(row: CollectionRow): SongCollection {
  return {
    id: row.id,
    name: row.name,
    author: toSongPerson(row.createdBy, row.authorName, row.authorStatus),
    itemCount: Number(row.itemCount ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSongCollectionItem(row: CollectionItemRow): SongCollectionItem {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    sourceUrl: row.sourceUrl,
    addedAt: row.addedAt.toISOString(),
    addedBy: toSongPerson(row.addedBy, row.adderName, row.adderStatus),
  }
}

/** Renombrar o eliminar: su autor o quien tiene `songs.moderate` (admin). */
export function canManageCollection(me: { userId: string, role: Role | null }, collection: { createdBy: string }): boolean {
  return collection.createdBy === me.userId || can(me.role, 'songs.moderate')
}

export function collectionNotFound() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: COLLECTION_NOT_FOUND_MESSAGE })
}

export function songGone() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: SONG_GONE_MESSAGE })
}

/** La colección o 404. */
export async function getCollection(id: string): Promise<CollectionRow> {
  const [row] = await collectionQuery(id)
  if (!row) throw collectionNotFound()
  return row
}

/** La colección, si quien llama puede cambiarla; si no, 403 (y 404 si no existe). */
export async function getManagedCollection(id: string, me: { userId: string, role: Role | null }): Promise<CollectionRow> {
  const row = await getCollection(id)
  if (!canManageCollection(me, row)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: FORBIDDEN_COLLECTION_MESSAGE })
  }
  return row
}

/** Agrega una canción sin duplicarla (FR-023): `ON CONFLICT DO NOTHING RETURNING`; sin fila devuelta, ya estaba. */
export function addCollectionItem(collectionId: string, songId: string, userId: string) {
  return useDb()
    .insert(songCollectionItems)
    .values({ collectionId, songId, addedBy: userId })
    .onConflictDoNothing()
    .returning({ songId: songCollectionItems.songId })
}

/** La colección cambió (renombrar, agregar o quitar): sube al inicio de la fila Colecciones. */
export function touchCollection(id: string) {
  return useDb().update(songCollections).set({ updatedAt: sql`now()` }).where(eq(songCollections.id, id))
}
