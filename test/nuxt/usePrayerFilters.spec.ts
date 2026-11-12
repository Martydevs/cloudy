// T074 — Filtros de Peticiones (feature 007, contracts/ui.md § Filtros): búsqueda con espera, presets de fecha de
// aprobación en el día local, rango inclusivo para la persona y orden. Los instantes esperados se calculan con el reloj
// local (como el composable), así la prueba no depende de la zona de la máquina.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePrayerFilters } from '~/composables/usePrayerFilters'

/** Instante ISO de las 00:00 locales de ese día (`month` 1-based). */
const local = (year: number, month: number, day: number) => new Date(year, month - 1, day).toISOString()

beforeEach(() => {
  // Jueves 12 nov 2026, 15:30 local.
  vi.useFakeTimers({ now: new Date(2026, 10, 12, 15, 30), toFake: ['Date', 'setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePrayerFilters', () => {
  it('por defecto: solo dir desc, sin filtros ni resumen', () => {
    const filters = usePrayerFilters()
    expect(filters.query.value).toEqual({ dir: 'desc' })
    expect(filters.hasFilters.value).toBe(false)
    expect(filters.activeSummary.value).toBeNull()
  })

  it('q se aplica recortado tras 300 ms sin teclear; en blanco no se envía', async () => {
    const filters = usePrayerFilters()
    filters.q.value = '  oración '
    await nextTick()
    expect(filters.query.value.q).toBeUndefined()
    vi.advanceTimersByTime(299)
    await nextTick()
    expect(filters.query.value.q).toBeUndefined()
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(filters.query.value).toEqual({ q: 'oración', dir: 'desc' })
    expect(filters.hasFilters.value).toBe(true)
    expect(filters.activeSummary.value).toBe('Buscando «oración»')

    filters.q.value = '   '
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(filters.query.value).toEqual({ dir: 'desc' })
  })

  it('Hoy = [inicio del día local, inicio del día siguiente)', () => {
    const filters = usePrayerFilters()
    filters.preset.value = 'today'
    expect(filters.query.value).toEqual({ from: local(2026, 11, 12), to: local(2026, 11, 13), dir: 'desc' })
    expect(filters.activeSummary.value).toBe('Aprobadas hoy')
  })

  it('7 días = [inicio del día local − 6 días, mañana)', () => {
    const filters = usePrayerFilters()
    filters.preset.value = 'week'
    expect(filters.query.value).toEqual({ from: local(2026, 11, 6), to: local(2026, 11, 13), dir: 'desc' })
    expect(filters.activeSummary.value).toBe('Aprobadas en los últimos 7 días')
  })

  it('Rango = desde 00:00 local hasta el final del día «hasta» (24:00 local), como instantes ISO', () => {
    const filters = usePrayerFilters()
    filters.preset.value = 'range'
    filters.from.value = '2026-10-30'
    filters.to.value = '2026-11-02'
    expect(filters.query.value).toEqual({ from: local(2026, 10, 30), to: local(2026, 11, 3), dir: 'desc' })
    expect(filters.activeSummary.value).toBe(`Aprobadas del ${formatDate(local(2026, 10, 30))} al ${formatDate(local(2026, 11, 2))}`)
    // Un solo día también vale: desde = hasta.
    filters.to.value = '2026-10-30'
    expect(filters.query.value).toEqual({ from: local(2026, 10, 30), to: local(2026, 10, 31), dir: 'desc' })
  })

  it('un rango incompleto, inválido o invertido no se envía y no cuenta como filtro', () => {
    const filters = usePrayerFilters()
    filters.preset.value = 'range'
    filters.from.value = '2026-11-02'
    expect(filters.query.value).toEqual({ dir: 'desc' })
    expect(filters.hasFilters.value).toBe(false)
    expect(filters.rangeError.value).toBeNull()
    filters.to.value = '2026-10-30'
    expect(filters.query.value).toEqual({ dir: 'desc' })
    expect(filters.rangeError.value).toBe('La fecha «hasta» no puede ser anterior a «desde»')
    filters.to.value = 'no-es-fecha'
    expect(filters.query.value).toEqual({ dir: 'desc' })
  })

  it('el orden se envía siempre y no es un filtro', () => {
    const filters = usePrayerFilters()
    filters.dir.value = 'asc'
    expect(filters.query.value).toEqual({ dir: 'asc' })
    expect(filters.hasFilters.value).toBe(false)
  })

  it('el resumen junta la búsqueda y la fecha; reset() vuelve a los valores por defecto', async () => {
    const filters = usePrayerFilters()
    filters.q.value = 'Ana'
    filters.preset.value = 'today'
    filters.dir.value = 'asc'
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(filters.activeSummary.value).toBe('Buscando «Ana» · Aprobadas hoy')

    filters.reset()
    vi.advanceTimersByTime(300)
    await nextTick()
    expect([filters.q.value, filters.preset.value, filters.from.value, filters.to.value, filters.dir.value]).toEqual(['', 'all', '', '', 'desc'])
    expect(filters.query.value).toEqual({ dir: 'desc' })
    expect(filters.hasFilters.value).toBe(false)
  })

  it('reset() quita la búsqueda al instante, sin esperar la pausa de 300 ms', async () => {
    const filters = usePrayerFilters()
    filters.q.value = 'Ana'
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(filters.query.value.q).toBe('Ana')
    filters.reset()
    expect(filters.query.value).toEqual({ dir: 'desc' })
  })

  it('limpiar la búsqueda aplica al instante y una búsqueda pendiente no llega después', async () => {
    const filters = usePrayerFilters()
    filters.q.value = 'Ana'
    await nextTick()
    vi.advanceTimersByTime(300)
    filters.q.value = 'Ana Ma'
    await nextTick()
    filters.q.value = ''
    await nextTick()
    expect(filters.query.value).toEqual({ dir: 'desc' })
    vi.advanceTimersByTime(1000)
    expect(filters.query.value).toEqual({ dir: 'desc' })
  })
})
