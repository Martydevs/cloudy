// Regresión: el cliente de OpenAI respeta NUXT_OPENAI_BASE_URL (stub de los e2e, research A9); vacío = API real.
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from 'nuxt/schema'

const createOpenAI = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI }))

const { openaiClient } = await import('../../server/ai/providers/openai')

const config = (openaiBaseUrl: string) =>
  ({ openaiApikey: 'sk-x', openaiOrg: 'org', openaiProj: 'proj', openaiBaseUrl }) as unknown as RuntimeConfig

describe('openaiClient', () => {
  it('usa la URL base configurada (stub de los e2e)', () => {
    openaiClient(config('http://127.0.0.1:4010'))
    expect(createOpenAI).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-x', baseURL: 'http://127.0.0.1:4010' }))
  })

  it('sin URL base va a la API de OpenAI', () => {
    openaiClient(config(''))
    expect(createOpenAI).toHaveBeenLastCalledWith(expect.objectContaining({ baseURL: undefined }))
  })
})
