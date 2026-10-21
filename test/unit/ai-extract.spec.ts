// Lectura con el AI SDK y respaldo OpenAI → Gemini (feature 002, research A1 y A11), con un
// `MockLanguageModelV4` por candidato: sin red ni proveedor real.
import { APICallError, NoObjectGeneratedError, RetryError } from 'ai'
import type { generateText as GenerateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderBreaker } from '../../server/ai/breaker'
import { extractImageText } from '../../server/ai/image-text/extract'
import { IMAGE_EXTRACTION_INSTRUCTION, IMAGE_EXTRACTION_PROMPT } from '../../server/ai/image-text/prompt'
import type { ImageTextCandidate } from '../../server/ai/providers/candidates'

// Se espía `generateText` para afirmar `timeout` y `maxRetries` de cada intento (no llegan al modelo).
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

const openai = (model: MockLanguageModelV4): ImageTextCandidate => ({ provider: 'openai', model })
const google = (model: MockLanguageModelV4): ImageTextCandidate => ({
  provider: 'google',
  model,
  providerOptions: { google: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } },
})

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
  vi.restoreAllMocks()
})

describe('extractImageText con un solo candidato', () => {
  it('texto legible → ready, recortado', async () => {
    const result = await extractImageText({ image, candidates: [openai(reads({ hasText: true, text: '  Hola  ' }))] })
    expect(result).toEqual({ status: 'ready', text: 'Hola', usedProvider: 'openai' })
  })

  it('hasText: false → empty', async () => {
    expect(await extractImageText({ image, candidates: [openai(reads({ hasText: false, text: '' }))] }))
      .toEqual({ status: 'empty', usedProvider: 'openai' })
  })

  it.each([
    ['JSON ilegible', '{'],
    ['fuera del esquema', { text: 'hola' }],
    ['refine incumplido', { hasText: true, text: '   ' }],
  ])('%s → failed/invalid_output', async (_, output) => {
    expect(await extractImageText({ image, candidates: [openai(reads(output))] }))
      .toMatchObject({ status: 'failed', error: 'invalid_output' })
  })

  it('entrada que no pasa modelImageSchema → invalid_input sin llamar al modelo', async () => {
    const model = reads(NOTE)
    for (const bad of [{ mediaType: 'image/webp', data: image.data }, { mediaType: 'image/jpeg', data: new Uint8Array() }]) {
      expect(await extractImageText({ image: bad as never, candidates: [openai(model)] })).toEqual({ status: 'failed', error: 'invalid_input' })
    }
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it.each([
    ['429 de límite', apiError(429, { error: { code: 'rate_limit_exceeded' } }), 'rate_limited'],
    ['429 insufficient_quota', apiError(429, { error: { code: 'insufficient_quota' } }), 'quota_exceeded'],
    ['402', apiError(402), 'quota_exceeded'],
    ['5xx', apiError(500), 'provider'],
    ['otro APICallError', apiError(400), 'provider'],
    ['timeout del intento', new DOMException('timeout', 'TimeoutError'), 'timeout'],
  ])('%s → failed/%s', async (_, thrown, code) => {
    expect(await extractImageText({ image, candidates: [openai(fails(thrown))], maxRetries: 0 }))
      .toEqual({ status: 'failed', error: code, usedProvider: 'openai' })
  })

  it('envía solo el prompt y los bytes, con las instrucciones y el detalle alto', async () => {
    const model = reads(NOTE)
    await extractImageText({ image, candidates: [openai(model)] })
    const [call] = model.doGenerateCalls
    const system = call!.prompt.find(m => m.role === 'system')
    const user = call!.prompt.find(m => m.role === 'user')
    expect(system?.content).toBe(IMAGE_EXTRACTION_INSTRUCTION)
    expect(user?.content).toHaveLength(2)
    expect(user?.content[0]).toMatchObject({ type: 'text', text: IMAGE_EXTRACTION_PROMPT })
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg', providerOptions: { openai: { imageDetail: 'high' } } })
    expect(call!.responseFormat).toMatchObject({ type: 'json' })
  })

  it('PNG viaja como image/png', async () => {
    const model = reads(NOTE)
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    await extractImageText({ image: { mediaType: 'image/png', data: png }, candidates: [openai(model)] })
    const user = model.doGenerateCalls[0]!.prompt.find(m => m.role === 'user')
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })

  it('sin respaldo: 30 s y 1 reintento', async () => {
    await extractImageText({ image, candidates: [openai(reads(NOTE))] })
    expect(sdk.calls[0]).toMatchObject({ timeout: 30_000, maxRetries: 1 })
  })

  it('sin candidatos → failed/provider sin llamar a nadie', async () => {
    expect(await extractImageText({ image, candidates: [] })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it('sin candidatos inyectados usa los de la configuración', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openaiApikey: '', googleApikey: '' }))
    expect(await extractImageText({ image })).toEqual({ status: 'failed', error: 'provider' })
    vi.unstubAllGlobals()
  })
})

describe('extractImageText con respaldo (research A11)', () => {
  it.each([
    ['red sin statusCode', apiError(undefined)],
    ['timeout propio', new DOMException('timeout', 'TimeoutError')],
    ['429 de límite', apiError(429, { error: { code: 'rate_limit_exceeded' } })],
    ['429 insufficient_quota', apiError(429, { error: { code: 'insufficient_quota' } })],
    ['402', apiError(402)],
    ['5xx', apiError(503)],
    ['401', apiError(401)],
    ['403', apiError(403)],
    ['404', apiError(404)],
    ['400', apiError(400)],
    ['RetryError', new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(500)] })],
    ['content-filter', noObject('content-filter')],
  ])('el principal falla con %s → lee el respaldo', async (_, thrown) => {
    const fallback = reads(NOTE)
    const result = await extractImageText({ image, candidates: [openai(fails(thrown)), google(fallback)] })
    expect(result).toEqual({ status: 'ready', text: NOTE.text, usedProvider: 'google' })
    expect(fallback.doGenerateCalls).toHaveLength(1)
  })

  it('el principal termina por política de contenido sin salida → lee el respaldo', async () => {
    const primary = new MockLanguageModelV4({ doGenerate: answer(null, 'content-filter') as DoGenerate })
    const result = await extractImageText({ image, candidates: [openai(primary), google(reads(NOTE))] })
    expect(result).toMatchObject({ status: 'ready', usedProvider: 'google' })
  })

  it('registra el respaldo solo con códigos, sin texto', async () => {
    await extractImageText({ image, candidates: [openai(fails(apiError(503))), google(reads(NOTE))] })
    expect(warn).toHaveBeenCalledWith('[image-text] fallback openai→google (provider)')
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toContain('Oremos')
  })

  it('saldo agotado o clave rechazada se registran como error', async () => {
    await extractImageText({ image, candidates: [openai(fails(apiError(401))), google(reads(NOTE))] })
    expect(error).toHaveBeenCalledWith('[image-text] fallback openai→google (provider)')
  })

  it.each([
    ['NoObjectGeneratedError por otra razón', fails(noObject('stop'))],
    ['salida que no pasa Zod', reads({ hasText: false, text: 'algo' })],
  ])('%s → invalid_output sin llamar al respaldo', async (_, primary) => {
    const fallback = reads(NOTE)
    expect(await extractImageText({ image, candidates: [openai(primary), google(fallback)] }))
      .toMatchObject({ status: 'failed', error: 'invalid_output' })
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })

  it('si el principal responde, el respaldo no se llama', async () => {
    const fallback = reads(NOTE)
    expect(await extractImageText({ image, candidates: [openai(reads(NOTE)), google(fallback)] }))
      .toMatchObject({ status: 'ready', usedProvider: 'openai' })
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })

  it('ambos fallan → el código del último intento', async () => {
    expect(await extractImageText({ image, candidates: [openai(fails(apiError(429))), google(fails(apiError(503)))], maxRetries: 0 }))
      .toEqual({ status: 'failed', error: 'provider', usedProvider: 'google' })
  })

  it('ambos fallan y alguno por cuota → quota_exceeded prevalece', async () => {
    expect(await extractImageText({ image, candidates: [openai(fails(apiError(402))), google(fails(apiError(503)))], maxRetries: 0 }))
      .toMatchObject({ status: 'failed', error: 'quota_exceeded' })
  })

  it('con respaldo, el principal usa 20 s sin reintento y el respaldo 30 s con 1, más su resolución', async () => {
    await extractImageText({ image, candidates: [openai(fails(apiError(503))), google(reads(NOTE))] })
    expect(sdk.calls[0]).toMatchObject({ timeout: 20_000, maxRetries: 0 })
    expect(sdk.calls[0]!.providerOptions).toBeUndefined()
    expect(sdk.calls[1]).toMatchObject({ timeout: 30_000, maxRetries: 1, providerOptions: { google: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } } })
  })

  it('el abortSignal del llamador abortado → timeout sin llamar al respaldo', async () => {
    const controller = new AbortController()
    const primary = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
        setTimeout(() => controller.abort(new DOMException('presupuesto', 'TimeoutError')), 5)
      }),
    })
    const fallback = reads(NOTE)
    expect(await extractImageText({ image, candidates: [openai(primary), google(fallback)], abortSignal: controller.signal }))
      .toEqual({ status: 'failed', error: 'timeout', usedProvider: 'openai' })
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })

  it('con el abortSignal ya abortado no llama a nadie', async () => {
    const model = reads(NOTE)
    expect(await extractImageText({ image, candidates: [openai(model)], abortSignal: AbortSignal.abort() }))
      .toMatchObject({ status: 'failed', error: 'timeout' })
    expect(model.doGenerateCalls).toHaveLength(0)
  })
})

describe('extractImageText con cortacircuito', () => {
  it('omite un candidato abierto y el siguiente pasa a ser el último (30 s, 1 reintento)', async () => {
    const breaker = createProviderBreaker()
    breaker.recordFailure('openai', true)
    const primary = reads(NOTE)
    const result = await extractImageText({ image, candidates: [openai(primary), google(reads(NOTE))], breaker })
    expect(result).toMatchObject({ status: 'ready', usedProvider: 'google' })
    expect(primary.doGenerateCalls).toHaveLength(0)
    expect(sdk.calls[0]).toMatchObject({ timeout: 30_000, maxRetries: 1 })
  })

  it('registra cada éxito y fallo, y anuncia una vez la apertura', async () => {
    const breaker = createProviderBreaker()
    const failure = vi.spyOn(breaker, 'recordFailure')
    const success = vi.spyOn(breaker, 'recordSuccess')
    await extractImageText({ image, candidates: [openai(fails(apiError(402))), google(reads(NOTE))], breaker })
    expect(failure).toHaveBeenCalledWith('openai', true)
    expect(success).toHaveBeenCalledWith('google')
    expect(warn).toHaveBeenCalledWith('[image-text] breaker open openai (quota_exceeded)')
    expect(breaker.isOpen('openai')).toBe(true)
  })

  it('con todos abiertos → failed/provider sin llamar a nadie', async () => {
    const breaker = createProviderBreaker()
    breaker.recordFailure('openai', true)
    expect(await extractImageText({ image, candidates: [openai(reads(NOTE))], breaker })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })
})
