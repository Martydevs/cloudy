// Esquemas zod de los formularios (`zod/mini`: el cliente solo carga lo que usa). Reflejan los validadores de
// `shared/validation/*` (el servidor sigue siendo la autoridad); `test/nuxt/form-schemas.spec.ts` comprueba que ambos
// coinciden. Mensajes y límites salen de `shared/validation`, los mismos que usa el servidor.
import { FetchError } from 'ofetch'
import * as z from 'zod/mini'
import { MAX_IMAGE_TEXT_LENGTH } from '#shared/constants/image-text'
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from '#shared/validation/auth'
import { COMMENT_MAX_LENGTH } from '#shared/validation/comments'
import {
  EMAIL_MAX,
  EMAIL_MESSAGE,
  EMAIL_RE,
  PASSWORD_MISMATCH_MESSAGE,
  REQUIRED_MESSAGE,
  maxMessage,
  minMessage,
} from '#shared/validation/core'
import { FILE_NAME_MAX, FOLDER_NAME_MAX, FORBIDDEN_MESSAGE, NAME_PATTERN } from '#shared/validation/files'
import { NOTE_MAX, SENDER_NAME_MAX } from '#shared/validation/submissions'
import { YOUTUBE_PLAYLIST_NAME_MAX } from '#shared/constants/youtube'
import { parseYoutubeUrl, YOUTUBE_URL_MESSAGES } from '#shared/validation/youtube'
import { SONG_COLLECTION_NAME_MAX, SONG_URL_MESSAGES } from '#shared/constants/songs'
import { parseLetrasUrl } from '#shared/validation/songs'

/**
 * Obligatorio: un texto de solo espacios cuenta como vacío. Va siempre primero en cada campo, que es el error que se
 * muestra. No usa `abort`: un fallo con `abort` hace que zod omita también la comprobación de objeto de la
 * confirmación (`confirmMatches`), y el servidor informa de ambos errores.
 */
const filled = z.refine<string>(value => value.trim().length > 0, { error: REQUIRED_MESSAGE })

/** Máximo de caracteres tras recortar, como `str()` del servidor (`maxLength` de zod no recorta). */
const maxChars = (max: number) => z.refine<string>(value => value.trim().length <= max, { error: maxMessage(max) })

/** Nombres de carpetas y archivos sin / \ : * ? " < > | ni caracteres de control. */
const safeName = z.refine<string>(value => value.trim() === '' || NAME_PATTERN.test(value.trim()), { error: FORBIDDEN_MESSAGE })

/** Mismo criterio que `email()` del servidor. */
const validEmail = z.refine<string>(value => {
  const email = value.trim()
  return email === '' || (email.length <= EMAIL_MAX && EMAIL_RE.test(email))
}, { error: EMAIL_MESSAGE })

const name = () => z.string().check(filled, maxChars(NAME_MAX))
const email = () => z.string().check(filled, validEmail)
// Las contraseñas no se recortan: el mínimo y el máximo miden el valor tal cual, como `str({ trim: false })`.
const newPassword = () => z.string().check(
  filled,
  z.minLength(PASSWORD_MIN, minMessage(PASSWORD_MIN)),
  z.maxLength(PASSWORD_MAX, maxMessage(PASSWORD_MAX)),
)
const confirmPassword = () => z.string().check(filled)
/** La confirmación debe ser igual a la contraseña; el error se marca en el campo de confirmación. */
const confirmMatches = z.refine<{ password: string, confirm: string }>(
  value => value.password === value.confirm,
  { error: PASSWORD_MISMATCH_MESSAGE, path: ['confirm'] },
)

export const registerSchema = z.object({
  name: name(),
  email: email(),
  password: newPassword(),
  confirm: confirmPassword(),
}).check(confirmMatches)

export const loginSchema = z.object({ email: email(), password: z.string().check(filled) })

export const forgotSchema = z.object({ email: email() })

export const resetSchema = z.object({ password: newPassword(), confirm: confirmPassword() }).check(confirmMatches)

export const changePasswordSchema = z.object({
  currentPassword: z.string().check(filled),
  password: newPassword(),
  confirm: confirmPassword(),
}).check(confirmMatches)

export const profileNameSchema = z.object({ name: name() })

export const folderNameSchema = z.object({ name: z.string().check(filled, maxChars(FOLDER_NAME_MAX), safeName) })

export const fileNameSchema = z.object({ name: z.string().check(filled, maxChars(FILE_NAME_MAX), safeName) })

/** Esquema del nombre en `NameDialog`: carpeta o archivo, con la misma forma. */
export type NameSchema = typeof folderNameSchema | typeof fileNameSchema

export const commentSchema = z.object({ body: z.string().check(filled, maxChars(COMMENT_MAX_LENGTH)) })

export const imageTextSchema = z.object({ text: z.string().check(filled, maxChars(MAX_IMAGE_TEXT_LENGTH)) })

/** Nombre del invitado en su envío. */
export const senderNameSchema = z.string().check(filled, maxChars(SENDER_NAME_MAX))

/** Nota opcional del envío: sin `filled`. */
export const noteSchema = z.string().check(maxChars(NOTE_MAX))

/** Envío del invitado en `GuestUploadForm` (`/upload`): nombre obligatorio y nota opcional. */
export const guestSubmissionSchema = z.object({
  name: senderNameSchema,
  note: noteSchema,
})

/**
 * Enlace de YouTube pegado en `/youtube` (feature 005, research D13). La regla es `parseYoutubeUrl` de `shared/`; su
 * motivo de rechazo elige el mensaje. Vacío → obligatorio (y el `refine` no repite el error).
 */
const youtubeUrl = z.refine<string>(
  value => value.trim() === '' || parseYoutubeUrl(value).ok,
  {
    error: (issue) => {
      const res = parseYoutubeUrl(issue.input)
      return res.ok ? YOUTUBE_URL_MESSAGES.not_url : YOUTUBE_URL_MESSAGES[res.reason]
    },
  },
)

export const youtubeUrlSchema = z.object({ url: z.string().check(filled, youtubeUrl) })

/** Nombre de una lista de YouTube: 1–80 caracteres tras recortar, como `playlistName()` del servidor. */
export const youtubePlaylistSchema = z.object({ name: z.string().check(filled, maxChars(YOUTUBE_PLAYLIST_NAME_MAX)) })

/**
 * Enlace de Letras.com pegado en `/canciones` (feature 006, research D6). La regla es `parseLetrasUrl` de `shared/`; su
 * motivo de rechazo elige el mensaje. Vacío → obligatorio (y el `refine` no repite el error).
 */
const letrasUrl = z.refine<string>(
  value => value.trim() === '' || parseLetrasUrl(value).ok,
  {
    error: (issue) => {
      const res = parseLetrasUrl(issue.input)
      return res.ok ? SONG_URL_MESSAGES.not_url : SONG_URL_MESSAGES[res.reason]
    },
  },
)

export const songUrlSchema = z.object({ url: z.string().check(filled, letrasUrl) })

/** Nombre de una colección de canciones: 1–80 caracteres tras recortar, como `songCollectionName()` del servidor. */
export const songCollectionSchema = z.object({ name: z.string().check(filled, maxChars(SONG_COLLECTION_NAME_MAX)) })

export type RegisterForm = z.infer<typeof registerSchema>
export type LoginForm = z.infer<typeof loginSchema>
export type ForgotForm = z.infer<typeof forgotSchema>
export type ResetForm = z.infer<typeof resetSchema>
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>
export type ProfileNameForm = z.infer<typeof profileNameSchema>
export type CommentForm = z.infer<typeof commentSchema>

/**
 * Errores de campo de un 422 (`{ errors: { campo: mensaje } }`) en el formato de `externalErrors` de Regle
 * (`{ campo: [mensaje] }`). Vacío si la respuesta no es un 422 con errores de campo.
 */
export function externalErrorsFrom(error: unknown): Record<string, string[]> {
  if (!(error instanceof FetchError) || error.response?.status !== 422) return {}
  const errors = (error.data as { data?: { errors?: Record<string, string> } } | undefined)?.data?.errors ?? {}
  return Object.fromEntries(Object.entries(errors).map(([field, message]) => [field, [message]]))
}
