// Enviar una carpeta con todo su contenido a la papelera (FR-011, FR-034).
// Una sola sentencia: marca carpeta, subcarpetas y archivos y registra la actividad (atómico).
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event): Promise<{ trashedItems: number }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const folder = await getVisibleFolder(id)

  const result = await useDb().execute<{ folders: number, files: number }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM folders WHERE id = ${id} AND deleted_at IS NULL
      UNION ALL
      SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
    ),
    trashed_folders AS (
      UPDATE folders SET deleted_at = now(), deleted_by = ${profile.userId}, trash_root_id = ${id}
      WHERE id IN (SELECT id FROM tree)
      RETURNING id
    ),
    trashed_files AS (
      UPDATE files SET deleted_at = now(), deleted_by = ${profile.userId}, trash_root_id = ${id}
      WHERE folder_id IN (SELECT id FROM tree) AND deleted_at IS NULL AND upload_status = 'ready'
      RETURNING id
    ),
    activity AS (
      INSERT INTO activity_log (actor_id, actor_label, action, target_type, target_id, target_label, meta)
      SELECT ${profile.userId}, ${profile.name}, 'folder.trash', 'folder', ${id}, ${folder.name},
        jsonb_build_object('items', (SELECT count(*) FROM trashed_folders) - 1 + (SELECT count(*) FROM trashed_files))
      WHERE EXISTS (SELECT 1 FROM trashed_folders)
      RETURNING id
    )
    SELECT (SELECT count(*)::int FROM trashed_folders) AS folders,
           (SELECT count(*)::int FROM trashed_files) AS files,
           (SELECT count(*)::int FROM activity) AS logged
  `)

  const row = result.rows[0]
  return { trashedItems: (row?.folders ?? 0) + (row?.files ?? 0) }
})
