// Cliente de OpenRouter: respeta NUXT_OPENROUTER_BASE_URL (stub de los e2e); vacío = API real. Sin clave no hay modelo.
import type { RuntimeConfig } from 'nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const provider = vi.fn((modelId: string) => ({ modelId }))
  return { provider, createOpenRouter: vi.fn(() => provider) }
})
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: sdk.createOpenRouter }))

const { OPENROUTER_DEFAULT_MODEL, openrouterClient, resolveImageTextModel } = await import('../../server/ai/providers/openrouter')

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

describe('resolveImageTextModel', () => {
  it('con clave devuelve el preset de extracción', () => {
    expect(resolveImageTextModel(config('sk-or-x'))).toEqual({ modelId: '@preset/image-content-extraction' })
    expect(sdk.provider).toHaveBeenCalledWith(OPENROUTER_DEFAULT_MODEL)
  })

  it.each([[''], ['   '], [' \n']])('sin clave (%j) → null sin crear el cliente', (key) => {
    expect(resolveImageTextModel(config(key))).toBeNull()
    expect(sdk.createOpenRouter).not.toHaveBeenCalled()
  })
})
