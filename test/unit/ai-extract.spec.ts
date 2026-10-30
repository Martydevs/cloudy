// Lectura con el AI SDK y una sola llamada a OpenRouter (feature 002, research A1), con un
// `MockLanguageModelV4` en lugar del modelo: sin red ni proveedor real.
import { APICallError, NoObjectGeneratedError, RetryError } from 'ai'
import type { generateText as GenerateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderBreaker } from '../../server/ai/breaker'
import { extractImageText } from '../../server/ai/image-text/extract'
import { IMAGE_EXTRACTION_INSTRUCTION, IMAGE_EXTRACTION_PROMPT } from '../../server/ai/image-text/prompt'

// Se espía `generateText` para afirmar `timeout` y `maxRetries` (no llegan al modelo).
const sdk = vi.hoisted(() => ({ calls: [] as Parameters<typeof GenerateText>[0][] }))
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn((options: Parameters<typeof GenerateText>[0]) => {
      sdk.calls.push(options)
      return actual.generateText(options)
    }),
  }
})

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

type DoGenerate = ConstructorParameters<typeof MockLanguageModelV4>[0] extends infer O ? O extends { doGenerate?: infer D } ? D : never : never

const answer = (output: unknown, finish: 'stop' | 'content-filter' = 'stop') => ({
  content: typeof output === 'string' || output === null ? (output ? [{ type: 'text' as const, text: output }] : []) : [{ type: 'text' as const, text: JSON.stringify(output) }],
  finishReason: { unified: finish, raw: finish },
  usage: USAGE,
  warnings: [],
})

const reads = (output: unknown) => new MockLanguageModelV4({ doGenerate: answer(output) as DoGenerate })
const fails = (error: unknown) => new MockLanguageModelV4({ doGenerate: async () => { throw error } })

const apiError = (statusCode: number | undefined, data?: unknown) =>
  new APICallError({ message: 'x', url: 'https://api.test', requestBodyValues: {}, statusCode, data, isRetryable: false })

const noObject = (finishReason: 'content-filter' | 'stop') => new NoObjectGeneratedError({
  message: 'x',
  response: { id: 'r', timestamp: new Date(), modelId: 'm' },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
  finishReason,
})

const image = { mediaType: 'image/jpeg' as const, data: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]) }
const NOTE = { hasText: true, text: 'Oremos por Ana\nGracias' }

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sdk.calls.length = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('extractImageText', () => {
  it('texto legible → ready, recortado', async () => {
    expect(await extractImageText({ image, model: reads({ hasText: true, text: '  Hola  ' }) }))
      .toEqual({ status: 'ready', text: 'Hola' })
  })

  it('hasText: false → empty', async () => {
    expect(await extractImageText({ image, model: reads({ hasText: false, text: '' }) })).toEqual({ status: 'empty' })
  })

  it.each([
    ['JSON ilegible', '{'],
    ['fuera del esquema', { text: 'hola' }],
    ['refine incumplido', { hasText: true, text: '   ' }],
    ['texto con hasText: false', { hasText: false, text: 'algo' }],
  ])('%s → failed/invalid_output', async (_, output) => {
    expect(await extractImageText({ image, model: reads(output) })).toEqual({ status: 'failed', error: 'invalid_output' })
  })

  it('entrada que no pasa modelImageSchema → invalid_input sin llamar al modelo', async () => {
    const model = reads(NOTE)
    for (const bad of [{ mediaType: 'image/webp', data: image.data }, { mediaType: 'image/jpeg', data: new Uint8Array() }]) {
      expect(await extractImageText({ image: bad as never, model })).toEqual({ status: 'failed', error: 'invalid_input' })
    }
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it.each([
    ['red sin statusCode', apiError(undefined), 'provider'],
    ['429', apiError(429), 'rate_limited'],
    ['402 sin créditos', apiError(402), 'quota_exceeded'],
    ['401', apiError(401), 'provider'],
    ['5xx', apiError(500), 'provider'],
    ['otro APICallError', apiError(400), 'provider'],
    ['RetryError', new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(500), apiError(429)] }), 'rate_limited'],
    ['timeout del intento', new DOMException('timeout', 'TimeoutError'), 'timeout'],
    ['NoObjectGeneratedError por política', noObject('content-filter'), 'provider'],
    ['NoObjectGeneratedError por otra razón', noObject('stop'), 'invalid_output'],
  ])('%s → failed/%s', async (_, thrown, code) => {
    expect(await extractImageText({ image, model: fails(thrown), maxRetries: 0 })).toEqual({ status: 'failed', error: code })
  })

  it('termina por política de contenido sin salida → failed/provider', async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer(null, 'content-filter') as DoGenerate })
    expect(await extractImageText({ image, model })).toEqual({ status: 'failed', error: 'provider' })
  })

  it('envía solo el prompt y los bytes como parte file, con las instrucciones y sin opciones de otro proveedor', async () => {
    const model = reads(NOTE)
    await extractImageText({ image, model })
    const [call] = model.doGenerateCalls
    const system = call!.prompt.find(m => m.role === 'system')
    const user = call!.prompt.find(m => m.role === 'user')
    expect(system?.content).toBe(IMAGE_EXTRACTION_INSTRUCTION)
    expect(user?.content).toHaveLength(2)
    expect(user?.content[0]).toMatchObject({ type: 'text', text: IMAGE_EXTRACTION_PROMPT })
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    expect((user?.content[1] as { providerOptions?: unknown }).providerOptions).toBeUndefined()
    expect(call!.providerOptions).toBeUndefined()
    expect(call!.responseFormat).toMatchObject({ type: 'json' })
  })

  it('PNG viaja como image/png', async () => {
    const model = reads(NOTE)
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    await extractImageText({ image: { mediaType: 'image/png', data: png }, model })
    const user = model.doGenerateCalls[0]!.prompt.find(m => m.role === 'user')
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })

  it('una sola llamada de 30 s con 1 reintento por defecto', async () => {
    await extractImageText({ image, model: reads(NOTE) })
    expect(sdk.calls).toHaveLength(1)
    expect(sdk.calls[0]).toMatchObject({ timeout: 30_000, maxRetries: 1 })
  })

  it('respeta maxRetries del llamador', async () => {
    await extractImageText({ image, model: reads(NOTE), maxRetries: 0 })
    expect(sdk.calls[0]).toMatchObject({ maxRetries: 0 })
  })

  it('model null (sin clave) → failed/provider sin llamar a nadie', async () => {
    expect(await extractImageText({ image, model: null })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it('sin modelo inyectado y sin clave en la configuración → failed/provider sin llamar', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: '  ', openrouterBaseUrl: '' }))
    expect(await extractImageText({ image })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it('sin modelo inyectado llama a OpenRouter (chat completions) con la clave, la URL y el preset de la configuración', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or-x', openrouterBaseUrl: 'http://openrouter.test/v1' }))
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
      id: 'gen-1',
      model: 'preset',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(NOTE) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }))
    vi.stubGlobal('fetch', fetch)
    expect(await extractImageText({ image })).toEqual({ status: 'ready', text: NOTE.text })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://openrouter.test/v1/chat/completions')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-or-x')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('@preset/image-content-extraction')
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,')
  })

  it('el abortSignal del llamador abortado durante la llamada → timeout', async () => {
    const controller = new AbortController()
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
        setTimeout(() => controller.abort(new DOMException('presupuesto', 'TimeoutError')), 5)
      }),
    })
    const breaker = createProviderBreaker(1)
    expect(await extractImageText({ image, model, abortSignal: controller.signal, breaker })).toEqual({ status: 'failed', error: 'timeout' })
    // El presupuesto agotado no es culpa del proveedor.
    expect(breaker.isOpen()).toBe(false)
  })

  it('con el abortSignal ya abortado no llama al modelo', async () => {
    const model = reads(NOTE)
    expect(await extractImageText({ image, model, abortSignal: AbortSignal.abort() })).toEqual({ status: 'failed', error: 'timeout' })
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('registra el fallo solo con códigos, sin texto: transitorio como aviso', async () => {
    await extractImageText({ image, model: fails(apiError(503)), maxRetries: 0 })
    expect(warn).toHaveBeenCalledWith('[image-text] openrouter failed (provider)')
    expect(error).not.toHaveBeenCalled()
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toContain('Oremos')
  })

  it('saldo agotado o clave rechazada se registran como error', async () => {
    await extractImageText({ image, model: fails(apiError(402)) })
    expect(error).toHaveBeenCalledWith('[image-text] openrouter failed (quota_exceeded)')
  })

  it('una salida inválida no se registra como fallo del proveedor', async () => {
    await extractImageText({ image, model: reads('{') })
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('extractImageText con cortacircuito', () => {
  it('abierto → failed/provider sin llamar al modelo', async () => {
    const breaker = createProviderBreaker()
    breaker.recordFailure(true)
    const model = reads(NOTE)
    expect(await extractImageText({ image, model, breaker })).toEqual({ status: 'failed', error: 'provider' })
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('un éxito se registra', async () => {
    const breaker = createProviderBreaker()
    const success = vi.spyOn(breaker, 'recordSuccess')
    await extractImageText({ image, model: reads(NOTE), breaker })
    expect(success).toHaveBeenCalledOnce()
  })

  it('un error persistente lo abre y se anuncia una vez', async () => {
    const breaker = createProviderBreaker()
    const failure = vi.spyOn(breaker, 'recordFailure')
    await extractImageText({ image, model: fails(apiError(402)), breaker })
    expect(failure).toHaveBeenCalledWith(true)
    expect(breaker.isOpen()).toBe(true)
    expect(error).toHaveBeenCalledWith('[image-text] breaker open (quota_exceeded)')
  })

  it('un fallo transitorio cuenta y abre al llegar al umbral', async () => {
    const breaker = createProviderBreaker(2)
    await extractImageText({ image, model: fails(apiError(503)), breaker, maxRetries: 0 })
    expect(breaker.isOpen()).toBe(false)
    await extractImageText({ image, model: fails(new DOMException('timeout', 'TimeoutError')), breaker, maxRetries: 0 })
    expect(breaker.isOpen()).toBe(true)
    expect(warn).toHaveBeenCalledWith('[image-text] breaker open (timeout)')
  })

  it('content-filter cuenta como fallo transitorio', async () => {
    const breaker = createProviderBreaker()
    const failure = vi.spyOn(breaker, 'recordFailure')
    const model = new MockLanguageModelV4({ doGenerate: answer(null, 'content-filter') as DoGenerate })
    await extractImageText({ image, model, breaker })
    expect(failure).toHaveBeenCalledWith(false)
  })

  it.each([
    ['NoObjectGeneratedError por otra razón', fails(noObject('stop'))],
    ['salida que no pasa Zod', reads({ hasText: false, text: 'algo' })],
  ])('%s → invalid_output no cuenta como fallo', async (_, model) => {
    const breaker = createProviderBreaker(1)
    const failure = vi.spyOn(breaker, 'recordFailure')
    expect(await extractImageText({ image, model, breaker })).toEqual({ status: 'failed', error: 'invalid_output' })
    expect(failure).not.toHaveBeenCalled()
    expect(breaker.isOpen()).toBe(false)
  })
})
