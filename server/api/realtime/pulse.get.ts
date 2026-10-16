// Pulso barato para el contador de pendientes en vivo (research R7), sondeado cada 5 s.
import { sql } from 'drizzle-orm'
import type { Pulse } from '#shared/types/api'
import { object, optional, str } from '#shared/validation/core'

const pulseQuery = object({
  since: optional(str({ max: 40, pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, message: 'Fecha no válida' })),
})

type ReadyRow = { id: string, sender_name: string, created_at: string, completed_at: string, file_count: number }

export default defineEventHandler(async (event): Promise<Pulse> => {
  const { profile } = requireRole(event, 'editor')
  const { since } = queryValid(event, pulseQuery)
  const now = new Date()
  const db = useDb()
  const sinceDate = since ? new Date(since) : null

  const [count, fresh, users] = await db.batch([
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (${readyPendingSubmissionsSql()}) ready`),
    // Los nuevos desde el cursor se filtran en SQL por `completed_at` (T120a).
    sinceDate
      ? db.execute<ReadyRow>(sql`SELECT * FROM (${readyPendingSubmissionsSql(sinceDate)}) ready ORDER BY completed_at DESC`)
      : db.execute<ReadyRow>(sql`SELECT NULL::uuid AS id WHERE false`),
    // Solo el admin gestiona usuarios (FR-021): a los demás no se les expone el conteo.
    profile.role === 'admin'
      ? db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM profiles WHERE status = 'pending'`)
      : db.execute<{ count: number }>(sql`SELECT 0::int AS count`),
  ])

  return {
    cursor: now.toISOString(),
    pendingCount: count.rows[0]?.count ?? 0,
    pendingUsers: users.rows[0]?.count ?? 0,
    newSubmissions: fresh.rows.map(row => ({
      id: row.id,
      senderName: row.sender_name,
      fileCount: row.file_count,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
})
