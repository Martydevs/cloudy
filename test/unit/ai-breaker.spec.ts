// Cortacircuito por ejecución del pool de invitados (feature 002, research A6).
import { describe, expect, it } from 'vitest'
import { createProviderBreaker } from '../../server/ai/breaker'
import type { ImageTextCandidate } from '../../server/ai/providers/candidates'

const candidates = [{ provider: 'openai' }, { provider: 'google' }] as ImageTextCandidate[]

describe('createProviderBreaker', () => {
  it('un error persistente abre el proveedor al instante', () => {
    const breaker = createProviderBreaker()
    expect(breaker.recordFailure('openai', true)).toBe(true)
    expect(breaker.isOpen('openai')).toBe(true)
    expect(breaker.isOpen('google')).toBe(false)
    // Ya abierto: no se vuelve a anunciar.
    expect(breaker.recordFailure('openai', true)).toBe(false)
  })

  it('3 fallos transitorios seguidos lo abren; un éxito reinicia la cuenta', () => {
    const breaker = createProviderBreaker()
    breaker.recordFailure('openai', false)
    breaker.recordFailure('openai', false)
    breaker.recordSuccess('openai')
    breaker.recordFailure('openai', false)
    breaker.recordFailure('openai', false)
    expect(breaker.isOpen('openai')).toBe(false)
    expect(breaker.recordFailure('openai', false)).toBe(true)
    expect(breaker.isOpen('openai')).toBe(true)
  })

  it('el umbral es configurable', () => {
    const breaker = createProviderBreaker(1)
    expect(breaker.recordFailure('google', false)).toBe(true)
  })

  it('exhausted solo si todos los candidatos están abiertos', () => {
    const breaker = createProviderBreaker()
    expect(breaker.exhausted(candidates)).toBe(false)
    breaker.recordFailure('openai', true)
    expect(breaker.exhausted(candidates)).toBe(false)
    expect(breaker.exhausted([candidates[0]!])).toBe(true)
    breaker.recordFailure('google', true)
    expect(breaker.exhausted(candidates)).toBe(true)
  })

  it('dos instancias no comparten estado', () => {
    const a = createProviderBreaker()
    const b = createProviderBreaker()
    a.recordFailure('openai', true)
    expect(b.isOpen('openai')).toBe(false)
  })
})
