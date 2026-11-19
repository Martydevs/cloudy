// Validadores del calendario de días de trabajo (`/calendario`). Cliente y servidor usan las mismas reglas; el servidor
// es la autoridad. Fechas `AAAA-MM-DD` y horas `HH:MM` «de pared»: nunca llevan zona horaria.
import {
  CALENDAR_MAX_RANGE_DAYS,
  CALENDAR_MESSAGES,
  CALENDAR_TIME_ZONE,
  WORK_DAY_AUDITORIUM_MAX,
  WORK_DAY_KINDS,
  WORK_DAY_MAX_MATERIALS,
  WORK_DAY_MAX_MEMBERS,
  WORK_DAY_MAX_SLOTS,
  WORK_DAY_STATUSES,
  WORK_DAY_TITLE_MAX,
} from '../constants/calendar'
import type { Field, Validator } from './core'
import { object, oneOf, optional, str, uuid } from './core'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/
const DAY_MS = 86_400_000

/** Milisegundos UTC de una fecha `AAAA-MM-DD` real (no acepta 2026-02-30), o `null`. */
export function parseIsoDate(value: unknown): number | null {
  const match = typeof value === 'string' ? DATE_RE.exec(value.trim()) : null
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : null
}

export function isoDate(message: string = CALENDAR_MESSAGES.date): Field<string> {
  return input => parseIsoDate(input) === null
    ? { ok: false, error: message }
    : { ok: true, value: (input as string).trim() }
}

/** Suma días a una fecha `AAAA-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date(parseIsoDate(date)! + days * DAY_MS).toISOString().slice(0, 10)
}

/** La fecha de «hoy» en la zona de la iglesia: la misma en el servidor (UTC) y en cualquier navegador. */
export function todayInCalendarZone(now: Date = new Date()): string {
  // `en-CA` da `AAAA-MM-DD`.
  return new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Miércoles o domingo: los días que suelen ser «normales». Solo sirve para mostrar una pista; nada se guarda por esto. */
export function usualWorkDay(date: unknown): boolean {
  const time = parseIsoDate(date)
  if (time === null) return false
  const weekday = new Date(time).getUTCDay()
  return weekday === 0 || weekday === 3
}

/** Hora `HH:MM` (acepta `HH:MM:SS`, como la devuelve Postgres) normalizada a `HH:MM`, o `null`. */
export function parseTime(value: unknown): string | null {
  return typeof value === 'string' && TIME_RE.test(value.trim()) ? value.trim().slice(0, 5) : null
}

export interface SlotInput { start: string, end: string }

export type SlotsResult =
  | { ok: true, slots: SlotInput[] }
  /** `rows`: error de cada fila por su índice; `error`: el primero, o el de la lista (vacía o demasiado larga). */
  | { ok: false, error: string, rows: Record<number, string> }

/**
 * Rangos de hora de un día: de 1 a 6, cada uno con inicio anterior al fin y sin cruzarse (uno puede empezar justo cuando
 * termina otro). Devuelve los rangos ordenados por hora de inicio.
 */
export function validateSlots(input: unknown): SlotsResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: CALENDAR_MESSAGES.slotsMin, rows: {} }
  if (input.length > WORK_DAY_MAX_SLOTS) return { ok: false, error: CALENDAR_MESSAGES.slotsMax, rows: {} }

  const rows: Record<number, string> = {}
  const parsed: (SlotInput & { index: number })[] = []
  for (const [index, raw] of input.entries()) {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const start = parseTime(source.start)
    const end = parseTime(source.end)
    if (!start || !end) rows[index] = CALENDAR_MESSAGES.time
    else if (start >= end) rows[index] = CALENDAR_MESSAGES.slotOrder
    else parsed.push({ index, start, end })
  }

  const sorted = [...parsed].sort((a, b) => a.start.localeCompare(b.start) || a.index - b.index)
  for (let i = 1; i < sorted.length; i++) {
    const [previous, current] = [sorted[i - 1]!, sorted[i]!]
    if (current.start < previous.end) {
      rows[previous.index] ??= CALENDAR_MESSAGES.slotOverlap
      rows[current.index] ??= CALENDAR_MESSAGES.slotOverlap
    }
  }

  const failed = Object.keys(rows).map(Number).sort((a, b) => a - b)
  if (failed.length > 0) return { ok: false, error: rows[failed[0]!]!, rows }
  return { ok: true, slots: sorted.map(({ start, end }) => ({ start, end })) }
}

const slots: Field<SlotInput[]> = (input) => {
  const res = validateSlots(input)
  return res.ok ? { ok: true, value: res.slots } : { ok: false, error: res.error }
}

/** Lista de identificadores sin repetidos, con tope. `undefined` cuenta como lista vacía. */
function idList(item: Field<string>, max: number, tooMany: string): Field<string[]> {
  return (input) => {
    if (input === undefined || input === null) return { ok: true, value: [] }
    if (!Array.isArray(input)) return { ok: false, error: 'Lista no válida' }
    const values: string[] = []
    for (const raw of input) {
      const res = item(raw)
      if (!res.ok) return { ok: false, error: res.error }
      if (!values.includes(res.value)) values.push(res.value)
    }
    return values.length > max ? { ok: false, error: tooMany } : { ok: true, value: values }
  }
}

export const workDayTitle = () => str({ max: WORK_DAY_TITLE_MAX })
export const workDayAuditorium = () => str({ max: WORK_DAY_AUDITORIUM_MAX })
export const workDayKind = () => oneOf(WORK_DAY_KINDS, CALENDAR_MESSAGES.kindRequired)
export const workDayStatus = () => oneOf(WORK_DAY_STATUSES, 'Estado no válido')

const materialIds = () => idList(uuid(), WORK_DAY_MAX_MATERIALS, CALENDAR_MESSAGES.materialsMax)

/** Crear o editar un día: `PATCH` reemplaza todo, por eso comparten forma. `status` vacío = «Sin iniciar». */
export const workDayInput = object({
  title: workDayTitle(),
  date: isoDate(),
  kind: workDayKind(),
  status: optional(workDayStatus()),
  auditorium: workDayAuditorium(),
  slots,
  // Los ids de las cuentas vienen de Neon Auth: texto, no necesariamente uuid.
  memberIds: idList(str({ max: 200 }), WORK_DAY_MAX_MEMBERS, CALENDAR_MESSAGES.membersMax),
  songCollectionIds: materialIds(),
  youtubePlaylistIds: materialIds(),
  folderIds: materialIds(),
})

export type WorkDayInput = typeof workDayInput extends Validator<infer T> ? T : never

/** Los campos de texto del formulario (el resto son listas): con ellos se compara el esquema zod del cliente. */
export const workDayFieldsInput = object({
  title: workDayTitle(),
  date: isoDate(),
  kind: workDayKind(),
  status: workDayStatus(),
  auditorium: workDayAuditorium(),
})

export const workDayStatusInput = object({ status: workDayStatus() })

/** `?from&to`: dos fechas en orden que cubren como mucho `CALENDAR_MAX_RANGE_DAYS` días (ambas incluidas). */
export const calendarRangeQuery = object({ from: isoDate(), to: isoDate() }, (raw) => {
  const [from, to] = [parseIsoDate(raw.from), parseIsoDate(raw.to)]
  if (from === null || to === null) return null
  const days = (to - from) / DAY_MS + 1
  return days < 1 || days > CALENDAR_MAX_RANGE_DAYS ? { to: CALENDAR_MESSAGES.range } : null
})
