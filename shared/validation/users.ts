// Gestión de usuarios (FR-021, FR-022). La regla "activar desde pending exige rol" vive en el
// handler porque necesita el estado actual del usuario.
import { int, object, oneOf, optional } from './core'

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
