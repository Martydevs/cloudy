// T008 — Endpoints de Peticiones (feature 007, contracts/api.md § 1–2, enmienda de historial): guard de equipo, validación
// antes de consultar, `Cache-Control: no-store` y la imagen generada que se guarda en el bucket y responde como JSON.
import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  putObject: vi.fn(async () => {}),
  deleteMany: vi.fn(async () => {}),
  presignGet: vi.fn(async () => 'https://bucket.test/signed'),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

beforeEach(() => {
  s3.putObject.mockReset().mockResolvedValue(undefined)
  s3.deleteMany.mockReset().mockResolvedValue(undefined)
})

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

  function install({ createPrayerImage = vi.fn(async () => ({ mediaType: 'image/png', data: PNG, count: 2 })), hitRateLimit = vi.fn(async () => {}), db = [] as unknown[] } = {}) {
    const fake = installNitro(db, { createPrayerImage, hitRateLimit })
    return { createPrayerImage, hitRateLimit, fake }
  }

  const post = async (body: unknown) => {
    const handler = await loadHandler<Record<string, unknown>>('api/peticiones/imagenes/index.post.ts')
    const event = makeEvent({ method: 'POST', url: '/api/peticiones/imagenes', body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('éxito: sube al bucket, guarda la fila y responde 201 con el JSON de la imagen (sin binario)', async () => {
    const { createPrayerImage, hitRateLimit, fake } = install()
    const { event, result } = await post({ fileIds: IDS })
    const image = await result
    expect(hitRateLimit).toHaveBeenCalledWith(event, 'peticiones-img:u1', { limit: 60, windowSec: 3600 })
    expect(createPrayerImage).toHaveBeenCalledWith(IDS, { abortSignal: expect.any(AbortSignal) })
    const id = image.id as string
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(image).toEqual({
      id,
      previewUrl: `/api/peticiones/imagenes/${id}/content`,
      downloadUrl: `/api/peticiones/imagenes/${id}/content?download=1`,
      fileIds: IDS,
      requestCount: 2,
      author: { userId: 'u1', name: 'Ana', active: true },
      createdAt: expect.any(String),
    })
    expect(s3.putObject).toHaveBeenCalledWith(`pre/peticiones/${id}.png`, PNG, 'image/png')
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({
      id, storageKey: `pre/peticiones/${id}.png`, mediaType: 'image/png', sizeBytes: 4, fileIds: IDS, createdBy: 'u1',
    })
    expect(event.node.res.statusCode).toBe(201)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    expect(event.node.res.getHeader('Content-Type')).not.toBe('image/png')
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('JPEG se guarda como .jpg', async () => {
    install({ createPrayerImage: vi.fn(async () => ({ mediaType: 'image/jpeg', data: PNG, count: 1 })) })
    const { result } = await post({ fileIds: [IDS[0]] })
    const image = await result
    expect(s3.putObject).toHaveBeenCalledWith(`pre/peticiones/${image.id}.jpg`, PNG, 'image/jpeg')
  })

  it('un tipo que no es imagen conocida → 502 invalid_output sin subir nada', async () => {
    install({ createPrayerImage: vi.fn(async () => ({ mediaType: 'image/x-raro', data: PNG, count: 1 })) })
    const { result } = await post({ fileIds: [IDS[0]] })
    expect((await expectStatus(result, 502)).data).toEqual({ code: 'invalid_output' })
    expect(s3.putObject).not.toHaveBeenCalled()
  })

  it('si la subida falla → 502 save_failed y no se escribe la fila', async () => {
    s3.putObject.mockRejectedValue(new Error('bucket'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fake } = install()
    const { result } = await post({ fileIds: IDS })
    const failure = await expectStatus(result, 502)
    expect(failure.data).toEqual({ code: 'save_failed' })
    expect(failure.message).toBe('La imagen se generó pero no se pudo guardar. Inténtalo de nuevo.')
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    expect(error).toHaveBeenCalledWith('[prayer-image] save_failed (upload)')
    error.mockRestore()
  })

  it('si la fila no entra → 502 save_failed y se borra el objeto subido (sin huérfanos)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    install({ db: [new Error('db caída')] })
    const { result } = await post({ fileIds: IDS })
    expect((await expectStatus(result, 502)).data).toEqual({ code: 'save_failed' })
    const [uploaded] = s3.putObject.mock.calls[0] as unknown as [string]
    expect(s3.deleteMany).toHaveBeenCalledWith([uploaded])
    error.mockRestore()
  })

  it('si además el borrado del objeto falla, se registra y sigue siendo save_failed', async () => {
    s3.deleteMany.mockRejectedValue(new Error('bucket'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    install({ db: [new Error('db caída')] })
    const { result } = await post({ fileIds: IDS })
    expect((await expectStatus(result, 502)).data).toEqual({ code: 'save_failed' })
    expect(error).toHaveBeenCalledWith('[prayer-image] orphan object not deleted')
    error.mockRestore()
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
    expect(s3.putObject).not.toHaveBeenCalled()
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

  it('un 429 del límite sin data sigue siendo rate_limited', async () => {
    install({ hitRateLimit: vi.fn(async () => { throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' }) }) })
    const { result } = await post({ fileIds: IDS })
    expect((await expectStatus(result, 429)).data).toEqual({ code: 'rate_limited' })
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

  it('el cierre normal tras enviar la respuesta no aborta nada', async () => {
    let signal: AbortSignal | undefined
    install({ createPrayerImage: vi.fn(async (_ids: string[], options: { abortSignal: AbortSignal }) => {
      signal = options.abortSignal
      return { mediaType: 'image/png', data: PNG, count: 1 }
    }) })
    const { event, result } = await post({ fileIds: [IDS[0]] })
    await result
    Object.defineProperty(event.node.res, 'writableFinished', { value: true, configurable: true })
    event.node.res.emit('close')
    expect(signal?.aborted).toBe(false)
  })

  it('exige sesión de equipo', async () => {
    install()
    await expectGuarded(await loadHandler('api/peticiones/imagenes/index.post.ts'), { method: 'POST', url: '/api/peticiones/imagenes', body: { fileIds: IDS } })
  })
})
