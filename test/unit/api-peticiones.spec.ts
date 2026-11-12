// T008 — Endpoints de Peticiones (feature 007, contracts/api.md § 1): guard de equipo, validación antes de consultar y
// `Cache-Control: no-store`.
import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/peticiones', () => {
  it('devuelve la página de listPrayerRequests con no-store y la query validada', async () => {
    const page = { items: [{ id: 'x' }], nextCursor: 'c' }
    const listPrayerRequests = vi.fn(async () => page)
    installNitro([], { listPrayerRequests })
    const handler = await loadHandler('api/peticiones/index.get.ts')
    const event = makeEvent({ url: '/api/peticiones?q=%20Ana%20&dir=asc' })
    expect(await handler(event)).toBe(page)
    expect(listPrayerRequests).toHaveBeenCalledWith({ q: 'Ana', from: undefined, to: undefined, dir: 'asc', cursor: undefined })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('sin resultados → { items: [], nextCursor: null }', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/peticiones/index.get.ts')
    expect(await handler(makeEvent({ url: '/api/peticiones' }))).toEqual({ items: [], nextCursor: null })
  })

  it.each([
    'from=ayer',
    'from=2026-11-08T00:00:00.000Z&to=2026-11-07T00:00:00.000Z',
    'dir=up',
    `q=${'a'.repeat(101)}`,
  ])('%s → 422 con data.errors sin consultar', async (query) => {
    const listPrayerRequests = vi.fn()
    installNitro([], { listPrayerRequests })
    const handler = await loadHandler('api/peticiones/index.get.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: `/api/peticiones?${query}` }))), 422)
    expect((error.data as { errors: object }).errors).toBeTruthy()
    expect(listPrayerRequests).not.toHaveBeenCalled()
  })

  it('exige sesión de equipo', async () => {
    installNitro([])
    await expectGuarded(await loadHandler('api/peticiones/index.get.ts'), { url: '/api/peticiones' })
  })
})

describe('POST /api/peticiones/imagenes', () => {
  const IDS = ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b']
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])

  function install({ createPrayerImage = vi.fn(async () => ({ mediaType: 'image/png', data: PNG, count: 2 })), hitRateLimit = vi.fn(async () => {}) } = {}) {
    installNitro([], { createPrayerImage, hitRateLimit })
    return { createPrayerImage, hitRateLimit }
  }

  const post = async (body: unknown) => {
    const handler = await loadHandler<Buffer>('api/peticiones/imagenes.post.ts')
    const event = makeEvent({ method: 'POST', url: '/api/peticiones/imagenes', body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('éxito: devuelve los bytes con su tipo, nombre inline, no-store y el conteo', async () => {
    const { createPrayerImage, hitRateLimit } = install()
    const { event, result } = await post({ fileIds: IDS })
    expect(Array.from(await result)).toEqual(Array.from(PNG))
    expect(hitRateLimit).toHaveBeenCalledWith(event, 'peticiones-img:u1', { limit: 60, windowSec: 3600 })
    expect(createPrayerImage).toHaveBeenCalledWith(IDS, { abortSignal: expect.any(AbortSignal) })
    expect(event.node.res.getHeader('Content-Type')).toBe('image/png')
    expect(event.node.res.getHeader('Content-Disposition')).toBe('inline; filename="peticiones.png"')
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    expect(event.node.res.getHeader('X-Peticiones-Count')).toBe('2')
  })

  it('JPEG se nombra .jpg', async () => {
    install({ createPrayerImage: vi.fn(async () => ({ mediaType: 'image/jpeg', data: PNG, count: 1 })) })
    const { event, result } = await post({ fileIds: [IDS[0]] })
    await result
    expect(event.node.res.getHeader('Content-Disposition')).toBe('inline; filename="peticiones.jpg"')
  })

  it('un tipo que no es imagen conocida → 502 invalid_output', async () => {
    install({ createPrayerImage: vi.fn(async () => ({ mediaType: 'image/x-raro', data: PNG, count: 1 })) })
    const { result } = await post({ fileIds: [IDS[0]] })
    expect((await expectStatus(result, 502)).data).toEqual({ code: 'invalid_output' })
  })

  it.each([
    ['vacío', { fileIds: [] }],
    ['5 ids', { fileIds: [...IDS, ...IDS, IDS[0]] }],
    ['repetidos', { fileIds: [IDS[0], IDS[0]] }],
    ['no-UUID', { fileIds: ['x'] }],
    ['sin cuerpo', {}],
  ])('%s → 422 sin límite ni generación', async (_, body) => {
    const { createPrayerImage, hitRateLimit } = install()
    const { result } = await post(body)
    await expectStatus(result, 422)
    expect(hitRateLimit).not.toHaveBeenCalled()
    expect(createPrayerImage).not.toHaveBeenCalled()
  })

  it('el límite propio responde 429 rate_limited antes de generar', async () => {
    const hitRateLimit = vi.fn(async () => {
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests', data: { retryAfter: 30 } })
    })
    const { createPrayerImage } = install({ hitRateLimit })
    const { result } = await post({ fileIds: IDS })
    expect((await expectStatus(result, 429)).data).toEqual({ code: 'rate_limited', retryAfter: 30 })
    expect(createPrayerImage).not.toHaveBeenCalled()
  })

  it('otro error del límite se propaga tal cual', async () => {
    install({ hitRateLimit: vi.fn(async () => { throw createError({ statusCode: 500, statusMessage: 'x' }) }) })
    const { result } = await post({ fileIds: IDS })
    await expectStatus(result, 500)
  })

  it('los errores de la capa de aplicación conservan su data.code', async () => {
    install({ createPrayerImage: vi.fn(async () => { throw createError({ statusCode: 409, data: { code: 'request_unavailable', ids: [IDS[1]] } }) }) })
    const { result } = await post({ fileIds: IDS })
    expect((await expectStatus(result, 409)).data).toEqual({ code: 'request_unavailable', ids: [IDS[1]] })
  })

  it('cerrar la conexión antes de responder aborta la generación', async () => {
    let signal: AbortSignal | undefined
    install({ createPrayerImage: vi.fn(async (_ids: string[], options: { abortSignal: AbortSignal }) => {
      signal = options.abortSignal
      return { mediaType: 'image/png', data: PNG, count: 1 }
    }) })
    const { event, result } = await post({ fileIds: [IDS[0]] })
    await result
    event.node.res.emit('close')
    expect(signal?.aborted).toBe(true)
  })

  it('exige sesión de equipo', async () => {
    install()
    await expectGuarded(await loadHandler('api/peticiones/imagenes.post.ts'), { method: 'POST', url: '/api/peticiones/imagenes', body: { fileIds: IDS } })
  })
})
