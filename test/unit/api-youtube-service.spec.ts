// T020 — Endpoints del servicio de descargas: salud y trabajos (feature 005, contracts/api.md). La frontera
// (`cloudy-api.ts`) se reemplaza por dobles: aquí solo se prueba el contrato de cada endpoint.
import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const JOB = 'b'.repeat(32)

function boundary(overrides: Record<string, unknown> = {}) {
  return {
    pingService: vi.fn(async () => ({ state: 'up' })),
    createJob: vi.fn(async () => ({ jobId: JOB, status: 'queued', engine: 'v2' })),
    getJob: vi.fn(async (_id: string, engine: string) => ({ jobId: JOB, engine, status: 'done', downloadUrl: 'https://svc/file', filename: 'a.mp3', sizeBytes: 10, expiresAt: '2026-11-03T12:00:00.000Z' })),
    cancelJob: vi.fn(async () => {}),
    ...overrides,
  }
}

const serviceError = (statusCode: number, data?: Record<string, unknown>) => createError({ statusCode, message: 'x', data })

describe('GET /api/youtube/health', () => {
  it.each(['up', 'down', 'waking'])('responde %s según el ping, sin caché', async (state) => {
    const mocks = boundary({ pingService: vi.fn(async () => ({ state })) })
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/health.get.ts')
    const event = makeEvent()
    expect(await handler(event)).toEqual({ state })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('503 sin configuración y exige sesión', async () => {
    installNitro([], boundary({ pingService: vi.fn(async () => { throw serviceError(503, { state: 'notConfigured' }) }) }))
    const handler = await loadHandler('api/youtube/health.get.ts')
    await expectStatus(Promise.resolve(handler(makeEvent())), 503)
    await expectGuarded(handler)
  })
})

describe('POST /api/youtube/jobs', () => {
  it('202 con el trabajo en cola y sin repetidos', async () => {
    const mocks = boundary()
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/index.post.ts')
    const event = makeEvent({ body: { videoIds: ['okShortVid1', 'lowResVid01', 'okShortVid1'], format: 'mp3' } })
    const job = await handler(event) as { status: string, items: { videoId: string, status: string }[], downloadUrl: null }
    expect(event.node.res.statusCode).toBe(202)
    expect(job).toMatchObject({ jobId: JOB, engine: 'v2', status: 'queued', format: 'mp3', progress: 0, downloadUrl: null })
    expect(job.items.map(i => [i.videoId, i.status])).toEqual([['okShortVid1', 'queued'], ['lowResVid01', 'queued']])
    // Sin `engine` en el cuerpo, la frontera elige: v2 y, si falla, v1.
    expect(mocks.createJob).toHaveBeenCalledWith(['okShortVid1', 'lowResVid01'], 'mp3', event, undefined)
  })

  it('con `engine` en el cuerpo usa solo ese motor y responde el motor que creó el trabajo', async () => {
    const mocks = boundary({ createJob: vi.fn(async (_ids: string[], _format: string, _event: unknown, engine?: string) => ({ jobId: JOB, status: 'queued', engine: engine ?? 'v1' })) })
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/index.post.ts')
    const forced = makeEvent({ body: { videoIds: ['okShortVid1'], format: 'mp3', engine: 'v1' } })
    expect(await handler(forced)).toMatchObject({ jobId: JOB, engine: 'v1' })
    expect(mocks.createJob).toHaveBeenCalledWith(['okShortVid1'], 'mp3', forced, 'v1')
    // Sin `engine`, si la frontera tuvo que pasar a v1, el trabajo lo dice: con ese motor se consulta después.
    expect(await handler(makeEvent({ body: { videoIds: ['okShortVid1'], format: 'mp3' } }))).toMatchObject({ engine: 'v1' })
  })

  it.each([
    [{ videoIds: [], format: 'mp3' }],
    [{ videoIds: Array.from({ length: 11 }, (_, i) => `video${String(i).padStart(6, '0')}`), format: 'mp3' }],
    [{ videoIds: ['okShortVid1'], format: 'webm' }],
    [{ videoIds: ['okShortVid1'], format: 'mp3', engine: 'v3' }],
  ])('422 con un cuerpo inválido sin llamar al servicio (%#)', async (body) => {
    const mocks = boundary()
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body }))), 422)
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it.each([
    [422, { videos: [{ videoId: 'privateVid1', code: 'private', message: 'privado' }] }],
    [429, { retryAfter: 30 }],
    [503, { state: 'waking' }],
    [502, undefined],
    [502, { code: 'engines_failed', cause: 'botCheck', attempts: [{ engine: 'v2', status: 502, code: 'bot_check' }, { engine: 'v1', status: 502, code: 'bot_check' }] }],
  ])('propaga el %i de la frontera', async (status, data) => {
    installNitro([], boundary({ createJob: vi.fn(async () => { throw serviceError(status, data) }) }))
    const handler = await loadHandler('api/youtube/jobs/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { videoIds: ['privateVid1'], format: 'mp3' } }))), status)
    expect(error.data).toEqual(data)
  })

  it('exige sesión', async () => {
    installNitro([], boundary())
    await expectGuarded(await loadHandler('api/youtube/jobs/index.post.ts'), { body: { videoIds: ['okShortVid1'], format: 'mp3' } })
  })
})

describe('GET /api/youtube/jobs/:jobId', () => {
  it('200 con el enlace al terminar, sin caché', async () => {
    const mocks = boundary()
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/[jobId].get.ts')
    const event = makeEvent({ params: { jobId: JOB } })
    expect(await handler(event)).toMatchObject({ status: 'done', downloadUrl: 'https://svc/file', filename: 'a.mp3', sizeBytes: 10, expiresAt: '2026-11-03T12:00:00.000Z' })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    // Sin `?engine=` se consulta el motor principal.
    expect(mocks.getJob).toHaveBeenCalledWith(JOB, 'v2', event)
  })

  it('`?engine=` elige el prefijo del trabajo; un motor desconocido es 422 sin llamar al servicio', async () => {
    const mocks = boundary()
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/[jobId].get.ts')
    const event = makeEvent({ params: { jobId: JOB }, url: `/api/youtube/jobs/${JOB}?engine=v1` })
    expect(await handler(event)).toMatchObject({ engine: 'v1', status: 'done' })
    expect(mocks.getJob).toHaveBeenCalledWith(JOB, 'v1', event)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { jobId: JOB }, url: `/api/youtube/jobs/${JOB}?engine=v9` }))), 422)
    expect(mocks.getJob).toHaveBeenCalledTimes(1)
  })

  it('404 sin llamar al servicio si el ID no tiene forma; 404 expired si el servicio lo olvidó', async () => {
    const mocks = boundary({ getJob: vi.fn(async () => { throw serviceError(404, { code: 'expired' }) }) })
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/[jobId].get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { jobId: 'nope' } }))), 404)
    expect(mocks.getJob).not.toHaveBeenCalled()
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { jobId: JOB } }))), 404)
    expect(error.data).toEqual({ code: 'expired' })
    await expectGuarded(handler, { params: { jobId: JOB } })
  })
})

describe('DELETE /api/youtube/jobs/:jobId', () => {
  it('204, también si el servicio ya lo olvidó; 404 con un ID sin forma', async () => {
    const mocks = boundary()
    installNitro([], mocks)
    const handler = await loadHandler('api/youtube/jobs/[jobId].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { jobId: JOB } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(mocks.cancelJob).toHaveBeenCalledWith(JOB, 'v2', event)
    // Un trabajo de v1 se cancela en v1; un motor desconocido no llega al servicio.
    const fallback = makeEvent({ method: 'DELETE', params: { jobId: JOB }, url: `/api/youtube/jobs/${JOB}?engine=v1` })
    await handler(fallback)
    expect(mocks.cancelJob).toHaveBeenLastCalledWith(JOB, 'v1', fallback)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { jobId: JOB }, url: `/api/youtube/jobs/${JOB}?engine=x` }))), 422)
    expect(mocks.cancelJob).toHaveBeenCalledTimes(2)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { jobId: 'x' } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { jobId: JOB } })
  })
})
