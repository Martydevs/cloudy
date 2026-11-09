// Validadores de la página Canciones (feature 006, data-model.md § Validadores) y lectura del enlace pegado
// (research D6). Cliente y servidor usan las mismas reglas; en el servidor `parseLetrasUrl` es el filtro contra SSRF.
import type { SongUrlReason } from '../constants/songs'
import { SONG_COLLECTION_NAME_MAX, SONG_HISTORY_MAX_LIMIT, SONG_HISTORY_PAGE, SONG_PRESENTATION_BATCH_MAX } from '../constants/songs'
import type { Field } from './core'
import { int, object, optional, str, uuid } from './core'

export type LetrasUrlResult =
  | { ok: true, url: string, artist: string, slug: string }
  | { ok: false, reason: SongUrlReason }

/** Hosts permitidos: comparación exacta, nunca `includes` (`evil-letras.com` y `letras.com.otro.test` no pasan). */
const LETRAS_HOSTS = new Set(['letras.com', 'www.letras.com'])
const SEGMENT_RE = /^[a-z0-9-]+$/
/** Algo con forma de dominio y ruta pero sin esquema («www.letras.com/a/b/»). */
const SCHEMELESS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]|$)/i

const fail = (reason: SongUrlReason): LetrasUrlResult => ({ ok: false, reason })

/**
 * Lee un enlace de canción de Letras.com y lo normaliza a `https://letras.com/<artista>/<cancion>` (sin `www.`,
 * parámetros, fragmento ni barra final; ruta en minúsculas). Solo `https`, host exacto, sin usuario, contraseña ni puerto
 * y exactamente dos segmentos `[a-z0-9-]`.
 */
export function parseLetrasUrl(text: unknown): LetrasUrlResult {
  if (typeof text !== 'string') return fail('not_url')
  const value = text.trim()
  if (value === '' || /\s/.test(value)) return fail('not_url')

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
  if (!hasScheme) return SCHEMELESS_RE.test(value) ? fail('not_https') : fail('not_url')

  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return fail('not_url')
  }
  if (url.protocol === 'http:') return fail('not_https')
  if (url.protocol !== 'https:') return fail('not_url')
  // El host real decide primero: «https://letras.com@otro.test/…» va a otro.test.
  if (!LETRAS_HOSTS.has(url.hostname.toLowerCase()) || url.port !== '') return fail('not_letras')
  if (url.username !== '' || url.password !== '') return fail('credentials')

  const segments = url.pathname.toLowerCase().split('/').filter(Boolean)
  if (segments.length !== 2 || !segments.every(s => SEGMENT_RE.test(s))) return fail('not_song')
  const [artist, slug] = segments as [string, string]
  return { ok: true, url: `https://letras.com/${artist}/${slug}`, artist, slug }
}

/** Nombre de una colección: 1–80 caracteres tras recortar. */
export const songCollectionName = () => str({ max: SONG_COLLECTION_NAME_MAX })

/** Forma del cuerpo de `POST /api/songs/fetch`; el enlace lo revisa después `parseLetrasUrl` (400 con `reason`). */
export const songUrlInput = object({ url: str({ max: 2048 }) })

export const songCollectionInput = object({
  name: songCollectionName(),
  songId: optional(uuid()),
})

export const songCollectionRename = object({ name: songCollectionName() })

export const songCollectionItemInput = object({ songId: uuid() })

/** `limit` 1–48 (24 por defecto), `cursor` keyset opcional y `exclude` (la canción de la ficha) opcional. */
export const songHistoryQuery = object({
  limit: (input: unknown) => {
    const res = optional(int({ min: 1, max: SONG_HISTORY_MAX_LIMIT }))(input)
    return res.ok ? { ok: true as const, value: res.value ?? SONG_HISTORY_PAGE } : res
  },
  cursor: optional(str({ max: 500 })),
  exclude: optional(uuid()),
})

/** Se aceptan unos pocos repetidos (se quitan), no listas de cualquier largo: el tope se revisa antes de mirar cada id. */
const RAW_ID_LIMIT = SONG_PRESENTATION_BATCH_MAX * 4
const TOO_MANY = `Puedes generar como máximo ${SONG_PRESENTATION_BATCH_MAX} presentaciones a la vez`

/** 1–`SONG_PRESENTATION_BATCH_MAX` ids de canción; los repetidos se quitan conservando el orden. */
function songIdList(): Field<string[]> {
  const id = uuid()
  return (input) => {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Elige al menos una canción' }
    if (input.length > RAW_ID_LIMIT) return { ok: false, error: TOO_MANY }
    const ids: string[] = []
    for (const item of input) {
      const res = id(item)
      if (!res.ok) return res
      if (!ids.includes(res.value)) ids.push(res.value)
    }
    if (ids.length > SONG_PRESENTATION_BATCH_MAX) return { ok: false, error: TOO_MANY }
    return { ok: true, value: ids }
  }
}

/** Cuerpo de `POST /api/songs/presentations`. */
export const songPresentationBatchInput = object({ songIds: songIdList() })
