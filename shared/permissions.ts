// Matriz de permisos por rol (FR-007). El servidor la aplica; la UI solo la refleja.

export type Role = 'admin' | 'editor'

export type Action =
  | 'content.read'
  | 'content.write'
  | 'submissions.review'
  | 'trash.empty'
  | 'users.manage'
  | 'activity.read'
  | 'comments.moderate'

const ADMIN_ONLY: ReadonlySet<Action> = new Set<Action>([
  'trash.empty',
  'users.manage',
  'activity.read',
  'comments.moderate',
])

export function can(role: Role | null | undefined, action: Action): boolean {
  if (role === 'admin') return true
  if (role === 'editor') return !ADMIN_ONLY.has(action)
  return false
}
