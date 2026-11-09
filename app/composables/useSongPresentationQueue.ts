// Cola del `.zip` de Canciones (contracts/ui.md § Composables): hasta `SONG_PRESENTATION_BATCH_MAX` canciones que se
// generan en un solo archivo con `useSongPresentationBatch()` (el transporte, sin avisos). Este composable es el único dueño
// del estado de la interfaz y el único que avisa (toasts) del lote. Se alimenta desde el modo cola de `/canciones` (cada
// enlace pegado se agrega aquí en vez de abrir la ficha) y desde «Descargar en un .zip» de la barra de selección.
// El estado vive en `useState`: sobrevive a la navegación, no a una recarga (como la bandeja). El resultado guarda solo lo
// serializable; el `objectURL` del `.zip` sigue en el transporte, así que cada invalidación llama a `release()`.
// La cola se conserva tras generar para ofrecer «Descargar de nuevo» y el resultado de cada canción; solo «Vaciar» la vacía.
import type { Song } from '#shared/types/api'
import { SONG_PRESENTATION_BATCH_MAX } from '#shared/constants/songs'
import type { PresentationBatchResult } from './useSongPresentationBatch'

export type QueuedSong = Pick<Song, 'id' | 'title' | 'artist'>

export type BatchResult =
  | { ok: true, filename: string, items: PresentationBatchResult[] }
  | { ok: false, error: string, retryable: boolean, items: PresentationBatchResult[] }

export type QueueAddOutcome = 'added' | 'already' | 'full'

const pick = ({ id, title, artist }: QueuedSong): QueuedSong => ({ id, title, artist })

export function useSongPresentationQueue() {
  const batch = useSongPresentationBatch()
  const toast = useToast()
  const m = messages.songs.present

  const batchMode = useState('songs-presentation-batch-mode', () => false)
  const items = useState<QueuedSong[]>('songs-presentation-batch-queue', () => [])
  const result = useState<BatchResult | null>('songs-presentation-batch-result', () => null)

  const count = computed(() => items.value.length)
  const full = computed(() => count.value >= SONG_PRESENTATION_BATCH_MAX)
  const visible = computed(() => count.value > 0 || result.value !== null)
  const canRedownload = computed(() => result.value?.ok === true)
  /** Presentaciones logradas del último `.zip`; sin el detalle por canción, todas las de la cola. */
  const doneCount = computed(() => {
    const current = result.value
    if (!current?.ok) return 0
    return current.items.length > 0 ? current.items.filter(item => item.status === 'done').length : count.value
  })

  /** El resultado (y su `.zip`) ya no corresponde a la cola. */
  function invalidate() {
    result.value = null
    batch.release()
  }

  function resultOf(songId: string): PresentationBatchResult | null {
    return result.value?.items.find(item => item.songId === songId) ?? null
  }

  /** `'full'` no avisa: quien llama lo muestra junto al campo. */
  function add(song: QueuedSong): QueueAddOutcome {
    if (items.value.some(item => item.id === song.id)) {
      toast.info(m.queueAlready(song.title))
      return 'already'
    }
    if (full.value) return 'full'
    items.value = [...items.value, pick(song)]
    invalidate()
    toast.success(m.queueAdded(song.title))
    return 'added'
  }

  function remove(songId: string) {
    const next = items.value.filter(item => item.id !== songId)
    if (next.length === items.value.length) return
    items.value = next
    invalidate()
  }

  function clear() {
    items.value = []
    invalidate()
  }

  /** Reemplaza la cola (barra de selección); se queda con las primeras `SONG_PRESENTATION_BATCH_MAX`. */
  function replaceWith(songs: readonly QueuedSong[]) {
    items.value = songs.slice(0, SONG_PRESENTATION_BATCH_MAX).map(pick)
    invalidate()
  }

  /** Genera y descarga el `.zip` de la cola. `null` si ya hay un lote en curso o la cola está vacía. */
  async function generate(): Promise<BatchResult | null> {
    if (batch.pending.value || count.value === 0) return null
    result.value = null
    const ids = items.value.map(item => item.id)
    const outcome = await batch.generate(ids)
    if (!outcome) return null
    const next: BatchResult = outcome.ok
      ? { ok: true, filename: outcome.file.filename, items: outcome.items }
      : { ok: false, error: outcome.error, retryable: outcome.retryable, items: outcome.items }
    // Si la cola cambió mientras se generaba (se puede agregar un enlace), el resultado ya no le corresponde.
    const current = items.value.map(item => item.id)
    const stale = current.length !== ids.length || current.some((id, i) => id !== ids[i])
    if (stale) batch.release()
    else result.value = next
    if (outcome.ok) {
      const done = outcome.items.length > 0 ? outcome.items.filter(item => item.status === 'done').length : ids.length
      toast.success(m.zipDone(done))
      if (outcome.items.some(item => item.arrangedBy === 'fallback')) toast.info(m.fallback)
    }
    else {
      toast.error(outcome.error)
    }
    return next
  }

  /** Vuelve a descargar el último `.zip` sin otra petición. */
  function redownload() {
    const current = result.value
    if (current?.ok) batch.redownload(current.filename)
  }

  return {
    batchMode,
    items: readonly(items),
    count,
    full,
    max: SONG_PRESENTATION_BATCH_MAX,
    visible,
    pending: batch.pending,
    result: readonly(result),
    doneCount,
    resultOf,
    canRedownload,
    add,
    remove,
    clear,
    replaceWith,
    generate,
    redownload,
  }
}
