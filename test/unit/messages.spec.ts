// Textos centralizados de avisos y errores (T153): plural y ausencia de inglés.
import { describe, expect, it } from 'vitest'
import { messages, pluralize } from '../../app/utils/messages'

describe('pluralize', () => {
  it('concuerda el sustantivo con la cantidad', () => {
    expect(pluralize(1, 'elemento', 'elementos')).toBe('1 elemento')
    expect(pluralize(0, 'elemento', 'elementos')).toBe('0 elementos')
    expect(pluralize(4, 'archivo', 'archivos')).toBe('4 archivos')
  })
})

describe('messages', () => {
  /** Todas las cadenas del árbol; las funciones se evalúan con argumentos de muestra. */
  function collect(node: unknown): string[] {
    if (typeof node === 'string') return [node]
    if (typeof node === 'function') return [(node as (...args: unknown[]) => string)('muestra', 'muestra')]
    if (node && typeof node === 'object') return Object.values(node).flatMap(collect)
    return []
  }

  it('ningún texto deja pasar las frases en inglés del servidor', () => {
    const texts = collect(messages)
    expect(texts.length).toBeGreaterThan(40)
    for (const text of texts) {
      expect(text, text).not.toMatch(/\b(error|failed|server|unauthorized|forbidden|not found|too many)\b/i)
      expect(text.trim(), text).toBe(text)
    }
  })

  it('el mensaje común del 429 dice qué hacer', () => {
    expect(messages.common.rateLimited).toMatch(/inténtalo de nuevo/i)
  })

  it('los avisos con cantidad concuerdan en singular y plural', () => {
    expect(messages.trash.emptied(1)).toBe('Se eliminó 1 elemento definitivamente')
    expect(messages.trash.emptied(3)).toBe('Se eliminaron 3 elementos definitivamente')
    expect(messages.files.uploadFailedCount(1)).toBe('Un archivo no se pudo subir')
    expect(messages.files.uploadFailedCount(2)).toBe('2 archivos no se pudieron subir')
    expect(messages.submissions.received('Eva', 1)).toBe('Nuevo envío de Eva (1 archivo)')
  })
})
