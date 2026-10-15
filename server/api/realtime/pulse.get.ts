// Pulso barato para el contador de pendientes en vivo (research R7), sondeado cada 3 s.
import { sql } from 'drizzle-orm'
import type { Pulse } from '#shared/types/api'
import { object, optional, str } from '#shared/validation/core'

const pulseQuery = object({
  since: optional(str({ max: 40, pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, message: 'Fecha no válida' })),
})

export default defineEventHandler(async (event): Promise<Pulse> => {
  requireRole(event, 'editor')
  const { since } = queryValid(event, pulseQuery)
  const now = new Date()

  const result = await useDb().execute<{ id: string, sender_name: string, created_at: string, file_count: number }>(sql`
    SELECT * FROM (${readyPendingSubmissionsSql()}) ready ORDER BY created_at DESC
  `)
  const sinceDate = since ? new Date(since) : null

  return {
    cursor: now.toISOString(),
    pendingCount: result.rows.length,
    newSubmissions: sinceDate
      ? result.rows
          .filter(row => new Date(row.created_at) > sinceDate)
          .map(row => ({
            id: row.id,
            senderName: row.sender_name,
            fileCount: row.file_count,
            createdAt: new Date(row.created_at).toISOString(),
          }))
      : [],
  }
})
