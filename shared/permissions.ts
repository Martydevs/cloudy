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
  /** Renombrar o eliminar una lista de YouTube ajena (feature 005, research D12). */
  | 'youtube.moderate'
  /** Renombrar o eliminar una colección de canciones ajena (feature 006, research D17). */
  | 'songs.moderate'
  /** Eliminar una imagen de peticiones ajena o renombrar/eliminar una colección de imágenes ajena (feature 007). */
  | 'prayers.moderate'

const ADMIN_ONLY: ReadonlySet<Action> = new Set<Action>([
  'trash.empty',
  'users.manage',
  'activity.read',
  'comments.moderate',
  'youtube.moderate',
  'songs.moderate',
  'prayers.moderate',
])

export function can(role: Role | null | undefined, action: Action): boolean {
  if (role === 'admin') return true
  if (role === 'editor') return !ADMIN_ONLY.has(action)
  return false
}
