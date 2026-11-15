// Reglas puras de la página Peticiones (feature 007, research D10): en qué orden van las peticiones elegidas y cómo se
// reparten en imágenes. Sin dependencias de Nuxt.
import type { PrayerRequest } from './types/api'

type Orderable = Pick<PrayerRequest, 'id' | 'approvedAt' | 'sentAt'>

/** Orden dentro de las imágenes: por aprobación, luego envío, luego id (ascendente). No cambia la lista recibida. */
export function orderForImages<T extends Orderable>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    Date.parse(a.approvedAt) - Date.parse(b.approvedAt)
    || Date.parse(a.sentAt) - Date.parse(b.sentAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Grupos de `size` en orden: ⌈N / size⌉ grupos, sin partir ninguna petición. */
export function chunkRequests<T>(list: readonly T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size))
  return groups
}
