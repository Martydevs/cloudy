// Resumen del Inicio (FR-026, FR-037): recientes, pendientes, totales por tipo y espacio usado.
import { desc, eq, sql } from 'drizzle-orm'
import type { DashboardSummary } from '#shared/types/api'
import { FILE_CATEGORIES } from '#shared/constants/files'
import { files, profiles } from '../db/schema'

export default defineEventHandler(async (event): Promise<DashboardSummary> => {
  requireRole(event, 'editor')
  const db = useDb()

  // Una sola ida y vuelta: el driver HTTP ejecuta el lote en una transacción.
  const [recent, pending, access, totals, storage] = await db.batch([
    db.select(fileColumns).from(files)
      .leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
      .where(visibleFilesWhere())
      .orderBy(desc(files.createdAt))
      .limit(8),
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (${readyPendingSubmissionsSql()}) ready`),
    // Solicitudes de acceso abiertas (feature 003): el inicio muestra "Solicitudes por atender".
    db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (${openAccessRequestsSql()}) open_requests`),
    db.select({
      category: files.category,
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)`,
    }).from(files).where(visibleFilesWhere()).groupBy(files.category),
    db.select({
      activeBytes: sql<string>`coalesce(sum(${files.sizeBytes}) FILTER (WHERE ${files.deletedAt} IS NULL), 0)`,
      trashBytes: sql<string>`coalesce(sum(${files.sizeBytes}) FILTER (WHERE ${files.deletedAt} IS NOT NULL), 0)`,
    }).from(files).where(eq(files.uploadStatus, 'ready')),
  ])

  const totalsByCategory = Object.fromEntries(
    FILE_CATEGORIES.map(category => [category, { count: 0, bytes: 0 }]),
  ) as DashboardSummary['totalsByCategory']
  for (const row of totals) {
    totalsByCategory[row.category] = { count: row.count, bytes: Number(row.bytes) }
  }

  return {
    recentFiles: recent.map(row => toFileItem(row)),
    pendingCount: pending.rows[0]?.count ?? 0,
    openAccessRequests: access.rows[0]?.count ?? 0,
    totalsByCategory,
    storage: {
      activeBytes: Number(storage[0]?.activeBytes ?? 0),
      trashBytes: Number(storage[0]?.trashBytes ?? 0),
    },
  }
})
