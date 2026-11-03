// Validadores de la página YouTube (feature 005, contracts/api.md § Validadores) y lectura del enlace pegado
// (research D13). Cliente y servidor usan las mismas reglas.
import {
  YOUTUBE_FORMAT_VALUES,
  YOUTUBE_HISTORY_MAX_LIMIT,
  YOUTUBE_HISTORY_PAGE,
  YOUTUBE_MAX_BATCH,
  YOUTUBE_PLAYLIST_NAME_MAX,
  YOUTUBE_VIDEO_ID_RE,
} from '../constants/youtube'
import type { Field } from './core'
import { int, object, oneOf, optional, REQUIRED_MESSAGE, str } from './core'

export const VIDEO_ID_MESSAGE = 'Identificador de video no válido'

/** ID de video de YouTube: 11 caracteres `A-Z a-z 0-9 _ -`. */
export function youtubeVideoId(): Field<string> {
  return input => (typeof input === 'string' && YOUTUBE_VIDEO_ID_RE.test(input))
    ? { ok: true, value: input }
    : { ok: false, error: VIDEO_ID_MESSAGE }
}

/** 1–`YOUTUBE_MAX_BATCH` IDs válidos; los repetidos se quitan conservando el orden. */
function videoIdList(): Field<string[]> {
  const id = youtubeVideoId()
  return (input) => {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Elige al menos un video' }
    const ids: string[] = []
    for (const item of input) {
      const res = id(item)
      if (!res.ok) return res
      if (!ids.includes(res.value)) ids.push(res.value)
    }
    if (ids.length > YOUTUBE_MAX_BATCH) return { ok: false, error: `Puedes descargar como máximo ${YOUTUBE_MAX_BATCH} videos a la vez` }
    return { ok: true, value: ids }
  }
}

export const playlistName = () => str({ max: YOUTUBE_PLAYLIST_NAME_MAX })

export const youtubeJobInput = object({
  videoIds: videoIdList(),
  format: oneOf(YOUTUBE_FORMAT_VALUES as readonly ['mp4_720', 'mp4_1080', 'mp3'], 'Formato no válido'),
})

export const youtubePlaylistInput = object({
  name: playlistName(),
  videoId: optional(youtubeVideoId()),
})

export const youtubePlaylistRename = object({ name: playlistName() })

export const youtubePlaylistItemInput = object({ videoId: youtubeVideoId() })

/** `limit` 1–48 (24 por defecto), `cursor` keyset opcional y `exclude` (el video de la ficha) opcional. */
export const youtubeHistoryQuery = object({
  limit: (input: unknown) => {
    const res = optional(int({ min: 1, max: YOUTUBE_HISTORY_MAX_LIMIT }))(input)
    return res.ok ? { ok: true as const, value: res.value ?? YOUTUBE_HISTORY_PAGE } : res
  },
  cursor: optional(str({ max: 500 })),
  exclude: optional(youtubeVideoId()),
})

// ---------------------------------------------------------------- enlace pegado

export type YoutubeUrlReason = 'not_url' | 'not_youtube' | 'playlist' | 'channel' | 'no_video' | 'bad_id'
export type YoutubeUrlResult = { ok: true, videoId: string } | { ok: false, reason: YoutubeUrlReason }

/** Texto del campo por motivo de rechazo (`youtubeUrlSchema` y la página). */
export const YOUTUBE_URL_MESSAGES: Record<YoutubeUrlReason | 'required', string> = {
  required: REQUIRED_MESSAGE,
  not_url: 'Pega un enlace completo, por ejemplo https://youtu.be/…',
  not_youtube: 'Solo aceptamos enlaces de YouTube',
  playlist: 'Ese enlace es de una lista de YouTube. Pega el de un video.',
  channel: 'Ese enlace es de un canal de YouTube. Pega el de un video.',
  no_video: 'Ese enlace no lleva a un video. Abre el video en YouTube y copia su enlace.',
  bad_id: 'El enlace está incompleto. Cópialo de nuevo desde YouTube.',
}

/** Hosts permitidos: se comparan exactos, nunca con `includes` (`evil-youtube.com` no pasa). */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
const SHORT_HOST = 'youtu.be'
/** Rutas `/<prefijo>/<id>`. */
const ID_PATHS = new Set(['shorts', 'embed', 'live', 'v'])
const CHANNEL_PATHS = new Set(['channel', 'c', 'user'])

const fail = (reason: YoutubeUrlReason): YoutubeUrlResult => ({ ok: false, reason })

function withId(id: string | undefined | null): YoutubeUrlResult {
  if (!id) return fail('no_video')
  return YOUTUBE_VIDEO_ID_RE.test(id) ? { ok: true, videoId: id } : fail('bad_id')
}

/**
 * Lee el ID de video de un enlace de YouTube (`watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `/v/`), con o
 * sin `https://`. Ignora `t`, `list`, `si`, `feature`, etc. Un ID suelto sin URL no se acepta: así un texto libre de
 * 11 caracteres no se confunde con un video.
 */
export function parseYoutubeUrl(text: unknown): YoutubeUrlResult {
  if (typeof text !== 'string') return fail('not_url')
  const value = text.trim()
  if (value === '' || /\s/.test(value)) return fail('not_url')

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  // Sin esquema solo vale algo con forma de dominio y ruta («youtu.be/…», «youtube.com/watch?v=…»).
  if (!hasScheme && !/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]|$)/i.test(value)) return fail('not_url')

  let url: URL
  try {
    url = new URL(hasScheme ? value : `https://${value}`)
  }
  catch {
    return fail('not_url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('not_url')

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === SHORT_HOST) return withId(segments[0])
  if (!YOUTUBE_HOSTS.has(host)) return fail('not_youtube')

  const [first, second] = segments
  if (first === 'watch') {
    const id = url.searchParams.get('v')
    if (id) return withId(id)
    return fail('no_video')
  }
  if (first === 'playlist') return fail('playlist')
  if (first?.startsWith('@') || (first && CHANNEL_PATHS.has(first))) return fail('channel')
  if (first && ID_PATHS.has(first)) return withId(second)
  return fail('no_video')
}
