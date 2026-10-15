// Envíos de invitados (FR-015 a FR-020): nombre, nota y lote de archivos; aprobación y rechazo.
import { MAX_GUEST_FILES } from '../constants/files'
import { array, nullable, object, optional, str, uuid } from './core'
import { uploadInput } from './files'

export const senderName = () => str({ max: 80 })
export const note = () => optional(str({ min: 0, max: 500 }))

/** Un archivo del envío: igual que `uploadInput` pero sin carpeta ni miniatura. */
const guestFile = (input: unknown) => {
  const res = uploadInput({ ...(input && typeof input === 'object' ? input : {}), folderId: null, withThumbnail: false })
  if (res.ok) {
    const { name, size, mimeType } = res.data
    return { ok: true as const, value: { name, size, mimeType } }
  }
  return { ok: false as const, error: Object.values(res.errors)[0] ?? 'Archivo no válido' }
}

export const submissionInput = object({
  senderName: senderName(),
  note: note(),
  files: array(guestFile, { min: 1, max: MAX_GUEST_FILES, label: 'archivos' }),
})

export const approveInput = object({ folderId: nullable(uuid('Carpeta no válida')) })

export const rejectInput = object({ reason: optional(str({ min: 0, max: 300 })) })

export const submissionsQuery = object({
  status: optional(str({ pattern: /^(pending|approved|rejected|expired)$/, message: 'Estado no válido' })),
})
