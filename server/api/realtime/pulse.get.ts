// Pulso barato para los contadores en vivo (research R7), sondeado cada 5 s: envíos por revisar, cuentas
// pendientes y solicitudes de acceso abiertas (feature 003, research B6). Un solo viaje a Neon: el perfil de
// quien sondea va en el mismo batch (perfil diferido, `server/middleware/session.ts`) y el guard corre después.
import { sql } from 'drizzle-orm'
import type { Pulse } from '#shared/types/api'
import { isoSince, object } from '#shared/validation/core'

const pulseQuery = object({ since: isoSince() })

type ReadyRow = { id: string, sender_name: string, created_at: string, completed_at: string, file_count: number }
type AccessRow = { id: string, sender_name: string, created_at: string }

export default defineEventHandler(async (event): Promise<Pulse> => {
  const user = requireSessionUser(event)
  const { since } = queryValid(event, pulseQuery)
  const now = new Date()
  const db = useDb()
  const sinceDate = since ? new Date(since) : null

  const [count, fresh, users, accessCount, freshAccess, ownProfile] = await db.batch([
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (${readyPendingSubmissionsSql()}) ready`),
    // Los nuevos desde el cursor se filtran en SQL por `completed_at` (T120a).
    sinceDate
      ? db.execute<ReadyRow>(sql`SELECT * FROM (${readyPendingSubmissionsSql(sinceDate)}) ready ORDER BY completed_at DESC`)
      : db.execute<ReadyRow>(sql`SELECT NULL::uuid AS id WHERE false`),
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM profiles WHERE status = 'pending'`),
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (${openAccessRequestsSql()}) open_requests`),
    sinceDate
      ? db.execute<AccessRow>(sql`SELECT * FROM (${openAccessRequestsSql(sinceDate)}) open_requests ORDER BY created_at ASC`)
      : db.execute<AccessRow>(sql`SELECT NULL::uuid AS id WHERE false`),
    profileQuery(user.id),
  ])
  await attachProfile(event, user, ownProfile[0])
  const { profile } = requireRole(event, 'editor')

  return {
    cursor: now.toISOString(),
    pendingCount: count.rows[0]?.count ?? 0,
    // Solo el admin gestiona usuarios (FR-021): a los demás no se les expone el conteo.
    pendingUsers: profile.role === 'admin' ? users.rows[0]?.count ?? 0 : 0,
    newSubmissions: fresh.rows.map(row => ({
      id: row.id,
      senderName: row.sender_name,
      fileCount: row.file_count,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    openAccessRequests: accessCount.rows[0]?.count ?? 0,
    newAccessRequests: freshAccess.rows.map(row => ({
      id: row.id,
      senderName: row.sender_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
})
