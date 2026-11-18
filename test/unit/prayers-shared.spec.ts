// T005 — Reglas puras de la página Peticiones (feature 007, research D10; data-model § Constantes).
import { describe, expect, it } from 'vitest'
import {
  PRAYER_ERROR_CODES,
  PRAYER_ERROR_MESSAGES,
  PRAYER_GENERATION_MAX_IMAGES,
  PRAYER_HISTORY_MAX_LIMIT,
  PRAYER_HISTORY_PAGE,
  PRAYER_IMAGE_CONCURRENCY,
  PRAYER_IMAGE_MAX_BYTES,
  PRAYER_IMAGE_RETENTION_DAYS,
  PRAYER_IMAGE_TIMEOUT_MS,
  PRAYER_MAX_SELECTION,
  PRAYER_PAGE_SIZE,
  PRAYER_PER_IMAGE,
} from '../../shared/constants/prayers'
import { chunkRequests, orderForImages, sameRequests } from '../../shared/prayers'

describe('constantes', () => {
  it('límites de la feature', () => {
    expect(PRAYER_PER_IMAGE).toBe(4)
    expect(PRAYER_MAX_SELECTION).toBe(40)
    expect(PRAYER_PAGE_SIZE).toBe(12)
    expect(PRAYER_IMAGE_CONCURRENCY).toBe(2)
    expect(PRAYER_IMAGE_TIMEOUT_MS).toBe(110_000)
    expect(PRAYER_IMAGE_MAX_BYTES).toBe(4_000_000)
    expect(PRAYER_IMAGE_RETENTION_DAYS).toBe(30)
    expect(PRAYER_HISTORY_PAGE).toBe(12)
    expect(PRAYER_HISTORY_MAX_LIMIT).toBe(48)
    // Una generación: el tope de la selección repartido de 4 en 4.
    expect(PRAYER_GENERATION_MAX_IMAGES).toBe(10)
  })

  it('cada código de error tiene un texto en español', () => {
    expect([...PRAYER_ERROR_CODES].sort()).toEqual([
      'generation_mismatch', 'generation_not_found', 'invalid_output', 'not_configured', 'provider', 'quota_exceeded', 'rate_limited',
      'request_unavailable', 'save_failed', 'timeout', 'too_large', 'unreadable_image',
    ])
    for (const code of PRAYER_ERROR_CODES) {
      expect(PRAYER_ERROR_MESSAGES[code].trim(), code).not.toBe('')
      expect(PRAYER_ERROR_MESSAGES[code], code).not.toMatch(/\b(error|failed|server|timeout|provider)\b/i)
    }
    expect(Object.keys(PRAYER_ERROR_MESSAGES).sort()).toEqual([...PRAYER_ERROR_CODES].sort())
  })
})

describe('orderForImages', () => {
  const r = (id: string, approvedAt: string, sentAt = '2026-11-01T10:00:00.000Z') => ({ id, approvedAt, sentAt })

  it('ordena por aprobación, envío e id sin importar el orden de entrada y sin mutarla', () => {
    const input = [
      r('c', '2026-11-07T10:00:00.000Z'),
      r('b', '2026-11-07T09:00:00.000Z', '2026-11-02T10:00:00.000Z'),
      r('a', '2026-11-07T09:00:00.000Z', '2026-11-01T10:00:00.000Z'),
      r('e', '2026-11-07T08:00:00.000Z'),
      r('d', '2026-11-07T08:00:00.000Z'),
    ]
    const copy = [...input]
    expect(orderForImages(input).map(x => x.id)).toEqual(['d', 'e', 'a', 'b', 'c'])
    expect(input).toEqual(copy)
    expect(orderForImages([...input].reverse()).map(x => x.id)).toEqual(['d', 'e', 'a', 'b', 'c'])
  })
})

describe('chunkRequests', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i)

  it.each([[0, 0], [1, 1], [4, 1], [5, 2], [8, 2], [9, 3], [40, 10]])('%i peticiones → %i grupos', (n, groups) => {
    const chunks = chunkRequests(list(n), 4)
    expect(chunks).toHaveLength(groups)
    expect(chunks.flat()).toEqual(list(n))
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4)
  })

  it('la quinta abre el segundo grupo', () => {
    expect(chunkRequests(list(5), 4)).toEqual([[0, 1, 2, 3], [4]])
  })
})

describe('sameRequests (página de generación)', () => {
  it('mismas peticiones en cualquier orden', () => {
    expect(sameRequests(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameRequests(['a'], ['a'])).toBe(true)
    expect(sameRequests([], [])).toBe(true)
  })

  it('distinto tamaño o distintos ids no coinciden', () => {
    expect(sameRequests(['a', 'b'], ['a'])).toBe(false)
    expect(sameRequests(['a'], ['a', 'b'])).toBe(false)
    expect(sameRequests(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameRequests([], ['a'])).toBe(false)
  })
})
