// Aviso al salir de Peticiones (feature 007, contracts/ui.md "Salir"): con imágenes generándose o sin descargar, la navegación
// interna pide confirmación y cerrar o recargar la pestaña muestra el aviso nativo del navegador. Al aceptar, se aborta la
// cola, se liberan las imágenes y se vacía la selección. El guardián del router vive solo mientras la página está montada
// (no depende de que la página sea el componente de `<RouterView>`).
export function usePrayerLeaveGuard() {
  const images = usePrayerImages()
  const selection = usePrayerSelection()
  const router = useRouter()
  const { confirm } = useConfirm()
  const m = messages.prayers

  let stop: (() => void) | undefined
  onMounted(() => {
    stop = router.beforeEach(async (to, from) => {
      if (to.path === from.path || !images.needsLeaveGuard.value) return true
      if (!await confirm({ title: m.leaveTitle, message: m.leaveBody, confirmLabel: m.leaveConfirm, danger: true })) return false
      images.reset()
      selection.clear()
      return true
    })
  })
  onBeforeUnmount(() => stop?.())

  if (import.meta.client) {
    useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
      if (!images.needsLeaveGuard.value) return
      event.preventDefault()
      // Navegadores que todavía piden `returnValue` para mostrar el aviso.
      event.returnValue = ''
    })
  }
}
