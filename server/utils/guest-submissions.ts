// Creación y cierre de envíos (FR-016): el formulario de un solo paso de `/upload` y el alta manual de Peticiones, que
// reutiliza las dos fases con el remitente de la sesión. El limitador se queda en cada endpoint.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, getRequestIP, readBody } from 'h3'
import type { H3Event } from 'h3'
import { canonicalMime, categoryOf, getExtension } from '#shared/constants/files'
import type { GuestUploadTicket } from '#shared/types/api'
import type { Validator } from '#shared/validation/core'
import { checkUploadFile, sanitizeFileName } from '#shared/validation/files'
import { checkPrayerPhoto } from '#shared/validation/prayers'
import { SENDER_NAME_MAX } from '#shared/validation/submissions'
import { guestSubmissionFiles, guestSubmissions } from '../db/schema'
import { deleteMany, head, key, presignPut, readRange } from './storage'

type SubmissionRow = typeof guestSubmissions.$inferSelect
type SubmissionFileRow = typeof guestSubmissionFiles.$inferSelect

export interface GuestFileInput {
  name: string
  size: number
  mimeType: string
}

export interface GuestSubmissionInput {
  senderName: string
  note?: string
  files: GuestFileInput[]
}

export interface GuestSubmissionTicket {
  submissionId: string
  uploads: GuestUploadTicket[]
}

/** 413 / 415 por archivo, sin escribir nada. `check` es la regla: la de cualquier subida o la del alta manual (solo imágenes). */
function assertUploadable(files: GuestFileInput[], check: typeof checkUploadFile = checkUploadFile) {
  for (const file of files) {
    const problem = check({ name: file.name, size: file.size, type: file.mimeType })
    if (problem) {
      throw createError({ statusCode: problem.code, statusMessage: problem.code === 413 ? 'Payload Too Large' : 'Unsupported Media Type', message: problem.message })
    }
  }
}

/** 415 si algún archivo del alta manual de Peticiones no es una imagen, sin escribir nada. */
export function assertPrayerPhotos(files: GuestFileInput[]) {
  assertUploadable(files, checkPrayerPhoto)
}

/** `sender_key` de un alta manual: quién la creó. Solo esa persona puede cerrarla, y nunca coincide con el hash de una IP. */
export const manualSenderKey = (userId: string) => `manual:${userId}`

/** Remitente de un alta manual: el nombre del perfil o, si viniera vacío, la parte local del correo. */
export function manualSenderName(profile: { name: string, email: string }): string {
  return (profile.name.trim() || profile.email.split('@')[0] || profile.email).slice(0, SENDER_NAME_MAX)
}

/** Cuerpo de un envío: nombres saneados y 413 / 415 por archivo antes que el resto de la validación, igual que en /api/uploads. */
export async function readGuestSubmission<T>(event: H3Event, validator: Validator<T>): Promise<T> {
  const raw = (await readBody<Record<string, unknown> | null>(event).catch(() => null)) ?? {}
  const rawFiles: Record<string, unknown>[] = Array.isArray(raw.files) ? raw.files : []
  const cleaned = rawFiles.map((f) => {
    const file: Record<string, unknown> = f && typeof f === 'object' ? f : {}
    return {
      name: sanitizeFileName(typeof file.name === 'string' ? file.name : ''),
      size: typeof file.size === 'number' ? file.size : 0,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    }
  })
  assertUploadable(cleaned)
  return unwrap(validator({ ...raw, files: cleaned }))
}

/**
 * Registra el envío y sus archivos (`uploading`) y firma un PUT por archivo. `senderKey` es el hash de la IP del invitado,
 * salvo en el alta manual (`manualSenderKey`).
 */
export async function createGuestSubmission(
  event: H3Event,
  input: GuestSubmissionInput,
  options: { senderKey?: string } = {},
): Promise<GuestSubmissionTicket> {
  assertUploadable(input.files)
  const senderKey = options.senderKey ?? hashSender(getRequestIP(event, { xForwardedFor: true }) ?? 'unknown')
  const note = input.note ?? null

  const submissionId = randomUUID()
  const rows = input.files.map((file) => {
    const ext = getExtension(file.name)
    const id = randomUUID()
    return {
      id,
      submissionId,
      originalName: file.name,
      extension: ext,
      mimeType: canonicalMime(ext, file.mimeType),
      category: categoryOf(ext)!,
      sizeBytes: file.size,
      storageKey: key(`guest/${submissionId}/${randomUUID()}`),
      uploadStatus: 'uploading' as const,
    }
  })

  const db = useDb()
  await db.batch([
    db.insert(guestSubmissions).values({ id: submissionId, senderName: input.senderName, note, senderKey }),
    db.insert(guestSubmissionFiles).values(rows),
  ])

  const uploads = await Promise.all(rows.map(async (row): Promise<GuestUploadTicket> => {
    const uploadUrl = await presignPut(row.storageKey, { contentType: row.mimeType, contentLength: row.sizeBytes })
    return {
      fileId: row.id,
      uploadUrl,
      headers: { 'content-type': row.mimeType },
    }
  }))

  return { submissionId, uploads }
}

export interface VerifiedSubmission {
  submission: SubmissionRow
  /** Archivos que llegaron completos y con una firma válida; siguen `uploading` hasta que el llamador cierre el envío. */
  accepted: SubmissionFileRow[]
  rejected: number
}

/**
 * Fase 2 de un envío, sin cerrarlo: comprueba cada archivo subido (tamaño real y firma) y elimina los inválidos, objetos y
 * filas (sin huérfanos, Constitución II). Si ninguno es válido borra el envío y responde 422. Con `senderKey`, un envío de
 * otro remitente responde 404 (el alta manual solo la cierra quien la creó).
 */
export async function verifyGuestSubmission(id: string, { senderKey }: { senderKey?: string } = {}): Promise<VerifiedSubmission> {
  const db = useDb()

  const [submission] = await db.select().from(guestSubmissions).where(eq(guestSubmissions.id, id)).limit(1)
  if (!submission || (senderKey !== undefined && submission.senderKey !== senderKey)) {
    throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío no existe' })
  }
  if (submission.status !== 'pending' || submission.completedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue cerrado' })
  }

  const files = await db.select().from(guestSubmissionFiles).where(and(
    eq(guestSubmissionFiles.submissionId, id),
    eq(guestSubmissionFiles.uploadStatus, 'uploading'),
  ))

  const accepted: SubmissionFileRow[] = []
  const rejected: SubmissionFileRow[] = []
  for (const file of files) {
    const object = await head(file.storageKey)
    const ok = !!object
      && object.size === Number(file.sizeBytes)
      && matchesSignature(file.extension, await readRange(file.storageKey, 0, 4095))
    if (ok) accepted.push(file)
    else rejected.push(file)
  }

  if (rejected.length > 0) {
    await deleteMany(rejected.map(f => f.storageKey))
    await db.delete(guestSubmissionFiles).where(inArray(guestSubmissionFiles.id, rejected.map(f => f.id)))
  }

  if (accepted.length === 0) {
    await db.delete(guestSubmissions).where(eq(guestSubmissions.id, id))
    throw createError({
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: 'Ningún archivo llegó completo o con un formato válido. Vuelve a intentarlo.',
    })
  }

  return { submission, accepted, rejected: rejected.length }
}

/** Cierra el envío de un invitado: archivos válidos `ready` y `completed_at`, que dispara el aviso en vivo (T120a). */
export async function completeGuestSubmission(id: string): Promise<{ accepted: number, rejected: number }> {
  const { accepted, rejected } = await verifyGuestSubmission(id)
  const db = useDb()
  await db.batch([
    db.update(guestSubmissionFiles).set({ uploadStatus: 'ready' }).where(inArray(guestSubmissionFiles.id, accepted.map(f => f.id))),
    db.update(guestSubmissions).set({ completedAt: new Date() }).where(and(eq(guestSubmissions.id, id), isNull(guestSubmissions.completedAt))),
  ])
  return { accepted: accepted.length, rejected }
}
