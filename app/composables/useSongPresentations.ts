// Cola de presentaciones de Canciones (feature 006, research D10): una canción por petición y de una en una, para no saturar
// el servicio gratuito ni exceder el plazo de una función. La cola vive en `useState('songs-presentations')` y la mueve el
// propio estado (`pump`, como `useYoutubeDriveImport`): no se queda colgada ni se filtra entre pruebas. Los `AbortController`
// y los `objectURL` no son serializables: van en mapas del módulo. Al terminar, el archivo se conserva para **Descargar de
// nuevo** (el navegador puede bloquear descargas seguidas) y se libera al **Descartar**.
import { FetchError } from 'ofetch'
import type { SongPresentationMeta } from '#shared/types/api'
import { SONG_PRESENTATION_TIMEOUT_MS } from '#shared/constants/songs'

export type PresentationStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface PresentationItem {
  songId: string
  title: string
  status: PresentationStatus
  slides?: number | null
  arrangedBy?: SongPresentationMeta['arrangedBy']
  filename?: string
  error?: string
  errorCode?: string | null
  /** Solo los fallos transitorios (503, 504 de Vercel, red, plazo) ofrecen **Reintentar** (FR-017). */
  retryable?: boolean
}

const ACTIVE: readonly PresentationStatus[] = ['queued', 'running']

class Canceled extends Error {}
class TimedOut extends Error {}

const controllers = new Map<string, AbortController>()
const files = new Map<string, { url: string, filename: string }>()

/** Con `responseType: 'blob'` el cuerpo JSON de un error también llega como `Blob`: se lee para que `serverMessage` lo vea. */
async function readBlobError(error: unknown): Promise<unknown> {
  // `FetchError.data` es un getter de `response._data`: se reemplaza ahí.
  const response = error instanceof FetchError ? error.response as (Response & { _data?: unknown }) | undefined : undefined
  if (response && typeof Blob !== 'undefined' && response._data instanceof Blob) {
    try {
      response._data = JSON.parse(await response._data.text())
    }
    catch {
      response._data = undefined
    }
  }
  return error
}

export function useSongPresentations() {
  const api = useApi()
  const toast = useToast()
  const items = useState<PresentationItem[]>('songs-presentations', () => [])
  /** Descargas disparadas desde que la cola empezó a trabajar (para avisar del bloqueo de descargas seguidas). */
  const delivered = useState('songs-presentations-delivered', () => 0)
  const m = messages.songs.present

  const find = (songId: string) => items.value.find(item => item.songId === songId)

  function patch(songId: string, changes: Partial<PresentationItem>) {
    items.value = items.value.map(item => (item.songId === songId ? { ...item, ...changes } : item))
  }

  function remove(songId: string) {
    items.value = items.value.filter(item => item.songId !== songId)
    revokeDownload(files.get(songId)?.url)
    files.delete(songId)
  }

  async function run(item: PresentationItem) {
    const controller = new AbortController()
    controllers.set(item.songId, controller)
    const timer = setTimeout(() => controller.abort(new TimedOut()), SONG_PRESENTATION_TIMEOUT_MS)
    try {
      // `$api` no expone `.raw`: las cabeceras se leen en `onResponse`.
      let headers: Headers | null = null
      const request = api<Blob>(`/api/songs/${item.songId}/pptx`, {
        method: 'POST',
        responseType: 'blob',
        signal: controller.signal,
        onResponse: ({ response }) => {
          headers = response.headers
        },
      })
      // Cancelar o vencer el plazo libera la cola aunque el transporte no respete la señal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      request.catch(() => {})
      const blob = await Promise.race([request, aborted])
      if (!(blob instanceof Blob)) throw new Error('sin archivo')
      const header = (name: string) => (headers as Headers | null)?.get(name) ?? null
      const slidesHeader = header('x-slide-count')
      const slides = slidesHeader !== null && slidesHeader !== '' && Number.isInteger(Number(slidesHeader)) ? Number(slidesHeader) : null
      const arranged = header('x-lyrics-arranged-by')
      const arrangedBy = arranged === 'llm' || arranged === 'fallback' ? arranged : null
      const file = downloadBlob(blob, header('content-disposition'), `${safeFilename(item.title)}.pptx`)
      files.set(item.songId, file)
      patch(item.songId, { status: 'done', slides, arrangedBy, filename: file.filename, error: undefined, errorCode: null, retryable: false })
      toast.success(`${item.title}: ${m.done(slides)}`)
      if (arrangedBy === 'fallback') toast.info(m.fallback)
      delivered.value += 1
      if (delivered.value === 2) toast.info(m.blocked)
    }
    catch (error) {
      const reason = controller.signal.reason
      if (reason instanceof Canceled) {
        patch(item.songId, { status: 'canceled', error: undefined, retryable: false })
        toast.info(m.cancelled)
        return
      }
      if (reason instanceof TimedOut) {
        patch(item.songId, { status: 'failed', error: m.timeout, errorCode: null, retryable: true })
        return
      }
      await readBlobError(error)
      patch(item.songId, {
        status: 'failed',
        error: songErrorMessage(error, m.failed, m.timeout),
        errorCode: songErrorCode(error),
        retryable: isTransientSongError(error),
      })
    }
    finally {
      clearTimeout(timer)
      controllers.delete(item.songId)
    }
  }

  /** La cola vive en el estado: arranca la siguiente «en cola» si ninguna está corriendo. */
  function pump() {
    if (items.value.some(item => item.status === 'running')) return
    const next = items.value.find(item => item.status === 'queued')
    if (!next) {
      delivered.value = 0
      return
    }
    patch(next.songId, { status: 'running' })
    void run(next).finally(pump)
  }

  /**
   * Encola una presentación por canción. Una canción que ya está en cola o generándose se ignora (doble clic = una sola
   * petición, FR-019); una terminada, fallida o cancelada vuelve a la cola. Devuelve cuántas se encolaron.
   */
  function enqueue(songs: readonly { id: string, title: string }[]): number {
    let queued = 0
    for (const song of songs) {
      const current = find(song.id)
      if (current && ACTIVE.includes(current.status)) continue
      if (current) remove(song.id)
      items.value = [...items.value, { songId: song.id, title: song.title, status: 'queued' }]
      queued++
    }
    pump()
    return queued
  }

  /** En cola: sale de la cola. Generándose: se aborta y la cola sigue con la siguiente. */
  function cancel(songId: string) {
    const current = find(songId)
    if (!current) return
    if (current.status === 'queued') {
      remove(songId)
      toast.info(m.cancelled)
      return
    }
    if (current.status === 'running') controllers.get(songId)?.abort(new Canceled())
  }

  function retry(songId: string) {
    const current = find(songId)
    if (current?.status !== 'failed' || !current.retryable) return
    patch(songId, { status: 'queued', error: undefined, errorCode: null })
    pump()
  }

  /** Vuelve a descargar el archivo ya generado, sin otra petición. */
  function redownload(songId: string) {
    const file = files.get(songId)
    if (file) triggerDownload(file.url, file.filename)
  }

  /** Quita de la bandeja una fila que ya no está activa y libera su archivo. */
  function dismiss(songId: string) {
    const current = find(songId)
    if (!current || ACTIVE.includes(current.status)) return
    remove(songId)
  }

  return {
    items,
    enqueue,
    cancel,
    retry,
    redownload,
    dismiss,
    filesFor: (n: number) => m.filesCount(n),
    /** La canción tiene una presentación en cola o generándose. */
    isBusy: (songId: string) => ACTIVE.includes(find(songId)?.status ?? 'done'),
    canRedownload: (songId: string) => files.has(songId) && find(songId)?.status === 'done',
    hasItems: computed(() => items.value.length > 0),
  }
}
