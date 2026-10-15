// Elementos visibles dentro de una carpeta (todas las profundidades), para la confirmación de borrado.
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event): Promise<{ items: number }> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  await getVisibleFolder(id)

  const result = await useDb().execute<{ items: number }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM folders WHERE id = ${id} AND deleted_at IS NULL
      UNION ALL
      SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
    )
    SELECT ((SELECT count(*) FROM tree) - 1
      + (SELECT count(*) FROM files WHERE folder_id IN (SELECT id FROM tree) AND deleted_at IS NULL AND upload_status = 'ready'))::int AS items
  `)
  return { items: result.rows[0]?.items ?? 0 }
})
