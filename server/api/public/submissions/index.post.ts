// Fase 1 del envío de un invitado (FR-016, FR-020): límite por IP, validación, registro y URLs firmadas.
import { randomUUID } from 'node:crypto'
import { createError, getRequestIP } from 'h3'
import { canonicalMime, categoryOf, getExtension } from '#shared/constants/files'
import { checkUploadFile, sanitizeFileName } from '#shared/validation/files'
import { submissionInput } from '#shared/validation/submissions'
import { guestSubmissionFiles, guestSubmissions } from '../../../db/schema'
import { key, presignPut } from '../../../utils/storage'

export interface GuestUploadTicket {
  fileId: string
  uploadUrl: string
  headers: Record<string, string>
}

export default defineEventHandler(async (event): Promise<{ submissionId: string, uploads: GuestUploadTicket[] }> => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const senderKey = hashSender(ip)
  await hitRateLimit(event, `guest:${senderKey}`, { limit: 5, windowSec: 3600 })

  const raw = (await readBody<Record<string, unknown> | null>(event).catch(() => null)) ?? {}
  const rawFiles: Record<string, unknown>[] = Array.isArray(raw.files) ? raw.files : []
  // 413 / 415 por archivo antes que el resto de la validación, igual que en /api/uploads.
  const cleaned = rawFiles.map((f) => {
    const file: Record<string, unknown> = f && typeof f === 'object' ? f : {}
    return {
      name: sanitizeFileName(typeof file.name === 'string' ? file.name : ''),
      size: typeof file.size === 'number' ? file.size : 0,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    }
  })
  for (const file of cleaned) {
    const problem = checkUploadFile({ name: file.name, size: file.size, type: file.mimeType })
    if (problem) {
      throw createError({ statusCode: problem.code, statusMessage: problem.code === 413 ? 'Payload Too Large' : 'Unsupported Media Type', message: problem.message })
    }
  }
  const input = unwrap(submissionInput({ ...raw, files: cleaned }))

  const submissionId = randomUUID()
  const rows = input.files.map((file) => {
    const ext = getExtension(file.name)
    return {
      id: randomUUID(),
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
    db.insert(guestSubmissions).values({ id: submissionId, senderName: input.senderName, note: input.note ?? null, senderKey }),
    db.insert(guestSubmissionFiles).values(rows),
  ])

  const uploads = await Promise.all(rows.map(async row => ({
    fileId: row.id,
    uploadUrl: await presignPut(row.storageKey, { contentType: row.mimeType, contentLength: row.sizeBytes }),
    headers: { 'content-type': row.mimeType },
  })))

  setResponseStatus(event, 201)
  return { submissionId, uploads }
})
