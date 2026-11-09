// T006 — Frontera con el servicio de descargas (feature 005, research D1, D6, D8): llamadas, mapeo a los DTOs,
// errores traducidos al español, plazos y que la clave nunca sale. `fetch` simulado: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { cancelJob, CLOUDY_API_TIMEOUTS, createJob, createLyricsPptx, createLyricsPptxBatch, getJob, pingService, probeVideo, queuedJob } from '../../server/utils/cloudy-api'
import { ITEM_ERROR_MESSAGES } from '../../shared/constants/youtube'
import { readZipEntry } from '../../server/utils/zip'
import { expectStatus } from './helpers/nitro'
import { makeZip } from './helpers/zip'

const KEY = 'clave-super-secreta-123'
const URL_BASE = 'https://cloudy-api.test'
const JOB = 'a'.repeat(32)

let config: { cloudyApiUrl: string, cloudyApiKey: string }
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
let warn: ReturnType<typeof vi.spyOn<Console, 'warn'>>

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function event() {
  const req = new IncomingMessage(new Socket())
  return createEvent(req, new ServerResponse(req))
}

beforeEach(() => {
  config = { cloudyApiUrl: `${URL_BASE}/`, cloudyApiKey: KEY }
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lastCall = () => fetchMock.mock.calls.at(-1)!
const headersOf = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>

/** Ningún error ni registro lleva la clave. */
function expectNoKeyLeak(error?: unknown) {
  expect(JSON.stringify(error ?? null)).not.toContain(KEY)
  expect(String((error as Error | undefined)?.message ?? '')).not.toContain(KEY)
  for (const call of warn.mock.calls) expect(call.join(' ')).not.toContain(KEY)
}

describe('llamadas y mapeo', () => {
  it('probeVideo manda X-API-Key a GET /v1/videos/{id} y mapea a camelCase', async () => {
    fetchMock.mockResolvedValue(json(200, {
      video_id: 'okShortVid1',
      title: 'Alabanza',
      duration: 245,
      thumbnail: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg',
      channel: 'Iglesia',
      available_heights: [1080, 360, 720, 720],
      downloadable: true,
      reason: null,
    }))
    expect(await probeVideo('okShortVid1')).toEqual({
      videoId: 'okShortVid1',
      title: 'Alabanza',
      channel: 'Iglesia',
      durationSeconds: 245,
      thumbnailUrl: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg',
      availableHeights: [360, 720, 1080],
      downloadable: true,
      reason: null,
    })
    const [url, init] = lastCall()
    expect(url).toBe(`${URL_BASE}/v1/videos/okShortVid1`)
    expect(headersOf(init)['X-API-Key']).toBe(KEY)
  })

  it('probeVideo: no descargable lleva su motivo; miniatura sin https se descarta; motivo desconocido → unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { video_id: 'tooLongVid1', title: 'Largo', duration: 4000, thumbnail: 'http://x/y.jpg', channel: null, available_heights: [], downloadable: false, reason: 'too_long' }))
    expect(await probeVideo('tooLongVid1')).toMatchObject({ downloadable: false, reason: 'too_long', thumbnailUrl: null, channel: null })
    fetchMock.mockResolvedValueOnce(json(200, { video_id: 'x', title: '', downloadable: false, reason: 'raro' }))
    expect(await probeVideo('xxxxxxxxxxx')).toMatchObject({ reason: 'unavailable', title: 'xxxxxxxxxxx', availableHeights: [] })
  })

  it('createJob manda POST /v1/jobs con video_ids y format', async () => {
    fetchMock.mockResolvedValue(json(202, { job_id: JOB, status: 'queued' }))
    expect(await createJob(['okShortVid1'], 'mp3')).toEqual({ jobId: JOB, status: 'queued' })
    const [url, init] = lastCall()
    expect(url).toBe(`${URL_BASE}/v1/jobs`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ video_ids: ['okShortVid1'], format: 'mp3' })
    expect(headersOf(init)['X-API-Key']).toBe(KEY)
  })

  it('createJob sin job_id en la respuesta → 503', async () => {
    fetchMock.mockResolvedValue(json(202, {}))
    await expectStatus(createJob(['okShortVid1'], 'mp3'), 503)
  })

  it('getJob mapea download_url, size_bytes, expires_at (segundos) y el avance a 0–100', async () => {
    fetchMock.mockResolvedValue(json(200, {
      job_id: JOB,
      status: 'done',
      format: 'mp4_1080',
      progress: 1,
      items: [
        { video_id: 'lowResVid01', title: 'Bajo', status: 'done', progress: 1, error: null, actual_height: 480 },
        { video_id: 'unavailVid1', title: null, status: 'failed', progress: 0.3333, error: { code: 'unavailable', message: 'Video unavailable' }, actual_height: null },
        { video_id: 'weird000001', status: 'rara', progress: 'x', error: { code: 5 } },
      ],
      download_url: `${URL_BASE}/v1/jobs/${JOB}/file?exp=1&sig=abc`,
      filename: 'Bajo.mp4',
      size_bytes: 1234,
      expires_at: 1_800_000_000,
    }))
    const job = await getJob(JOB)
    expect(job).toMatchObject({
      jobId: JOB,
      status: 'done',
      format: 'mp4_1080',
      progress: 100,
      downloadUrl: `${URL_BASE}/v1/jobs/${JOB}/file?exp=1&sig=abc`,
      filename: 'Bajo.mp4',
      sizeBytes: 1234,
      expiresAt: new Date(1_800_000_000_000).toISOString(),
    })
    expect(job.items[0]).toEqual({ videoId: 'lowResVid01', title: 'Bajo', status: 'done', progress: 100, error: null, actualHeight: 480 })
    // El mensaje es el nuestro, nunca el del servicio en inglés.
    expect(job.items[1]!.error).toEqual({ code: 'unavailable', message: ITEM_ERROR_MESSAGES.unavailable })
    expect(job.items[1]!.progress).toBe(33)
    expect(job.items[2]).toMatchObject({ status: 'queued', progress: 0, error: { code: 'internal' } })
    expect(lastCall()[0]).toBe(`${URL_BASE}/v1/jobs/${JOB}`)
  })

  it('getJob en curso: sin enlace ni vencimiento', async () => {
    fetchMock.mockResolvedValue(json(200, { job_id: JOB, status: 'running', format: 'mp3', progress: 0.5, items: [] }))
    expect(await getJob(JOB)).toMatchObject({ status: 'running', progress: 50, downloadUrl: null, expiresAt: null, sizeBytes: null })
  })

  it('cancelJob llama DELETE y trata 404 como éxito', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(cancelJob(JOB)).resolves.toBeUndefined()
    expect(lastCall()[1]?.method).toBe('DELETE')
    fetchMock.mockResolvedValueOnce(json(404, { detail: { code: 'not_found', message: 'Job not found or expired' } }))
    await expect(cancelJob(JOB)).resolves.toBeUndefined()
    fetchMock.mockResolvedValueOnce(json(503, {}))
    await expectStatus(cancelJob(JOB), 503)
  })

  it('pingService llama /healthz sin X-API-Key: up, down y waking', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'ok' }))
    expect(await pingService()).toEqual({ state: 'up' })
    const [url, init] = lastCall()
    expect(url).toBe(`${URL_BASE}/healthz`)
    expect(headersOf(init)['X-API-Key']).toBeUndefined()

    fetchMock.mockResolvedValueOnce(json(503, { status: 'degraded' }))
    expect(await pingService()).toEqual({ state: 'down' })
    fetchMock.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    expect(await pingService()).toEqual({ state: 'waking' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }))
    expect(await pingService()).toEqual({ state: 'waking' })
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await pingService()).toEqual({ state: 'waking' })
  })

  it('respuestas incompletas o raras se mapean con valores seguros', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { video_id: 5, downloadable: true, available_heights: 'x', duration: 'larga' }))
    expect(await probeVideo('okShortVid1')).toMatchObject({ videoId: 'okShortVid1', title: 'okShortVid1', availableHeights: [], durationSeconds: null, reason: null })
    fetchMock.mockResolvedValueOnce(json(202, { job_id: JOB, status: 'rarísimo' }))
    expect(await createJob(['okShortVid1'], 'mp3')).toEqual({ jobId: JOB, status: 'queued' })
    fetchMock.mockResolvedValueOnce(json(200, { status: 'rarísimo', items: 'x', progress: 7 }))
    expect(await getJob(JOB)).toMatchObject({ jobId: '', status: 'queued', items: [], progress: 100 })
    fetchMock.mockResolvedValueOnce(json(200, { job_id: JOB, status: 'running', items: [null, { video_id: 'okShortVid1', error: { code: 'private' } }] }))
    const job = await getJob(JOB)
    expect(job.items[0]).toMatchObject({ videoId: '', status: 'queued', error: null })
    expect(job.items[1]!.error).toEqual({ code: 'private', message: ITEM_ERROR_MESSAGES.private })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 410 }))
    await expect(cancelJob(JOB)).resolves.toBeUndefined()
  })

  it('queuedJob arma el trabajo recién creado', () => {
    expect(queuedJob(JOB, ['okShortVid1'], 'mp3')).toEqual({
      jobId: JOB, status: 'queued', format: 'mp3', progress: 0,
      items: [{ videoId: 'okShortVid1', title: null, status: 'queued', progress: 0, error: null, actualHeight: null }],
      downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null,
    })
  })
})

describe('tabla de errores (research D6)', () => {
  it.each([
    ['red', () => Promise.reject(new TypeError('fetch failed'))],
    ['plazo (AbortError)', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
    ['plazo (TimeoutError)', () => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))],
    ['502', () => Promise.resolve(new Response('Bad Gateway', { status: 502 }))],
    ['503', () => Promise.resolve(json(503, {}))],
    ['504', () => Promise.resolve(new Response('', { status: 504 }))],
    ['500', () => Promise.resolve(json(500, { detail: 'boom' }))],
  ])('%s → 503 waking', async (_, response) => {
    fetchMock.mockImplementation(response as () => Promise<Response>)
    const error = await expectStatus(probeVideo('okShortVid1'), 503)
    expect(error.data).toEqual({ state: 'waking' })
    expect(error.message).toMatch(/despertando/)
    expectNoKeyLeak(error)
  })

  it('401 → 502 sin detalle; solo se registra el estado', async () => {
    fetchMock.mockResolvedValue(json(401, { detail: { code: 'unauthorized', message: 'Invalid or missing API key' } }))
    const error = await expectStatus(createJob(['okShortVid1'], 'mp3'), 502)
    expect(error.data).toBeUndefined()
    expect(error.message).toMatch(/administrador/)
    expect(warn.mock.calls.flat().join(' ')).toContain('401')
    expectNoKeyLeak(error)
  })

  it('429 queue_full → 429 con Retry-After: 30', async () => {
    fetchMock.mockResolvedValue(json(429, { detail: { code: 'queue_full', message: 'Too many jobs queued, retry later' } }))
    const ev = event()
    const error = await expectStatus(createJob(['okShortVid1'], 'mp3', ev), 429)
    expect(ev.node.res.getHeader('Retry-After')).toBe(30)
    expect(error.message).toMatch(/ocupado/)
  })

  it.each([404, 410])('%i de un trabajo → 404 expired', async (status) => {
    fetchMock.mockResolvedValue(json(status, { detail: { code: 'expired', message: 'x' } }))
    const error = await expectStatus(getJob(JOB), 404)
    expect(error.data).toEqual({ code: 'expired' })
  })

  it('404 o 422 con código de un video → 404 con el código', async () => {
    fetchMock.mockResolvedValueOnce(json(404, {}))
    expect((await expectStatus(probeVideo('okShortVid1'), 404)).data).toEqual({ code: 'unavailable' })
    fetchMock.mockResolvedValueOnce(json(422, { detail: { code: 'private', message: 'Private video. Sign in' } }))
    const error = await expectStatus(probeVideo('privateVid1'), 404)
    expect(error.data).toEqual({ code: 'private' })
    expect(error.message).toBe('No encontramos ese video. Revisa el enlace.')
  })

  it('422 videos_rejected → 422 con data.videos en español', async () => {
    fetchMock.mockResolvedValue(json(422, {
      detail: {
        code: 'videos_rejected',
        message: 'Some videos can\'t be downloaded',
        videos: [
          { video_id: 'privateVid1', code: 'private', message: 'Private video' },
          { video_id: 'tooLongVid1', code: 'too_long', message: 'Longer than 30 minutes' },
          { code: 'private' },
          { video_id: 'x0000000001' },
        ],
      },
    }))
    const error = await expectStatus(createJob(['privateVid1', 'tooLongVid1'], 'mp3'), 422)
    const videos = (error.data as { videos: { videoId: string, code: string, message: string }[] }).videos
    expect(videos.map(v => [v.videoId, v.code])).toEqual([['privateVid1', 'private'], ['tooLongVid1', 'too_long'], ['x0000000001', 'internal']])
    expect(videos[0]!.message).toBe(ITEM_ERROR_MESSAGES.private)
    expect(JSON.stringify(videos)).not.toMatch(/Private video|Longer than/)
  })

  it('422 batch_too_large y validación de FastAPI → 422 genérico', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { detail: { code: 'batch_too_large', message: 'At most 10' } }))
    expect((await expectStatus(createJob(['okShortVid1'], 'mp3'), 422)).data).toBeUndefined()
    fetchMock.mockResolvedValueOnce(json(422, { detail: [{ loc: ['body', 'format'], msg: 'bad' }] }))
    expect((await expectStatus(createJob(['okShortVid1'], 'mp3'), 422)).data).toBeUndefined()
    fetchMock.mockResolvedValueOnce(new Response('no-json', { status: 422 }))
    await expectStatus(createJob(['okShortVid1'], 'mp3'), 422)
  })

  it('404 fuera de videos y trabajos → 404', async () => {
    fetchMock.mockResolvedValue(json(404, {}))
    await expectStatus(createJob(['okShortVid1'], 'mp3'), 404)
  })
})

describe('configuración', () => {
  it.each([
    { cloudyApiUrl: '', cloudyApiKey: KEY },
    { cloudyApiUrl: URL_BASE, cloudyApiKey: '' },
  ])('sin URL o sin clave toda función responde 503 «no está configurado» sin llamar a fetch', async (cfg) => {
    config = cfg
    for (const call of [() => probeVideo('okShortVid1'), () => createJob(['okShortVid1'], 'mp3'), () => getJob(JOB), () => cancelJob(JOB), () => pingService()]) {
      const error = await expectStatus(call(), 503)
      expect(error.message).toBe('El servicio de descargas no está configurado.')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('plazos', () => {
  it('ping 5 s, getJob/cancelJob 10 s, probeVideo 20 s, createJob 45 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockImplementation(async () => json(200, { job_id: JOB, status: 'queued', format: 'mp3', items: [], title: 't' }))
    await pingService()
    await getJob(JOB)
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }))
    await cancelJob(JOB)
    await probeVideo('okShortVid1')
    await createJob(['okShortVid1'], 'mp3')
    expect(timeout.mock.calls.map(c => c[0])).toEqual([5_000, 10_000, 10_000, 20_000, 45_000])
    expect(CLOUDY_API_TIMEOUTS).toEqual({ ping: 5_000, job: 10_000, probe: 20_000, create: 45_000, pptx: 90_000, pptxBatch: 110_000 })
  })
})

// T040 — Presentaciones de Canciones (feature 006, research D9): cuerpo con la letra en blanco, cabeceras y tabla de errores.
describe('createLyricsPptx', () => {
  const PPTX = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])
  const ok = (headers: Record<string, string> = {}) => new Response(PPTX, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'content-disposition': 'attachment; filename="Cancion.pptx"; filename*=UTF-8\'\'Canci%C3%B3n.pptx',
      'x-slide-count': '7',
      'x-lyrics-arranged-by': 'llm',
      ...headers,
    },
  })
  const input = { html: '<div class="lyric-original"><p>a</p></div>', title: 'Canción' }

  it('POST /v1/lyrics/pptx con X-API-Key, letra en blanco y plazo de 90 s; lee bytes y cabeceras', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValue(ok())
    const result = await createLyricsPptx(input)
    const [url, init] = lastCall()
    expect(url).toBe(`${URL_BASE}/v1/lyrics/pptx`)
    expect(init?.method).toBe('POST')
    expect(headersOf(init)['X-API-Key']).toBe(KEY)
    expect(headersOf(init)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ html: input.html, title: 'Canción', font_color: 'FFFFFF' })
    expect(timeout).toHaveBeenCalledWith(90_000)
    expect(result).toEqual({
      bytes: PPTX,
      contentDisposition: 'attachment; filename="Cancion.pptx"; filename*=UTF-8\'\'Canci%C3%B3n.pptx',
      slideCount: 7,
      arrangedBy: 'llm',
    })
  })

  it('cabeceras ausentes o desconocidas → null', async () => {
    fetchMock.mockResolvedValue(new Response(PPTX, { status: 200 }))
    expect(await createLyricsPptx(input)).toMatchObject({ contentDisposition: null, slideCount: null, arrangedBy: null })
    fetchMock.mockResolvedValue(ok({ 'x-slide-count': 'muchas', 'x-lyrics-arranged-by': 'magia' }))
    expect(await createLyricsPptx(input)).toMatchObject({ slideCount: null, arrangedBy: null })
    fetchMock.mockResolvedValue(ok({ 'x-lyrics-arranged-by': 'fallback' }))
    expect(await createLyricsPptx(input)).toMatchObject({ arrangedBy: 'fallback' })
  })

  it.each([
    ['no_lyrics', 422, 'La letra guardada no tiene contenido. Vuelve a obtenerla.'],
    ['lyrics_too_long', 422, 'Eso no parece una canción: la letra pasa de 300 líneas.'],
  ] as const)('422 %s → 422 con el código', async (code, status, message) => {
    fetchMock.mockResolvedValue(json(422, { detail: { code, message: 'english text' } }))
    const error = await expectStatus(createLyricsPptx(input), status)
    expect(error.data).toEqual({ code })
    expect(error.message).toBe(message)
  })

  it('422 con la lista de validación de FastAPI → 502 invalid, registrado sin el cuerpo', async () => {
    fetchMock.mockResolvedValue(json(422, { detail: [{ loc: ['body', 'font_color'], msg: 'secreto del cuerpo' }] }))
    const error = await expectStatus(createLyricsPptx(input), 502)
    expect(error.data).toEqual({ code: 'invalid' })
    expect(warn.mock.calls.flat().join(' ')).toBe('[cloudy-api] pptx → 422')
  })

  it.each([401, 403])('%i → 502 misconfigured', async (status) => {
    fetchMock.mockResolvedValue(json(status, { detail: { code: 'unauthorized', message: 'Invalid or missing API key' } }))
    const error = await expectStatus(createLyricsPptx(input), 502)
    expect(error.data).toEqual({ code: 'misconfigured' })
    expect(error.message).toMatch(/presentaciones/)
    expectNoKeyLeak(error)
  })

  it.each([
    ['500', () => Promise.resolve(json(500, {}))],
    ['502', () => Promise.resolve(new Response('Bad Gateway', { status: 502 }))],
    ['429', () => Promise.resolve(json(429, {}))],
    ['red', () => Promise.reject(new TypeError('fetch failed'))],
    ['plazo (AbortError)', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
  ])('%s → 503 waking', async (_, response) => {
    fetchMock.mockImplementation(response as () => Promise<Response>)
    const error = await expectStatus(createLyricsPptx(input), 503)
    expect(error.data).toEqual({ code: 'waking' })
    expect(error.message).toMatch(/presentaciones/)
    expectNoKeyLeak(error)
  })

  it('un cuerpo que se corta al leerlo → 503 waking', async () => {
    const res = ok()
    vi.spyOn(res, 'arrayBuffer').mockRejectedValue(Object.assign(new Error('terminated'), { name: 'TypeError' }))
    fetchMock.mockResolvedValue(res)
    const error = await expectStatus(createLyricsPptx(input), 503)
    expect(error.data).toEqual({ code: 'waking' })
  })

  it.each([
    { cloudyApiUrl: '', cloudyApiKey: KEY },
    { cloudyApiUrl: URL_BASE, cloudyApiKey: '' },
  ])('sin URL o sin clave → 503 not_configured sin llamar a fetch', async (cfg) => {
    config = cfg
    const error = await expectStatus(createLyricsPptx(input), 503)
    expect(error.data).toEqual({ code: 'not_configured' })
    expect(error.message).toBe('El servicio de presentaciones no está configurado. Avisa a un administrador.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Lote de presentaciones (POST /v1/lyrics/pptx/batch): un .zip con un .pptx por canción lograda y manifest.json; el manifest
// se lee aquí y no viaja a la persona.
describe('createLyricsPptxBatch', () => {
  const inputs = [
    { html: '<p>a</p>', title: 'Uno' },
    { html: '<p>b</p>', title: 'Dos' },
  ]
  const done = (index: number, filename: string, extra: Record<string, unknown> = {}) =>
    ({ index, status: 'done', filename, title: filename, arranged_by: 'llm', slide_count: 3, error: null, ...extra })
  const failedItem = (index: number, code: string) =>
    ({ index, status: 'failed', filename: null, title: null, arranged_by: null, slide_count: null, error: { code, message: 'english' } })
  const zipOf = (items: unknown[], extra: Record<string, Uint8Array> = {}) =>
    makeZip({ ...extra, 'manifest.json': JSON.stringify({ items }) })
  const ok = (zip: Uint8Array) => new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } })

  it('POST /v1/lyrics/pptx/batch con X-API-Key, cada letra en blanco y plazo de 110 s; devuelve el zip sin manifest y cada resultado', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const zip = zipOf([done(0, 'Uno.pptx'), failedItem(1, 'no_lyrics')], { 'Uno.pptx': new Uint8Array([0x50, 0x4B]) })
    fetchMock.mockResolvedValue(ok(zip))
    const result = await createLyricsPptxBatch(inputs)
    const [url, init] = lastCall()
    expect(url).toBe(`${URL_BASE}/v1/lyrics/pptx/batch`)
    expect(init?.method).toBe('POST')
    expect(headersOf(init)['X-API-Key']).toBe(KEY)
    expect(JSON.parse(String(init?.body))).toEqual({
      items: [
        { html: '<p>a</p>', title: 'Uno', font_color: 'FFFFFF' },
        { html: '<p>b</p>', title: 'Dos', font_color: 'FFFFFF' },
      ],
    })
    expect(timeout).toHaveBeenCalledWith(110_000)
    expect(readZipEntry(result.zip!, 'manifest.json')).toBeNull()
    expect([...readZipEntry(result.zip!, 'Uno.pptx')!]).toEqual([0x50, 0x4B])
    expect([...result.zip!]).toEqual([...makeZip({ 'Uno.pptx': new Uint8Array([0x50, 0x4B]) })])
    expect(result.items).toEqual([
      { index: 0, status: 'done', filename: 'Uno.pptx', slideCount: 3, arrangedBy: 'llm', errorCode: null },
      { index: 1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'no_lyrics' },
    ])
  })

  it('valores desconocidos del manifest: reparto → null, código de error → invalid; entradas sin índice se ignoran', async () => {
    fetchMock.mockResolvedValue(ok(zipOf([done(0, 'Uno.pptx', { arranged_by: 'magia', slide_count: 'x' }), failedItem(1, 'raro'), { status: 'done' }])))
    const { items } = await createLyricsPptxBatch(inputs)
    expect(items).toEqual([
      { index: 0, status: 'done', filename: 'Uno.pptx', slideCount: null, arrangedBy: null, errorCode: null },
      { index: 1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'invalid' },
    ])
  })

  it('422 all_items_failed → sin zip y con el resultado de cada canción (no es un error del lote)', async () => {
    fetchMock.mockResolvedValue(json(422, { detail: { code: 'all_items_failed', message: 'x', items: [failedItem(0, 'no_lyrics'), failedItem(1, 'lyrics_too_long')] } }))
    const result = await createLyricsPptxBatch(inputs)
    expect(result.zip).toBeNull()
    expect(result.items.map(i => i.errorCode)).toEqual(['no_lyrics', 'lyrics_too_long'])
  })

  it('422 all_items_failed con índices que no cubren cada canción → 502 misconfigured', async () => {
    fetchMock.mockResolvedValue(json(422, { detail: { code: 'all_items_failed', message: 'x', items: [failedItem(0, 'no_lyrics'), failedItem(0, 'no_lyrics')] } }))
    const error = await expectStatus(createLyricsPptxBatch(inputs), 502)
    expect(error.data).toEqual({ code: 'misconfigured' })
  })

  it.each([
    ['batch_too_large', { detail: { code: 'batch_too_large', message: 'At most 1' } }, 502, 'misconfigured'],
    ['lista de validación', { detail: [{ loc: ['body'], msg: 'x' }] }, 502, 'invalid'],
  ] as const)('422 %s → %i %s', async (_, body, status, code) => {
    fetchMock.mockResolvedValue(json(422, body))
    const error = await expectStatus(createLyricsPptxBatch(inputs), status)
    expect(error.data).toEqual({ code })
  })

  it.each([
    ['401', () => Promise.resolve(json(401, {})), 502, 'misconfigured'],
    ['503', () => Promise.resolve(new Response('down', { status: 503 })), 503, 'waking'],
    ['red', () => Promise.reject(new TypeError('fetch failed')), 503, 'waking'],
  ] as const)('%s → %i %s, sin filtrar la clave', async (_, response, status, code) => {
    fetchMock.mockImplementation(response as () => Promise<Response>)
    const error = await expectStatus(createLyricsPptxBatch(inputs), status)
    expect(error.data).toEqual({ code })
    expectNoKeyLeak(error)
  })

  // Una respuesta que no sigue el contrato es un despliegue desalineado: `misconfigured` (502, sin Reintentar), no `waking`.
  it.each([
    ['sin manifest', makeZip({ 'Uno.pptx': 'x' })],
    ['manifest que no es JSON', makeZip({ 'manifest.json': '{nope' })],
    ['manifest con menos canciones', zipOf([done(0, 'Uno.pptx')])],
    ['manifest con más canciones', zipOf([done(0, 'Uno.pptx'), done(1, 'Dos.pptx'), done(2, 'Tres.pptx')])],
    ['índice repetido', zipOf([done(0, 'Uno.pptx'), done(0, 'Uno (2).pptx')])],
    ['índice fuera del lote (hueco en 0..n-1)', zipOf([done(0, 'Uno.pptx'), done(2, 'Tres.pptx')])],
    ['cuerpo que no es zip', new Uint8Array([1, 2, 3])],
  ])('%s → 502 misconfigured', async (_, zip) => {
    fetchMock.mockResolvedValue(ok(zip))
    const error = await expectStatus(createLyricsPptxBatch(inputs), 502)
    expect(error.data).toEqual({ code: 'misconfigured' })
    expect(error.message).toBe('El servicio de presentaciones no está bien configurado. Avisa a un administrador.')
    expectNoKeyLeak(error)
  })

  it('un cuerpo que se corta al leerlo → 503 waking', async () => {
    const res = ok(zipOf([]))
    vi.spyOn(res, 'arrayBuffer').mockRejectedValue(Object.assign(new Error('terminated'), { name: 'TypeError' }))
    fetchMock.mockResolvedValue(res)
    const error = await expectStatus(createLyricsPptxBatch(inputs), 503)
    expect(error.data).toEqual({ code: 'waking' })
  })

  it('sin URL o sin clave → 503 not_configured sin llamar a fetch', async () => {
    config = { cloudyApiUrl: '', cloudyApiKey: KEY }
    const error = await expectStatus(createLyricsPptxBatch(inputs), 503)
    expect(error.data).toEqual({ code: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
