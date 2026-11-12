// Filtros de la página Peticiones (feature 007, contracts/ui.md § Filtros): búsqueda, fecha de **aprobación** y orden →
// la query de `GET /api/peticiones`. Los días son los de la zona horaria de quien mira y viajan como instantes ISO:
// `from` inclusivo y `to` exclusivo, como los valida `prayersQuery`. Cambiar un filtro reinicia la lista (lo hace
// `usePrayerRequests` al cambiar la query) y nunca toca la selección.
import type { PrayersDir, PrayersQuery } from '#shared/validation/prayers'

export type PrayerDatePreset = 'all' | 'today' | 'week' | 'range'

/** Pausa tras teclear antes de buscar (FR-028). */
const SEARCH_DEBOUNCE_MS = 300
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 00:00 local de `AAAA-MM-DD` desplazado `days` días; `null` si no es una fecha real. */
function localDay(ymd: string, days = 0): Date | null {
  const match = YMD_RE.exec(ymd)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const date = new Date(year, month, day)
  // `new Date(2026, 1, 31)` salta a marzo: una fecha imposible no se acepta.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  date.setDate(date.getDate() + days)
  return date
}

/** 00:00 local de hoy desplazado `days` días. */
function today(days = 0): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
}

export function usePrayerFilters() {
  const m = messages.prayers
  const q = ref('')
  const preset = ref<PrayerDatePreset>('all')
  const from = ref('')
  const to = ref('')
  const dir = ref<PrayersDir>('desc')

  /** Búsqueda aplicada: tras la pausa, o al instante si queda en blanco (limpiar no espera). */
  const search = ref('')
  const applySearch = useDebounceFn((value: string) => {
    search.value = value.trim()
  }, SEARCH_DEBOUNCE_MS)
  watch(q, (value) => {
    // Siempre pasa por la función con espera: así una búsqueda pendiente no llega después de limpiar.
    void applySearch(value)
    if (!value.trim()) search.value = ''
  })

  /** El rango, si está completo y en orden: `[desde 00:00, día siguiente a hasta 00:00)`. */
  const range = computed(() => {
    const start = localDay(from.value)
    const end = localDay(to.value, 1)
    return start && end && start < end ? { start, end } : null
  })
  const rangeError = computed(() => (preset.value === 'range' && localDay(from.value) && localDay(to.value) && !range.value ? m.rangeInverted : null))

  const period = computed<{ start: Date, end: Date } | null>(() => {
    switch (preset.value) {
      case 'today': return { start: today(), end: today(1) }
      case 'week': return { start: today(-6), end: today(1) }
      case 'range': return range.value
      default: return null
    }
  })

  const query = computed<PrayersQuery>(() => ({
    ...(search.value ? { q: search.value } : {}),
    ...(period.value ? { from: period.value.start.toISOString(), to: period.value.end.toISOString() } : {}),
    dir: dir.value,
  }))

  /** Hay algo que acota el resultado (el orden no cuenta). */
  const hasFilters = computed(() => !!search.value || !!period.value)

  const activeSummary = computed(() => {
    const parts: string[] = []
    if (search.value) parts.push(m.summarySearch(search.value))
    if (preset.value === 'today') parts.push(m.summaryToday)
    else if (preset.value === 'week') parts.push(m.summaryWeek)
    else if (range.value && preset.value === 'range') {
      parts.push(m.summaryRange(formatDate(range.value.start.toISOString()), formatDate(localDay(to.value)!.toISOString())))
    }
    return parts.length > 0 ? parts.join(' · ') : null
  })

  function reset() {
    q.value = ''
    search.value = ''
    preset.value = 'all'
    from.value = ''
    to.value = ''
    dir.value = 'desc'
  }

  return { q, preset, from, to, dir, query, hasFilters, activeSummary, rangeError, reset }
}
