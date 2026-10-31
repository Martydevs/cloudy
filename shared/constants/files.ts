// Reglas de archivos compartidas por cliente y servidor (FR-009, FR-010).

export const FILE_CATEGORIES = ['image', 'audio', 'video', 'presentation', 'document'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export interface AllowedType {
  /** MIME aceptados; el primero es el canónico que se guarda. */
  mimes: string[]
  category: FileCategory
}

export const ALLOWED_TYPES: Record<string, AllowedType> = {
  jpg: { mimes: ['image/jpeg', 'image/pjpeg'], category: 'image' },
  jpeg: { mimes: ['image/jpeg', 'image/pjpeg'], category: 'image' },
  png: { mimes: ['image/png'], category: 'image' },
  webp: { mimes: ['image/webp'], category: 'image' },
  gif: { mimes: ['image/gif'], category: 'image' },
  heic: { mimes: ['image/heic', 'image/heif'], category: 'image' },
  mp3: { mimes: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'], category: 'audio' },
  wav: { mimes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'], category: 'audio' },
  m4a: { mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'], category: 'audio' },
  aac: { mimes: ['audio/aac', 'audio/x-aac', 'audio/aacp'], category: 'audio' },
  ogg: { mimes: ['audio/ogg', 'application/ogg', 'audio/vorbis'], category: 'audio' },
  mp4: { mimes: ['video/mp4'], category: 'video' },
  mov: { mimes: ['video/quicktime'], category: 'video' },
  pptx: { mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], category: 'presentation' },
  ppt: { mimes: ['application/vnd.ms-powerpoint'], category: 'presentation' },
  key: { mimes: ['application/vnd.apple.keynote', 'application/x-iwork-keynote-sffkey'], category: 'presentation' },
  odp: { mimes: ['application/vnd.oasis.opendocument.presentation'], category: 'presentation' },
  pdf: { mimes: ['application/pdf'], category: 'presentation' },
  txt: { mimes: ['text/plain'], category: 'document' },
  md: { mimes: ['text/markdown', 'text/x-markdown', 'text/plain'], category: 'document' },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], category: 'document' },
}

/** MIME que los navegadores envían cuando no reconocen el tipo; se acepta y se usa el canónico. */
const UNKNOWN_MIMES = new Set(['', 'application/octet-stream'])

export const MAX_FILE_SIZE = 104_857_600 // 100 MB
export const MAX_GUEST_FILES = 20
export const TRASH_RETENTION_DAYS = 30
export const SUBMISSION_TTL_DAYS = 7
export const UPLOAD_ORPHAN_HOURS = 24
export const POLL_INTERVAL_MS = 5000
/**
 * Solape del cursor del pulso: una fila estampada antes de que otro pulso tomara su cursor puede confirmarse después
 * y quedar fuera de `> since`. El cliente descarta los ids que ya avisó.
 */
export const PULSE_OVERLAP_MS = 10_000

/** Extensiones admitidas con punto, para el atributo `accept` de los selectores. */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_TYPES).map(ext => `.${ext}`).join(',')

/** Extensión en minúsculas sin punto, o '' si el nombre no tiene. */
export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function categoryOf(ext: string): FileCategory | null {
  return ALLOWED_TYPES[ext.toLowerCase()]?.category ?? null
}

export function isAllowed(ext: string, mime: string): boolean {
  const type = ALLOWED_TYPES[ext.toLowerCase()]
  if (!type) return false
  const normalized = mime.toLowerCase().split(';')[0]!.trim()
  return UNKNOWN_MIMES.has(normalized) || type.mimes.includes(normalized)
}

/** MIME que se guarda: el declarado si está en la lista, o el canónico de la extensión. */
export function canonicalMime(ext: string, mime: string): string {
  const type = ALLOWED_TYPES[ext.toLowerCase()]
  if (!type) return mime
  const normalized = mime.toLowerCase().split(';')[0]!.trim()
  return type.mimes.includes(normalized) ? normalized : type.mimes[0]!
}
