// Cola del .zip de Canciones: agregar (repetida, llena), cualquier cambio invalida el resultado y suelta el .zip, quitar/vaciar/
// reemplazar (recorta a 3), generar con éxito (resultado, aviso con el conteo y la nota de respaldo), 422 con el porqué de cada
// canción, doble clic = una petición, «Descargar de nuevo» y `canRedownload`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { calls, failFromServer, mockApi, resetCalls } from './helpers/api'

const URL_ = '/api/songs/presentations'
const song = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `Canción ${n}`, artist: n === 1 ? 'Banda' : null })
const S1 = song(1).id
const S2 = song(2).id

const items = [
  { songId: S1, status: 'done', filename: 'Cancion 1.pptx', slideCount: 4, arrangedBy: 'fallback', errorCode: null },
  { songId: S2, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'no_lyrics' },
]

function zip(header: string | null = encodeURIComponent(JSON.stringify(items))) {
  return (event: H3Event) => {
    setResponseHeader(event, 'content-type', 'application/zip')
    setResponseHeader(event, 'content-disposition', 'attachment; filename="canciones.zip"')
    if (header !== null) setResponseHeader(event, 'x-song-presentations', header)
    return Buffer.from([0x50, 0x4B, 5, 6])
  }
}

const toasts = () => useToast().toasts.value.map(t => [t.type, t.message])

let clicks: ReturnType<typeof vi.spyOn>
let revoke: ReturnType<typeof vi.spyOn>
let urls = 0

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
  useState('songs-presentation-batch-pending').value = false
  useState('songs-presentation-batch-mode').value = false
  useState('songs-presentation-batch-queue').value = []
  useState('songs-presentation-batch-result').value = null
  urls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloudy/${++urls}`)
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  useSongPresentationBatch().release()
  vi.restoreAllMocks()
})

describe('useSongPresentationQueue', () => {
  it('agrega con aviso, no repite y no pasa de 3 (llena no avisa: lo muestra quien llama)', () => {
    const queue = useSongPresentationQueue()
    expect(queue.visible.value).toBe(false)
    expect(queue.add({ ...song(1), sourceUrl: 'https://letras.com/a/b' } as ReturnType<typeof song>)).toBe('added')
    // Solo guarda lo que la cola necesita.
    expect(queue.items.value).toEqual([song(1)])
    expect(queue.visible.value).toBe(true)
    expect(queue.add(song(1))).toBe('already')
    expect(toasts()).toEqual([['success', '«Canción 1» agregada a la cola'], ['info', '«Canción 1» ya está en la cola']])

    expect(queue.add(song(2))).toBe('added')
    expect(queue.add(song(3))).toBe('added')
    expect(queue.full.value).toBe(true)
    expect(queue.count.value).toBe(queue.max)
    useToast().toasts.value = []
    expect(queue.add(song(4))).toBe('full')
    expect(toasts()).toEqual([])
    expect(queue.count.value).toBe(3)
  })

  it('quitar, vaciar y reemplazar (recorta a 3); quitar una que no está no cambia nada', () => {
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    queue.add(song(2))
    queue.remove(S1)
    expect(queue.items.value.map(s => s.id)).toEqual([S2])
    queue.remove('otra')
    expect(queue.count.value).toBe(1)
    queue.replaceWith([1, 2, 3, 4].map(song))
    expect(queue.items.value.map(s => s.title)).toEqual(['Canción 1', 'Canción 2', 'Canción 3'])
    queue.clear()
    expect(queue.count.value).toBe(0)
    expect(queue.visible.value).toBe(false)
  })

  it('genera: una petición con los ids, resultado por canción, aviso con las logradas y la nota de respaldo', async () => {
    mockApi('POST', URL_, zip())
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    queue.add(song(2))
    useToast().toasts.value = []
    const result = await queue.generate()
    expect(calls.filter(c => c.url === URL_)).toEqual([{ method: 'POST', url: URL_, body: { songIds: [S1, S2] } }])
    expect(result).toMatchObject({ ok: true, filename: 'canciones.zip' })
    expect(queue.resultOf(S1)).toMatchObject({ status: 'done', slideCount: 4, message: null })
    expect(queue.resultOf(S2)).toMatchObject({ status: 'failed', message: 'La letra guardada no tiene contenido. Vuelve a obtenerla.' })
    expect(queue.resultOf('otra')).toBeNull()
    expect(toasts()).toEqual([
      ['success', 'canciones.zip descargado: 1 presentación'],
      ['info', 'Las diapositivas se agruparon automáticamente (el reparto con IA no estuvo disponible).'],
    ])
    // La cola se conserva para «Descargar de nuevo» y el detalle.
    expect(queue.count.value).toBe(2)
    expect(queue.canRedownload.value).toBe(true)
    expect(clicks).toHaveBeenCalledTimes(1)
    queue.redownload()
    expect(clicks).toHaveBeenCalledTimes(2)
    expect(calls.filter(c => c.url === URL_)).toHaveLength(1)
  })

  it('sin el detalle por canción el aviso cuenta toda la cola', async () => {
    mockApi('POST', URL_, zip(null))
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    queue.add(song(2))
    useToast().toasts.value = []
    await queue.generate()
    expect(toasts()).toEqual([['success', 'canciones.zip descargado: 2 presentaciones']])
  })

  it('cualquier cambio en la cola invalida el resultado y suelta el .zip', async () => {
    mockApi('POST', URL_, zip())
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    await queue.generate()
    expect(queue.canRedownload.value).toBe(true)
    queue.add(song(2))
    expect(queue.result.value).toBeNull()
    expect(queue.canRedownload.value).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
    queue.redownload()
    expect(clicks).toHaveBeenCalledTimes(1)

    await queue.generate()
    revoke.mockClear()
    queue.remove(S2)
    expect(queue.result.value).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/2')

    await queue.generate()
    queue.replaceWith([song(3)])
    expect(queue.result.value).toBeNull()

    await queue.generate()
    queue.clear()
    expect(queue.result.value).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/4')
  })

  it('422 presentations_failed: ko sin reintento, el porqué de cada canción y un aviso de error', async () => {
    mockApi('POST', URL_, failFromServer(422, 'Unprocessable Entity', 'No se pudo generar ninguna de las presentaciones.', {
      code: 'presentations_failed',
      items: [{ songId: S1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'lyrics_too_long' }],
    }))
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    useToast().toasts.value = []
    const result = await queue.generate()
    expect(result).toMatchObject({ ok: false, retryable: false, error: 'No se pudo generar ninguna de las presentaciones.' })
    expect(queue.resultOf(S1)?.message).toBe('Eso no parece una canción: la letra pasa de 300 líneas.')
    expect(queue.canRedownload.value).toBe(false)
    expect(toasts()).toEqual([['error', 'No se pudo generar ninguna de las presentaciones.']])
    queue.redownload()
    expect(clicks).not.toHaveBeenCalled()
  })

  it('mientras genera, otra llamada devuelve null sin otra petición; con la cola vacía también', async () => {
    let resolve: () => void = () => {}
    mockApi('POST', URL_, (event: H3Event) => new Promise((r) => {
      resolve = () => r(zip()(event))
    }))
    const queue = useSongPresentationQueue()
    expect(await queue.generate()).toBeNull()
    queue.add(song(1))
    const first = queue.generate()
    await vi.waitUntil(() => calls.some(c => c.url === URL_))
    expect(queue.pending.value).toBe(true)
    expect(await queue.generate()).toBeNull()
    resolve()
    expect(await first).toMatchObject({ ok: true })
    expect(calls.filter(c => c.url === URL_)).toHaveLength(1)
    expect(queue.pending.value).toBe(false)
  })

  it('si la cola cambia mientras genera, el resultado no se guarda y el .zip se suelta (el aviso sí sale)', async () => {
    let resolve: () => void = () => {}
    mockApi('POST', URL_, (event: H3Event) => new Promise((r) => {
      resolve = () => r(zip()(event))
    }))
    const queue = useSongPresentationQueue()
    queue.add(song(1))
    const first = queue.generate()
    await vi.waitUntil(() => calls.some(c => c.url === URL_))
    queue.add(song(2))
    useToast().toasts.value = []
    resolve()
    expect(await first).toMatchObject({ ok: true })
    expect(queue.result.value).toBeNull()
    expect(queue.canRedownload.value).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
    expect(toasts()[0]).toEqual(['success', 'canciones.zip descargado: 1 presentación'])
  })

  it('el modo cola vive en useState', () => {
    const queue = useSongPresentationQueue()
    queue.batchMode.value = true
    expect(useSongPresentationQueue().batchMode.value).toBe(true)
  })
})
