// Lote de presentaciones de Canciones: hasta `SONG_PRESENTATION_BATCH_MAX` canciones en una sola petición
// (`POST /api/songs/presentations`) y un solo `.zip`. Es la lógica sin interfaz: quien la use decide cómo mostrar `items`.
// Éxito parcial: `ok: true` aunque alguna canción haya fallado (su `errorCode` y `message` lo dicen); `ok: false` si no
// salió ninguna o falló todo el lote (servicio despertando, plazo, etc.). `pending` vive en `useState`: todas las instancias
// ven el mismo lote en curso (doble clic = una sola petición, también entre componentes). El `objectURL` del `.zip` no es
// serializable: va en una variable del módulo, hay a lo sumo uno en memoria, se conserva para **Descargar de nuevo** y se
// libera solo con `release()` o al pedir otro lote (nunca al desmontar un componente: otro puede seguir ofreciéndolo).
import { FetchError } from 'ofetch'
import type { SongPresentationBatchItem } from '#shared/types/api'
import {
  SONG_PRESENTATION_BATCH_MAX,
  SONG_PRESENTATION_BATCH_TIMEOUT_MS,
  SONG_PRESENTATION_ITEM_ERRORS,
  SONG_PRESENTATION_ITEM_MESSAGES,
  SONG_PRESENTATION_ZIP_NAME,
} from '#shared/constants/songs'

/** Resultado de una canción con su texto en español cuando falló. */
export interface PresentationBatchResult extends SongPresentationBatchItem {
  message: string | null
}

export type PresentationBatchOutcome =
  | { ok: true, items: PresentationBatchResult[], file: { url: string, filename: string } }
  | { ok: false, items: PresentationBatchResult[], error: string, retryable: boolean }

const STATUSES: readonly SongPresentationBatchItem['status'][] = ['done', 'failed']

function toResult(raw: unknown): PresentationBatchResult | null {
  const item = (raw ?? {}) as Record<string, unknown>
  if (typeof item.songId !== 'string' || !STATUSES.includes(item.status as SongPresentationBatchItem['status'])) return null
  const done = item.status === 'done'
  const code = SONG_PRESENTATION_ITEM_ERRORS.find(c => c === item.errorCode) ?? (done ? null : 'invalid')
  return {
    songId: item.songId,
    status: done ? 'done' : 'failed',
    filename: done && typeof item.filename === 'string' ? item.filename : null,
    slideCount: done && typeof item.slideCount === 'number' ? item.slideCount : null,
    arrangedBy: done && (item.arrangedBy === 'llm' || item.arrangedBy === 'fallback') ? item.arrangedBy : null,
    errorCode: code,
    message: code ? SONG_PRESENTATION_ITEM_MESSAGES[code] : null,
  }
}

function toResults(value: unknown): PresentationBatchResult[] {
  return Array.isArray(value) ? value.flatMap(item => toResult(item) ?? []) : []
}

/** Cabecera `X-Song-Presentations` (JSON con `encodeURIComponent`); rota o ausente → lista vacía. */
export function parsePresentationsHeader(header: string | null | undefined): PresentationBatchResult[] {
  if (!header) return []
  try {
    return toResults(JSON.parse(decodeURIComponent(header)))
  }
  catch {
    return []
  }
}

class TimedOut extends Error {}

/** `objectURL` del último `.zip` (a lo sumo uno): no es serializable, así que no va en `useState`. */
let lastUrl: string | null = null

export function useSongPresentationBatch() {
  const api = useApi()
  const m = messages.songs.present
  const pending = useState('songs-presentation-batch-pending', () => false)

  function release() {
    revokeDownload(lastUrl)
    lastUrl = null
  }

  /**
   * Genera y descarga el `.zip` de `songIds` (1–3; los repetidos cuentan una vez). Mientras hay un lote en curso, otra
   * llamada no hace nada y devuelve `null` (doble clic = una sola petición).
   */
  async function generate(songIds: readonly string[]): Promise<PresentationBatchOutcome | null> {
    const ids = [...new Set(songIds)]
    if (pending.value || ids.length === 0 || ids.length > SONG_PRESENTATION_BATCH_MAX) return null
    pending.value = true
    release()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new TimedOut()), SONG_PRESENTATION_BATCH_TIMEOUT_MS)
    let headers: Headers | null = null
    try {
      const request = api<Blob>('/api/songs/presentations', {
        method: 'POST',
        body: { songIds: ids },
        responseType: 'blob',
        signal: controller.signal,
        onResponse: ({ response }) => {
          headers = response.headers
        },
      })
      // Vencer el plazo suelta la petición aunque el transporte no respete la señal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      request.catch(() => {})
      const blob = await Promise.race([request, aborted])
      if (!(blob instanceof Blob)) throw new Error('sin archivo')
      const header = (name: string) => (headers as Headers | null)?.get(name) ?? null
      const items = parsePresentationsHeader(header('x-song-presentations'))
      const file = downloadBlob(blob, header('content-disposition'), SONG_PRESENTATION_ZIP_NAME)
      lastUrl = file.url
      return { ok: true, items, file }
    }
    catch (error) {
      if (controller.signal.reason instanceof TimedOut) return { ok: false, items: [], error: m.timeout, retryable: true }
      await readBlobError(error)
      // 422 `presentations_failed`: ninguna salió, pero cada canción dice por qué.
      const data = error instanceof FetchError ? (error.data as { data?: { items?: unknown } } | undefined)?.data : undefined
      return {
        ok: false,
        items: toResults(data?.items),
        error: songErrorMessage(error, m.failed, m.timeout),
        retryable: isTransientSongError(error),
      }
    }
    finally {
      clearTimeout(timer)
      pending.value = false
    }
  }

  /** Vuelve a descargar el último `.zip` sin otra petición. */
  function redownload(filename: string = SONG_PRESENTATION_ZIP_NAME) {
    if (lastUrl) triggerDownload(lastUrl, filename)
  }

  return { pending: readonly(pending), generate, redownload, release }
}
