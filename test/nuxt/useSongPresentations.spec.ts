// T043 — Cola de presentaciones (feature 006, research D10): una petición por canción y de una en una; doble clic = una sola
// petición; estados, cancelación, reintento solo de fallos transitorios, descargar de nuevo sin pedirla y descartar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { calls, failFromServer, flush, mockApi, resetCalls } from './helpers/api'

const DISPOSITION = 'attachment; filename="Cancion.pptx"; filename*=UTF-8\'\'Canci%C3%B3n.pptx'

function pptx({ slides = '7', arrangedBy = 'llm', disposition = DISPOSITION as string | null } = {}) {
  return (event: H3Event) => {
    setResponseHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    if (disposition) setResponseHeader(event, 'content-disposition', disposition)
    if (slides) setResponseHeader(event, 'x-slide-count', slides)
    if (arrangedBy) setResponseHeader(event, 'x-lyrics-arranged-by', arrangedBy)
    return Buffer.from([0x50, 0x4B, 3, 4])
  }
}

/** Respuesta que espera a que la prueba la suelte (para ver la cola de una en una). */
function held() {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release: () => release(), impl: async (event: H3Event) => { await gate; return pptx()(event) } }
}

const posts = (id: string) => calls.filter(c => c.method === 'POST' && c.url === `/api/songs/${id}/pptx`)
let clicks: ReturnType<typeof vi.spyOn>
let revoke: ReturnType<typeof vi.spyOn>
let urls = 0

beforeEach(() => {
  resetCalls()
  useState('songs-presentations').value = []
  useState('songs-presentations-delivered').value = 0
  useToast().toasts.value = []
  urls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloudy/${++urls}`)
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const toasts = () => useToast().toasts.value.map(t => t.message)

describe('useSongPresentations', () => {
  it('una canción: una sola petición aunque se pida dos veces seguidas; queued → running → done con las diapositivas', async () => {
    mockApi('POST', '/api/songs/s1/pptx', pptx())
    const p = useSongPresentations()
    expect(p.enqueue([{ id: 's1', title: 'Canción' }])).toBe(1)
    expect(p.enqueue([{ id: 's1', title: 'Canción' }])).toBe(0)
    expect(p.items.value[0]!.status).toBe('running')
    expect(p.isBusy('s1')).toBe(true)
    expect(p.hasItems.value).toBe(true)
    await flush(10)
    expect(posts('s1')).toHaveLength(1)
    expect(p.items.value[0]).toMatchObject({ songId: 's1', status: 'done', slides: 7, arrangedBy: 'llm', filename: 'Canción.pptx' })
    expect(p.isBusy('s1')).toBe(false)
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(toasts()).toContain('Canción: 7 diapositivas generadas')
  })

  it('varias canciones se generan de una en una', async () => {
    const first = held()
    mockApi('POST', '/api/songs/a/pptx', first.impl)
    mockApi('POST', '/api/songs/b/pptx', pptx({ slides: '1', disposition: null }))
    const p = useSongPresentations()
    expect(p.enqueue([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])).toBe(2)
    await flush(5)
    expect(p.items.value.map(i => i.status)).toEqual(['running', 'queued'])
    expect(posts('b')).toHaveLength(0)
    first.release()
    await flush(15)
    expect(p.items.value.map(i => i.status)).toEqual(['done', 'done'])
    expect(posts('b')).toHaveLength(1)
    // Sin Content-Disposition, el nombre sale del título.
    expect(p.items.value[1]!.filename).toBe('B.pptx')
    expect(toasts()).toContain('B: 1 diapositiva generada')
    // Varias descargas seguidas: se avisa que el navegador pudo bloquearlas.
    expect(toasts()).toContain('Tu navegador pudo bloquear las descargas seguidas. Usa «Descargar de nuevo» en las que falten.')
    expect(p.filesFor(2)).toBe('Recibirás 2 archivos, uno por canción.')
    expect(p.filesFor(1)).toBe('Recibirás 1 archivo.')
  })

  it('sin conteo de diapositivas avisa «Presentación lista»; el reparto de respaldo muestra su nota', async () => {
    mockApi('POST', '/api/songs/s1/pptx', pptx({ slides: '', arrangedBy: 'fallback' }))
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    await flush(10)
    expect(p.items.value[0]).toMatchObject({ status: 'done', slides: null, arrangedBy: 'fallback' })
    expect(toasts()).toContain('Canción: Presentación lista')
    expect(toasts()).toContain('Las diapositivas se agruparon automáticamente (el reparto con IA no estuvo disponible).')
  })

  it('cancelar la que se genera la aborta y la cola sigue; cancelar una en cola la saca', async () => {
    const first = held()
    mockApi('POST', '/api/songs/a/pptx', first.impl)
    mockApi('POST', '/api/songs/b/pptx', pptx())
    mockApi('POST', '/api/songs/c/pptx', pptx())
    const p = useSongPresentations()
    p.enqueue([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }])
    await flush(5)
    p.cancel('b')
    expect(p.items.value.map(i => i.songId)).toEqual(['a', 'c'])
    p.cancel('a')
    await flush(15)
    expect(p.items.value.map(i => [i.songId, i.status])).toEqual([['a', 'canceled'], ['c', 'done']])
    expect(posts('b')).toHaveLength(0)
    expect(toasts()).toContain('Generación cancelada')
    first.release()
    p.cancel('nadie')
  })

  it('un fallo transitorio (503 waking) ofrece Reintentar y al reintentar se genera', async () => {
    mockApi('POST', '/api/songs/s1/pptx', failFromServer(503, 'Service Unavailable', 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.', { code: 'waking' }))
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    await flush(10)
    expect(p.items.value[0]).toMatchObject({ status: 'failed', retryable: true, errorCode: 'waking', error: 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.' })
    mockApi('POST', '/api/songs/s1/pptx', pptx())
    p.retry('s1')
    await flush(10)
    expect(p.items.value[0]!.status).toBe('done')
    expect(posts('s1')).toHaveLength(2)
  })

  it('el 504 de Vercel también es transitorio', async () => {
    mockApi('POST', '/api/songs/s1/pptx', (event: H3Event) => {
      setResponseStatus(event, 504)
      return 'FUNCTION_INVOCATION_TIMEOUT'
    })
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    await flush(10)
    expect(p.items.value[0]).toMatchObject({ status: 'failed', retryable: true, error: 'La presentación tardó demasiado. Inténtalo de nuevo.' })
  })

  it.each([
    ['no_lyrics', 'La letra guardada no tiene contenido. Vuelve a obtenerla.'],
    ['lyrics_too_long', 'Eso no parece una canción: la letra pasa de 300 líneas.'],
  ])('%s no ofrece Reintentar', async (code, message) => {
    mockApi('POST', '/api/songs/s1/pptx', failFromServer(422, 'Unprocessable Entity', message, { code }))
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    await flush(10)
    expect(p.items.value[0]).toMatchObject({ status: 'failed', retryable: false, errorCode: code, error: message })
    p.retry('s1')
    await flush()
    expect(posts('s1')).toHaveLength(1)
  })

  it('Descargar de nuevo reutiliza el archivo sin otra petición; Descartar lo libera', async () => {
    mockApi('POST', '/api/songs/s1/pptx', pptx())
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    await flush(10)
    expect(p.canRedownload('s1')).toBe(true)
    p.redownload('s1')
    expect(clicks).toHaveBeenCalledTimes(2)
    expect(posts('s1')).toHaveLength(1)
    p.dismiss('s1')
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
    expect(p.items.value).toEqual([])
    expect(p.hasItems.value).toBe(false)
    p.redownload('s1')
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('una fila activa no se descarta; una terminada se puede volver a encolar', async () => {
    const first = held()
    mockApi('POST', '/api/songs/s1/pptx', first.impl)
    const p = useSongPresentations()
    p.enqueue([{ id: 's1', title: 'Canción' }])
    p.dismiss('s1')
    expect(p.items.value).toHaveLength(1)
    first.release()
    await flush(10)
    mockApi('POST', '/api/songs/s1/pptx', pptx())
    expect(p.enqueue([{ id: 's1', title: 'Canción' }])).toBe(1)
    await flush(10)
    expect(posts('s1')).toHaveLength(2)
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
  })
})
