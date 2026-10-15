import { describe, expect, it } from 'vitest'
import { hashSender, windowStart } from '../../server/utils/rate-limit'

describe('windowStart', () => {
  it('alinea al inicio de la ventana', () => {
    expect(windowStart(new Date('2026-10-14T10:07:30Z'), 900).toISOString()).toBe('2026-10-14T10:00:00.000Z')
  })
  it('el borde exacto abre una ventana nueva', () => {
    expect(windowStart(new Date('2026-10-14T10:15:00Z'), 900).toISOString()).toBe('2026-10-14T10:15:00.000Z')
    expect(windowStart(new Date('2026-10-14T10:14:59.999Z'), 900).toISOString()).toBe('2026-10-14T10:00:00.000Z')
  })
  it('ventanas de una hora', () => {
    expect(windowStart(new Date('2026-10-14T10:59:59Z'), 3600).toISOString()).toBe('2026-10-14T10:00:00.000Z')
  })
})

describe('hashSender', () => {
  it('es determinista y no expone la IP', () => {
    const hash = hashSender('203.0.113.7', 'sal')
    expect(hash).toBe(hashSender('203.0.113.7', 'sal'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('203.0.113.7')
  })
  it('depende de la sal y de la IP', () => {
    expect(hashSender('203.0.113.7', 'sal')).not.toBe(hashSender('203.0.113.7', 'otra'))
    expect(hashSender('203.0.113.7', 'sal')).not.toBe(hashSender('203.0.113.8', 'sal'))
  })
})
