// Reglas del calendario de días de trabajo: fechas y horas de pared, rangos sin cruces, la pista de miércoles y domingo
// (que nunca decide el tipo) y los límites de cada lista.
import { describe, expect, it } from 'vitest'
import { CALENDAR_MESSAGES, DEFAULT_AUDITORIUM, WORK_DAY_MAX_MATERIALS, WORK_DAY_MAX_MEMBERS } from '../../shared/constants/calendar'
import { REQUIRED_MESSAGE, maxMessage } from '../../shared/validation/core'
import {
  addDays,
  calendarRangeQuery,
  parseIsoDate,
  parseTime,
  todayInCalendarZone,
  usualWorkDay,
  validateSlots,
  workDayFieldsInput,
  workDayInput,
  workDayStatusInput,
} from '../../shared/validation/calendar'
import { UUID, UUID2 } from './helpers/nitro'

const day = (changes: Record<string, unknown> = {}) => ({
  title: 'Servicio dominical',
  date: '2026-11-22',
  kind: 'normal',
  auditorium: DEFAULT_AUDITORIUM,
  slots: [{ start: '09:00', end: '11:00' }],
  ...changes,
})

const errorsOf = (input: unknown) => {
  const res = workDayInput(input)
  return res.ok ? {} : res.errors
}

describe('fechas y horas', () => {
  it('parseIsoDate solo acepta fechas reales AAAA-MM-DD', () => {
    expect(parseIsoDate('2026-11-22')).toBe(Date.UTC(2026, 10, 22))
    expect(parseIsoDate(' 2028-02-29 ')).toBe(Date.UTC(2028, 1, 29))
    for (const bad of ['2026-02-30', '2026-13-01', '22/11/2026', '2026-1-1', '', null, 20261122]) expect(parseIsoDate(bad), String(bad)).toBeNull()
  })

  it('addDays cruza meses y años', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-11-18', 29)).toBe('2026-12-17')
  })

  it('todayInCalendarZone usa la zona de la iglesia: de noche allá, el servidor (UTC) ya va un día adelante', () => {
    expect(todayInCalendarZone(new Date('2026-11-19T02:30:00Z'))).toBe('2026-11-18')
    expect(todayInCalendarZone(new Date('2026-11-18T15:00:00Z'))).toBe('2026-11-18')
    expect(todayInCalendarZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('parseTime normaliza a HH:MM y rechaza lo demás', () => {
    expect(parseTime('09:05')).toBe('09:05')
    expect(parseTime('23:59:00')).toBe('23:59')
    for (const bad of ['24:00', '9:00', '09:60', 'mañana', '', undefined, 900]) expect(parseTime(bad), String(bad)).toBeNull()
  })
})

describe('usualWorkDay', () => {
  it('solo miércoles y domingo, y nunca con una fecha inválida', () => {
    expect(usualWorkDay('2026-11-18')).toBe(true) // miércoles
    expect(usualWorkDay('2026-11-22')).toBe(true) // domingo
    for (const other of ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21']) expect(usualWorkDay(other), other).toBe(false)
    expect(usualWorkDay('')).toBe(false)
    expect(usualWorkDay('2026-02-30')).toBe(false)
  })
})

describe('validateSlots', () => {
  it('ordena por hora de inicio y admite rangos que se tocan sin cruzarse', () => {
    expect(validateSlots([{ start: '18:00', end: '20:00:00' }, { start: '09:00', end: '11:00' }, { start: '11:00', end: '12:30' }])).toEqual({
      ok: true,
      slots: [{ start: '09:00', end: '11:00' }, { start: '11:00', end: '12:30' }, { start: '18:00', end: '20:00' }],
    })
  })

  it('pide al menos uno y como mucho seis', () => {
    expect(validateSlots([])).toEqual({ ok: false, error: CALENDAR_MESSAGES.slotsMin, rows: {} })
    expect(validateSlots(undefined)).toMatchObject({ ok: false, error: CALENDAR_MESSAGES.slotsMin })
    const seven = Array.from({ length: 7 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` }))
    expect(validateSlots(seven)).toEqual({ ok: false, error: CALENDAR_MESSAGES.slotsMax, rows: {} })
    expect(validateSlots(seven.slice(0, 6))).toMatchObject({ ok: true })
  })

  it('marca cada fila con su motivo: hora inválida, fin antes del inicio o cruce', () => {
    const res = validateSlots([
      { start: '09:00', end: '11:00' },
      { start: '', end: '10:00' },
      { start: '12:00', end: '12:00' },
      { start: '10:30', end: '11:30' },
      null,
    ])
    expect(res).toEqual({
      ok: false,
      error: CALENDAR_MESSAGES.slotOverlap,
      rows: {
        0: CALENDAR_MESSAGES.slotOverlap,
        1: CALENDAR_MESSAGES.time,
        2: CALENDAR_MESSAGES.slotOrder,
        3: CALENDAR_MESSAGES.slotOverlap,
        4: CALENDAR_MESSAGES.time,
      },
    })
  })

  it('dos rangos iguales se cruzan', () => {
    expect(validateSlots([{ start: '09:00', end: '10:00' }, { start: '09:00', end: '10:00' }])).toMatchObject({
      ok: false,
      rows: { 0: CALENDAR_MESSAGES.slotOverlap, 1: CALENDAR_MESSAGES.slotOverlap },
    })
  })
})

describe('workDayInput', () => {
  it('acepta lo mínimo: sin estado, miembros ni material', () => {
    expect(workDayInput(day({ title: '  Servicio dominical  ' }))).toEqual({
      ok: true,
      data: {
        title: 'Servicio dominical',
        date: '2026-11-22',
        kind: 'normal',
        status: undefined,
        auditorium: DEFAULT_AUDITORIUM,
        slots: [{ start: '09:00', end: '11:00' }],
        memberIds: [],
        songCollectionIds: [],
        youtubePlaylistIds: [],
        folderIds: [],
      },
    })
  })

  it('el tipo es obligatorio aunque la fecha sea miércoles o domingo: nada se asume', () => {
    expect(errorsOf(day({ kind: undefined }))).toEqual({ kind: CALENDAR_MESSAGES.kindRequired })
    expect(errorsOf(day({ kind: '' }))).toEqual({ kind: CALENDAR_MESSAGES.kindRequired })
    expect(errorsOf(day({ kind: 'fiesta' }))).toEqual({ kind: CALENDAR_MESSAGES.kindRequired })
    expect(workDayInput(day({ kind: 'special' }))).toMatchObject({ ok: true })
  })

  it('título 1–120 y auditorio 1–80, recortados', () => {
    expect(errorsOf(day({ title: '   ' }))).toEqual({ title: REQUIRED_MESSAGE })
    expect(errorsOf(day({ title: 'a'.repeat(121) }))).toEqual({ title: maxMessage(120) })
    expect(workDayInput(day({ title: 'a'.repeat(120) }))).toMatchObject({ ok: true })
    expect(errorsOf(day({ auditorium: '' }))).toEqual({ auditorium: REQUIRED_MESSAGE })
    expect(errorsOf(day({ auditorium: 'a'.repeat(81) }))).toEqual({ auditorium: maxMessage(80) })
  })

  it('fecha, estado y rangos inválidos', () => {
    expect(errorsOf(day({ date: '2026-02-30' }))).toEqual({ date: CALENDAR_MESSAGES.date })
    expect(errorsOf(day({ status: 'pausado' }))).toEqual({ status: 'Estado no válido' })
    expect(workDayInput(day({ status: 'finished' }))).toMatchObject({ ok: true, data: { status: 'finished' } })
    expect(errorsOf(day({ slots: [] }))).toEqual({ slots: CALENDAR_MESSAGES.slotsMin })
    expect(errorsOf(day({ slots: [{ start: '10:00', end: '09:00' }] }))).toEqual({ slots: CALENDAR_MESSAGES.slotOrder })
  })

  it('las listas quitan repetidos y tienen tope', () => {
    const res = workDayInput(day({ memberIds: ['u1', 'u2', 'u1'], songCollectionIds: [UUID, UUID.toUpperCase()], youtubePlaylistIds: [UUID2], folderIds: null }))
    expect(res).toMatchObject({ ok: true, data: { memberIds: ['u1', 'u2'], songCollectionIds: [UUID], youtubePlaylistIds: [UUID2], folderIds: [] } })

    const many = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`)
    expect(workDayInput(day({ memberIds: many(WORK_DAY_MAX_MEMBERS) }))).toMatchObject({ ok: true })
    expect(errorsOf(day({ memberIds: many(WORK_DAY_MAX_MEMBERS + 1) }))).toEqual({ memberIds: CALENDAR_MESSAGES.membersMax })
    const ids = Array.from({ length: WORK_DAY_MAX_MATERIALS + 1 }, (_, i) => `${UUID.slice(0, -2)}${String(i).padStart(2, '0')}`)
    expect(errorsOf(day({ folderIds: ids }))).toEqual({ folderIds: CALENDAR_MESSAGES.materialsMax })
  })

  it('rechaza listas con forma o ids inválidos', () => {
    expect(errorsOf(day({ memberIds: 'u1' }))).toEqual({ memberIds: 'Lista no válida' })
    expect(errorsOf(day({ memberIds: [''] }))).toEqual({ memberIds: REQUIRED_MESSAGE })
    expect(errorsOf(day({ songCollectionIds: ['no-es-uuid'] }))).toEqual({ songCollectionIds: 'Identificador no válido' })
  })
})

describe('workDayFieldsInput y workDayStatusInput', () => {
  it('los campos del formulario exigen estado', () => {
    expect(workDayFieldsInput({ title: 'A', date: '2026-11-22', kind: 'normal', status: 'not_started', auditorium: 'B' })).toMatchObject({ ok: true })
    expect(workDayFieldsInput({ title: 'A', date: '2026-11-22', kind: 'normal', status: '', auditorium: 'B' })).toMatchObject({ ok: false, errors: { status: 'Estado no válido' } })
  })

  it('el cambio de estado solo admite los tres estados', () => {
    for (const status of ['not_started', 'in_progress', 'finished']) expect(workDayStatusInput({ status })).toEqual({ ok: true, data: { status } })
    expect(workDayStatusInput({ status: 'done' })).toMatchObject({ ok: false })
    expect(workDayStatusInput({})).toMatchObject({ ok: false })
  })
})

describe('calendarRangeQuery', () => {
  it('acepta de 1 a 62 días con ambas fechas incluidas', () => {
    expect(calendarRangeQuery({ from: '2026-11-18', to: '2026-11-18' })).toEqual({ ok: true, data: { from: '2026-11-18', to: '2026-11-18' } })
    expect(calendarRangeQuery({ from: '2026-11-01', to: '2027-01-01' })).toMatchObject({ ok: true }) // 62 días
  })

  it('rechaza rangos al revés, de más de 62 días o con fechas inválidas', () => {
    expect(calendarRangeQuery({ from: '2026-11-01', to: '2027-01-02' })).toEqual({ ok: false, errors: { to: CALENDAR_MESSAGES.range } })
    expect(calendarRangeQuery({ from: '2026-11-19', to: '2026-11-18' })).toEqual({ ok: false, errors: { to: CALENDAR_MESSAGES.range } })
    expect(calendarRangeQuery({ from: 'ayer', to: '2026-11-18' })).toEqual({ ok: false, errors: { from: CALENDAR_MESSAGES.date } })
    expect(calendarRangeQuery({})).toEqual({ ok: false, errors: { from: CALENDAR_MESSAGES.date, to: CALENDAR_MESSAGES.date } })
  })
})
