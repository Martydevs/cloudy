// Creación de envíos de invitados (FR-016; feature 003, research B4 y B11): un solo camino para el envío abierto
// (`/enviar`) y el envío con permiso (`/upload`). El limitador se queda en cada endpoint.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createError, getRequestIP, readBody } from 'h3'
import type { H3Event } from 'h3'
import { canonicalMime, categoryOf, getExtension } from '#shared/constants/files'
import { isImageTextEligible } from '#shared/constants/image-text'
import type { AccessState, GuestUploadTicket } from '#shared/types/api'
import type { Validator } from '#shared/validation/core'
import { checkUploadFile, sanitizeFileName } from '#shared/validation/files'
import { guestSubmissionFiles, guestSubmissions } from '../db/schema'
import { key, presignPut } from './storage'

export interface GuestFileInput {
  name: string
  size: number
  mimeType: string
  withTextSource?: boolean
}

export interface GuestSubmissionInput {
  /** Solo en el envío abierto; con permiso, el nombre sale de la solicitud. */
  senderName?: string
  note?: string
  files: GuestFileInput[]
}

export interface GuestSubmissionTicket {
  submissionId: string
  uploads: GuestUploadTicket[]
}

/** 413 / 415 por archivo, sin escribir nada. */
function assertUploadable(files: GuestFileInput[]) {
  for (const file of files) {
    const problem = checkUploadFile({ name: file.name, size: file.size, type: file.mimeType })
    if (problem) {
      throw createError({ statusCode: problem.code, statusMessage: problem.code === 413 ? 'Payload Too Large' : 'Unsupported Media Type', message: problem.message })
    }
  }
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
      withTextSource: file.withTextSource === true,
    }
  })
  assertUploadable(cleaned)
  return unwrap(validator({ ...raw, files: cleaned }))
}

/**
 * Registra el envío y sus archivos (`uploading`) y firma un PUT por archivo (más la copia JPEG de cada HEIC apta).
 * Con permiso, todo va en un `db.batch` condicionado a que la solicitud siga aprobada y vigente; si no lo está,
 * no se escribe nada ni se firma ninguna URL y devuelve `{ denied: state }`.
 */
export async function createGuestSubmission(event: H3Event, input: GuestSubmissionInput, opts: { origin: 'link' }): Promise<GuestSubmissionTicket>
export async function createGuestSubmission(event: H3Event, input: GuestSubmissionInput, opts: { origin: 'permission', tokenHash: string }): Promise<GuestSubmissionTicket | { denied: AccessState }>
export async function createGuestSubmission(
  event: H3Event,
  input: GuestSubmissionInput,
  opts: { origin: 'link' } | { origin: 'permission', tokenHash: string },
): Promise<GuestSubmissionTicket | { denied: AccessState }> {
  assertUploadable(input.files)
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const senderKey = hashSender(ip)
  const note = input.note ?? null

  const submissionId = randomUUID()
  const textSources = new Set<string>()
  const rows = input.files.map((file) => {
    const ext = getExtension(file.name)
    const id = randomUUID()
    // Copia JPEG para leer el texto de una HEIC apta (feature 002, research A4).
    if (file.withTextSource && ext === 'heic' && isImageTextEligible({ category: categoryOf(ext)!, extension: ext, size: file.size })) textSources.add(id)
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
  if (opts.origin === 'link') {
    await db.batch([
      db.insert(guestSubmissions).values({ id: submissionId, senderName: input.senderName!, note, senderKey, origin: 'link', accessGrantedBy: null }),
      db.insert(guestSubmissionFiles).values(rows),
    ])
  }
  else {
    // Orden fijo (research B4): envío condicional → archivos solo si el envío existe → reserva al final.
    const { insert, reserve } = permittedSubmissionQueries(opts.tokenHash, { id: submissionId, note, senderKey })
    const values = sql.join(rows.map(r => sql`(
      ${r.id}::uuid, ${r.originalName}::text, ${r.extension}::text, ${r.mimeType}::text, ${r.category}::file_category, ${r.sizeBytes}::bigint, ${r.storageKey}::text
    )`), sql`, `)
    const [created] = await db.batch([
      db.execute<{ id: string }>(insert),
      db.execute(sql`
        INSERT INTO guest_submission_files (id, submission_id, original_name, extension, mime_type, category, size_bytes, storage_key, upload_status)
        SELECT v.id, ${submissionId}::uuid, v.original_name, v.extension, v.mime_type, v.category, v.size_bytes, v.storage_key, 'uploading'::upload_status
        FROM (VALUES ${values}) AS v(id, original_name, extension, mime_type, category, size_bytes, storage_key)
        WHERE EXISTS (SELECT 1 FROM guest_submissions WHERE id = ${submissionId}::uuid)
      `),
      db.execute(reserve),
    ])
    if (created.rows.length === 0) return { denied: await deniedAccessState(opts.tokenHash) }
  }

  const uploads = await Promise.all(rows.map(async (row): Promise<GuestUploadTicket> => {
    const [uploadUrl, textSourceUploadUrl] = await Promise.all([
      presignPut(row.storageKey, { contentType: row.mimeType, contentLength: row.sizeBytes }),
      textSources.has(row.id) ? presignPut(textSourceKeyFor(row.id), { contentType: 'image/jpeg' }) : undefined,
    ])
    return {
      fileId: row.id,
      uploadUrl,
      ...(textSourceUploadUrl ? { textSourceUploadUrl } : {}),
      headers: { 'content-type': row.mimeType },
    }
  }))

  return { submissionId, uploads }
}
