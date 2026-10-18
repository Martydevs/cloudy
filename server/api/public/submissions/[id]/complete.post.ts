// Fase 2 del envío de un invitado: verifica cada archivo (tamaño real y firma), descarta los
// inválidos y cierra el envío con `completed_at`, que dispara el aviso en vivo (T120a).
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, getRequestIP } from 'h3'
import { guestSubmissionFiles, guestSubmissions } from '../../../../db/schema'
import { deleteMany, head, readRange } from '../../../../utils/storage'

export default defineEventHandler(async (event): Promise<{ status: 'pending', accepted: number, rejected: number }> => {
  // El id del envío es la capacidad (no hay sesión); el límite por IP, holgado para un invitado
  // legítimo (un cierre por envío, 5 envíos/h), frena a quien lo use para leer el bucket a ciegas.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  await hitRateLimit(event, `guest-complete:${hashSender(ip)}`, { limit: 10, windowSec: 3600 })

  const id = paramId(event)
  const db = useDb()

  const [submission] = await db.select().from(guestSubmissions).where(eq(guestSubmissions.id, id)).limit(1)
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío no existe' })
  if (submission.status !== 'pending' || submission.completedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue cerrado' })
  }

  const files = await db.select().from(guestSubmissionFiles).where(and(
    eq(guestSubmissionFiles.submissionId, id),
    eq(guestSubmissionFiles.uploadStatus, 'uploading'),
  ))

  const accepted: string[] = []
  const rejected: string[] = []
  for (const file of files) {
    const object = await head(file.storageKey)
    const ok = !!object
      && object.size === Number(file.sizeBytes)
      && matchesSignature(file.extension, await readRange(file.storageKey, 0, 4095))
    if (ok) accepted.push(file.id)
    else rejected.push(file.id)
  }

  // Sin huérfanos (Constitución II): los objetos y filas inválidos se eliminan.
  if (rejected.length > 0) {
    await deleteMany(files.filter(f => rejected.includes(f.id)).map(f => f.storageKey))
    await db.delete(guestSubmissionFiles).where(inArray(guestSubmissionFiles.id, rejected))
  }

  if (accepted.length === 0) {
    await db.delete(guestSubmissions).where(eq(guestSubmissions.id, id))
    throw createError({
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: 'Ningún archivo llegó completo o con un formato válido. Vuelve a intentarlo.',
    })
  }

  await db.batch([
    db.update(guestSubmissionFiles).set({ uploadStatus: 'ready' }).where(inArray(guestSubmissionFiles.id, accepted)),
    db.update(guestSubmissions).set({ completedAt: new Date() }).where(and(eq(guestSubmissions.id, id), isNull(guestSubmissions.completedAt))),
  ])

  return { status: 'pending', accepted: accepted.length, rejected: rejected.length }
})
