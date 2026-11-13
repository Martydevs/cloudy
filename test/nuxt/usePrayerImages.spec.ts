// T047 — Cola de imágenes de peticiones (feature 007, research D8, enmienda de historial): una imagen por grupo, 2 a la vez,
// la imagen guardada sale de la cola y entra arriba en el historial, errores en español con reintento solo cuando sirve, 409
// que retira peticiones, cancelar, generar de nuevo, descartar y el aviso al salir solo con algo en curso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { PRAYER_IMAGE_TIMEOUT_MS } from '#shared/constants/prayers'
import type { PrayerGeneratedImage, PrayerRequest } from '#shared/types/api'
import { calls, flush, mockApi, resetCalls } from './helpers/api'

// Sin red el transporte rechaza sin respuesta: se simula por encima de `$api`.
const net = vi.hoisted(() => ({ offline: false }))
mockNuxtImport('useApi', original => () => (net.offline ? (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as ReturnType<typeof original> : original()))

type Reply = (event: H3Event) => unknown

/** Lo que responde el servidor: la imagen ya guardada, con el id derivado del primer id del grupo. */
const saved = (fileIds: string[]): PrayerGeneratedImage => ({
  id: `saved-${fileIds.join('-')}`,
  previewUrl: `/api/peticiones/imagenes/saved-${fileIds[0]}/content`,
  downloadUrl: `/api/peticiones/imagenes/saved-${fileIds[0]}/content?download=1`,
  fileIds,
  requestCount: fileIds.length,
  author: { userId: 'u1', name: 'Ana', active: true },
  createdAt: '2026-11-12T10:00:00.000Z',
})
const png: Reply = async (event) => {
  const body = await readBody<{ requests: { fileId: string }[] }>(event)
  setResponseStatus(event, 201)
  return saved(body.requests.map(r => r.fileId))
}
const fail = (status: number, data?: Record<string, unknown>): Reply => (event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', ...(data ? { data } : {}) }
}

/** Respuesta por primer id del grupo; las que no tienen una se quedan esperando hasta `release`. */
const replies = new Map<string, Reply>()
const gates = new Map<string, () => void>()
function hold(id: string, reply: Reply = png) {
  replies.set(id, async (event) => {
    await new Promise<void>(resolve => gates.set(id, resolve))
    return reply(event)
  })
}
const release = (id: string) => gates.get(id)?.()

const posts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')
/** Peticiones elegidas con su texto, tal como las guarda `usePrayerSelection`. */
const group = (...ids: string[]) => ids.map(id => ({ request: { id } as PrayerRequest, text: `texto ${id}` }))
const sent = (...ids: string[]) => ids.map(fileId => ({ fileId, text: `texto ${fileId}` }))

const added = () => useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => []).value

beforeEach(() => {
  resetCalls()
  replies.clear()
  gates.clear()
  usePrayerImages().reset()
  useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY).value = []
  useToast().toasts.value = []
  mockApi('POST', '/api/peticiones/imagenes', async (event: H3Event) => {
    const body = await readBody<{ requests: { fileId: string }[] }>(event)
    return (replies.get(body.requests[0]!.fileId) ?? png)(event)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('usePrayerImages', () => {
  it('un elemento por grupo, con índice 1-based y las peticiones con su texto en orden', async () => {
    const images = usePrayerImages()
    expect(images.enqueue([group('a', 'b', 'c', 'd'), group('e')])).toBe(2)
    expect(images.items.value.map(i => [i.key, i.index, i.requests])).toEqual([
      ['img-1', 1, sent('a', 'b', 'c', 'd')],
      ['img-2', 2, sent('e')],
    ])
    expect(images.hasItems.value).toBe(true)
    await flush(10)
    expect(posts().map(c => c.body)).toEqual([{ requests: sent('a', 'b', 'c', 'd') }, { requests: sent('e') }])
  })

  it('nunca más de 2 a la vez; la tercera arranca cuando termina una', async () => {
    for (const id of ['a', 'b', 'c']) hold(id)
    const images = usePrayerImages()
    images.enqueue([group('a'), group('b'), group('c')])
    await flush(5)
    expect(images.items.value.map(i => i.status)).toEqual(['running', 'running', 'queued'])
    expect(posts()).toHaveLength(2)
    release('a')
    await flush(10)
    expect(images.items.value.map(i => [i.key, i.status])).toEqual([['img-2', 'running'], ['img-3', 'running']])
    release('b')
    release('c')
    await flush(10)
    expect(images.items.value).toEqual([])
  })

  it('lista: sale de la cola, entra arriba en el historial (sin repetir) y avisa en el toast y en la región viva', async () => {
    const images = usePrayerImages()
    images.enqueue([group('a'), group('b')])
    await flush(10)
    expect(images.items.value).toEqual([])
    expect(images.hasItems.value).toBe(false)
    expect(added().map(i => i.id).sort()).toEqual(['saved-a', 'saved-b'])
    expect(useToast().toasts.value.map(t => t.message)).toEqual(expect.arrayContaining([
      'Imagen 1 lista y guardada en el historial',
      'Imagen 2 lista y guardada en el historial',
    ]))
    expect(images.announcement.value).toMatch(/^Imagen [12] lista/)
    // La misma imagen dos veces (respuesta repetida) no se duplica.
    images.enqueue([group('a')])
    await flush(10)
    expect(added().filter(i => i.id === 'saved-a')).toHaveLength(1)
    expect(added()[0]!.id).toBe('saved-a')
  })

  it('una respuesta sin imagen cuenta como fallo de conexión', async () => {
    replies.set('a', () => ({}))
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await flush(10)
    expect(images.items.value[0]).toMatchObject({ status: 'failed', retryable: true })
  })

  it.each([
    ['rate_limited', 429, true],
    ['provider', 502, true],
    ['invalid_output', 502, true],
    ['too_large', 502, true],
    ['timeout', 504, true],
    ['save_failed', 502, true],
    ['quota_exceeded', 503, false],
    ['not_configured', 503, false],
  ] as const)('el código %s del servidor fija el mensaje y si se puede reintentar', async (code, status, retryable) => {
    replies.set('a', fail(status, { code }))
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await flush(10)
    const [item] = images.items.value
    expect(item).toMatchObject({ status: 'failed', errorCode: code, retryable })
    expect(item!.error).toBeTruthy()
    expect(images.announcement.value).toBe('La imagen 1 no se pudo generar')
  })

  it.each([
    ['504 de la plataforma sin código', fail(504), 'timeout', true],
    ['429 sin código', fail(429), 'rate_limited', true],
    ['500 sin código', fail(500), null, true],
    ['400 sin código', fail(400), null, false],
  ] as const)('%s → %s', async (_, reply, code, retryable) => {
    replies.set('a', reply)
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await flush(10)
    expect(images.items.value[0]).toMatchObject({ status: 'failed', errorCode: code, retryable })
  })

  it('sin red (sin respuesta): mensaje de conexión y reintentable', async () => {
    net.offline = true
    try {
      const images = usePrayerImages()
      images.enqueue([group('a')])
      await flush(10)
      expect(images.items.value[0]).toMatchObject({ status: 'failed', retryable: true, error: 'Se perdió la conexión al generar la imagen. Revisa tu conexión.' })
    }
    finally {
      net.offline = false
    }
  })

  it('409 request_unavailable: no se reintenta y avisa con los ids', async () => {
    replies.set('a', fail(409, { code: 'request_unavailable', ids: ['b'] }))
    const images = usePrayerImages()
    const seen: string[][] = []
    images.onUnavailable(ids => seen.push(ids))
    images.enqueue([group('a', 'b')])
    await flush(10)
    expect(images.items.value[0]).toMatchObject({ status: 'failed', errorCode: 'request_unavailable', retryable: false })
    expect(seen).toEqual([['b']])
  })

  it('cancelar: aborta la activa y saca de la cola la pendiente', async () => {
    for (const id of ['a', 'b', 'c']) hold(id)
    const images = usePrayerImages()
    images.enqueue([group('a'), group('b'), group('c')])
    await flush(5)
    images.cancel('img-3')
    expect(images.items.value.map(i => i.key)).toEqual(['img-1', 'img-2'])
    images.cancel('img-1')
    await flush(5)
    expect(images.items.value[0]!.status).toBe('canceled')
    release('b')
    await flush(10)
    expect(images.items.value.map(i => [i.key, i.status])).toEqual([['img-1', 'canceled']])
    expect(added().map(i => i.id)).toEqual(['saved-b'])
    // Cancelar algo que ya no está en curso no hace nada.
    images.cancel('img-1')
    expect(images.items.value[0]!.status).toBe('canceled')
  })

  it('reintentar (solo fallidas reintentables) y generar de nuevo (solo canceladas)', async () => {
    replies.set('a', fail(502, { code: 'provider' }))
    hold('b')
    const images = usePrayerImages()
    images.enqueue([group('a'), group('b')])
    await flush(10)
    expect(images.items.value.map(i => i.status)).toEqual(['failed', 'running'])
    images.cancel('img-2')
    await flush(5)
    replies.set('a', png)
    images.retry('img-1')
    await flush(10)
    expect(images.items.value.map(i => i.key)).toEqual(['img-2'])
    const before = posts().length
    // Generar de nuevo algo que no está cancelado no hace nada.
    images.regenerate('img-9')
    expect(posts().length).toBe(before)
    replies.set('b', png)
    images.regenerate('img-2')
    await flush(10)
    expect(posts().length).toBe(before + 1)
    expect(posts().at(-1)!.body).toEqual({ requests: sent('b') })
    expect(images.items.value).toEqual([])
    // Reintentar algo que no falló no hace nada.
    images.retry('img-1')
    expect(posts().length).toBe(before + 1)
  })

  it('una fallida no reintentable no vuelve a la cola', async () => {
    replies.set('a', fail(503, { code: 'quota_exceeded' }))
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await flush(10)
    images.retry('img-1')
    expect(images.items.value[0]!.status).toBe('failed')
  })

  it('el aviso al salir solo cuenta lo que está en cola o generándose', async () => {
    replies.set('b', fail(502, { code: 'provider' }))
    const images = usePrayerImages()
    images.enqueue([group('a')])
    expect(images.needsLeaveGuard.value).toBe(true)
    await flush(10)
    expect(images.needsLeaveGuard.value).toBe(false)
    images.enqueue([group('b')])
    await flush(10)
    expect(images.items.value[0]!.status).toBe('failed')
    expect(images.needsLeaveGuard.value).toBe(false)
  })

  it('descartar y reiniciar abortan; la respuesta tardía no revive nada', async () => {
    replies.set('a', fail(502, { code: 'provider' }))
    hold('b')
    const images = usePrayerImages()
    images.enqueue([group('a'), group('b')])
    await flush(10)
    images.dismiss('img-1')
    expect(images.items.value.map(i => i.key)).toEqual(['img-2'])
    images.reset()
    expect(images.items.value).toEqual([])
    release('b')
    await flush(10)
    expect(images.items.value).toEqual([])
    expect(added()).toEqual([])
    expect(images.hasItems.value).toBe(false)
  })

  it('una nueva generación numera a continuación aunque las anteriores ya salieron de la cola; reiniciar vuelve a 1', async () => {
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await flush(10)
    images.enqueue([group('b')])
    expect(images.items.value.map(i => i.index)).toEqual([2])
    images.reset()
    images.enqueue([group('c')])
    expect(images.items.value.map(i => i.index)).toEqual([1])
  })

  it('el plazo vence: fallida por tiempo y reintentable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    hold('a')
    const images = usePrayerImages()
    images.enqueue([group('a')])
    await vi.advanceTimersByTimeAsync(PRAYER_IMAGE_TIMEOUT_MS + 1)
    vi.useRealTimers()
    await flush(5)
    expect(images.items.value[0]).toMatchObject({ status: 'failed', errorCode: 'timeout', retryable: true })
    release('a')
  })

  it('el estado no se filtra entre pruebas', () => {
    expect(usePrayerImages().items.value).toEqual([])
  })
})
