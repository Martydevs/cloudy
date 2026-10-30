// Cortacircuito por ejecución del pool de invitados (feature 002, research A6), con OpenRouter como único proveedor.
import { describe, expect, it } from 'vitest'
import { createProviderBreaker } from '../../server/ai/breaker'

describe('createProviderBreaker', () => {
  it('empieza cerrado', () => {
    expect(createProviderBreaker().isOpen()).toBe(false)
  })

  it('un error persistente lo abre al instante', () => {
    const breaker = createProviderBreaker()
    expect(breaker.recordFailure(true)).toBe(true)
    expect(breaker.isOpen()).toBe(true)
    // Ya abierto: no se vuelve a anunciar.
    expect(breaker.recordFailure(true)).toBe(false)
    expect(breaker.recordFailure(false)).toBe(false)
  })

  it('3 fallos transitorios seguidos lo abren; un éxito reinicia la cuenta', () => {
    const breaker = createProviderBreaker()
    expect(breaker.recordFailure(false)).toBe(false)
    expect(breaker.recordFailure(false)).toBe(false)
    breaker.recordSuccess()
    breaker.recordFailure(false)
    breaker.recordFailure(false)
    expect(breaker.isOpen()).toBe(false)
    expect(breaker.recordFailure(false)).toBe(true)
    expect(breaker.isOpen()).toBe(true)
  })

  it('un éxito no cierra un cortacircuito ya abierto', () => {
    const breaker = createProviderBreaker()
    breaker.recordFailure(true)
    breaker.recordSuccess()
    expect(breaker.isOpen()).toBe(true)
  })

  it('el umbral es configurable', () => {
    const breaker = createProviderBreaker(1)
    expect(breaker.recordFailure(false)).toBe(true)
  })

  it('dos instancias no comparten estado', () => {
    const a = createProviderBreaker()
    const b = createProviderBreaker()
    a.recordFailure(true)
    expect(b.isOpen()).toBe(false)
  })
})
