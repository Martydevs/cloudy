// Días de trabajo del equipo (`/calendario`): todo el SQL de `work_days`, `work_day_slots` y `work_day_members` vive aquí
// (el del material, en `work-day-materials.ts`); los endpoints no tocan drizzle (`architecture.spec.ts`). Cada lectura es un
// solo `db.batch` sin N+1 y cada escritura otro: un día nunca queda a medias (sin rangos, o con parte de sus miembros).
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { CALENDAR_MESSAGES } from '#shared/constants/calendar'
import type { CalendarMember, WorkDay, WorkDayDetail, WorkDayMember, WorkDaySlot, WorkDayStatus } from '#shared/types/api'
import type { WorkDayInput } from '#shared/validation/calendar'
import { profiles, workDayMembers, workDays, workDaySlots } from '../db/schema'
import type { ProfileRow } from './session'
import { toSongPerson } from './songs'
import {
  dayMaterialQueries,
  deleteMaterialsQuery,
  existingMaterialQueries,
  insertMaterialsQuery,
  materialCountSql,
  missingMaterials,
  toWorkDayMaterials,
} from './work-day-materials'

type DayRow = Pick<typeof workDays.$inferSelect, 'id' | 'title' | 'workDate' | 'kind' | 'status' | 'auditorium'> & {
  materialCount: number | string | null
}
interface SlotRow { id: string, workDayId: string, startTime: string, endTime: string }
interface MemberRow { workDayId: string, userId: string, name: string | null, status: string | null }

const dayColumns = {
  id: workDays.id,
  title: workDays.title,
  workDate: workDays.workDate,
  kind: workDays.kind,
  status: workDays.status,
  auditorium: workDays.auditorium,
  materialCount: materialCountSql(),
}

const slotColumns = {
  id: workDaySlots.id,
  workDayId: workDaySlots.workDayId,
  startTime: workDaySlots.startTime,
  endTime: workDaySlots.endTime,
}

const memberColumns = {
  workDayId: workDayMembers.workDayId,
  userId: workDayMembers.userId,
  name: profiles.name,
  status: profiles.status,
}

/** Postgres devuelve `HH:MM:SS`; la interfaz trabaja con `HH:MM`. */
const hhmm = (time: string) => time.slice(0, 5)

function toSlot(row: SlotRow): WorkDaySlot {
  return { id: row.id, start: hhmm(row.startTime), end: hhmm(row.endTime) }
}

function toMember(row: MemberRow): WorkDayMember {
  return toSongPerson(row.userId, row.name, row.status)
}

function toWorkDay(row: DayRow, slots: readonly SlotRow[], members: readonly MemberRow[]): WorkDay {
  return {
    id: row.id,
    title: row.title,
    date: row.workDate,
    kind: row.kind,
    status: row.status,
    auditorium: row.auditorium,
    slots: slots.filter(slot => slot.workDayId === row.id).map(toSlot),
    members: members.filter(member => member.workDayId === row.id).map(toMember),
    materialCount: Number(row.materialCount ?? 0),
  }
}

export function workDayNotFound() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: CALENDAR_MESSAGES.notFound })
}

function unavailable(code: 'member_unavailable' | 'material_unavailable', ids: string[]) {
  const message = code === 'member_unavailable' ? CALENDAR_MESSAGES.memberUnavailable : CALENDAR_MESSAGES.materialUnavailable
  return createError({ statusCode: 409, statusMessage: 'Conflict', message, data: { code, ids } })
}

/** Días de un rango de fechas (ambas incluidas) con sus rangos, miembros y cantidad de adjuntos: un viaje, tres consultas. */
export async function listWorkDays(from: string, to: string): Promise<WorkDay[]> {
  const db = useDb()
  const inRange = and(gte(workDays.workDate, from), lte(workDays.workDate, to))
  const [days, slots, members] = await db.batch([
    db.select(dayColumns).from(workDays).where(inRange).orderBy(asc(workDays.workDate), asc(workDays.id)),
    db.select(slotColumns)
      .from(workDaySlots)
      .innerJoin(workDays, eq(workDaySlots.workDayId, workDays.id))
      .where(inRange)
      .orderBy(asc(workDaySlots.startTime), asc(workDaySlots.id)),
    db.select(memberColumns)
      .from(workDayMembers)
      .innerJoin(workDays, eq(workDayMembers.workDayId, workDays.id))
      .leftJoin(profiles, eq(workDayMembers.userId, profiles.userId))
      .where(inRange)
      .orderBy(asc(sql`lower(${profiles.name})`), asc(workDayMembers.userId)),
  ])
  return days.map(day => toWorkDay(day, slots, members))
}

/** El día con su material resuelto (nombres actuales y hasta 50 elementos por adjunto), en un solo viaje. */
export async function getWorkDayDetail(id: string): Promise<WorkDayDetail> {
  const db = useDb()
  const [[day], slots, members, ...material] = await db.batch([
    db.select({
      ...dayColumns,
      createdBy: workDays.createdBy,
      createdAt: workDays.createdAt,
      updatedAt: workDays.updatedAt,
      authorName: profiles.name,
      authorStatus: profiles.status,
    })
      .from(workDays)
      .leftJoin(profiles, eq(workDays.createdBy, profiles.userId))
      .where(eq(workDays.id, id))
      .limit(1),
    db.select(slotColumns).from(workDaySlots).where(eq(workDaySlots.workDayId, id)).orderBy(asc(workDaySlots.startTime), asc(workDaySlots.id)),
    db.select(memberColumns)
      .from(workDayMembers)
      .leftJoin(profiles, eq(workDayMembers.userId, profiles.userId))
      .where(eq(workDayMembers.workDayId, id))
      .orderBy(asc(sql`lower(${profiles.name})`), asc(workDayMembers.userId)),
    ...dayMaterialQueries(id),
  ])
  if (!day) throw workDayNotFound()
  return {
    ...toWorkDay(day, slots, members),
    materials: toWorkDayMaterials(...material),
    createdBy: toSongPerson(day.createdBy, day.authorName, day.authorStatus),
    createdAt: day.createdAt.toISOString(),
    updatedAt: day.updatedAt.toISOString(),
  }
}

/**
 * Antes de escribir: las cuentas elegidas que siguen activas, lo que sigue existiendo del material y, al editar, el día y
 * sus miembros actuales (alguien ya asignado puede seguir aunque su cuenta se haya desactivado). Un viaje.
 */
async function checkReferences(input: WorkDayInput, editingId?: string) {
  const db = useDb()
  const [activeMembers, currentDay, currentMembers, ...found] = await db.batch([
    db.select({ id: profiles.userId })
      .from(profiles)
      .where(and(inArray(profiles.userId, input.memberIds), eq(profiles.status, 'active'), isNotNull(profiles.role))),
    db.select({ id: workDays.id }).from(workDays).where(editingId ? eq(workDays.id, editingId) : sql`false`).limit(1),
    db.select({ id: workDayMembers.userId }).from(workDayMembers).where(editingId ? eq(workDayMembers.workDayId, editingId) : sql`false`),
    ...existingMaterialQueries(input),
  ])
  if (editingId && currentDay.length === 0) throw workDayNotFound()

  const allowed = new Set([...activeMembers, ...currentMembers].map(row => row.id))
  const goneMembers = input.memberIds.filter(id => !allowed.has(id))
  if (goneMembers.length > 0) throw unavailable('member_unavailable', goneMembers)

  const goneMaterials = missingMaterials(input, found)
  if (goneMaterials.length > 0) throw unavailable('material_unavailable', goneMaterials)
}

/** Lo elegido se borró entre la comprobación y la escritura: la clave foránea falla y el lote entero se deshace. */
async function writeBatch(queries: unknown[]): Promise<void> {
  const db = useDb()
  try {
    // `db.batch` pide una tupla no vacía; aquí la lista depende de lo que se eligió.
    await db.batch(queries as unknown as Parameters<typeof db.batch>[0])
  }
  catch (error) {
    const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code
    if (code === '23503') throw unavailable('material_unavailable', [])
    throw error
  }
}

function childInserts(id: string, input: WorkDayInput, userId: string, now: Date): unknown[] {
  const db = useDb()
  return [
    db.insert(workDaySlots).values(input.slots.map(slot => ({ workDayId: id, startTime: slot.start, endTime: slot.end }))),
    input.memberIds.length > 0 ? db.insert(workDayMembers).values(input.memberIds.map(memberId => ({ workDayId: id, userId: memberId }))) : null,
    insertMaterialsQuery(id, input, userId, now),
  ].filter(query => query !== null)
}

/** Crea el día con sus rangos, miembros y adjuntos en un solo lote. Devuelve su id. */
export async function createWorkDay(input: WorkDayInput, me: Pick<ProfileRow, 'userId'>): Promise<string> {
  await checkReferences(input)
  const id = randomUUID()
  const now = new Date()
  await writeBatch([
    useDb().insert(workDays).values({
      id,
      title: input.title,
      workDate: input.date,
      kind: input.kind,
      status: input.status ?? 'not_started',
      auditorium: input.auditorium,
      createdBy: me.userId,
      createdAt: now,
      updatedAt: now,
    }),
    ...childInserts(id, input, me.userId, now),
  ])
  return id
}

/** Reemplaza los datos del día, sus rangos, miembros y adjuntos en un solo lote (404 si ya no existe). */
export async function updateWorkDay(id: string, input: WorkDayInput, me: Pick<ProfileRow, 'userId'>): Promise<void> {
  await checkReferences(input, id)
  const db = useDb()
  const now = new Date()
  await writeBatch([
    db.update(workDays)
      .set({
        title: input.title,
        workDate: input.date,
        kind: input.kind,
        ...(input.status ? { status: input.status } : {}),
        auditorium: input.auditorium,
        updatedAt: now,
      })
      .where(eq(workDays.id, id)),
    db.delete(workDaySlots).where(eq(workDaySlots.workDayId, id)),
    db.delete(workDayMembers).where(eq(workDayMembers.workDayId, id)),
    deleteMaterialsQuery(id),
    ...childInserts(id, input, me.userId, now),
  ])
}

export async function setWorkDayStatus(id: string, status: WorkDayStatus): Promise<void> {
  const rows = await useDb()
    .update(workDays)
    .set({ status, updatedAt: new Date() })
    .where(eq(workDays.id, id))
    .returning({ id: workDays.id })
  if (rows.length === 0) throw workDayNotFound()
}

/** Borra el día; sus rangos, miembros y adjuntos se van por cascada. */
export async function deleteWorkDay(id: string): Promise<void> {
  const rows = await useDb().delete(workDays).where(eq(workDays.id, id)).returning({ id: workDays.id })
  if (rows.length === 0) throw workDayNotFound()
}

/** Cuentas activas que se pueden asignar a un día. */
export async function listCalendarMembers(): Promise<CalendarMember[]> {
  const rows = await useDb()
    .select({ id: profiles.userId, name: profiles.name, role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.status, 'active'), isNotNull(profiles.role)))
    .orderBy(asc(sql`lower(${profiles.name})`), asc(profiles.userId))
  return rows.map(row => ({ id: row.id, name: row.name, role: row.role! }))
}
