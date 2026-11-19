// Lógica pura del calendario de días de trabajo: convierte los días en eventos (uno por rango de hora), calcula qué
// meses pedir y arma los textos de fecha. Fechas y horas son «de pared»: se construyen como `Date` local y se ven igual
// para todo el equipo. Sin dependencias del componente de calendario, que solo conoce `WorkCalendar.vue`.
import type { InjectionKey } from 'vue'
import type { WorkDay, WorkDayKind, WorkDaySlot, WorkDayStatus } from '#shared/types/api'

export type CalendarView = 'day' | 'week' | 'month'

export const CALENDAR_VIEWS: { id: CalendarView, label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
]

/** Evento del calendario: un rango de hora de un día. `id` es el del rango. */
export interface WorkCalendarEvent {
  id: string
  text: string
  start: Date
  end: Date
  workDayId: string
  kind: WorkDayKind
  status: WorkDayStatus
  auditorium: string
}

/** Cómo abre un evento el detalle de su día (lo provee `WorkCalendar`, lo usa `WorkCalendarEvent`). */
export const OPEN_WORK_DAY: InjectionKey<(workDayId: string) => void> = Symbol('open-work-day')

const pad = (n: number) => String(n).padStart(2, '0')

/** `AAAA-MM-DD` + `HH:MM` → `Date` en la hora local de quien mira (hora de pared). */
export function localDate(date: string, time = '00:00'): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return new Date(year, month - 1, day, hours, minutes)
}

/** `Date` local → `AAAA-MM-DD`. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toCalendarEvents(days: readonly WorkDay[]): WorkCalendarEvent[] {
  return days.flatMap(day => day.slots.map(slot => ({
    id: slot.id,
    text: day.title,
    start: localDate(day.date, slot.start),
    end: localDate(day.date, slot.end),
    workDayId: day.id,
    kind: day.kind,
    status: day.status,
    auditorium: day.auditorium,
  })))
}

/** Clases del evento: el tipo y el estado. El color nunca es la única señal (el contenido lleva icono y texto). */
export function eventClass(event: Pick<WorkCalendarEvent, 'kind' | 'status'>): string {
  const state = event.status === 'in_progress' ? ' is-in-progress' : event.status === 'finished' ? ' is-finished' : ''
  return `cloudy-ev cloudy-ev--${event.kind}${state}`
}

/** Primera hora de la rejilla de día y semana: las 6, o antes si algún rango empieza más temprano. */
export function firstGridHour(events: readonly Pick<WorkCalendarEvent, 'start'>[], fallback = 6): number {
  return events.reduce((hour, event) => Math.min(hour, event.start.getHours()), fallback)
}

// ---------------------------------------------------------------- meses (carga por rango)

/** Clave de mes `AAAA-MM`. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function shiftMonth(key: string, months: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number]
  return monthKey(new Date(year, month - 1 + months, 1))
}

/** Primer y último día del mes, para `GET /api/calendario?from&to`. */
export function monthRange(key: string): { from: string, to: string } {
  const [year, month] = key.split('-').map(Number) as [number, number]
  return { from: `${key}-01`, to: `${key}-${pad(new Date(year, month, 0).getDate())}` }
}

/** El mes de la fecha visible primero, y sus vecinos (la rejilla del mes y la semana pueden asomarse a ellos). */
export function monthsAround(date: Date): [string, string, string] {
  const key = monthKey(date)
  return [key, shiftMonth(key, -1), shiftMonth(key, 1)]
}

// ---------------------------------------------------------------- navegación y textos

/** La fecha al avanzar o retroceder un periodo de la vista. */
export function shiftDate(date: Date, view: CalendarView, direction: -1 | 1): Date {
  if (view === 'month') return new Date(date.getFullYear(), date.getMonth() + direction, 1)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * (view === 'week' ? 7 : 1))
}

/** Domingo de la semana de la fecha (la semana empieza en domingo). */
export function weekStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay())
}

const monthFormat = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' })
const dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
const shortYearFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' })

/** Título del periodo visible: «noviembre de 2026», «15 nov – 21 nov 2026» o «domingo, 22 de noviembre de 2026». */
export function rangeLabel(date: Date, view: CalendarView): string {
  if (view === 'month') return monthFormat.format(date)
  if (view === 'day') return dayFormat.format(date)
  const start = weekStart(date)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return `${shortFormat.format(start)} – ${shortYearFormat.format(end)}`
}

const workDateFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' })
const workDateYearFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** «domingo, 22 de noviembre» (con año si se pide). No depende de la zona horaria: la fecha es de pared. */
export function formatWorkDate(date: string, withYear = false): string {
  return (withYear ? workDateYearFormat : workDateFormat).format(localDate(date))
}

export function formatSlot(slot: Pick<WorkDaySlot, 'start' | 'end'>): string {
  return `${slot.start}–${slot.end}`
}

/** «09:00–11:00 · 18:00–20:00». */
export function formatSlots(slots: readonly Pick<WorkDaySlot, 'start' | 'end'>[]): string {
  return slots.map(formatSlot).join(' · ')
}

/** Hora local `HH:MM` de un evento. */
export function formatEventTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** El estado al que lleva «un toque» desde la lista: Sin iniciar → En proceso → Finalizado. */
export function nextStatus(status: WorkDayStatus): WorkDayStatus | null {
  return status === 'not_started' ? 'in_progress' : status === 'in_progress' ? 'finished' : null
}

export const WORK_DAY_STATUS_BADGE: Record<WorkDayStatus, string> = {
  not_started: 'badge-ghost',
  in_progress: 'badge-info',
  finished: 'badge-success',
}

export const WORK_DAY_STATUS_ICON: Record<WorkDayStatus, string> = {
  not_started: 'lucide:circle-dashed',
  in_progress: 'lucide:loader',
  finished: 'lucide:circle-check',
}

export const WORK_DAY_KIND_ICON: Record<WorkDayKind, string> = {
  normal: 'lucide:calendar',
  special: 'lucide:star',
}
