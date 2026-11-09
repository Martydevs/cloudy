// Gestión de usuarios (FR-021, FR-022). La regla "activar desde pending exige rol" vive en el
// handler porque necesita el estado actual del usuario.
import type { Field } from './core'
import { array, int, object, oneOf, optional, str } from './core'

export const USER_PAGE_SIZE = 50

export const userPatchInput = object({
  status: optional(oneOf(['active', 'disabled'] as const)),
  role: optional(oneOf(['admin', 'editor'] as const)),
}, raw => (raw.status == null || raw.status === '') && (raw.role == null || raw.role === '')
  ? { status: 'Indica un estado o un rol' }
  : null)

export const usersQuery = object({
  status: optional(oneOf(['pending', 'active', 'disabled'] as const)),
  page: optional(int({ min: 1 })),
  pageSize: optional(int({ min: 1, max: USER_PAGE_SIZE })),
})

// ---------------------------------------------------------------- selección múltiple de Usuarios

/** Lo que se puede hacer con varias cuentas a la vez: desactivar, eliminar o cambiar el rol. */
export const USER_BATCH_ACTIONS = ['disable', 'remove', 'role'] as const
export type UserBatchAction = (typeof USER_BATCH_ACTIONS)[number]
/** Cuentas por petición: lo que cabe en una página de `/usuarios`. */
export const USER_BATCH_MAX = 20

function userIdList(): Field<string[]> {
  const list = array(str({ max: 200 }))
  return (input) => {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Elige al menos una cuenta' }
    if (input.length > USER_BATCH_MAX) return { ok: false, error: `Puedes cambiar como máximo ${USER_BATCH_MAX} cuentas a la vez` }
    const res = list(input)
    return res.ok ? res : { ok: false, error: 'Cuenta no válida' }
  }
}

/** `role` es obligatorio (y solo cuenta) cuando `action = 'role'`. */
export const userBatchInput = object({
  ids: userIdList(),
  action: oneOf(USER_BATCH_ACTIONS, 'Acción no válida'),
  role: optional(oneOf(['admin', 'editor'] as const, 'Rol no válido')),
}, raw => raw.action === 'role' && (raw.role == null || raw.role === '') ? { role: 'Elige un rol' } : null)
