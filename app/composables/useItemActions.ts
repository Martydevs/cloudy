// Acciones sobre archivos y carpetas compartidas por el explorador y el detalle:
// crear carpeta, renombrar, mover y enviar a la papelera, con confirmación y avisos (Constitución VI).
import type { FileItem, FolderItem } from '#shared/types/api'

export type ItemKind = 'file' | 'folder'
type Item = FileItem | FolderItem

export type ItemDialog =
  | { type: 'create', parentId: string | null }
  | { type: 'rename', kind: ItemKind, item: Item }
  | { type: 'move', kind: ItemKind, item: Item }

export type ItemChange = 'created' | 'renamed' | 'moved' | 'trashed'

/** Nombre sin la extensión (el campo de renombrar no deja cambiarla). */
export function baseName(item: Item, kind: ItemKind): string {
  if (kind === 'folder') return item.name
  const ext = (item as FileItem).extension
  return item.name.toLowerCase().endsWith(`.${ext}`) ? item.name.slice(0, -(ext.length + 1)) : item.name
}

export function useItemActions(onChanged: (change: ItemChange, kind: ItemKind, item: Item) => void) {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const dialog = ref<ItemDialog | null>(null)
  const busy = ref(false)
  const serverError = ref('')

  function open(next: ItemDialog) {
    serverError.value = ''
    dialog.value = next
  }

  function close() {
    dialog.value = null
    serverError.value = ''
  }

  async function run(task: () => Promise<void>, fallback: string) {
    busy.value = true
    serverError.value = ''
    try {
      await task()
      close()
    }
    catch (error) {
      serverError.value = serverMessage(error, fallback)
      // El selector de carpetas no tiene zona de error propia: se avisa con un toast.
      if (dialog.value?.type === 'move') toast.error(serverError.value)
    }
    finally {
      busy.value = false
    }
  }

  async function submitName(value: string) {
    const current = dialog.value
    if (!current || current.type === 'move') return
    if (current.type === 'create') {
      await run(async () => {
        const folder = await api<FolderItem>('/api/folders', { method: 'POST', body: { name: value, parentId: current.parentId } })
        toast.success(folder.name === value ? `Carpeta «${folder.name}» creada` : `Ya existía «${value}»: se creó «${folder.name}»`)
        onChanged('created', 'folder', folder)
      }, 'No pudimos crear la carpeta. Inténtalo de nuevo.')
      return
    }
    const { kind, item } = current
    const name = kind === 'file' ? `${value}.${(item as FileItem).extension}` : value
    await run(async () => {
      const url = kind === 'file' ? `/api/files/${item.id}` : `/api/folders/${item.id}`
      const updated = await api<Item>(url, { method: 'PATCH', body: { name } })
      toast.success(`Ahora se llama «${updated.name}»`)
      onChanged('renamed', kind, updated)
    }, 'No pudimos renombrar. Inténtalo de nuevo.')
  }

  async function submitMove(target: string | null) {
    const current = dialog.value
    if (!current || current.type !== 'move') return
    const { kind, item } = current
    await run(async () => {
      const url = kind === 'file' ? `/api/files/${item.id}` : `/api/folders/${item.id}`
      const body = kind === 'file' ? { folderId: target } : { parentId: target }
      const updated = await api<Item>(url, { method: 'PATCH', body })
      toast.success(`Se movió «${updated.name}»`)
      onChanged('moved', kind, updated)
    }, 'No pudimos mover el elemento. Inténtalo de nuevo.')
  }

  async function trash(kind: ItemKind, item: Item) {
    let message = 'Podrás restaurarlo desde la papelera durante 30 días.'
    if (kind === 'folder') {
      const { items } = await api<{ items: number }>(`/api/folders/${item.id}/count`).catch(() => ({ items: 0 }))
      if (items > 0) message = `Se enviarán ${items === 1 ? '1 elemento' : `${items} elementos`} a la papelera junto con la carpeta. ${message}`
    }
    const ok = await confirm({
      title: `¿Eliminar «${item.name}»?`,
      message,
      confirmLabel: 'Enviar a la papelera',
      danger: true,
    })
    if (!ok) return
    try {
      await api(kind === 'file' ? `/api/files/${item.id}` : `/api/folders/${item.id}`, { method: 'DELETE' })
      toast.success(`«${item.name}» se envió a la papelera`)
      onChanged('trashed', kind, item)
    }
    catch (error) {
      toast.error(serverMessage(error, 'No pudimos eliminarlo. Inténtalo de nuevo.'))
    }
  }

  return { dialog, busy, serverError, open, close, submitName, submitMove, trash }
}
