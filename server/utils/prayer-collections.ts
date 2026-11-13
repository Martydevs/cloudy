// Colecciones de imágenes de peticiones (feature 007, enmienda de historial; misma forma que las colecciones de canciones):
// agrupan imágenes ya generadas y las protegen de la limpieza de 30 días. Todo el SQL vive aquí: los endpoints no tocan
// drizzle. La fila trae el conteo por subconsulta en la misma sentencia (sin N+1). Renombrar o eliminar: su autor o quien
// tiene `prayers.moderate` (admin); agregar o quitar imágenes, cualquier persona del equipo. Eliminar una colección no
// borra sus imágenes.
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError } from 'h3'
import type { Role } from '#shared/permissions'
import { can } from '#shared/permissions'
import type { PrayerImageCollection, PrayerImageCollectionDetail, PrayerImageCollectionItem } from '#shared/types/api'
import { prayerImageCollectionItems, prayerImageCollections, prayerImages, profiles } from '../db/schema'
import { prayerImageExists, prayerImageGone, toPrayerGeneratedImage } from './prayer-gallery'
import { toSongPerson } from './songs'

export const FORBIDDEN_PRAYER_COLLECTION_MESSAGE = 'Solo quien la creó o un administrador puede cambiar esta colección.'
export const PRAYER_COLLECTION_NOT_FOUND_MESSAGE = 'Esa colección ya no existe.'

type Me = { userId: string, role: Role | null }

/** Columnas de una colección con su autor y el conteo de imágenes. */
export const prayerCollectionColumns = {
  id: prayerImageCollections.id,
  name: prayerImageCollections.name,
  createdBy: prayerImageCollections.createdBy,
  createdAt: prayerImageCollections.createdAt,
  updatedAt: prayerImageCollections.updatedAt,
  authorName: profiles.name,
  authorStatus: profiles.status,
  itemCount: sql<number>`(SELECT count(*)::int FROM prayer_image_collection_items i WHERE i.collection_id = ${prayerImageCollections.id})`,
}

export interface PrayerCollectionRow {
  id: string
  name: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
  authorName: string | null
  authorStatus: string | null
  itemCount: number | string | null
}

const collectionsQuery = () => useDb()
  .select(prayerCollectionColumns)
  .from(prayerImageCollections)
  .leftJoin(profiles, eq(prayerImageCollections.createdBy, profiles.userId))

/** Todas las colecciones (son decenas), la que cambió más reciente primero. */
export function listPrayerCollectionsQuery() {
  return collectionsQuery().orderBy(desc(prayerImageCollections.updatedAt), asc(prayerImageCollections.id))
}

export function prayerCollectionQuery(id: string) {
  return collectionsQuery().where(eq(prayerImageCollections.id, id)).limit(1)
}

const author = alias(profiles, 'author')
const adder = alias(profiles, 'adder')

/** Imágenes de una colección en el orden en que se agregaron, con su autor y quién las agregó (una sola sentencia). */
export function prayerCollectionItemsQuery(id: string) {
  return useDb()
    .select({
      id: prayerImages.id,
      storageKey: prayerImages.storageKey,
      mediaType: prayerImages.mediaType,
      fileIds: prayerImages.fileIds,
      createdBy: prayerImages.createdBy,
      createdAt: prayerImages.createdAt,
      authorName: author.name,
      authorStatus: author.status,
      addedAt: prayerImageCollectionItems.addedAt,
      addedBy: prayerImageCollectionItems.addedBy,
      adderName: adder.name,
      adderStatus: adder.status,
    })
    .from(prayerImageCollectionItems)
    .innerJoin(prayerImages, eq(prayerImageCollectionItems.imageId, prayerImages.id))
    .leftJoin(author, eq(prayerImages.createdBy, author.userId))
    .leftJoin(adder, eq(prayerImageCollectionItems.addedBy, adder.userId))
    .where(eq(prayerImageCollectionItems.collectionId, id))
    .orderBy(asc(prayerImageCollectionItems.addedAt), asc(prayerImages.id))
}

export type PrayerCollectionItemRow = Awaited<ReturnType<typeof prayerCollectionItemsQuery>>[number]

export function toPrayerCollection(row: PrayerCollectionRow): PrayerImageCollection {
  return {
    id: row.id,
    name: row.name,
    author: toSongPerson(row.createdBy, row.authorName, row.authorStatus),
    itemCount: Number(row.itemCount ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPrayerCollectionItem(row: PrayerCollectionItemRow): PrayerImageCollectionItem {
  return {
    ...toPrayerGeneratedImage(row),
    addedAt: row.addedAt.toISOString(),
    addedBy: toSongPerson(row.addedBy, row.adderName, row.adderStatus),
  }
}

/** Renombrar o eliminar: su autor o quien tiene `prayers.moderate` (admin). */
export function canManagePrayerCollection(me: Me, collection: { createdBy: string }): boolean {
  return collection.createdBy === me.userId || can(me.role, 'prayers.moderate')
}

export function prayerCollectionNotFound() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: PRAYER_COLLECTION_NOT_FOUND_MESSAGE })
}

/** La colección o 404. */
export async function getPrayerCollection(id: string): Promise<PrayerCollectionRow> {
  const [row] = await prayerCollectionQuery(id)
  if (!row) throw prayerCollectionNotFound()
  return row
}

/** La colección, si quien llama puede cambiarla; si no, 403 (y 404 si no existe). */
export async function getManagedPrayerCollection(id: string, me: Me): Promise<PrayerCollectionRow> {
  const row = await getPrayerCollection(id)
  if (!canManagePrayerCollection(me, row)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: FORBIDDEN_PRAYER_COLLECTION_MESSAGE })
  }
  return row
}

export async function listPrayerCollections(): Promise<PrayerImageCollection[]> {
  const rows = await listPrayerCollectionsQuery()
  return rows.map(toPrayerCollection)
}

/** La colección y sus imágenes en un solo viaje (`db.batch`). */
export async function getPrayerCollectionDetail(id: string): Promise<PrayerImageCollectionDetail> {
  const [[row], items] = await useDb().batch([prayerCollectionQuery(id), prayerCollectionItemsQuery(id)])
  if (!row) throw prayerCollectionNotFound()
  return { ...toPrayerCollection(row), items: items.map(toPrayerCollectionItem) }
}

/**
 * Crea una colección. Con `imageId` nace con esa imagen en el mismo `db.batch`; si la imagen no existe, 404 y no se crea
 * nada (sin colecciones a medias). Los nombres pueden repetirse.
 */
export async function createPrayerCollection(
  { name, imageId, me }: { name: string, imageId?: string, me: { userId: string, name: string | null, status: string | null } },
): Promise<PrayerImageCollection> {
  if (imageId && !await prayerImageExists(imageId)) throw prayerImageGone()
  const db = useDb()
  const id = randomUUID()
  const now = new Date()
  const insertCollection = db.insert(prayerImageCollections).values({ id, name, createdBy: me.userId, createdAt: now, updatedAt: now })
  if (imageId) {
    await db.batch([insertCollection, db.insert(prayerImageCollectionItems).values({ collectionId: id, imageId, addedBy: me.userId, addedAt: now })])
  }
  else {
    await db.batch([insertCollection])
  }
  return {
    id,
    name,
    author: toSongPerson(me.userId, me.name, me.status),
    itemCount: imageId ? 1 : 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

/** Renombrar (autor o admin): la colección sube al inicio de la fila. */
export async function renamePrayerCollection(id: string, name: string, me: Me): Promise<PrayerImageCollection> {
  const row = await getManagedPrayerCollection(id, me)
  const [updated] = await useDb()
    .update(prayerImageCollections)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(prayerImageCollections.id, id))
    .returning({ updatedAt: prayerImageCollections.updatedAt })
  if (!updated) throw prayerCollectionNotFound()
  return toPrayerCollection({ ...row, name, updatedAt: updated.updatedAt })
}

/** Eliminar (autor o admin). La cascada borra sus elementos; las imágenes siguen en el historial. */
export async function deletePrayerCollection(id: string, me: Me): Promise<void> {
  await getManagedPrayerCollection(id, me)
  await useDb().delete(prayerImageCollections).where(eq(prayerImageCollections.id, id))
}

/** La colección cambió (renombrar, agregar o quitar): sube al inicio de la fila Colecciones. */
function touchPrayerCollection(id: string) {
  return useDb().update(prayerImageCollections).set({ updatedAt: sql`now()` }).where(eq(prayerImageCollections.id, id))
}

/** Agrega una imagen sin duplicarla: `ON CONFLICT DO NOTHING RETURNING`; sin fila devuelta, ya estaba. */
export async function addPrayerCollectionItem(id: string, imageId: string, userId: string): Promise<{ added: boolean }> {
  const db = useDb()
  const [[collection], [image]] = await db.batch([
    db.select({ id: prayerImageCollections.id }).from(prayerImageCollections).where(eq(prayerImageCollections.id, id)).limit(1),
    db.select({ id: prayerImages.id }).from(prayerImages).where(eq(prayerImages.id, imageId)).limit(1),
  ])
  if (!collection) throw prayerCollectionNotFound()
  if (!image) throw prayerImageGone()
  const inserted = await db
    .insert(prayerImageCollectionItems)
    .values({ collectionId: id, imageId, addedBy: userId })
    .onConflictDoNothing()
    .returning({ imageId: prayerImageCollectionItems.imageId })
  const added = inserted.length > 0
  if (added) await touchPrayerCollection(id)
  return { added }
}

/** Quitar una imagen (idempotente). La imagen sigue en el historial. */
export async function removePrayerCollectionItem(id: string, imageId: string): Promise<void> {
  const removed = await useDb()
    .delete(prayerImageCollectionItems)
    .where(and(eq(prayerImageCollectionItems.collectionId, id), eq(prayerImageCollectionItems.imageId, imageId)))
    .returning({ imageId: prayerImageCollectionItems.imageId })
  if (removed.length > 0) await touchPrayerCollection(id)
}
