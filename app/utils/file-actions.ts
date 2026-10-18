// Opciones del menú `⋯` de archivos y carpetas (mismo orden en cuadrícula, lista y detalle).
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

export type ItemAction = 'open' | 'rename' | 'move' | 'trash'

export function fileMenuItems(fileId: string, { includeOpen = true } = {}): ActionMenuItem[] {
  return [
    ...(includeOpen ? [{ key: 'open', label: 'Abrir', icon: 'lucide:eye' }] : []),
    { key: 'download', label: 'Descargar', icon: 'lucide:download', href: `/api/files/${fileId}/content?download=1` },
    { key: 'rename', label: 'Renombrar', icon: 'lucide:pencil' },
    { key: 'move', label: 'Mover', icon: 'lucide:folder-input' },
    { key: 'trash', label: 'Eliminar', icon: 'lucide:trash-2', danger: true },
  ]
}

export const folderMenuItems: ActionMenuItem[] = [
  { key: 'open', label: 'Abrir', icon: 'lucide:folder-open' },
  { key: 'rename', label: 'Renombrar', icon: 'lucide:pencil' },
  { key: 'move', label: 'Mover', icon: 'lucide:folder-input' },
  { key: 'trash', label: 'Eliminar', icon: 'lucide:trash-2', danger: true },
]
