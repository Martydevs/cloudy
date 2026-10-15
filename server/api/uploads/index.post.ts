// Fase 1 de la subida (research R5): valida, reserva el registro y firma el PUT directo al bucket.
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { UploadTicket } from '#shared/types/api'
import { canonicalMime, categoryOf, getExtension } from '#shared/constants/files'
import { checkUploadFile, sanitizeFileName, uploadInput } from '#shared/validation/files'
import { files } from '../../db/schema'
import { key, presignPut } from '../../utils/storage'

export default defineEventHandler(async (event): Promise<UploadTicket> => {
  const { profile } = requireRole(event, 'editor')
  const body: Record<string, unknown> = (await readBody<Record<string, unknown> | null>(event).catch(() => null)) ?? {}
  const name = sanitizeFileName(typeof body.name === 'string' ? body.name : '')

  // 413 / 415 antes que el resto de la validación (FR-009, FR-010).
  const problem = checkUploadFile({
    name,
    size: typeof body.size === 'number' ? body.size : 0,
    type: typeof body.mimeType === 'string' ? body.mimeType : '',
  })
  if (problem) {
    const statusMessage = problem.code === 413 ? 'Payload Too Large' : 'Unsupported Media Type'
    throw createError({ statusCode: problem.code, statusMessage, message: problem.message })
  }

  const input = unwrap(uploadInput({ ...body, name }))
  if (input.folderId) await getVisibleFolder(input.folderId)

  const ext = getExtension(input.name)
  const mimeType = canonicalMime(ext, input.mimeType)
  const id = randomUUID()
  const storageKey = key(`files/${id}`)

  await useDb().insert(files).values({
    id,
    folderId: input.folderId,
    name: input.name,
    extension: ext,
    mimeType,
    category: categoryOf(ext)!,
    sizeBytes: input.size,
    storageKey,
    uploadStatus: 'uploading',
    origin: 'team',
    uploadedBy: profile.userId,
  })

  const [uploadUrl, thumbUploadUrl] = await Promise.all([
    presignPut(storageKey, { contentType: mimeType, contentLength: input.size }),
    input.withThumbnail ? presignPut(key(`thumbs/${id}.webp`), { contentType: 'image/webp' }) : undefined,
  ])

  setResponseStatus(event, 201)
  return {
    fileId: id,
    uploadUrl,
    ...(thumbUploadUrl ? { thumbUploadUrl } : {}),
    headers: { 'content-type': mimeType },
  }
})
