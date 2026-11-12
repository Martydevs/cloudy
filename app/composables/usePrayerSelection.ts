// Selección de la página Peticiones (feature 007, research D10): una copia de cada tarjeta elegida, para que la selección
// sobreviva a búsquedas, filtros y páginas nuevas y se pueda listar aunque el filtro la oculte. Tope de 40; solo se
// eligen tarjetas con texto. Vive en `useState` y la página la vacía al salir.
import type { PrayerRequest } from '#shared/types/api'
import { PRAYER_MAX_SELECTION, PRAYER_PER_IMAGE } from '#shared/constants/prayers'
import { chunkRequests, hasIllegibleMark, isSelectable, orderForImages } from '#shared/prayers'

export function usePrayerSelection() {
  const state = useState<Record<string, PrayerRequest>>('prayer-selection', () => ({}))

  const count = computed(() => Object.keys(state.value).length)
  /** En el orden de las imágenes: aprobación, envío, id. */
  const ordered = computed(() => orderForImages(Object.values(state.value)))
  /** ⌈N / 4⌉ grupos: uno por imagen. */
  const groups = computed(() => chunkRequests(ordered.value, PRAYER_PER_IMAGE))
  const unreadable = computed(() => ordered.value.filter(request => hasIllegibleMark(request.text.text)))
  const limitReached = computed(() => count.value >= PRAYER_MAX_SELECTION)

  const isSelected = (id: string) => id in state.value

  /** Agrega o quita la tarjeta; devuelve si quedó elegida. No agrega sin texto ni con el tope alcanzado. */
  function toggle(request: PrayerRequest): boolean {
    if (isSelected(request.id)) {
      remove([request.id])
      return false
    }
    if (!isSelectable(request) || limitReached.value) return false
    state.value = { ...state.value, [request.id]: { ...request } }
    return true
  }

  function remove(ids: readonly string[]) {
    const next = { ...state.value }
    for (const id of ids) delete next[id]
    state.value = next
  }

  function clear() {
    state.value = {}
  }

  /** Tras corregir una transcripción: actualiza la copia elegida, o la quita si ya no se puede elegir. */
  function sync(request: PrayerRequest) {
    if (!isSelected(request.id)) return
    if (isSelectable(request)) state.value = { ...state.value, [request.id]: { ...request } }
    else remove([request.id])
  }

  return { count, ordered, groups, unreadable, limitReached, isSelected, toggle, remove, clear, sync }
}
