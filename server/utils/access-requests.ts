// Solicitudes de acceso de invitados (feature 003, research B1–B5): token en cookie, estado derivado del reloj
// de Postgres y transiciones con UPDATE condicionados. Todo el SQL de `guest_access_requests` vive aquí.
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError, getCookie, getRequestIP, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { ACCESS_COOKIE, ACCESS_DEVICE_COOKIE, ACCESS_WAIT_MINUTES, ACCESS_WINDOW_MINUTES, accessStateOf } from '#shared/constants/access'
import type { AccessRequest, AccessState, GuestAccess } from '#shared/types/api'
import { guestAccessRequests, profiles } from '../db/schema'
import type { Actor } from './activity'

export type AccessRequestRow = typeof guestAccessRequests.$inferSelect

/** La cookie dura 3 h: 8 min de espera + 30 para empezar + una subida larga por 4G (research B1). */
const ACCESS_COOKIE_MAX_AGE = 3 * 60 * 60
const DEVICE_COOKIE_MAX_AGE = 24 * 60 * 60
const TOKEN_RE = /^[\w-]{43}$/

/** Intervalo constante en SQL (nunca entrada del usuario). */
const minutes = (n: number) => sql.raw(`interval '${n} minutes'`)

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: !import.meta.dev,
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
})

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function issueAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

/** En la base solo vive el SHA-256 del token: el token no identifica a nadie (research B1). */
export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function setAccessCookie(event: H3Event, token: string) {
  setCookie(event, ACCESS_COOKIE, token, cookieOptions(ACCESS_COOKIE_MAX_AGE))
}

const readAccessToken = (event: H3Event): string | null => {
  const token = getCookie(event, ACCESS_COOKIE)
  return token && TOKEN_RE.test(token) ? token : null
}

/** Hash del token de la cookie del invitado, o `null` si no hay una con la forma esperada. */
export function readAccessTokenHash(event: H3Event): string | null {
  const token = readAccessToken(event)
  return token ? hashAccessToken(token) : null
}

/** Reemite la cookie con otras 3 h para que el `complete` de una subida larga la reciba (research B1). */
export function renewAccessCookie(event: H3Event) {
  const token = readAccessToken(event)
  if (token) setAccessCookie(event, token)
}

/** Textos del servidor (contracts/api.md); el cliente los muestra con `serverMessage()` y no los duplica. */
export const ACCESS_MESSAGES = {
  used: 'Tu acceso ya se usó. Pide uno nuevo para enviar más archivos',
  accessExpired: 'Tu acceso caducó. Pide acceso de nuevo',
  waiting: 'Tu solicitud todavía no está aprobada',
  needed: 'Necesitas pedir acceso para enviar archivos',
  requestExpired: 'La solicitud caducó antes de atenderla',
  requestGone: 'La solicitud ya no existe',
  approvedBy: (name: string) => `${name} ya dio acceso a esta persona`,
  rejectedBy: (name: string) => `${name} ya rechazó esta solicitud`,
  someone: 'Alguien del equipo',
} as const

/** 403 de un envío con permiso cuando la solicitud no está vigente, con el texto según el estado. */
export function accessDeniedError(state: AccessState) {
  const message = state === 'used'
    ? ACCESS_MESSAGES.used
    : state === 'accessExpired'
      ? ACCESS_MESSAGES.accessExpired
      : state === 'waiting' ? ACCESS_MESSAGES.waiting : ACCESS_MESSAGES.needed
  return createError({ statusCode: 403, statusMessage: 'Forbidden', message, data: { state } })
}

/** Clave del límite por navegador: SHA-256 de la cookie `cloudy-guest-device`, que se crea si falta (research B2). */
export function ensureDeviceKey(event: H3Event): string {
  let value = getCookie(event, ACCESS_DEVICE_COOKIE)
  if (!value || !TOKEN_RE.test(value)) {
    value = issueAccessToken()
    setCookie(event, ACCESS_DEVICE_COOKIE, value, cookieOptions(DEVICE_COOKIE_MAX_AGE))
  }
  return hashAccessToken(value)
}

export async function findAccessByTokenHash(tokenHash: string): Promise<AccessRequestRow | null> {
  const [row] = await useDb().select().from(guestAccessRequests).where(eq(guestAccessRequests.tokenHash, tokenHash)).limit(1)
  return row ?? null
}

/** Lo que ve el invitado: estado, su nombre y el vencimiento que aplica; nunca datos del equipo (FR-013). */
export function toGuestAccess(row: AccessRequestRow | null, now: Date): GuestAccess {
  const state = accessStateOf(row, now)
  const expiresAt = state === 'waiting' ? row!.expiresAt : state === 'approved' ? row!.accessExpiresAt : null
  return { state, senderName: row?.senderName ?? null, expiresAt: expiresAt ? expiresAt.toISOString() : null }
}

/** Inserta la solicitud (`expires_at = now() + 8 min`), emite la cookie y devuelve el estado `waiting`. */
export async function createAccessRequest(event: H3Event, senderName: string): Promise<GuestAccess> {
  const token = issueAccessToken()
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const [row] = await useDb().insert(guestAccessRequests).values({
    senderName,
    senderKey: hashSender(ip),
    tokenHash: hashAccessToken(token),
    // Con el reloj del servidor, igual que el cursor del pulso (y que `completed_at` de los envíos): con el de
    // Postgres, un desfase de segundos haría que el aviso al equipo nunca llegara. La vigencia sí usa `now()`.
    createdAt: new Date(),
    expiresAt: sql`now() + ${minutes(ACCESS_WAIT_MINUTES)}`,
  }).returning()
  setAccessCookie(event, token)
  return { state: 'waiting', senderName, expiresAt: row!.expiresAt.toISOString() }
}

/** Abiertas y vigentes, la más antigua primero (caduca antes), máximo 50 (FR-008). */
export async function listOpenAccessRequests(): Promise<AccessRequest[]> {
  const rows = await useDb()
    .select({ id: guestAccessRequests.id, senderName: guestAccessRequests.senderName, createdAt: guestAccessRequests.createdAt, expiresAt: guestAccessRequests.expiresAt })
    .from(guestAccessRequests)
    .where(and(eq(guestAccessRequests.status, 'open'), sql`${guestAccessRequests.expiresAt} > now()`))
    .orderBy(asc(guestAccessRequests.createdAt))
    .limit(50)
  return rows.map(r => ({ id: r.id, senderName: r.senderName, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }))
}

export type DecideResult =
  | { decided: true }
  | { conflict: { state: 'approved' | 'rejected' | 'used', decidedBy: { name: string } | null } }
  | { expired: true }
  | { notFound: true }

/**
 * Aprueba o rechaza en una sola sentencia (research B5): el UPDATE condicionado y la actividad van en un CTE,
 * así la actividad solo se escribe si esta decisión ganó. Si no ganó, se lee el estado actual.
 */
export async function decideAccessRequest(id: string, decision: 'approved' | 'rejected', actor: Actor): Promise<DecideResult> {
  const db = useDb()
  const action = decision === 'approved' ? 'access.approve' : 'access.reject'
  const window = decision === 'approved' ? sql`now() + ${minutes(ACCESS_WINDOW_MINUTES)}` : sql`NULL`
  const result = await db.execute<{ id: number }>(sql`
    WITH decided AS (
      UPDATE guest_access_requests
      SET status = ${decision}::access_request_status, decided_by = ${actor.userId}, decided_at = now(), access_expires_at = ${window}
      WHERE id = ${id}::uuid AND status = 'open' AND expires_at > now()
      RETURNING id, sender_name
    )
    INSERT INTO activity_log (actor_id, actor_label, action, target_type, target_id, target_label, meta)
    SELECT ${actor.userId}, ${actor.name}, ${action}::activity_action, 'access_request', decided.id::text, decided.sender_name, NULL::jsonb
    FROM decided
    RETURNING id
  `)
  if (result.rows.length > 0) return { decided: true }

  const [current] = await db
    .select({ status: guestAccessRequests.status, decidedByName: profiles.name })
    .from(guestAccessRequests)
    .leftJoin(profiles, eq(profiles.userId, guestAccessRequests.decidedBy))
    .where(eq(guestAccessRequests.id, id))
    .limit(1)
  if (!current) return { notFound: true }
  // Sigue abierta y el UPDATE no la tocó: venció antes de atenderla.
  if (current.status === 'open') return { expired: true }
  return { conflict: { state: current.status, decidedBy: current.decidedByName ? { name: current.decidedByName } : null } }
}

/** Traduce una decisión que no ganó a 409 / 410 / 404 (FR-009); los textos solo viven en el servidor. */
export function assertDecided(result: DecideResult): void {
  if ('notFound' in result) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: ACCESS_MESSAGES.requestGone })
  if ('expired' in result) throw createError({ statusCode: 410, statusMessage: 'Gone', message: ACCESS_MESSAGES.requestExpired })
  if ('conflict' in result) {
    const { state, decidedBy } = result.conflict
    const name = decidedBy?.name ?? ACCESS_MESSAGES.someone
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: state === 'rejected' ? ACCESS_MESSAGES.rejectedBy(name) : ACCESS_MESSAGES.approvedBy(name),
      data: { state, decidedBy },
    })
  }
}

/** Condición de una solicitud aprobada y vigente para el token (se evalúa con el reloj de Postgres). */
const approvedFor = (tokenHash: string) =>
  sql`token_hash = ${tokenHash} AND status = 'approved' AND access_expires_at > now()`

/**
 * Sentencias del envío con permiso para el `db.batch` de `createGuestSubmission` (research B4): el INSERT
 * condicional del envío (toma nombre y aprobador de la solicitud) va primero y la reserva de `submission_id`,
 * al final y solo si el envío existe, así la FK siempre apunta a una fila que ya está.
 */
export function permittedSubmissionQueries(tokenHash: string, submission: { id: string, note: string | null, senderKey: string }): { insert: SQL, reserve: SQL } {
  return {
    insert: sql`
      INSERT INTO guest_submissions (id, sender_name, note, sender_key, origin, access_granted_by)
      SELECT ${submission.id}::uuid, sender_name, ${submission.note}::text, ${submission.senderKey}::text, 'permission'::submission_origin, decided_by
      FROM guest_access_requests
      WHERE ${approvedFor(tokenHash)}
      RETURNING id
    `,
    reserve: sql`
      UPDATE guest_access_requests SET submission_id = ${submission.id}::uuid
      WHERE ${approvedFor(tokenHash)}
        AND EXISTS (SELECT 1 FROM guest_submissions WHERE id = ${submission.id}::uuid)
    `,
  }
}

/** Estado con el que se niega un envío cuando la solicitud no estaba vigente al crearlo. */
export async function deniedAccessState(tokenHash: string): Promise<Exclude<AccessState, 'approved'>> {
  const state = accessStateOf(await findAccessByTokenHash(tokenHash), new Date())
  // Postgres ya dijo que no está vigente: un reloj del servidor un poco atrasado no lo contradice.
  return state === 'approved' ? 'accessExpired' : state
}

/**
 * Consume el acceso al completar el envío (research B4): solo desde `approved`, con ese envío reservado y el token
 * del mismo navegador. La vigencia no se vuelve a comprobar: solo cuenta al iniciar el envío.
 */
export async function consumeForSubmission(submissionId: string, tokenHash: string | null): Promise<boolean> {
  if (!tokenHash) return false
  const rows = await useDb().update(guestAccessRequests)
    .set({ status: 'used', usedAt: sql`now()` })
    .where(and(
      eq(guestAccessRequests.submissionId, submissionId),
      eq(guestAccessRequests.tokenHash, tokenHash),
      eq(guestAccessRequests.status, 'approved'),
    ))
    .returning({ id: guestAccessRequests.id })
  return rows.length > 0
}

/** Solicitudes abiertas y vigentes (pulso y dashboard); con `since`, solo las creadas después. */
export function openAccessRequestsSql(since?: Date | null): SQL {
  return sql`
    SELECT id, sender_name, created_at FROM guest_access_requests
    WHERE status = 'open' AND expires_at > now()
    ${since ? sql`AND created_at > ${since.toISOString()}::timestamptz` : sql``}
  `
}

/** Borra las solicitudes terminadas o vencidas hace más de 24 h (data-model, "Retención"). */
export async function purgeStaleAccessRequests(): Promise<number> {
  const cutoff = sql`now() - interval '24 hours'`
  const rows = await useDb().delete(guestAccessRequests)
    .where(sql`
      (${guestAccessRequests.status} = 'rejected' AND ${guestAccessRequests.decidedAt} < ${cutoff})
      OR (${guestAccessRequests.status} = 'used' AND ${guestAccessRequests.usedAt} < ${cutoff})
      OR (${guestAccessRequests.status} = 'open' AND ${guestAccessRequests.expiresAt} < ${cutoff})
      OR (${guestAccessRequests.status} = 'approved' AND ${guestAccessRequests.accessExpiresAt} < ${cutoff})
    `)
    .returning({ id: guestAccessRequests.id })
  return rows.length
}
