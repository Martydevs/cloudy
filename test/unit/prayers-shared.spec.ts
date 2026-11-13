// T005 — Reglas puras de la página Peticiones (feature 007, research D7 y D10; data-model § Constantes).
import { describe, expect, it } from 'vitest'
import {
  PRAYER_ERROR_CODES,
  PRAYER_ERROR_MESSAGES,
  PRAYER_HISTORY_MAX_LIMIT,
  PRAYER_HISTORY_PAGE,
  PRAYER_IMAGE_CONCURRENCY,
  PRAYER_IMAGE_MAX_BYTES,
  PRAYER_IMAGE_RETENTION_DAYS,
  PRAYER_IMAGE_TIMEOUT_MS,
  PRAYER_LONG_TEXT_CHARS,
  PRAYER_MAX_SELECTION,
  PRAYER_PAGE_SIZE,
  PRAYER_PER_IMAGE,
} from '../../shared/constants/prayers'
import { chunkRequests, hasIllegibleMark, isLongText, isSelectable, orderForImages, splitIllegible } from '../../shared/prayers'
import type { ImageText } from '../../shared/types/api'

const text = (changes: Partial<ImageText> = {}): ImageText =>
  ({ status: 'ready', text: 'Oremos por Ana', error: null, readAt: null, editedAt: null, editedBy: null, ...changes })

describe('constantes', () => {
  it('límites de la feature', () => {
    expect(PRAYER_PER_IMAGE).toBe(4)
    expect(PRAYER_MAX_SELECTION).toBe(40)
    expect(PRAYER_PAGE_SIZE).toBe(12)
    expect(PRAYER_LONG_TEXT_CHARS).toBe(600)
    expect(PRAYER_IMAGE_CONCURRENCY).toBe(2)
    expect(PRAYER_IMAGE_TIMEOUT_MS).toBe(110_000)
    expect(PRAYER_IMAGE_MAX_BYTES).toBe(4_000_000)
    expect(PRAYER_IMAGE_RETENTION_DAYS).toBe(30)
    expect(PRAYER_HISTORY_PAGE).toBe(12)
    expect(PRAYER_HISTORY_MAX_LIMIT).toBe(48)
  })

  it('cada código de error tiene un texto en español', () => {
    expect([...PRAYER_ERROR_CODES].sort()).toEqual(
      ['invalid_output', 'not_configured', 'provider', 'quota_exceeded', 'rate_limited', 'request_unavailable', 'save_failed', 'timeout', 'too_large'],
    )
    for (const code of PRAYER_ERROR_CODES) {
      expect(PRAYER_ERROR_MESSAGES[code].trim(), code).not.toBe('')
      expect(PRAYER_ERROR_MESSAGES[code], code).not.toMatch(/\b(error|failed|server|timeout|provider)\b/i)
    }
    expect(Object.keys(PRAYER_ERROR_MESSAGES).sort()).toEqual([...PRAYER_ERROR_CODES].sort())
  })
})

describe('hasIllegibleMark', () => {
  it.each(['[ilegible]', '[unlegible]', '[illegible]', '[texto ilegible]', '[ILEGIBLE]', '[Ilégible]', '[ILÉGIBLE]', 'Oremos por [ilegible] y su familia'])(
    '%s → true',
    value => expect(hasIllegibleMark(value)).toBe(true),
  )

  it.each(['legible', 'texto legible sin corchetes', '[nombre]', '[ile\ngible]', '[ilegible\n]', '', null, undefined])(
    '%j → false',
    value => expect(hasIllegibleMark(value)).toBe(false),
  )

  it('no arrastra estado entre llamadas', () => {
    for (let i = 0; i < 4; i++) expect(hasIllegibleMark('[ilegible]')).toBe(true)
  })
})

describe('splitIllegible', () => {
  it('separa las marcas y reproduce el texto original', () => {
    const value = 'Oremos por [ilegible] y por [Texto ILÉGIBLE].'
    const chunks = splitIllegible(value)
    expect(chunks).toEqual([
      { text: 'Oremos por ', mark: false },
      { text: '[ilegible]', mark: true },
      { text: ' y por ', mark: false },
      { text: '[Texto ILÉGIBLE]', mark: true },
      { text: '.', mark: false },
    ])
    expect(chunks.map(c => c.text).join('')).toBe(value)
  })

  it('sin marcas devuelve un solo trozo; con solo una marca, uno marcado; vacío, ninguno', () => {
    expect(splitIllegible('Gracias')).toEqual([{ text: 'Gracias', mark: false }])
    expect(splitIllegible('[ilegible]')).toEqual([{ text: '[ilegible]', mark: true }])
    expect(splitIllegible('')).toEqual([])
  })
})

describe('isSelectable e isLongText', () => {
  it('solo un texto ready no vacío se puede elegir', () => {
    expect(isSelectable({ text: text() })).toBe(true)
    expect(isSelectable({ text: text({ text: '   ' }) })).toBe(false)
    expect(isSelectable({ text: text({ text: null }) })).toBe(false)
    for (const status of ['pending', 'reading', 'empty', 'failed', 'unavailable'] as const) {
      expect(isSelectable({ text: text({ status }) }), status).toBe(false)
    }
  })

  it('largo con más de 600 caracteres', () => {
    expect(isLongText('a'.repeat(600))).toBe(false)
    expect(isLongText('a'.repeat(601))).toBe(true)
    expect(isLongText(null)).toBe(false)
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
