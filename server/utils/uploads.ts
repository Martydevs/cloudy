// Subidas del equipo en curso: búsqueda del registro y limpieza ante fallos (sin huérfanos, Constitución II).
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { files } from '../db/schema'
import { deleteMany, key } from './storage'

export const MAX_THUMB_BYTES = 1_048_576

export function thumbKeyFor(fileId: string): string {
  return key(`thumbs/${fileId}.webp`)
}

/** Copia JPEG de una HEIC para leer su texto (feature 002, research A4); derivada del id, como la miniatura. */
export function textSourceKeyFor(fileId: string): string {
  return key(`textsrc/${fileId}.jpg`)
}

/** Registro `uploading` del usuario, o 404. */
export async function getOwnUpload(fileId: string, userId: string) {
  const [row] = await useDb().select().from(files).where(and(
    eq(files.id, fileId),
    eq(files.uploadStatus, 'uploading'),
    eq(files.uploadedBy, userId),
  )).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La subida no existe o ya terminó' })
  return row
}

/** Borra los objetos y el registro de una subida que no se completará. */
export async function discardUpload(row: { id: string, storageKey: string }) {
  await deleteMany([row.storageKey, thumbKeyFor(row.id), textSourceKeyFor(row.id)])
  await useDb().delete(files).where(and(eq(files.id, row.id), eq(files.uploadStatus, 'uploading')))
}
