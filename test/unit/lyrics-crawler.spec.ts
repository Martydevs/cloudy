// T021 — Frontera con Apify (feature 006, research D1–D3): llamada al actor, cancelación del run huérfano y tabla de
// fallos. `apify-client` simulado: sin red. Ningún error ni registro lleva el token ni la URL del run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectStatus } from './helpers/nitro'

const TOKEN = 'apify_api_super_secreto_123'

const sdk = vi.hoisted(() => ({
  instances: [] as unknown[],
  call: vi.fn(),
  abort: vi.fn(),
  listItems: vi.fn(),
  actorId: '' as string,
  runId: '' as string,
  datasetId: '' as string,
}))

vi.mock('apify-client', () => ({
  ApifyClient: class {
    constructor(options: unknown) {
      sdk.instances.push(options)
    }

    actor(id: string) {
      sdk.actorId = id
      return { call: sdk.call }
    }

    run(id: string) {
      sdk.runId = id
      return { abort: sdk.abort }
    }

    dataset(id: string) {
      sdk.datasetId = id
      return { listItems: sdk.listItems }
    }
  },
}))

const { crawlLetras } = await import('../../server/utils/lyrics-crawler')

let config: { apifyApiKey: string, apifyBaseUrl: string }
let warn: ReturnType<typeof vi.spyOn<Console, 'warn'>>

const URL = 'https://letras.com/musiko/de-buenas-part-josh-gamez'
const run = (status = 'SUCCEEDED') => ({ id: 'run-secreto-1', status, defaultDatasetId: 'ds1' })
const item = { html: '<html>…</html>', crawl: { httpStatusCode: 200 }, metadata: { url: 'https://www.letras.com/musiko/de-buenas-part-josh-gamez/', redirectedUrl: 'https://www.letras.com/musiko/de-buenas-part-josh-gamez/' } }

function apiError(statusCode: number, type?: string) {
  return Object.assign(new Error(`Apify dijo algo con ${TOKEN} en https://api.apify.com/v2/actor-runs/run-secreto-1`), { name: 'ApifyApiError', statusCode, type })
}

function expectNoLeak(error: unknown) {
  const text = `${JSON.stringify(error)} ${(error as Error).message}`
  expect(text).not.toContain(TOKEN)
  expect(text).not.toContain('run-secreto-1')
  for (const call of warn.mock.calls) {
    expect(call.join(' ')).not.toContain(TOKEN)
    expect(call.join(' ')).not.toContain('run-secreto-1')
  }
}

beforeEach(() => {
  config = { apifyApiKey: TOKEN, apifyBaseUrl: '' }
  vi.stubGlobal('useRuntimeConfig', () => config)
  sdk.instances.length = 0
  sdk.call.mockReset().mockResolvedValue(run())
  sdk.abort.mockReset().mockResolvedValue({})
  sdk.listItems.mockReset().mockResolvedValue({ items: [item] })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('crawlLetras', () => {
  it('sin clave → 503 not_configured sin instanciar el cliente', async () => {
    config.apifyApiKey = ''
    const error = await expectStatus(crawlLetras(URL), 503)
    expect(error.data).toEqual({ code: 'not_configured' })
    expect(sdk.instances).toHaveLength(0)
  })

  it('lanza el actor con las opciones de D2 y lee un item del dataset', async () => {
    expect(await crawlLetras(URL)).toEqual({ html: '<html>…</html>', status: 200, finalUrl: 'https://www.letras.com/musiko/de-buenas-part-josh-gamez/' })
    expect(sdk.instances).toEqual([{ token: TOKEN, maxRetries: 2, timeoutSecs: 60 }])
    expect(sdk.actorId).toBe('apify/rag-web-browser')
    expect(sdk.call).toHaveBeenCalledWith(
      { query: URL, maxResults: 1, outputFormats: ['html'], scrapingTool: 'browser-playwright', requestTimeoutSecs: 40, removeCookieWarnings: true, htmlTransformer: 'none' },
      { waitSecs: 55, log: null },
    )
    expect(sdk.datasetId).toBe('ds1')
    expect(sdk.listItems).toHaveBeenCalledWith({ limit: 1 })
  })

  it('con apifyBaseUrl (e2e) apunta el cliente al stub', async () => {
    config.apifyBaseUrl = 'http://127.0.0.1:9999'
    await crawlLetras(URL)
    expect(sdk.instances).toEqual([{ token: TOKEN, baseUrl: 'http://127.0.0.1:9999', maxRetries: 2, timeoutSecs: 60 }])
  })

  it('campos ausentes o raros del item → null', async () => {
    sdk.listItems.mockResolvedValue({ items: [{ html: '', crawl: { httpStatusCode: '200' }, metadata: { url: 'https://letras.com/a/b' } }] })
    expect(await crawlLetras(URL)).toEqual({ html: null, status: null, finalUrl: 'https://letras.com/a/b' })
    sdk.listItems.mockResolvedValue({ items: [{}] })
    expect(await crawlLetras(URL)).toEqual({ html: null, status: null, finalUrl: null })
  })

  it.each([
    [401, undefined, 502, 'misconfigured'],
    [403, 'insufficient-permissions', 502, 'misconfigured'],
    [402, 'not-enough-usage-to-run-paid-actor', 503, 'quota'],
    [429, 'rate-limit-exceeded', 503, 'busy'],
    [500, undefined, 502, 'crawl_failed'],
    [400, 'invalid-input', 502, 'crawl_failed'],
  ])('ApifyApiError %i → %i %s', async (status, type, expected, code) => {
    sdk.call.mockRejectedValue(apiError(status, type))
    const error = await expectStatus(crawlLetras(URL), expected)
    expect(error.data).toEqual({ code })
    expect(warn).toHaveBeenCalledWith(`[lyrics-crawler] call → ${status}${type ? ` (${type})` : ''}`)
    expectNoLeak(error)
  })

  it.each(['FAILED', 'TIMED-OUT', 'ABORTED'])('run %s → 502 crawl_failed sin leer el dataset', async (status) => {
    sdk.call.mockResolvedValue(run(status))
    const error = await expectStatus(crawlLetras(URL), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
    expect(sdk.listItems).not.toHaveBeenCalled()
    expect(sdk.abort).not.toHaveBeenCalled()
  })

  it('run todavía RUNNING tras la espera → lo cancela y 502 crawl_failed', async () => {
    sdk.call.mockResolvedValue(run('RUNNING'))
    const error = await expectStatus(crawlLetras(URL), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
    expect(sdk.runId).toBe('run-secreto-1')
    expect(sdk.abort).toHaveBeenCalledTimes(1)
    expectNoLeak(error)
  })

  it('si la cancelación falla, igual responde crawl_failed', async () => {
    sdk.call.mockResolvedValue(run('READY'))
    sdk.abort.mockRejectedValue(apiError(500))
    const error = await expectStatus(crawlLetras(URL), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
    expect(warn).toHaveBeenCalledWith('[lyrics-crawler] abort → failed')
  })

  it('dataset vacío → 502 crawl_failed', async () => {
    sdk.listItems.mockResolvedValue({ items: [] })
    const error = await expectStatus(crawlLetras(URL), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
  })

  it('error al leer el dataset se clasifica igual', async () => {
    sdk.listItems.mockRejectedValue(apiError(402))
    const error = await expectStatus(crawlLetras(URL), 503)
    expect(error.data).toEqual({ code: 'quota' })
    expect(warn).toHaveBeenCalledWith('[lyrics-crawler] items → 402')
  })

  it('error de red → 502 crawl_failed, registrado solo con su nombre', async () => {
    sdk.call.mockRejectedValue(Object.assign(new Error(`connect ECONNREFUSED con ${TOKEN}`), { name: 'AxiosError' }))
    const error = await expectStatus(crawlLetras(URL), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
    expect(warn).toHaveBeenCalledWith('[lyrics-crawler] call → network (AxiosError)')
    expectNoLeak(error)
    sdk.call.mockRejectedValue(null)
    await expectStatus(crawlLetras(URL), 502)
    expect(warn).toHaveBeenCalledWith('[lyrics-crawler] call → network (unknown)')
  })
})
