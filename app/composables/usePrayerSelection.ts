// Selección de la página Peticiones (feature 007, research D10): una copia de cada tarjeta elegida junto al texto que el
// equipo escribe para ella, para que la selección sobreviva a búsquedas, filtros y páginas nuevas y se pueda listar aunque
// el filtro la oculte. Tope de 40; cualquier petición aprobada se puede elegir y el texto se escribe en el diálogo de
// generación. Vive en `useState` y la página la vacía al salir: el texto no se guarda en ningún lado.
import type { PrayerRequest } from '#shared/types/api'
import { PRAYER_MAX_SELECTION, PRAYER_PER_IMAGE } from '#shared/constants/prayers'
import { chunkRequests, orderForImages } from '#shared/prayers'

/** Una petición elegida y su transcripción escrita a mano (vacía hasta que alguien la escribe). */
export interface PrayerSelectionEntry {
  request: PrayerRequest
  text: string
}

export function usePrayerSelection() {
  const state = useState<Record<string, PrayerSelectionEntry>>('prayer-selection', () => ({}))

  const count = computed(() => Object.keys(state.value).length)
  /** En el orden de las imágenes: aprobación, envío, id. */
  const ordered = computed(() => orderForImages(Object.values(state.value).map(entry => entry.request))
    .map(request => state.value[request.id]!)
    .filter(Boolean))
  /** ⌈N / 4⌉ grupos: uno por imagen. */
  const groups = computed(() => chunkRequests(ordered.value, PRAYER_PER_IMAGE))
  const limitReached = computed(() => count.value >= PRAYER_MAX_SELECTION)
  /** Peticiones elegidas a las que todavía les falta el texto: sin ellas no se puede generar. */
  const missingText = computed(() => ordered.value.filter(entry => entry.text.trim() === '').length)
  const ready = computed(() => count.value > 0 && missingText.value === 0)

  const isSelected = (id: string) => id in state.value

  /** Agrega o quita la tarjeta; devuelve si quedó elegida. No agrega con el tope alcanzado. */
  function toggle(request: PrayerRequest): boolean {
    if (isSelected(request.id)) {
      remove([request.id])
      return false
    }
    if (limitReached.value) return false
    state.value = { ...state.value, [request.id]: { request: { ...request }, text: '' } }
    return true
  }

  /** Texto escrito para una petición elegida (el diálogo de generación). */
  function setText(id: string, text: string) {
    const entry = state.value[id]
    if (!entry) return
    state.value = { ...state.value, [id]: { ...entry, text } }
  }

  function remove(ids: readonly string[]) {
    const next = { ...state.value }
    for (const id of ids) delete next[id]
    state.value = next
  }

  function clear() {
    state.value = {}
  }

  return { count, ordered, groups, limitReached, missingText, ready, isSelected, toggle, setText, remove, clear }
}
