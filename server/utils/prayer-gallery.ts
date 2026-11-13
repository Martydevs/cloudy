// Historial de imágenes de peticiones (feature 007, enmienda de historial): cada imagen generada se guarda en el bucket con
// una fila en `prayer_images`. Aquí vive todo su SQL (guardar, listar, leer, borrar y la limpieza a los 30 días) y la
// subida al bucket; los endpoints no tocan drizzle. Guardar no deja huérfanos: si la fila no entra, se borra el objeto.
import { randomUUID } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { PRAYER_IMAGE_RETENTION_DAYS } from '#shared/constants/prayers'
import type { Role } from '#shared/permissions'
import { can } from '#shared/permissions'
import type { Paginated, PrayerGeneratedImage } from '#shared/types/api'
import { prayerImages, profiles } from '../db/schema'
import { encodeCursor } from './pagination'
import { prayerError } from './prayer-images'
import { decodePrayerCursor } from './prayer-requests'
import { toSongPerson } from './songs'
import { deleteMany, key, putObject } from './storage'

/** Formatos que el navegador sabe nombrar y mostrar; otro tipo cuenta como salida inválida. */
export const PRAYER_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export const PRAYER_IMAGE_GONE_MESSAGE = 'Esa imagen ya no está guardada.'
export const FORBIDDEN_PRAYER_IMAGE_MESSAGE = 'Solo quien la generó o un administrador puede eliminar esta imagen.'

const PURGE_BATCH = 500

/** Columnas de una imagen con su autor (una sola sentencia, sin N+1). */
export const prayerImageColumns = {
  id: prayerImages.id,
  storageKey: prayerImages.storageKey,
  mediaType: prayerImages.mediaType,
  fileIds: prayerImages.fileIds,
  createdBy: prayerImages.createdBy,
  createdAt: prayerImages.createdAt,
  authorName: profiles.name,
  authorStatus: profiles.status,
}

export interface PrayerImageRow {
  id: string
  storageKey: string
  mediaType: string
  fileIds: string[]
  createdBy: string
  createdAt: Date
  authorName: string | null
  authorStatus: string | null
}

const imagesQuery = () => useDb()
  .select(prayerImageColumns)
  .from(prayerImages)
  .leftJoin(profiles, eq(prayerImages.createdBy, profiles.userId))

export function prayerImageUrls(id: string) {
  const previewUrl = `/api/peticiones/imagenes/${id}/content`
  return { previewUrl, downloadUrl: `${previewUrl}?download=1` }
}

export function toPrayerGeneratedImage(row: PrayerImageRow): PrayerGeneratedImage {
  return {
    id: row.id,
    ...prayerImageUrls(row.id),
    fileIds: row.fileIds,
    requestCount: row.fileIds.length,
    author: toSongPerson(row.createdBy, row.authorName, row.authorStatus),
    createdAt: row.createdAt.toISOString(),
  }
}

/** Nombre de la descarga: `peticiones-AAAA-MM-DD-<6 del id>.<ext>`, con la fecha en UTC. */
export function prayerImageFilename(row: Pick<PrayerImageRow, 'id' | 'mediaType' | 'createdAt'>): string {
  const extension = PRAYER_IMAGE_EXTENSIONS[row.mediaType] ?? 'png'
  return `peticiones-${row.createdAt.toISOString().slice(0, 10)}-${row.id.slice(0, 6)}.${extension}`
}

export interface SavePrayerImageInput {
  fileIds: string[]
  mediaType: string
  data: Uint8Array
  author: { userId: string, name: string | null, status: string | null }
}

/**
 * Sube la imagen al bucket (`peticiones/<id>.<ext>`) y guarda su fila. Un tipo desconocido es `invalid_output`; un fallo al
 * subir o al guardar es `save_failed` (502) y no deja el objeto suelto.
 */
export async function savePrayerImage({ fileIds, mediaType, data, author }: SavePrayerImageInput): Promise<PrayerGeneratedImage> {
  const extension = PRAYER_IMAGE_EXTENSIONS[mediaType]
  if (!extension) throw prayerError('invalid_output')
  const id = randomUUID()
  const storageKey = key(`peticiones/${id}.${extension}`)
  // Hora del servidor en milisegundos: el cursor del historial compara con la misma precisión.
  const createdAt = new Date()

  try {
    await putObject(storageKey, data, mediaType)
  }
  catch {
    console.error('[prayer-image] save_failed (upload)')
    throw prayerError('save_failed')
  }
  try {
    await useDb().insert(prayerImages).values({ id, storageKey, mediaType, sizeBytes: data.byteLength, fileIds, createdBy: author.userId, createdAt })
  }
  catch {
    console.error('[prayer-image] save_failed (insert)')
    await deleteMany([storageKey]).catch(() => console.error('[prayer-image] orphan object not deleted'))
    throw prayerError('save_failed')
  }
  return toPrayerGeneratedImage({ id, storageKey, mediaType, fileIds, createdBy: author.userId, createdAt, authorName: author.name, authorStatus: author.status })
}

/** Página del historial: keyset sobre `(created_at, id)` descendente, la más reciente primero. */
export async function listPrayerImages({ limit, cursor }: { limit: number, cursor?: string }): Promise<Paginated<PrayerGeneratedImage>> {
  const after = decodePrayerCursor(cursor)
  const rows = await imagesQuery()
    .where(after ? sql`(${prayerImages.createdAt}, ${prayerImages.id}) < (${after.v}::timestamptz, ${after.id}::uuid)` : undefined)
    .orderBy(desc(prayerImages.createdAt), desc(prayerImages.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = rows.length > limit && last ? encodeCursor({ v: last.createdAt.toISOString(), id: last.id }) : null
  return { items: page.map(toPrayerGeneratedImage), nextCursor }
}

export function prayerImageGone() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: PRAYER_IMAGE_GONE_MESSAGE })
}

/** La imagen o 404. */
export async function getPrayerImage(id: string): Promise<PrayerImageRow> {
  const [row] = await imagesQuery().where(eq(prayerImages.id, id)).limit(1)
  if (!row) throw prayerImageGone()
  return row
}

/** Solo comprueba que exista (para agregarla a una colección). */
export async function prayerImageExists(id: string): Promise<boolean> {
  const [row] = await useDb().select({ id: prayerImages.id }).from(prayerImages).where(eq(prayerImages.id, id)).limit(1)
  return !!row
}

/** Eliminar: quien la generó o quien tiene `prayers.moderate` (admin). */
export function canManagePrayerImage(me: { userId: string, role: Role | null }, image: { createdBy: string }): boolean {
  return image.createdBy === me.userId || can(me.role, 'prayers.moderate')
}

/** Borra la fila (sus elementos de colección caen en cascada) y después el objeto. 404 si no existe, 403 si no es tuya. */
export async function deletePrayerImage(id: string, me: { userId: string, role: Role | null }): Promise<void> {
  const row = await getPrayerImage(id)
  if (!canManagePrayerImage(me, row)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: FORBIDDEN_PRAYER_IMAGE_MESSAGE })
  }
  await useDb().delete(prayerImages).where(eq(prayerImages.id, id))
  await deleteMany([row.storageKey]).catch(() => console.error('[prayer-image] object not deleted'))
}

/**
 * Limpieza diaria: imágenes de más de 30 días que no están en ninguna colección, en lotes de 500; primero las filas y
 * luego sus objetos. Devuelve cuántas se borraron.
 */
export async function purgeExpiredPrayerImages(): Promise<number> {
  let total = 0
  for (;;) {
    const expired = await useDb().delete(prayerImages)
      .where(sql`${prayerImages.id} IN (
        SELECT p.id FROM prayer_images p
        WHERE p.created_at < now() - make_interval(days => ${PRAYER_IMAGE_RETENTION_DAYS}::int)
          AND NOT EXISTS (SELECT 1 FROM prayer_image_collection_items i WHERE i.image_id = p.id)
        LIMIT ${PURGE_BATCH}
      )`)
      .returning({ storageKey: prayerImages.storageKey })
    if (expired.length > 0) await deleteMany(expired.map(row => row.storageKey))
    total += expired.length
    if (expired.length < PURGE_BATCH) break
  }
  return total
}
