// Lectura de la foto de una petición (revisión antes de generar) con un `MockLanguageModelV4`: sin red ni proveedor real.
import { APICallError } from 'ai'
import type { generateText as GenerateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTranscriptPrompt } from '../../server/ai/prayer-transcript/prompt'
import { transcribePrayerPhoto } from '../../server/ai/prayer-transcript/transcribe'

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

// Como el modelo real (`resolvePrayerTranscriptModel`): acepta cualquier https, así el AI SDK no descarga la foto.
const supportedUrls = { 'image/*': [/^https:\/\/.+$/i] }
const says = (text: string) => new MockLanguageModelV4({
  supportedUrls,
  doGenerate: { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] } as DoGenerate,
})
const reads = (output: unknown) => says(JSON.stringify(output))
const fails = (error: unknown) => new MockLanguageModelV4({ supportedUrls, doGenerate: async () => { throw error } })
const apiError = (statusCode: number) =>
  new APICallError({ message: 'x', url: 'https://api.test', requestBodyValues: {}, statusCode, isRetryable: false })

const URL_A = 'https://bucket.test/b/guest/s1/aaa?X-Amz-Signature=f00'
const photo = { url: URL_A, mediaType: 'image/png' as const }

beforeEach(() => {
  sdk.calls.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('transcribePrayerPhoto', () => {
  it('envía la instrucción y la foto como URL (sin descargarla) y devuelve el texto con sus saltos de línea', async () => {
    const model = reads({ hasText: true, text: '  Por mi familia\ny mi trabajo \n' })
    expect(await transcribePrayerPhoto({ photo, model })).toEqual({ status: 'ready', hasText: true, text: 'Por mi familia\ny mi trabajo' })
    const user = model.doGenerateCalls[0]!.prompt.find(m => m.role === 'user')
    expect(user?.content).toHaveLength(2)
    expect(user?.content[0]).toMatchObject({ type: 'text', text: buildTranscriptPrompt() })
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: { type: 'url', url: new URL(URL_A) } })
    // Salida estructurada: el modelo recibe el esquema `{ hasText, text }`.
    expect(model.doGenerateCalls[0]!.responseFormat).toMatchObject({ type: 'json' })
  })

  it('hasText: false → sin texto, aunque el modelo haya escrito algo', async () => {
    expect(await transcribePrayerPhoto({ photo, model: reads({ hasText: false, text: 'No se ve nada' }) }))
      .toEqual({ status: 'ready', hasText: false, text: '' })
  })

  it('hasText: true con el texto en blanco cuenta como sin texto', async () => {
    expect(await transcribePrayerPhoto({ photo, model: reads({ hasText: true, text: '  \n ' }) }))
      .toEqual({ status: 'ready', hasText: false, text: '' })
  })

  it.each([
    ['algo que no es JSON', 'No puedo leer la foto'],
    ['un JSON fuera del esquema', JSON.stringify({ texto: 'Hola' })],
    ['un hasText que no es booleano', JSON.stringify({ hasText: 'sí', text: 'Hola' })],
  ])('%s → invalid_output', async (_, raw) => {
    expect(await transcribePrayerPhoto({ photo, model: says(raw) })).toEqual({ status: 'failed', error: 'invalid_output' })
  })

  it('una sola llamada con intento de 30 s, 1 reintento y un tope de 45 s combinado con la señal del llamador', async () => {
    const controller = new AbortController()
    const any = vi.spyOn(AbortSignal, 'any')
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await transcribePrayerPhoto({ photo, model: reads({ hasText: true, text: 'Hola' }), abortSignal: controller.signal })
    expect(sdk.calls).toHaveLength(1)
    expect(sdk.calls[0]).toMatchObject({ timeout: 30_000, maxRetries: 1 })
    expect(timeout).toHaveBeenCalledWith(45_000)
    expect(any.mock.calls[0]![0]).toContain(controller.signal)
    expect(sdk.calls[0]!.abortSignal).toBe(any.mock.results[0]!.value)
  })

  it.each([
    ['una URL http', { url: 'http://bucket.test/b/guest/s1/aaa', mediaType: 'image/jpeg' }],
    ['algo que no es URL', { url: 'guest/s1/aaa', mediaType: 'image/jpeg' }],
    ['una HEIC', { url: URL_A, mediaType: 'image/heic' }],
    ['nada', undefined],
  ])('%s → invalid_input sin llamar al modelo', async (_, input) => {
    const model = reads({ hasText: true, text: 'Hola' })
    expect(await transcribePrayerPhoto({ photo: input as never, model })).toEqual({ status: 'failed', error: 'invalid_input' })
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('model null → provider sin llamar', async () => {
    expect(await transcribePrayerPhoto({ photo, model: null })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it('sin modelo inyectado y sin clave → provider sin llamar', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: ' ', openrouterBaseUrl: '' }))
    expect(await transcribePrayerPhoto({ photo })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it.each([
    ['402', apiError(402), 'quota_exceeded'],
    ['429', apiError(429), 'rate_limited'],
    ['500', apiError(500), 'provider'],
    ['401', apiError(401), 'rejected'],
    ['403', apiError(403), 'rejected'],
    ['404', apiError(404), 'rejected'],
    ['timeout del intento', new DOMException('timeout', 'TimeoutError'), 'timeout'],
  ])('%s → %s, sin lanzar', async (_, thrown, code) => {
    expect(await transcribePrayerPhoto({ photo, model: fails(thrown) })).toEqual({ status: 'failed', error: code })
  })

  it('el abortSignal del llamador abortado → timeout; ya abortado no llama', async () => {
    const controller = new AbortController()
    const model = new MockLanguageModelV4({
      supportedUrls,
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
        setTimeout(() => controller.abort(new DOMException('cancelada', 'AbortError')), 5)
      }),
    })
    expect(await transcribePrayerPhoto({ photo, model, abortSignal: controller.signal })).toEqual({ status: 'failed', error: 'timeout' })
    const idle = reads({ hasText: true, text: 'Hola' })
    expect(await transcribePrayerPhoto({ photo, model: idle, abortSignal: AbortSignal.abort() })).toEqual({ status: 'failed', error: 'timeout' })
    expect(idle.doGenerateCalls).toHaveLength(0)
  })

  it('sin modelo inyectado llama a chat completions con el preset de lectura, la foto como URL firmada y nada más', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or-x', openrouterBaseUrl: 'http://openrouter.test/v1' }))
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
      id: 'gen-1',
      model: 'preset',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ hasText: true, text: 'Por mi hermano' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }))
    vi.stubGlobal('fetch', fetch)
    expect(await transcribePrayerPhoto({ photo })).toEqual({ status: 'ready', hasText: true, text: 'Por mi hermano' })
    // El AI SDK no descargó la foto: no hubo otro fetch.
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://openrouter.test/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('@preset/pray-requests-transcription')
    expect(body.modalities).toBeUndefined()
    expect(body.response_format).toMatchObject({ type: 'json_schema' })
    const parts = body.messages[0].content as { type: string, text?: string, image_url?: { url: string } }[]
    expect(parts.filter(part => part.type === 'image_url').map(part => part.image_url!.url)).toEqual([URL_A])
    expect(parts.filter(part => part.type === 'text').map(part => part.text)).toEqual([buildTranscriptPrompt()])
  })

  it('OpenRouter responde 401 «User not found.» (clave borrada) → rejected, sin reintento', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or-v1-borrada', openrouterBaseUrl: 'http://openrouter.test/v1' }))
    const fetch = vi.fn(async () => Response.json({ error: { message: 'User not found.', code: 401 } }, { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect(await transcribePrayerPhoto({ photo })).toEqual({ status: 'failed', error: 'rejected' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('nunca registra la URL de la foto', async () => {
    await transcribePrayerPhoto({ photo, model: fails(apiError(500)) })
    const logged = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(' ')
    expect(logged).not.toContain('bucket.test')
  })
})
