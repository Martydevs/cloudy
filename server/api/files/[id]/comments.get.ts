// Comentarios de un archivo en orden cronológico (US8). `?since=` devuelve solo los nuevos (sondeo de 5 s).
import { createError } from 'h3'
import type { Comment } from '#shared/types/api'
import { commentsQuery } from '#shared/validation/comments'

export default defineEventHandler(async (event): Promise<Comment[]> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { since } = queryValid(event, commentsQuery)

  // Archivo y comentarios en un solo viaje: el hilo se sondea cada 5 s.
  const db = useDb()
  const [[file], rows] = await db.batch([commentFileQuery(id), listComments(id, since ? new Date(since) : undefined)])
  // Un archivo en la papelera no muestra su hilo (igual que `GET /api/files/:id`).
  if (!file || file.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El archivo no existe o está en la papelera' })
  }
  return rows.map(row => toComment(row, profile))
})
