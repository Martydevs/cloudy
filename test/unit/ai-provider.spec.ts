// Candidatos de lectura: OpenAI principal y Gemini de respaldo, solo con clave (feature 002, research A11).
import type { RuntimeConfig } from 'nuxt/schema'
import { describe, expect, it } from 'vitest'
import { resolveImageTextCandidates } from '../../server/ai/providers/candidates'

const config = (openaiApikey: string, googleApikey: string) =>
  ({ openaiApikey, openaiOrg: '', openaiProj: '', openaiBaseUrl: '', googleApikey }) as unknown as RuntimeConfig

const modelId = (model: unknown) => (model as { modelId: string }).modelId

describe('resolveImageTextCandidates', () => {
  it('con ambas claves: OpenAI primero y Gemini de respaldo', () => {
    const candidates = resolveImageTextCandidates(config('sk-1', 'g-1'))
    expect(candidates.map(c => c.provider)).toEqual(['openai', 'google'])
    expect(modelId(candidates[0]!.model)).toBe('gpt-4o')
    expect(modelId(candidates[1]!.model)).toBe('gemini-3.5-flash-lite')
    expect(candidates[0]!.providerOptions).toBeUndefined()
    expect(candidates[1]!.providerOptions).toEqual({ google: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } })
  })

  it('omite al proveedor sin clave', () => {
    expect(resolveImageTextCandidates(config('sk-1', '')).map(c => c.provider)).toEqual(['openai'])
    expect(resolveImageTextCandidates(config('', 'g-1')).map(c => c.provider)).toEqual(['google'])
  })

  it('sin claves, o solo con espacios, no hay candidatos', () => {
    expect(resolveImageTextCandidates(config('', ''))).toEqual([])
    expect(resolveImageTextCandidates(config('  ', ' \n'))).toEqual([])
  })
})
