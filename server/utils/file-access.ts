// Lectura de un archivo visible (listo y fuera de la papelera) con su autor.
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { files, profiles } from '../db/schema'
import { fileColumns, visibleFilesWhere } from './files'
import { commentCountSql } from './pagination'

export async function getVisibleFile(id: string) {
  const [row] = await useDb()
    .select({ ...fileColumns, commentCount: commentCountSql() })
    .from(files)
    .leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
    .where(and(eq(files.id, id), visibleFilesWhere()))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El archivo no existe o está en la papelera' })
  return row
}
