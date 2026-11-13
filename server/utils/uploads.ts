// Subidas del equipo en curso: búsqueda del registro y limpieza ante fallos (sin huérfanos, Constitución II).
// También la copia JPEG de los HEIC: se conserva aunque la lectura de texto de la feature 002 se retirara.
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { MAX_IMAGE_TEXT_BYTES } from '#shared/constants/image-text'
import { files, guestSubmissionFiles } from '../db/schema'
import { matchesSignature } from './file-signature'
import { deleteMany, head, key, readRange } from './storage'

export const MAX_THUMB_BYTES = 1_048_576

export function thumbKeyFor(fileId: string): string {
  return key(`thumbs/${fileId}.webp`)
}

/** Copia JPEG de una HEIC (research A4 de la feature 002); derivada del id, como la miniatura. */
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

/** Tabla donde vive la imagen: la del equipo o la de un envío de invitado. */
export type TextSourceTable = 'files' | 'guest_submission_files'
export interface TextSourceTarget { table: TextSourceTable, id: string }

/**
 * Valida la copia JPEG de una HEIC al completar la subida (research A4): 0 < tamaño ≤ 5 MB y firma JPEG.
 * Válida → se guarda en `text_source_key`, para que la limpieza diaria la borre junto al original; ausente o
 * inválida → se borra el objeto si existe. Devuelve si la copia es válida. Nunca lanza.
 */
export async function checkTextSourceCopy(target: TextSourceTarget): Promise<boolean> {
  const sourceKey = textSourceKeyFor(target.id)
  try {
    const object = await head(sourceKey)
    const valid = !!object
      && object.size > 0
      && object.size <= MAX_IMAGE_TEXT_BYTES
      && matchesSignature('jpg', await readRange(sourceKey, 0, 4095))
    if (!valid) {
      if (object) await deleteMany([sourceKey])
      return false
    }
    if (target.table === 'files') {
      await useDb().update(files).set({ textSourceKey: sourceKey }).where(eq(files.id, target.id))
    }
    else {
      await useDb().update(guestSubmissionFiles).set({ textSourceKey: sourceKey }).where(eq(guestSubmissionFiles.id, target.id))
    }
    return true
  }
  catch (error) {
    const name = (error as { name?: unknown } | null)?.name
    console.error(`[uploads] ${target.table}:${target.id} copy check error (${typeof name === 'string' ? name : 'unknown'})`)
    return false
  }
}
