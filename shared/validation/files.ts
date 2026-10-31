// Reglas de carpetas, archivos y subidas (FR-009 a FR-012).
import { FILE_CATEGORIES, MAX_FILE_SIZE, getExtension, isAllowed } from '../constants/files'
import type { Field } from './core'
import { bool, int, nullable, object, oneOf, optional, str, uuid } from './core'

// Se prohíben / \ : * ? " < > | y los caracteres de control.
export const NAME_PATTERN = /^[^/\\:*?"<>|\u0000-\u001F]+$/
const FORBIDDEN_CHARS_GLOBAL = /[/\\:*?"<>|\u0000-\u001F]/g
export const FORBIDDEN_MESSAGE = 'No uses los caracteres / \\ : * ? " < > |'
export const FOLDER_NAME_MAX = 120
export const FILE_NAME_MAX = 200

export const folderName = () => str({ max: FOLDER_NAME_MAX, pattern: NAME_PATTERN, message: FORBIDDEN_MESSAGE })
export const fileName = () => str({ max: FILE_NAME_MAX, pattern: NAME_PATTERN, message: FORBIDDEN_MESSAGE })

/** Destino de un movimiento: ausente = no se mueve · `null` = raíz · uuid = carpeta. */
export function moveTarget(): Field<string | null | undefined> {
  return (input) => {
    if (input === undefined) return { ok: true, value: undefined }
    if (input === null || input === 'root') return { ok: true, value: null }
    return uuid('Carpeta de destino no válida')(input)
  }
}

export const folderInput = object({ name: folderName(), parentId: nullable(uuid('Carpeta no válida')) })

export const folderPatchInput = object(
  { name: optional(folderName()), parentId: moveTarget() },
  raw => raw.name === undefined && raw.parentId === undefined ? { name: 'Indica un nombre nuevo o una carpeta de destino' } : null,
)

export const fileRenameInput = object(
  { name: optional(fileName()), folderId: moveTarget() },
  raw => raw.name === undefined && raw.folderId === undefined ? { name: 'Indica un nombre nuevo o una carpeta de destino' } : null,
)

/** Reemplaza los caracteres prohibidos de nombres que vienen del sistema del usuario. */
export function sanitizeFileName(name: string): string {
  const clean = name.replace(FORBIDDEN_CHARS_GLOBAL, '-').replace(/\s+/g, ' ').trim()
  if (clean.length <= FILE_NAME_MAX) return clean || 'archivo'
  const ext = getExtension(clean)
  const suffix = ext ? `.${ext}` : ''
  return clean.slice(0, FILE_NAME_MAX - suffix.length) + suffix
}

/** Conserva la extensión original al renombrar (la extensión es inmutable). */
export function ensureExtension(name: string, extension: string): string {
  return getExtension(name) === extension.toLowerCase() ? name : `${name}.${extension}`
}

export type UploadProblem = { code: 413 | 415, message: string } | null

/** Validación previa de un archivo, igual en el navegador y en el servidor. */
export function checkUploadFile(file: { name: string, size: number, type: string }): UploadProblem {
  const ext = getExtension(file.name)
  if (!ext || !isAllowed(ext, file.type)) {
    return { code: 415, message: `«${file.name}»: formato no admitido` }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { code: 413, message: `«${file.name}» supera 100 MB` }
  }
  return null
}

export const uploadInput = object(
  {
    folderId: nullable(uuid('Carpeta no válida')),
    name: fileName(),
    size: int({ min: 1, max: MAX_FILE_SIZE, message: 'El tamaño debe estar entre 1 byte y 100 MB' }),
    mimeType: str({ min: 0, max: 255 }),
    withThumbnail: optional(bool()),
    /** Pide el PUT de la copia JPEG de una HEIC apta (feature 002); en otro caso se ignora. */
    withTextSource: optional(bool()),
  },
  (raw) => {
    const name = typeof raw.name === 'string' ? raw.name : ''
    const mime = typeof raw.mimeType === 'string' ? raw.mimeType : ''
    const ext = getExtension(name)
    return name && (!ext || !isAllowed(ext, mime)) ? { name: 'Formato no admitido' } : null
  },
)

export const SORT_KEYS = ['name', 'date', 'size'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const listQuery = object({
  sort: optional(oneOf(SORT_KEYS)),
  dir: optional(oneOf(['asc', 'desc'] as const)),
  type: optional(oneOf(FILE_CATEGORIES)),
  cursor: optional(str({ max: 500 })),
})

export const searchQuery = object({
  q: str({ max: 100 }),
  sort: optional(oneOf(SORT_KEYS)),
  dir: optional(oneOf(['asc', 'desc'] as const)),
  type: optional(oneOf(FILE_CATEGORIES)),
  cursor: optional(str({ max: 500 })),
})
