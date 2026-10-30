// Reglas de los formularios de cuenta (FR-001, FR-004, FR-027, FR-030).
import { email, object, sameAs, str } from './core'

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const NAME_MAX = 80

const name = () => str({ max: NAME_MAX })
const newPassword = () => str({ min: PASSWORD_MIN, max: PASSWORD_MAX, trim: false })
const confirm = () => str({ trim: false })

export const registerInput = object(
  { name: name(), email: email(), password: newPassword(), confirm: confirm() },
  sameAs('password', 'confirm'),
)

export const loginInput = object({ email: email(), password: str({ trim: false }) })

export const forgotInput = object({ email: email() })

export const resetInput = object(
  { password: newPassword(), confirm: confirm() },
  sameAs('password', 'confirm'),
)

export const changePasswordInput = object(
  { currentPassword: str({ trim: false }), password: newPassword(), confirm: confirm() },
  sameAs('password', 'confirm'),
)

export const profileNameInput = object({ name: name() })

/** URL a la que lleva el enlace del correo de recuperación. */
export function buildResetRedirect(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/restablecer`
}
