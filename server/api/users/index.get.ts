// Lista de usuarios para el administrador (FR-021): los pendientes primero, luego los más recientes.
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { UsersPage } from '#shared/types/api'
import { USER_PAGE_SIZE, usersQuery } from '#shared/validation/users'
import { profiles } from '../../db/schema'

export default defineEventHandler(async (event): Promise<UsersPage> => {
  requireRole(event, 'admin')
  const { status, page = 1, pageSize = USER_PAGE_SIZE } = queryValid(event, usersQuery)
  const db = useDb()
  const where = and(ne(profiles.status, 'removed'), status ? eq(profiles.status, status) : undefined)

  const [rows, [count]] = await db.batch([
    db.select().from(profiles)
      .where(where)
      .orderBy(sql`CASE ${profiles.status} WHEN 'pending' THEN 0 ELSE 1 END`, desc(profiles.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(profiles).where(where),
  ])

  return { items: rows.map(toProfile), total: count?.total ?? 0 }
})
