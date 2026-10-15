// Fase 2 de la subida: comprueba tamaño real y firma binaria, registra la miniatura y publica el archivo.
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { FileItem } from '#shared/types/api'
import { files } from '../../../db/schema'
import { deleteMany, head, readRange } from '../../../utils/storage'

export default defineEventHandler(async (event): Promise<FileItem> => {
  const { profile } = requireRole(event, 'editor')
  const row = await getOwnUpload(paramId(event, 'fileId'), profile.userId)

  const object = await head(row.storageKey)
  if (!object) {
    throw createError({ statusCode: 422, statusMessage: 'Upload missing', message: 'No recibimos el archivo. Vuelve a subirlo.' })
  }
  if (object.size !== Number(row.sizeBytes)) {
    await discardUpload(row)
    throw createError({ statusCode: 422, statusMessage: 'Size mismatch', message: 'El archivo llegó incompleto. Vuelve a subirlo.' })
  }
  if (!matchesSignature(row.extension, await readRange(row.storageKey, 0, 4095))) {
    await discardUpload(row)
    throw createError({ statusCode: 422, statusMessage: 'Signature mismatch', message: 'El contenido no corresponde al tipo de archivo' })
  }

  // La miniatura es opcional: si no llegó o es demasiado grande se usa el ícono de la categoría.
  const thumbKey = thumbKeyFor(row.id)
  const thumb = await head(thumbKey)
  const validThumb = thumb && thumb.size > 0 && thumb.size <= MAX_THUMB_BYTES
  if (thumb && !validThumb) await deleteMany([thumbKey])

  const db = useDb()
  const updated = await retryOnUniqueViolation(async () => {
    const finalName = withSuffix(row.name, await takenNames('file', row.folderId, row.name, row.id))
    const [rows] = await db.batch([
      db.update(files)
        .set({ name: finalName, uploadStatus: 'ready', thumbKey: validThumb ? thumbKey : null, updatedAt: new Date() })
        .where(eq(files.id, row.id))
        .returning(),
      activityInsert(profile, 'file.upload', { type: 'file', id: row.id, label: finalName }, { size: Number(row.sizeBytes) }),
    ])
    return rows[0]!
  })

  return toFileItem({ ...updated, uploaderName: profile.name })
})
