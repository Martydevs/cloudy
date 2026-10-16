// Papelera (FR-034–FR-036): listar raíces, restaurar y purgar definitivamente.
// Una "raíz" es lo que el usuario envió a la papelera (`trash_root_id = id`); su contenido comparte ese `trash_root_id`.
import { and, eq, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError, getRouterParam } from 'h3'
import type { H3Event } from 'h3'
import { daysLeft, trashPurgeAt } from '#shared/retention'
import type { TrashItem, TrashRestoreResult } from '#shared/types/api'
import { files, folders } from '../db/schema'
import type { Actor } from './activity'
import { deleteMany } from './storage'
import { thumbKeyFor } from './uploads'

export type TrashKind = TrashItem['kind']

type TrashRootRow = {
  kind: TrashKind
  id: string
  name: string
  parent_id: string | null
  deleted_at: string | Date
  deleted_by_name: string | null
  item_count: number
  bytes: string | number
}

function uuidList(ids: string[]): SQL {
  return sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)
}

/**
 * Raíces de la papelera, de la más reciente a la más antigua. `itemCount` cuenta el contenido de una
 * carpeta (todas las profundidades, sin la propia carpeta), igual que la confirmación de borrado y
 * `meta.items` de `folder.trash`.
 */
export async function listTrash(): Promise<TrashItem[]> {
  const result = await useDb().execute<TrashRootRow>(sql`
    SELECT 'folder' AS kind, f.id, f.name, f.parent_id, f.deleted_at, p.name AS deleted_by_name,
      ((SELECT count(*) FROM folders c WHERE c.trash_root_id = f.id AND c.id <> f.id)
        + (SELECT count(*) FROM files c WHERE c.trash_root_id = f.id))::int AS item_count,
      (SELECT coalesce(sum(c.size_bytes), 0) FROM files c WHERE c.trash_root_id = f.id)::bigint AS bytes
    FROM folders f LEFT JOIN profiles p ON p.user_id = f.deleted_by
    WHERE f.trash_root_id = f.id AND f.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'file' AS kind, f.id, f.name, f.folder_id AS parent_id, f.deleted_at, p.name AS deleted_by_name,
      0 AS item_count, f.size_bytes AS bytes
    FROM files f LEFT JOIN profiles p ON p.user_id = f.deleted_by
    WHERE f.trash_root_id = f.id AND f.deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `)
  const rows = result.rows
  const paths = await folderPaths(rows.map(r => r.parent_id))
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    originalPath: row.parent_id ? paths.get(row.parent_id) ?? [] : [],
    deletedBy: row.deleted_by_name,
    deletedAt: new Date(row.deleted_at).toISOString(),
    daysLeft: daysLeft(trashPurgeAt(row.deleted_at)),
    itemCount: Number(row.item_count),
    bytes: Number(row.bytes),
  }))
}

/** La raíz de papelera pedida, o 404. */
export async function getTrashRoot(kind: TrashKind, id: string): Promise<{ name: string, parentId: string | null }> {
  const db = useDb()
  const [row] = kind === 'file'
    ? await db.select({ name: files.name, parentId: files.folderId }).from(files)
        .where(and(eq(files.id, id), eq(files.trashRootId, id))).limit(1)
    : await db.select({ name: folders.name, parentId: folders.parentId }).from(folders)
        .where(and(eq(folders.id, id), eq(folders.trashRootId, id))).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El elemento ya no está en la papelera' })
  return row
}

/**
 * Restaura la raíz y todo lo que se envió con ella. Si su carpeta sigue en la papelera, la raíz vuelve
 * a "Archivos" (`movedToRoot`). Si el nombre ya está en uso, solo la raíz recibe un sufijo.
 */
export async function restore(kind: TrashKind, id: string, actor: Actor): Promise<TrashRestoreResult> {
  const root = await getTrashRoot(kind, id)
  let folderId = root.parentId
  if (folderId) {
    // Una carpeta purgada habría borrado esta fila en cascada: si existe, solo puede estar en la papelera.
    const [parent] = await useDb().select({ deletedAt: folders.deletedAt }).from(folders).where(eq(folders.id, folderId)).limit(1)
    if (!parent || parent.deletedAt) folderId = null
  }
  const movedToRoot = root.parentId !== null && folderId === null

  const name = await retryOnUniqueViolation(async () => {
    const finalName = withSuffix(root.name, await takenNames(kind, folderId, root.name))
    const db = useDb()
    const cleared = { deletedAt: null, deletedBy: null, trashRootId: null }
    const now = new Date()
    if (kind === 'file') {
      await db.batch([
        db.update(files).set({ ...cleared, name: finalName, folderId, updatedAt: now })
          .where(and(eq(files.id, id), eq(files.trashRootId, id))),
        activityInsert(actor, 'file.restore', { type: 'file', id, label: finalName }, meta(movedToRoot, root.name, finalName)),
      ])
    }
    else {
      await db.batch([
        db.update(folders).set(cleared).where(and(eq(folders.trashRootId, id), ne(folders.id, id))),
        db.update(files).set(cleared).where(eq(files.trashRootId, id)),
        db.update(folders).set({ ...cleared, name: finalName, parentId: folderId, updatedAt: now })
          .where(and(eq(folders.id, id), eq(folders.trashRootId, id))),
        activityInsert(actor, 'folder.restore', { type: 'folder', id, label: finalName }, meta(movedToRoot, root.name, finalName)),
      ])
    }
    return finalName
  })

  const path = folderId ? (await folderPaths([folderId])).get(folderId) ?? [] : []
  return { name, restoredTo: { folderId, path }, movedToRoot }
}

/** Detalle de la actividad solo cuando la restauración no fue exacta. */
function meta(movedToRoot: boolean, from: string, to: string): Record<string, unknown> | undefined {
  if (!movedToRoot && from === to) return undefined
  return { ...(movedToRoot ? { movedToRoot } : {}), ...(from === to ? {} : { from, to }) }
}

type PurgeRow = {
  purged: number
  id: string | null
  storage_key: string | null
  thumb_key: string | null
}

/**
 * Borra definitivamente las raíces indicadas y devuelve cuántas se purgaron.
 *
 * Una sola sentencia borra las filas y devuelve sus claves: los archivos de todo el subárbol de cada
 * carpeta (también los que se enviaron antes a la papelera por separado, que caerían en cascada) y
 * los archivos raíz. Los comentarios caen en cascada. Después se borran los objetos: si el bucket
 * falla solo quedan objetos sin referencia, nunca filas que apunten a objetos inexistentes.
 */
export async function purge(rootIds: string[]): Promise<number> {
  const ids = [...new Set(rootIds)]
  if (ids.length === 0) return 0
  const result = await useDb().execute<PurgeRow>(sql`
    WITH RECURSIVE root_folders AS (
      SELECT id FROM folders WHERE id IN (${uuidList(ids)}) AND trash_root_id = id
    ),
    root_files AS (
      SELECT id FROM files WHERE id IN (${uuidList(ids)}) AND trash_root_id = id
    ),
    tree AS (
      SELECT id FROM root_folders
      UNION ALL
      SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
    ),
    purged_files AS (
      DELETE FROM files
      WHERE folder_id IN (SELECT id FROM tree) OR id IN (SELECT id FROM root_files)
      RETURNING id, storage_key, thumb_key
    ),
    purged_folders AS (
      DELETE FROM folders WHERE id IN (SELECT id FROM root_folders)
      RETURNING id
    ),
    total AS (
      SELECT ((SELECT count(*) FROM purged_folders) + (SELECT count(*) FROM root_files))::int AS purged
    )
    SELECT total.purged, p.id, p.storage_key, p.thumb_key FROM total LEFT JOIN purged_files p ON true
  `)
  const rows = result.rows
  const keys = rows.flatMap(r => r.id ? [r.storage_key ?? '', r.thumb_key ?? '', thumbKeyFor(r.id)] : [])
  if (keys.length) {
    try {
      await deleteMany(keys)
    }
    catch (error) {
      // Las filas ya no existen: el usuario no puede reintentar. Se registra para limpiar el bucket a mano.
      console.error(`[trash] No se pudieron borrar ${keys.length} objetos del bucket`, error)
    }
  }
  return Number(rows[0]?.purged ?? 0)
}

const PURGE_BATCH = 500

/**
 * Purga todas las raíces (o solo las eliminadas antes de `before`) en lotes de 500, de la más antigua
 * a la más reciente. Idempotente: lo que ya no está en la papelera no se vuelve a contar.
 */
export async function purgeAll(before?: Date): Promise<number> {
  const cutoff = before ? sql`AND deleted_at < ${before.toISOString()}::timestamptz` : sql``
  let total = 0
  for (;;) {
    const result = await useDb().execute<{ id: string }>(sql`
      SELECT id FROM (
        SELECT id, deleted_at FROM folders WHERE trash_root_id = id ${cutoff}
        UNION ALL
        SELECT id, deleted_at FROM files WHERE trash_root_id = id ${cutoff}
      ) roots
      ORDER BY deleted_at
      LIMIT ${PURGE_BATCH}
    `)
    const ids = result.rows.map(r => r.id)
    if (ids.length === 0) break
    const purged = await purge(ids)
    total += purged
    // Sin avance (p. ej. otra purga simultánea se adelantó) se termina para no girar en vano.
    if (ids.length < PURGE_BATCH || purged === 0) break
  }
  return total
}

/** Valida el parámetro `:kind` de las rutas de papelera (404 si no es `file` ni `folder`). */
export function paramTrashKind(event: H3Event): TrashKind {
  const kind = getRouterParam(event, 'kind')
  if (kind !== 'file' && kind !== 'folder') throw createError({ statusCode: 404, statusMessage: 'No encontrado' })
  return kind
}
