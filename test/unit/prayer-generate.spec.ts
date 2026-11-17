// T010 — Generación de una imagen de peticiones (feature 007, contracts/api.md § 4; revisión antes de generar: el modelo
// escribe el texto verificado) con un `MockLanguageModelV4`: sin red ni proveedor real.
import { APICallError } from 'ai'
import type { generateText as GenerateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePrayerImage } from '../../server/ai/prayer-image/generate'
import { buildPrayerPrompt, prayerTextBlock } from '../../server/ai/prayer-image/prompt'

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

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const template = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])

type Part = { type: 'text', text: string } | { type: 'file', mediaType: string, data: Uint8Array }

// LanguageModelV4 entrega los archivos como `{ type: 'data', data }`.
const answer = (content: Part[]) => ({
  content: content.map(part => (part.type === 'file' ? { ...part, data: { type: 'data', data: part.data } } : part)),
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: USAGE,
  warnings: [],
})

const draws = (content: Part[]) => new MockLanguageModelV4({ doGenerate: answer(content) as DoGenerate })
const fails = (error: unknown) => new MockLanguageModelV4({ doGenerate: async () => { throw error } })
const apiError = (statusCode: number) =>
  new APICallError({ message: 'x', url: 'https://api.test', requestBodyValues: {}, statusCode, isRetryable: false })

const TEXT_A = 'Por la salud de mi mamá\ny de mi abuela'
const TEXT_B = 'Por mi trabajo'
const texts = [TEXT_A, TEXT_B]

beforeEach(() => {
  sdk.calls.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('generatePrayerImage', () => {
  it('envía instrucción, plantilla y un bloque de texto por petición, en orden y sin ninguna foto, y devuelve la primera imagen', async () => {
    const model = draws([{ type: 'text', text: 'Listo' }, { type: 'file', mediaType: 'image/png', data: PNG }, { type: 'file', mediaType: 'image/jpeg', data: template }])
    const result = await generatePrayerImage({ texts, template, model })
    expect(result).toEqual({ status: 'ready', mediaType: 'image/png', data: PNG })
    const user = model.doGenerateCalls[0]!.prompt.find(m => m.role === 'user')
    expect(user?.content).toHaveLength(4)
    expect(user?.content[0]).toMatchObject({ type: 'text', text: buildPrayerPrompt(2) })
    expect(user?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg', data: { type: 'data' } })
    expect(user?.content[2]).toMatchObject({ type: 'text', text: prayerTextBlock(TEXT_A) })
    expect(user?.content[3]).toMatchObject({ type: 'text', text: prayerTextBlock(TEXT_B) })
    // El único archivo es la plantilla: ninguna foto de invitado viaja al modelo.
    expect((user?.content as { type: string }[]).filter(part => part.type === 'file')).toHaveLength(1)
  })

  it('ignora archivos que no son imagen', async () => {
    const model = draws([{ type: 'file', mediaType: 'application/pdf', data: PNG }, { type: 'file', mediaType: 'image/png', data: PNG }])
    expect(await generatePrayerImage({ texts, template, model })).toMatchObject({ status: 'ready', mediaType: 'image/png' })
  })

  it('una sola llamada con intento de 90 s, 1 reintento y señal combinada', async () => {
    const controller = new AbortController()
    const any = vi.spyOn(AbortSignal, 'any')
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await generatePrayerImage({ texts, template, model: draws([{ type: 'file', mediaType: 'image/png', data: PNG }]), abortSignal: controller.signal })
    expect(sdk.calls).toHaveLength(1)
    expect(sdk.calls[0]).toMatchObject({ timeout: 90_000, maxRetries: 1 })
    expect(timeout).toHaveBeenCalledWith(105_000)
    expect(any.mock.calls[0]![0]).toContain(controller.signal)
    expect(sdk.calls[0]!.abortSignal).toBe(any.mock.results[0]!.value)
  })

  it('sin imagen → invalid_output', async () => {
    expect(await generatePrayerImage({ texts, template, model: draws([{ type: 'text', text: 'No puedo' }]) }))
      .toEqual({ status: 'failed', error: 'invalid_output' })
  })

  it('imagen de más de 4 000 000 bytes → too_large', async () => {
    const big = new Uint8Array(4_000_001)
    expect(await generatePrayerImage({ texts, template, model: draws([{ type: 'file', mediaType: 'image/png', data: big }]) }))
      .toEqual({ status: 'failed', error: 'too_large' })
  })

  it('justo 4 000 000 bytes pasa', async () => {
    const edge = new Uint8Array(4_000_000)
    expect(await generatePrayerImage({ texts, template, model: draws([{ type: 'file', mediaType: 'image/png', data: edge }]) }))
      .toMatchObject({ status: 'ready' })
  })

  it('un texto de justo 1000 caracteres pasa', async () => {
    const model = draws([{ type: 'file', mediaType: 'image/png', data: PNG }])
    expect(await generatePrayerImage({ texts: ['a'.repeat(1000)], template, model })).toMatchObject({ status: 'ready' })
  })

  it.each([
    ['sin textos', [], template],
    ['5 textos', ['a', 'b', 'c', 'd', 'e'], template],
    ['un texto en blanco', ['Hola', '  \n '], template],
    ['un texto de más de 1000 caracteres', ['a'.repeat(1001)], template],
    ['algo que no es texto', [{ url: 'https://bucket.test/x' }], template],
    ['plantilla vacía', ['Hola'], new Uint8Array()],
  ])('%s → invalid_input sin llamar al modelo', async (_, input, tpl) => {
    const model = draws([{ type: 'file', mediaType: 'image/png', data: PNG }])
    expect(await generatePrayerImage({ texts: input as never, template: tpl, model })).toEqual({ status: 'failed', error: 'invalid_input' })
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('model null → provider sin llamar', async () => {
    expect(await generatePrayerImage({ texts, template, model: null })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it('sin modelo inyectado y sin clave → provider sin llamar', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: ' ', openrouterBaseUrl: '' }))
    expect(await generatePrayerImage({ texts, template })).toEqual({ status: 'failed', error: 'provider' })
    expect(sdk.calls).toHaveLength(0)
  })

  it.each([
    ['402', apiError(402), 'quota_exceeded'],
    ['429', apiError(429), 'rate_limited'],
    ['500', apiError(500), 'provider'],
    // Clave revocada, sin permisos o preset inexistente: «Reintentar» no sirve (regresión: llegaba como `provider` → 502).
    ['401', apiError(401), 'rejected'],
    ['403', apiError(403), 'rejected'],
    ['404', apiError(404), 'rejected'],
    ['timeout del intento', new DOMException('timeout', 'TimeoutError'), 'timeout'],
  ])('%s → %s, sin lanzar', async (_, thrown, code) => {
    const model = fails(thrown)
    expect(await generatePrayerImage({ texts, template, model })).toEqual({ status: 'failed', error: code })
  })

  it('el abortSignal del llamador abortado → timeout; ya abortado no llama', async () => {
    const controller = new AbortController()
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
        setTimeout(() => controller.abort(new DOMException('cancelada', 'AbortError')), 5)
      }),
    })
    expect(await generatePrayerImage({ texts, template, model, abortSignal: controller.signal })).toEqual({ status: 'failed', error: 'timeout' })
    const idle = draws([{ type: 'file', mediaType: 'image/png', data: PNG }])
    expect(await generatePrayerImage({ texts, template, model: idle, abortSignal: AbortSignal.abort() })).toEqual({ status: 'failed', error: 'timeout' })
    expect(idle.doGenerateCalls).toHaveLength(0)
  })

  it('sin modelo inyectado llama a chat completions con el preset, modalities, la plantilla en base64 y los textos, sin fotos', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or-x', openrouterBaseUrl: 'http://openrouter.test/v1' }))
    const b64 = Buffer.from(PNG).toString('base64')
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
      id: 'gen-1',
      model: 'preset',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }))
    vi.stubGlobal('fetch', fetch)
    const result = await generatePrayerImage({ texts, template })
    expect(result).toMatchObject({ status: 'ready', mediaType: 'image/png' })
    expect(Array.from((result as { data: Uint8Array }).data)).toEqual(Array.from(PNG))
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://openrouter.test/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('@preset/pray-requests-image-generation')
    expect(body.modalities).toEqual(['image', 'text'])
    const parts = body.messages[0].content as { type: string, text?: string, image_url?: { url: string } }[]
    const images = parts.filter(part => part.type === 'image_url').map(part => part.image_url!.url)
    // La única imagen es la plantilla, en base64: ninguna foto de invitado.
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(parts.filter(part => part.type === 'text').map(part => part.text)).toEqual([buildPrayerPrompt(2), prayerTextBlock(TEXT_A), prayerTextBlock(TEXT_B)])
  })

  // Regresión: con una clave borrada en OpenRouter, la API responde 401 «User not found.» y la página mostraba un 502
  // reintentable («El servicio de imágenes no respondió bien»).
  it('OpenRouter responde 401 «User not found.» (clave borrada) → rejected', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or-v1-borrada', openrouterBaseUrl: 'http://openrouter.test/v1' }))
    const fetch = vi.fn(async () => Response.json({ error: { message: 'User not found.', code: 401 } }, { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect(await generatePrayerImage({ texts, template })).toEqual({ status: 'failed', error: 'rejected' })
    // 401 no se reintenta: una sola llamada.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('nunca registra el texto de las peticiones', async () => {
    await generatePrayerImage({ texts, template, model: fails(apiError(500)) })
    const logged = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(' ')
    expect(logged).not.toMatch(/mamá|trabajo/)
  })
})
