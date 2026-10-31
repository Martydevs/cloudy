// Registro de actividad (FR-023): cada acción del enum `activity_action` con su texto en español.

export const ACTIVITY_LABELS: Record<string, string> = {
  'file.upload': 'subió el archivo',
  'file.rename': 'renombró el archivo',
  'file.move': 'movió el archivo',
  'file.trash': 'envió a la papelera el archivo',
  'file.restore': 'restauró el archivo',
  'file.purge': 'eliminó definitivamente el archivo',
  'file.text_edit': 'corrigió el texto de la imagen',
  'folder.create': 'creó la carpeta',
  'folder.rename': 'renombró la carpeta',
  'folder.move': 'movió la carpeta',
  'folder.trash': 'envió a la papelera la carpeta',
  'folder.restore': 'restauró la carpeta',
  'folder.purge': 'eliminó definitivamente la carpeta',
  'trash.empty': 'vació la papelera',
  'submission.approve': 'aprobó el envío de',
  'submission.reject': 'rechazó el envío de',
  'comment.admin_delete': 'eliminó un comentario en',
  'user.activate': 'activó la cuenta de',
  'user.disable': 'desactivó la cuenta de',
  'user.role_change': 'cambió el rol de',
  'user.remove': 'eliminó la cuenta de',
  // Solicitudes de acceso de invitados (feature 003, FR-011).
  'access.approve': 'dio acceso a',
  'access.reject': 'rechazó la solicitud de',
}

/** Opciones del filtro, en el orden del enum. */
export const ACTIVITY_ACTIONS = Object.keys(ACTIVITY_LABELS)

export const ACTIVITY_ICONS: Record<string, string> = {
  file: 'lucide:file',
  folder: 'lucide:folder',
  trash: 'lucide:trash-2',
  submission: 'lucide:inbox',
  comment: 'lucide:message-square',
  user: 'lucide:user',
  access: 'lucide:door-open',
}

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action
}

export function activityIcon(action: string): string {
  return ACTIVITY_ICONS[action.split('.')[0] ?? ''] ?? 'lucide:activity'
}

/** Detalle extra legible a partir de `meta` (p. ej. el cambio de rol o el nombre anterior). */
export function activityDetail(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return ''
  const role = (value: unknown) => roleLabel(value === 'admin' || value === 'editor' ? value : null)
  if (action === 'user.role_change') return `${role(meta.from)} → ${role(meta.to)}`
  if (action === 'user.activate' && typeof meta.role === 'string') return `como ${role(meta.role)}`
  if ((action === 'file.rename' || action === 'folder.rename') && typeof meta.from === 'string') return `antes «${meta.from}»`
  if (action === 'submission.reject' && typeof meta.reason === 'string' && meta.reason) return `motivo: ${meta.reason}`
  if (action === 'comment.admin_delete' && typeof meta.author === 'string') return `escrito por ${meta.author}`
  return ''
}
