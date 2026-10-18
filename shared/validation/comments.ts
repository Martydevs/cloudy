// Comentarios en archivos (US8): mismas reglas en el formulario y en los endpoints.
import { isoSince, object, str } from './core'

export const COMMENT_MAX_LENGTH = 2000

/** 1–2 000 caracteres tras `trim` (data-model `comments.body`). */
export const commentInput = object({ body: str({ max: COMMENT_MAX_LENGTH }) })

/** `since` trae solo los comentarios creados después del cursor (sondeo). */
export const commentsQuery = object({ since: isoSince() })
