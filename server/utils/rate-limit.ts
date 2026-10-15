// Limitador de ventana fija respaldado en Postgres (research R3): válido con varias instancias de Vercel.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createError, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { rateLimits } from '../db/schema'

/** Inicio de la ventana fija de `windowSec` segundos que contiene `now`. */
export function windowStart(now: Date, windowSec: number): Date {
  const size = windowSec * 1000
  return new Date(Math.floor(now.getTime() / size) * size)
}

/** Hash SHA-256 de la IP con sal: nunca se guarda la IP en claro. */
export function hashSender(ip: string, salt: string = useRuntimeConfig().rateLimitSalt): string {
  return createHash('sha256').update(`${ip}${salt}`).digest('hex')
}

/**
 * Cuenta un intento para `key` y lanza 429 (con `Retry-After`) si supera `limit` en la ventana.
 * El upsert es atómico, así que no hay carreras entre instancias.
 */
export async function hitRateLimit(
  event: H3Event | null,
  key: string,
  { limit, windowSec }: { limit: number, windowSec: number },
): Promise<void> {
  const now = new Date()
  const start = windowStart(now, windowSec)
  const [row] = await useDb()
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count })

  if ((row?.count ?? 0) > limit) {
    const retryAfter = Math.max(1, Math.ceil((start.getTime() + windowSec * 1000 - now.getTime()) / 1000))
    if (event) setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: { retryAfter },
    })
  }
}
