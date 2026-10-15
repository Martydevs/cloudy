// Autoriza las tareas programadas de Vercel Cron: `Authorization: Bearer <CRON_SECRET>`.
import { timingSafeEqual } from 'node:crypto'
import { createError, getRequestHeader } from 'h3'
import type { H3Event } from 'h3'

export function requireCron(event: H3Event): void {
  const secret = useRuntimeConfig().cronSecret
  const header = getRequestHeader(event, 'authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
