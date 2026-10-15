// Textos en español de roles y estados de cuenta (una sola definición para todas las vistas).
import type { Role } from '#shared/permissions'
import type { UserStatus } from '#shared/types/api'

export const ROLE_LABELS: Record<Role, string> = { admin: 'Administrador', editor: 'Editor' }

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: 'Pendiente',
  active: 'Activo',
  disabled: 'Desactivado',
  removed: 'Eliminado',
}

export const STATUS_BADGE: Record<UserStatus, string> = {
  pending: 'badge-warning',
  active: 'badge-success badge-soft',
  disabled: 'badge-ghost',
  removed: 'badge-ghost',
}

export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'Sin rol'
}
