// Plazos de retención (FR-020, FR-034): compartidos por la API, la UI y el cron.
import { SUBMISSION_TTL_DAYS, TRASH_RETENTION_DAYS } from './constants/files'

const DAY_MS = 86_400_000

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Fecha en que caduca un envío de invitado sin revisar. */
export function submissionExpiresAt(createdAt: Date | string): Date {
  return addDays(new Date(createdAt), SUBMISSION_TTL_DAYS)
}

/** Fecha en que se purga un elemento de la papelera. */
export function trashPurgeAt(deletedAt: Date | string): Date {
  return addDays(new Date(deletedAt), TRASH_RETENTION_DAYS)
}

/** Días enteros que faltan hasta `until` (nunca negativo). */
export function daysLeft(until: Date | string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / DAY_MS))
}
