// Datos del calendario de días de trabajo. La lista «Próximos días» va en el SSR (`useUpcomingWorkDays`); el calendario
// pide meses completos, los guarda por clave de mes en `useState` y precarga el anterior y el siguiente, así volver a
// un mes ya visto es instantáneo (la carga dinámica del componente de calendario es de pago: esta es la nuestra). Tras
// cada cambio se vuelven a pedir los meses conocidos y la lista, para que todas las vistas digan lo mismo.
import { UPCOMING_WORK_DAYS, WORK_DAY_STATUS_LABELS } from '#shared/constants/calendar'
import type { WorkDay, WorkDayDetail, WorkDayList, WorkDayStatus } from '#shared/types/api'
import type { WorkDayInput } from '#shared/validation/calendar'
import { addDays, todayInCalendarZone } from '#shared/validation/calendar'

export const UPCOMING_KEY = 'work-days-upcoming'

export interface CalendarMonth {
  status: 'loading' | 'ready' | 'error'
  items: WorkDay[]
}

/** «Hoy» en la zona de la iglesia, fijado en el SSR para que la hidratación pida el mismo rango. */
export function useCalendarToday() {
  return useState('work-calendar-today', () => todayInCalendarZone())
}

/** Los próximos 30 días (`GET /api/calendario`), compartidos por clave. */
export function useUpcomingWorkDays() {
  const today = useCalendarToday()
  return useApiFetch<WorkDayList>('/api/calendario', {
    key: UPCOMING_KEY,
    query: { from: today.value, to: addDays(today.value, UPCOMING_WORK_DAYS - 1) },
  })
}

export function useWorkCalendar() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const m = messages.calendar
  const months = useState<Record<string, CalendarMonth>>('work-calendar-months', () => ({}))

  function setMonth(key: string, month: CalendarMonth) {
    months.value = { ...months.value, [key]: month }
  }

  /** Pide un mes si no se tiene (o si falló antes); `force` lo vuelve a pedir conservando lo que ya se ve. */
  async function loadMonth(key: string, force = false): Promise<void> {
    const known = months.value[key]
    if (known && !force && known.status !== 'error') return
    setMonth(key, { status: 'loading', items: known?.items ?? [] })
    try {
      const { items } = await api<WorkDayList>('/api/calendario', { query: monthRange(key) })
      setMonth(key, { status: 'ready', items })
    }
    catch {
      setMonth(key, { status: 'error', items: known?.items ?? [] })
    }
  }

  /** Carga el mes de la fecha visible y precarga sus vecinos. */
  function show(date: Date): Promise<void[]> {
    return Promise.all(monthsAround(date).map(key => loadMonth(key)))
  }

  /** Todos los días conocidos, sin repetir, en orden de fecha. */
  const days = computed(() => Object.keys(months.value).sort().flatMap(key => months.value[key]!.items))

  function monthOf(date: Date): CalendarMonth | undefined {
    return months.value[monthKey(date)]
  }

  /** Vuelve a pedir los meses ya conocidos (al volver a la página: otra persona pudo cambiar algo). */
  function revalidate(): Promise<void[]> {
    return Promise.all(Object.keys(months.value).map(key => loadMonth(key, true)))
  }

  /** Después de crear, editar, cambiar el estado o borrar. */
  async function refresh(): Promise<void> {
    await Promise.all([refreshNuxtData(UPCOMING_KEY), revalidate()])
  }

  /** Crea (sin `id`) o reemplaza un día. `null` si falló (el aviso ya se mostró). */
  async function save(input: WorkDayInput, id?: string): Promise<WorkDayDetail | null> {
    try {
      const day = await api<WorkDayDetail>(id ? `/api/calendario/${id}` : '/api/calendario', { method: id ? 'PATCH' : 'POST', body: input })
      toast.success(id ? m.updated(day.title) : m.created(day.title))
      await refresh()
      return day
    }
    catch (error) {
      toast.error(serverMessage(error, id ? m.updateFailed : m.createFailed))
      return null
    }
  }

  async function setStatus(day: Pick<WorkDay, 'id' | 'title'>, status: WorkDayStatus): Promise<boolean> {
    try {
      await api(`/api/calendario/${day.id}/estado`, { method: 'PATCH', body: { status } })
      toast.success(m.statusChanged(day.title, WORK_DAY_STATUS_LABELS[status]))
      await refresh()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.statusFailed))
      return false
    }
  }

  /** Pide confirmación antes de borrar. */
  async function remove(day: Pick<WorkDay, 'id' | 'title'>): Promise<boolean> {
    const ok = await confirm({ title: m.deleteConfirm(day.title), message: m.deleteBody, confirmLabel: 'Eliminar día', danger: true })
    if (!ok) return false
    try {
      // Como texto: la plantilla también encaja con `/api/calendario/miembros` (solo GET) y el tipo de la ruta se confunde.
      const url: string = `/api/calendario/${day.id}`
      await api(url, { method: 'DELETE' })
      toast.success(m.deleted(day.title))
      await refresh()
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, m.deleteFailed))
      return false
    }
  }

  return { months, days, monthOf, show, loadMonth, revalidate, refresh, save, setStatus, remove }
}
