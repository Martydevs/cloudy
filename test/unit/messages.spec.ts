// Textos centralizados de avisos y errores (T153): plural y ausencia de inglés.
import { describe, expect, it } from 'vitest'
import { messages, pluralize } from '../../app/utils/messages'
import { LAST_ADMIN_MESSAGE } from '../../shared/constants/messages'

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

  // Selección múltiple de Archivos: un solo aviso y una sola confirmación para todo lo marcado.
  it('papelera de varios elementos: cuenta lo enviado y, aparte, lo que ya no estaba', () => {
    const { trashedMany, trashManyConfirm, trashManyHint } = messages.files
    expect(trashedMany(1)).toBe('Se envió 1 elemento a la papelera')
    expect(trashedMany(3)).toBe('Se enviaron 3 elementos a la papelera')
    expect(trashedMany(1, 1)).toBe('Se envió 1 elemento a la papelera. 1 ya no estaba disponible.')
    expect(trashedMany(2, 3)).toBe('Se enviaron 2 elementos a la papelera. 3 ya no estaban disponibles.')

    expect(trashManyConfirm(1)).toBe('¿Enviar 1 elemento a la papelera?')
    expect(trashManyConfirm(4)).toBe('¿Enviar 4 elementos a la papelera?')

    // Sin carpetas solo dice cómo recuperar; con carpetas avisa de que van con su contenido.
    expect(trashManyHint(1, 0)).toBe('Puedes recuperarlo desde Papelera.')
    expect(trashManyHint(2, 0)).toBe('Puedes recuperarlos desde Papelera.')
    expect(trashManyHint(1, 1)).toBe('La carpeta se envía con todo su contenido. Puedes recuperarlo desde Papelera.')
    expect(trashManyHint(3, 1)).toBe('La carpeta se envía con todo su contenido. Puedes recuperarlos desde Papelera.')
    expect(trashManyHint(3, 2)).toBe('Las carpetas se envían con todo su contenido. Puedes recuperarlos desde Papelera.')
  })

  // Selección múltiple de Usuarios: cuántas cambiaron y por qué no las demás.
  it('cambio de varias cuentas: concuerda cada parte y nombra la regla del último administrador', () => {
    const { bulkDone } = messages.users
    expect(bulkDone(1)).toBe('1 cuenta actualizada.')
    expect(bulkDone(2)).toBe('2 cuentas actualizadas.')
    expect(bulkDone(0, 1)).toBe('0 cuentas actualizadas. 1 no se cambió: debe existir al menos un administrador activo.')
    expect(bulkDone(1, 2)).toBe('1 cuenta actualizada. 2 no se cambiaron: debe existir al menos un administrador activo.')
    expect(bulkDone(1, 0, 1)).toBe('1 cuenta actualizada. 1 ya estaba así o ya no existe.')
    expect(bulkDone(3, 0, 2)).toBe('3 cuentas actualizadas. 2 ya estaban así o ya no existen.')
    expect(bulkDone(3, 1, 2)).toBe('3 cuentas actualizadas. 1 no se cambió: debe existir al menos un administrador activo. 2 ya estaban así o ya no existen.')
    // El motivo es el mismo texto que responde el servidor en el 409 de una sola cuenta.
    expect(bulkDone(0, 1)).toContain(LAST_ADMIN_MESSAGE.toLowerCase())
  })

  it('confirmaciones de varias cuentas: singular, plural y el aviso de la propia cuenta', () => {
    const { bulkRemoveConfirm, bulkRemoveHint, bulkDisableSelfConfirm, bulkDisableSelfHint } = messages.users
    expect(bulkRemoveConfirm(1)).toBe('¿Eliminar 1 cuenta?')
    expect(bulkRemoveConfirm(3)).toBe('¿Eliminar 3 cuentas?')
    expect(bulkRemoveHint(1, false)).toBe('Perderá el acceso a Cloudy. Sus archivos y su historial se conservan.')
    expect(bulkRemoveHint(2, false)).toBe('Perderán el acceso a Cloudy. Sus archivos y su historial se conservan.')
    expect(bulkRemoveHint(1, true)).toBe('Perderá el acceso a Cloudy. Sus archivos y su historial se conservan. Tu propia cuenta está en la selección: perderás el acceso en cuanto confirmes.')
    expect(bulkRemoveHint(2, true)).toBe('Perderán el acceso a Cloudy. Sus archivos y su historial se conservan. Tu propia cuenta está en la selección: perderás el acceso en cuanto confirmes.')
    expect(bulkDisableSelfConfirm(1)).toBe('¿Desactivar tu propia cuenta?')
    expect(bulkDisableSelfConfirm(3)).toBe('¿Desactivar 3 cuentas, incluida la tuya?')
    expect(bulkDisableSelfHint).toMatch(/Solo otro administrador podrá reactivar tu cuenta/)
  })

  it('los fallos de la selección dicen qué hacer', () => {
    expect(messages.files.trashManyFailed).toMatch(/inténtalo de nuevo/i)
    expect(messages.users.bulkFailed).toMatch(/inténtalo de nuevo/i)
    expect(messages.files.trashedNone).toMatch(/Actualizamos la lista/)
    // Un lote que falla entero con causas distintas: manda a ver la de cada video.
    expect(messages.youtube.downloads.failed).toMatch(/Revisa el motivo de cada uno/)
  })
})
