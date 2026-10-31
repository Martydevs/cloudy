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

/** Nombre del invitado (solicitud de acceso y envío). */
export const senderNameSchema = z.string().check(filled, maxChars(SENDER_NAME_MAX))

/** Nota opcional del envío: sin `filled`. */
export const noteSchema = z.string().check(maxChars(NOTE_MAX))

/** Solicitud de acceso en `/upload`: solo el nombre. */
export const accessRequestSchema = z.object({ name: senderNameSchema })

/**
 * Envío del invitado en `GuestUploadForm`. Con el nombre fijo de la solicitud aprobada no hay campo que validar:
 * `fixedName` deja pasar cualquier texto en `name`.
 */
export const guestSubmissionSchema = (fixedName: boolean) => z.object({
  name: fixedName ? z.string() : senderNameSchema,
  note: noteSchema,
})

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
