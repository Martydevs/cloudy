// Creación de envíos de invitados (FR-016): el formulario de un solo paso de `/upload`. El limitador se queda en el endpoint.
import { randomUUID } from 'node:crypto'
import { createError, getRequestIP, readBody } from 'h3'
import type { H3Event } from 'h3'
import { canonicalMime, categoryOf, getExtension } from '#shared/constants/files'
import { isImageTextEligible } from '#shared/constants/image-text'
import type { GuestUploadTicket } from '#shared/types/api'
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
  senderName: string
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

/** Registra el envío y sus archivos (`uploading`) y firma un PUT por archivo (más la copia JPEG de cada HEIC apta). */
export async function createGuestSubmission(event: H3Event, input: GuestSubmissionInput): Promise<GuestSubmissionTicket> {
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
  await db.batch([
    db.insert(guestSubmissions).values({ id: submissionId, senderName: input.senderName, note, senderKey }),
    db.insert(guestSubmissionFiles).values(rows),
  ])

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
