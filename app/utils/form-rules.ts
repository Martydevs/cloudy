// Reglas de Regle de los formularios. Reflejan los validadores de `shared/validation/*` (el servidor sigue
// siendo la autoridad); `test/nuxt/form-rules.spec.ts` comprueba que ambos coinciden.
import type { RegleComputedRules } from '@regle/core'
import { maxLength, minLength, required, sameAs } from '@regle/rules'
import { FetchError } from 'ofetch'
import { MAX_IMAGE_TEXT_LENGTH } from '#shared/constants/image-text'
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from '#shared/validation/auth'
import { COMMENT_MAX_LENGTH } from '#shared/validation/comments'
import { FILE_NAME_MAX, FOLDER_NAME_MAX } from '#shared/validation/files'
import { NOTE_MAX, SENDER_NAME_MAX } from '#shared/validation/submissions'
import { maxChars, safeName, validEmail } from '~/regle-config'

export type RegisterForm = { name: string, email: string, password: string, confirm: string }
export type LoginForm = { email: string, password: string }
export type ForgotForm = { email: string }
export type ResetForm = { password: string, confirm: string }
export type ChangePasswordForm = { currentPassword: string, password: string, confirm: string }
export type ProfileNameForm = { name: string }
export type NameForm = { name: string }
export type CommentForm = { body: string }
export type ImageTextForm = { text: string }

/**
 * Reglas de un formulario de `AuthForm`. Reciben el estado para comparar campos (confirmar la contraseña) y
 * para que el componente infiera el tipo de los datos que emite.
 */
export type FormRules<S extends Record<string, string>> = (state: S) => RegleComputedRules<S>

const name = () => ({ required, maxChars: maxChars(NAME_MAX) })
const email = () => ({ required, validEmail })
// Las contraseñas no se recortan: `minLength`/`maxLength` miden el valor tal cual, como `str({ trim: false })`.
const newPassword = () => ({ required, minLength: minLength(PASSWORD_MIN), maxLength: maxLength(PASSWORD_MAX) })
const confirmPassword = (state: { password: string }) => ({ required, sameAs: sameAs(() => state.password) })

export const registerRules: FormRules<RegisterForm> = state => ({
  name: name(),
  email: email(),
  password: newPassword(),
  confirm: confirmPassword(state),
})

export const loginRules: FormRules<LoginForm> = () => ({ email: email(), password: { required } })

export const forgotRules: FormRules<ForgotForm> = () => ({ email: email() })

export const resetRules: FormRules<ResetForm> = state => ({
  password: newPassword(),
  confirm: confirmPassword(state),
})

export const changePasswordRules: FormRules<ChangePasswordForm> = state => ({
  currentPassword: { required },
  password: newPassword(),
  confirm: confirmPassword(state),
})

export const profileNameRules: FormRules<ProfileNameForm> = () => ({ name: name() })

export const folderNameRules = () => ({
  name: { required, maxChars: maxChars(FOLDER_NAME_MAX), safeName },
}) satisfies RegleComputedRules<NameForm>

export const fileNameRules = () => ({
  name: { required, maxChars: maxChars(FILE_NAME_MAX), safeName },
}) satisfies RegleComputedRules<NameForm>

/** Reglas del nombre en `NameDialog`: carpeta o archivo, con la misma forma. */
export type NameRules = typeof folderNameRules | typeof fileNameRules

export const commentRules = () => ({
  body: { required, maxChars: maxChars(COMMENT_MAX_LENGTH) },
}) satisfies RegleComputedRules<CommentForm>

export const imageTextRules = () => ({
  text: { required, maxChars: maxChars(MAX_IMAGE_TEXT_LENGTH) },
}) satisfies RegleComputedRules<ImageTextForm>

/** Nombre del invitado (solicitud de acceso y envío). */
export const senderNameRules = () => ({ required, maxChars: maxChars(SENDER_NAME_MAX) })

/** Nota opcional del envío: sin `required`. */
export const noteRules = () => ({ maxChars: maxChars(NOTE_MAX) })

/**
 * Errores de campo de un 422 (`{ errors: { campo: mensaje } }`) en el formato de `externalErrors` de Regle
 * (`{ campo: [mensaje] }`). Vacío si la respuesta no es un 422 con errores de campo.
 */
export function externalErrorsFrom(error: unknown): Record<string, string[]> {
  if (!(error instanceof FetchError) || error.response?.status !== 422) return {}
  const errors = (error.data as { data?: { errors?: Record<string, string> } } | undefined)?.data?.errors ?? {}
  return Object.fromEntries(Object.entries(errors).map(([field, message]) => [field, [message]]))
}
