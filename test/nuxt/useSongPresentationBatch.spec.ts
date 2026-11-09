// Lote de presentaciones (POST /api/songs/presentations): una sola petición, el .zip se descarga, cada canción trae su
// resultado (éxito parcial), 422 con el porqué de cada una, fallos transitorios reintentables (503, 504, plazo del navegador)
// y doble clic = una petición, también entre instancias (`pending` en `useState`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { calls, failFromServer, flush, mockApi, resetCalls } from './helpers/api'

const S1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const S2 = '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const URL_ = '/api/songs/presentations'

const items = [
  { songId: S1, status: 'done', filename: 'Cancion.pptx', slideCount: 4, arrangedBy: 'llm', errorCode: null },
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

let clicks: ReturnType<typeof vi.spyOn>
let revoke: ReturnType<typeof vi.spyOn>
let urls = 0

beforeEach(() => {
  resetCalls()
  useState('songs-presentation-batch-pending').value = false
  urls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloudy/${++urls}`)
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSongPresentationBatch', () => {
  it('una petición con los ids sin repetir; descarga el zip y devuelve cada resultado con su texto', async () => {
    mockApi('POST', URL_, zip())
    const batch = useSongPresentationBatch()
    const outcome = await batch.generate([S1, S2, S1])
    expect(calls.filter(c => c.url === URL_)).toEqual([{ method: 'POST', url: URL_, body: { songIds: [S1, S2] } }])
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      ok: true,
      file: { url: 'blob:cloudy/1', filename: 'canciones.zip' },
      items: [
        { ...items[0], message: null },
        { ...items[1], message: 'La letra guardada no tiene contenido. Vuelve a obtenerla.' },
      ],
    })
    expect(batch.pending.value).toBe(false)

    batch.redownload()
    expect(clicks).toHaveBeenCalledTimes(2)
    batch.release()
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
  })

  it('cabecera ausente o rota → sin resultados, pero el zip igual se descarga', async () => {
    mockApi('POST', URL_, zip('%E0%A4%A'))
    const outcome = await useSongPresentationBatch().generate([S1])
    expect(outcome).toMatchObject({ ok: true, items: [] })
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('422 presentations_failed → ok: false con el porqué de cada canción y sin reintento', async () => {
    mockApi('POST', URL_, failFromServer(422, 'Unprocessable Entity', 'No se pudo generar ninguna de las presentaciones.', {
      code: 'presentations_failed',
      items: [{ songId: S1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'not_found' }],
    }))
    const outcome = await useSongPresentationBatch().generate([S1])
    expect(outcome).toEqual({
      ok: false,
      error: 'No se pudo generar ninguna de las presentaciones.',
      retryable: false,
      items: [{ songId: S1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'not_found', message: 'Esa canción ya no existe.' }],
    })
    expect(clicks).not.toHaveBeenCalled()
  })

  it('503 waking → ok: false reintentable', async () => {
    mockApi('POST', URL_, failFromServer(503, 'Service Unavailable', 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.', { code: 'waking' }))
    const outcome = await useSongPresentationBatch().generate([S1])
    expect(outcome).toMatchObject({ ok: false, retryable: true, items: [] })
  })

  it('el 504 de Vercel → el texto de plazo, reintentable', async () => {
    mockApi('POST', URL_, (event: H3Event) => {
      setResponseStatus(event, 504)
      return 'FUNCTION_INVOCATION_TIMEOUT'
    })
    const outcome = await useSongPresentationBatch().generate([S1])
    expect(outcome).toEqual({ ok: false, items: [], error: 'La presentación tardó demasiado. Inténtalo de nuevo.', retryable: true })
  })

  it('si el navegador vence el plazo (125 s) → el texto de plazo, reintentable, y `pending` vuelve a false', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mockApi('POST', URL_, () => new Promise(() => {}))
      const batch = useSongPresentationBatch()
      const outcome = batch.generate([S1])
      expect(batch.pending.value).toBe(true)
      await vi.advanceTimersByTimeAsync(124_999)
      expect(batch.pending.value).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(await outcome).toEqual({ ok: false, items: [], error: 'La presentación tardó demasiado. Inténtalo de nuevo.', retryable: true })
      expect(batch.pending.value).toBe(false)
      expect(clicks).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('mientras hay un lote en curso, otro no sale (ni desde otra instancia); vacío o más de 3 tampoco', async () => {
    mockApi('POST', URL_, zip())
    const batch = useSongPresentationBatch()
    const other = useSongPresentationBatch()
    const first = batch.generate([S1])
    expect(batch.pending.value).toBe(true)
    expect(other.pending.value).toBe(true)
    expect(await batch.generate([S2])).toBeNull()
    expect(await other.generate([S2])).toBeNull()
    await first
    await flush()
    expect(other.pending.value).toBe(false)
    expect(await batch.generate([])).toBeNull()
    expect(await batch.generate(['a', 'b', 'c', 'd'])).toBeNull()
    expect(calls.filter(c => c.url === URL_)).toHaveLength(1)
    // El último .zip es uno solo para todas las instancias: la otra también lo vuelve a descargar.
    other.redownload()
    expect(clicks).toHaveBeenCalledTimes(2)
    other.release()
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
  })
})
