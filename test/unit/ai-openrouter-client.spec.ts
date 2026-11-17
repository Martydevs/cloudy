// Cliente de OpenRouter: respeta NUXT_OPENROUTER_BASE_URL (stub de los e2e); vacío = API real. Sin clave no hay modelo.
import type { RuntimeConfig } from 'nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  // Un modelo de OpenRouter mínimo: solo acepta como URL las que terminan en extensión de imagen.
  const provider = vi.fn((modelId: string) => ({
    specificationVersion: 'v4' as const,
    provider: 'openrouter',
    modelId,
    supportedUrls: { 'image/*': [/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(?:[?#].*)?$/i] },
  }))
  return { provider, createOpenRouter: vi.fn(() => provider) }
})
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: sdk.createOpenRouter }))

const { OPENROUTER_PRAY_REQUESTS_MODEL, OPENROUTER_PRAY_TRANSCRIPTION_MODEL, openrouterClient, resolvePrayerImageModel, resolvePrayerTranscriptModel } = await import('../../server/ai/providers/openrouter')

const config = (openrouterApikey: string, openrouterBaseUrl = '') =>
  ({ openrouterApikey, openrouterBaseUrl }) as unknown as RuntimeConfig

beforeEach(() => {
  sdk.createOpenRouter.mockClear()
  sdk.provider.mockClear()
})

describe('openrouterClient', () => {
  it('con URL base la usa (stub de los e2e) y pasa la clave', () => {
    openrouterClient(config('sk-or-x', 'http://127.0.0.1:4010'))
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: 'http://127.0.0.1:4010' })
  })

  it('sin URL base va a la API de OpenRouter', () => {
    openrouterClient(config('sk-or-x'))
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: undefined })
  })
})

describe('ids de preset', () => {
  it('lleva un solo prefijo @preset/', () => {
    expect(OPENROUTER_PRAY_REQUESTS_MODEL).toBe('@preset/pray-requests-image-generation')
    expect(OPENROUTER_PRAY_TRANSCRIPTION_MODEL).toBe('@preset/pray-requests-transcription')
  })
})

describe('resolvePrayerImageModel', () => {
  it('con clave devuelve el preset de peticiones con modalities de imagen y la misma URL base', () => {
    expect(resolvePrayerImageModel(config('sk-or-x', 'http://127.0.0.1:4010'))).toMatchObject({ provider: 'openrouter', modelId: OPENROUTER_PRAY_REQUESTS_MODEL })
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: 'http://127.0.0.1:4010' })
    expect(sdk.provider).toHaveBeenCalledWith(OPENROUTER_PRAY_REQUESTS_MODEL, { extraBody: { modalities: ['image', 'text'] } })
  })

  // Las fotos de los invitados son URLs firmadas de claves sin extensión: tienen que llegar a OpenRouter como URL, sin que
  // el AI SDK las descargue en la función (feature 008).
  it('acepta como URL cualquier imagen https (firmada y sin extensión) y los data URI, pero no http', async () => {
    const model = resolvePrayerImageModel(config('sk-or-x')) as unknown as { supportedUrls: Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>> }
    const patterns = (await model.supportedUrls)['image/*']!
    const accepted = (url: string) => patterns.some(re => re.test(url))
    expect(accepted('https://bucket.test/b/guest/s1/abc?X-Amz-Signature=f00')).toBe(true)
    expect(accepted('https://bucket.test/b/textsrc/abc.jpg?X-Amz-Signature=f00')).toBe(true)
    expect(accepted('data:image/jpeg;base64,/9j/')).toBe(true)
    expect(accepted('http://bucket.test/b/guest/s1/abc')).toBe(false)
  })

  it('sin URL base va a OpenRouter', () => {
    resolvePrayerImageModel(config('sk-or-x'))
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: undefined })
  })

  it.each([[''], ['   ']])('sin clave (%j) → null sin crear el cliente', (key) => {
    expect(resolvePrayerImageModel(config(key))).toBeNull()
    expect(sdk.createOpenRouter).not.toHaveBeenCalled()
  })
})

describe('resolvePrayerTranscriptModel', () => {
  it('con clave devuelve el preset de lectura, sin modalities de imagen, y la misma URL base', () => {
    expect(resolvePrayerTranscriptModel(config('sk-or-x', 'http://127.0.0.1:4010'))).toMatchObject({ provider: 'openrouter', modelId: OPENROUTER_PRAY_TRANSCRIPTION_MODEL })
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: 'http://127.0.0.1:4010' })
    expect(sdk.provider).toHaveBeenCalledWith(OPENROUTER_PRAY_TRANSCRIPTION_MODEL)
  })

  // La foto de un invitado es una URL firmada de una clave sin extensión: llega a OpenRouter como URL, igual que con el
  // modelo de imágenes (comparten el envoltorio).
  it('acepta como URL cualquier imagen https (firmada y sin extensión), pero no http', async () => {
    const model = resolvePrayerTranscriptModel(config('sk-or-x')) as unknown as { supportedUrls: Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>> }
    const patterns = (await model.supportedUrls)['image/*']!
    const accepted = (url: string) => patterns.some(re => re.test(url))
    expect(accepted('https://bucket.test/b/guest/s1/abc?X-Amz-Signature=f00')).toBe(true)
    expect(accepted('http://bucket.test/b/guest/s1/abc')).toBe(false)
  })

  it.each([[''], ['   ']])('sin clave (%j) → null sin crear el cliente', (key) => {
    expect(resolvePrayerTranscriptModel(config(key))).toBeNull()
    expect(sdk.createOpenRouter).not.toHaveBeenCalled()
  })
})
