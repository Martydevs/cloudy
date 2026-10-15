// Estado compartido del diálogo de subida: lo abren la barra superior y los accesos rápidos,
// y las vistas de archivos se refrescan cuando `version` cambia.
export function useUploadDialog() {
  const isOpen = useState('upload-open', () => false)
  const folderId = useState<string | null>('upload-folder', () => null)
  const version = useState('upload-version', () => 0)
  const route = useRoute()

  function open(target?: string | null) {
    const current = typeof route.params.folderId === 'string' ? route.params.folderId : null
    folderId.value = target === undefined ? current : target
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function notifyUploaded() {
    version.value++
  }

  return { isOpen, folderId, version, open, close, notifyUploaded }
}
