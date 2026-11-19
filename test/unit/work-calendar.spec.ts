// Lógica pura del calendario: de días a eventos (uno por rango), meses a pedir, navegación y textos de fecha.
import { describe, expect, it } from 'vitest'
import type { WorkDay } from '../../shared/types/api'
import {
  CALENDAR_VIEWS,
  eventClass,
  firstGridHour,
  formatEventTime,
  formatSlot,
  formatSlots,
  formatWorkDate,
  localDate,
  monthKey,
  monthRange,
  monthsAround,
  nextStatus,
  rangeLabel,
  shiftDate,
  shiftMonth,
  toCalendarEvents,
  toIsoDate,
  weekStart,
  WORK_DAY_KIND_ICON,
  WORK_DAY_STATUS_BADGE,
  WORK_DAY_STATUS_ICON,
} from '../../app/utils/work-calendar'

const day = (changes: Partial<WorkDay> = {}): WorkDay => ({
  id: 'd1',
  title: 'Servicio dominical',
  date: '2026-11-22',
  kind: 'normal',
  status: 'not_started',
  auditorium: 'Skykids Auditorium',
  slots: [{ id: 's1', start: '09:00', end: '11:00' }, { id: 's2', start: '18:30', end: '20:00' }],
  members: [],
  materialCount: 0,
  ...changes,
})

describe('fechas de pared', () => {
  it('localDate construye la fecha en la hora local y toIsoDate la devuelve igual', () => {
    const date = localDate('2026-11-22', '18:30')
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 10, 22, 18, 30])
    expect(toIsoDate(date)).toBe('2026-11-22')
    expect(toIsoDate(localDate('2026-01-05'))).toBe('2026-01-05')
    expect(formatEventTime(date)).toBe('18:30')
    expect(formatEventTime(localDate('2026-01-05', '07:05'))).toBe('07:05')
  })
})

describe('toCalendarEvents', () => {
  it('crea un evento por rango, con el id del rango y los datos del día', () => {
    const events = toCalendarEvents([day(), day({ id: 'd2', title: 'Conferencia', kind: 'special', status: 'finished', slots: [{ id: 's3', start: '10:00', end: '12:00' }] })])
    expect(events.map(event => [event.id, event.text, event.workDayId, event.kind, event.status])).toEqual([
      ['s1', 'Servicio dominical', 'd1', 'normal', 'not_started'],
      ['s2', 'Servicio dominical', 'd1', 'normal', 'not_started'],
      ['s3', 'Conferencia', 'd2', 'special', 'finished'],
    ])
    expect(events[1]!.start).toEqual(localDate('2026-11-22', '18:30'))
    expect(events[1]!.end).toEqual(localDate('2026-11-22', '20:00'))
    expect(events[0]!.auditorium).toBe('Skykids Auditorium')
    expect(toCalendarEvents([day({ slots: [] })])).toEqual([])
  })

  it('eventClass dice el tipo y el estado', () => {
    expect(eventClass({ kind: 'normal', status: 'not_started' })).toBe('cloudy-ev cloudy-ev--normal')
    expect(eventClass({ kind: 'special', status: 'in_progress' })).toBe('cloudy-ev cloudy-ev--special is-in-progress')
    expect(eventClass({ kind: 'normal', status: 'finished' })).toBe('cloudy-ev cloudy-ev--normal is-finished')
  })

  it('firstGridHour: las 6, o antes si un rango empieza más temprano', () => {
    expect(firstGridHour([])).toBe(6)
    expect(firstGridHour(toCalendarEvents([day()]))).toBe(6)
    expect(firstGridHour(toCalendarEvents([day({ slots: [{ id: 's', start: '04:30', end: '06:00' }] })]))).toBe(4)
  })
})

describe('meses', () => {
  it('claves, rangos y vecinos (cruzando de año)', () => {
    expect(monthKey(localDate('2026-11-22'))).toBe('2026-11')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthsAround(localDate('2026-12-31'))).toEqual(['2026-12', '2026-11', '2027-01'])
  })
})

describe('navegación', () => {
  it('shiftDate avanza un día, una semana o un mes', () => {
    const date = localDate('2026-11-30')
    expect(toIsoDate(shiftDate(date, 'day', 1))).toBe('2026-12-01')
    expect(toIsoDate(shiftDate(date, 'day', -1))).toBe('2026-11-29')
    expect(toIsoDate(shiftDate(date, 'week', 1))).toBe('2026-12-07')
    expect(toIsoDate(shiftDate(date, 'week', -1))).toBe('2026-11-23')
    // En vista de mes cae en el día 1: el 31 de enero + 1 mes no se salta febrero.
    expect(toIsoDate(shiftDate(localDate('2026-01-31'), 'month', 1))).toBe('2026-02-01')
    expect(toIsoDate(shiftDate(date, 'month', -1))).toBe('2026-10-01')
  })

  it('la semana empieza en domingo', () => {
    expect(toIsoDate(weekStart(localDate('2026-11-18')))).toBe('2026-11-15')
    expect(toIsoDate(weekStart(localDate('2026-11-22')))).toBe('2026-11-22')
  })

  it('rangeLabel en español para cada vista', () => {
    const date = localDate('2026-11-18')
    expect(rangeLabel(date, 'month')).toBe('noviembre de 2026')
    expect(rangeLabel(date, 'day')).toBe('miércoles, 18 de noviembre de 2026')
    expect(rangeLabel(date, 'week')).toMatch(/^15 nov – 21 nov 2026$/)
    expect(CALENDAR_VIEWS.map(view => view.label)).toEqual(['Día', 'Semana', 'Mes'])
  })
})

describe('textos', () => {
  it('fecha del día, con y sin año', () => {
    expect(formatWorkDate('2026-11-22')).toBe('domingo, 22 de noviembre')
    expect(formatWorkDate('2026-11-22', true)).toBe('domingo, 22 de noviembre de 2026')
  })

  it('rangos de hora', () => {
    expect(formatSlot({ start: '09:00', end: '11:00' })).toBe('09:00–11:00')
    expect(formatSlots(day().slots)).toBe('09:00–11:00 · 18:30–20:00')
  })

  it('nextStatus: Sin iniciar → En proceso → Finalizado, y ahí termina', () => {
    expect(nextStatus('not_started')).toBe('in_progress')
    expect(nextStatus('in_progress')).toBe('finished')
    expect(nextStatus('finished')).toBeNull()
  })

  it('cada tipo y estado tiene icono lucide e insignia', () => {
    for (const icon of [...Object.values(WORK_DAY_KIND_ICON), ...Object.values(WORK_DAY_STATUS_ICON)]) expect(icon).toMatch(/^lucide:/)
    expect(Object.keys(WORK_DAY_STATUS_BADGE)).toEqual(['not_started', 'in_progress', 'finished'])
  })
})
