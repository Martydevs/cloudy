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
  /**
   * Agendar, editar y borrar días de trabajo del calendario (`/calendario`), y cambiar el estado de cualquiera. Los editores
   * ven; el estado de un día en el que están asignados lo decide `canSetWorkDayStatus`, no esta matriz.
   */
  | 'calendar.manage'

const ADMIN_ONLY: ReadonlySet<Action> = new Set<Action>([
  'trash.empty',
  'users.manage',
  'activity.read',
  'comments.moderate',
  'youtube.moderate',
  'songs.moderate',
  'prayers.moderate',
  'calendar.manage',
])

export function can(role: Role | null | undefined, action: Action): boolean {
  if (role === 'admin') return true
  if (role === 'editor') return !ADMIN_ONLY.has(action)
  return false
}

/**
 * Cambiar el estado de un día de trabajo: quien administra, el de cualquiera; un editor, solo el de los días en los que
 * está asignado como miembro. Depende del día, así que no cabe en la matriz por rol. El servidor lo aplica en
 * `setWorkDayStatus`; la interfaz solo lo refleja.
 */
export function canSetWorkDayStatus(
  role: Role | null | undefined,
  userId: string | null | undefined,
  members: readonly { userId: string }[],
): boolean {
  if (role === 'admin') return true
  if (role !== 'editor' || !userId) return false
  return members.some(member => member.userId === userId)
}
