// Cliente de OpenRouter: respeta NUXT_OPENROUTER_BASE_URL (stub de los e2e); vacío = API real. Sin clave no hay modelo.
import type { RuntimeConfig } from 'nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const provider = vi.fn((modelId: string) => ({ modelId }))
  return { provider, createOpenRouter: vi.fn(() => provider) }
})
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: sdk.createOpenRouter }))

const { OPENROUTER_PRAY_REQUESTS_MODEL, openrouterClient, resolvePrayerImageModel } = await import('../../server/ai/providers/openrouter')

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
  })
})

describe('resolvePrayerImageModel', () => {
  it('con clave devuelve el preset de peticiones con modalities de imagen y la misma URL base', () => {
    expect(resolvePrayerImageModel(config('sk-or-x', 'http://127.0.0.1:4010'))).toEqual({ modelId: OPENROUTER_PRAY_REQUESTS_MODEL })
    expect(sdk.createOpenRouter).toHaveBeenLastCalledWith({ apiKey: 'sk-or-x', baseURL: 'http://127.0.0.1:4010' })
    expect(sdk.provider).toHaveBeenCalledWith(OPENROUTER_PRAY_REQUESTS_MODEL, { extraBody: { modalities: ['image', 'text'] } })
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
