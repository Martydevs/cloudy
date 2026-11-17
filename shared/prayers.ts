// Reglas puras de la página Peticiones (feature 007, research D10): en qué orden van las peticiones elegidas y cómo se
// reparten en imágenes. Sin dependencias de Nuxt.
import { PRAYER_LONG_TEXT_CHARS } from './constants/prayers'
import type { PrayerRequest } from './types/api'

type Orderable = Pick<PrayerRequest, 'id' | 'approvedAt' | 'sentAt'>

/** Orden dentro de las imágenes: por aprobación, luego envío, luego id (ascendente). No cambia la lista recibida. */
export function orderForImages<T extends Orderable>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    Date.parse(a.approvedAt) - Date.parse(b.approvedAt)
    || Date.parse(a.sentAt) - Date.parse(b.sentAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** El texto de una petición es tan largo que puede no caber en la plantilla (aviso, no error). */
export function isLongText(text: string): boolean {
  return text.trim().length > PRAYER_LONG_TEXT_CHARS
}

/** Grupos de `size` en orden: ⌈N / size⌉ grupos, sin partir ninguna petición. */
export function chunkRequests<T>(list: readonly T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size))
  return groups
}

/**
 * Mismas peticiones en cualquier orden (página de generación): así se reconoce qué imagen guardada o en curso es de qué
 * grupo. El servidor reordena las fotos al generar, así que el orden no cuenta.
 */
export function sameRequests(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every(id => set.has(id))
}
