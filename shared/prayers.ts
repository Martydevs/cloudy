// Reglas puras de la página Peticiones (feature 007, research D7 y D10): marcas de ilegible, qué tarjeta se puede elegir
// y cómo se reparten las elegidas en imágenes. Sin dependencias de Nuxt.
import { PRAYER_LONG_TEXT_CHARS } from './constants/prayers'
import type { PrayerRequest } from './types/api'

/**
 * Corchetes en una sola línea que contienen «legible» (`[ilegible]`, `[unlegible]`, `[illegible]`, `[texto ilegible]`,
 * `[ILÉGIBLE]`): sin distinguir mayúsculas ni la tilde de la `e`.
 */
const ILLEGIBLE_SOURCE = String.raw`\[[^\]\n]*l[eé]gible[^\]\n]*\]`

export function hasIllegibleMark(text: string | null | undefined): boolean {
  // Una regex sin `g` por llamada: no arrastra `lastIndex`.
  return !!text && new RegExp(ILLEGIBLE_SOURCE, 'iu').test(text)
}

export interface TextChunk {
  text: string
  mark: boolean
}

/** Trozos del texto con las marcas aparte; concatenados reproducen el original. */
export function splitIllegible(text: string): TextChunk[] {
  const chunks: TextChunk[] = []
  let last = 0
  for (const match of text.matchAll(new RegExp(ILLEGIBLE_SOURCE, 'giu'))) {
    if (match.index > last) chunks.push({ text: text.slice(last, match.index), mark: false })
    chunks.push({ text: match[0], mark: true })
    last = match.index + match[0].length
  }
  if (last < text.length) chunks.push({ text: text.slice(last), mark: false })
  return chunks
}

/** Solo una transcripción lista y no vacía puede ir a una imagen. */
export function isSelectable(request: Pick<PrayerRequest, 'text'>): boolean {
  return request.text.status === 'ready' && (request.text.text ?? '').trim() !== ''
}

export function isLongText(text: string | null | undefined): boolean {
  return (text?.length ?? 0) > PRAYER_LONG_TEXT_CHARS
}

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
