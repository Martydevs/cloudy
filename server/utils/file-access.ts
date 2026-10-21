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

/** Imagen visible (lista y fuera de la papelera), o 404: el texto extraído solo existe para imágenes (feature 002). */
export async function getVisibleImage(id: string): Promise<{ id: string, name: string }> {
  const [row] = await useDb()
    .select({ id: files.id, name: files.name, category: files.category })
    .from(files)
    .where(and(eq(files.id, id), visibleFilesWhere()))
    .limit(1)
  if (!row || row.category !== 'image') {
    throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La imagen no existe o está en la papelera' })
  }
  return { id: row.id, name: row.name }
}
