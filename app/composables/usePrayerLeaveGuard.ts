// Aviso al salir de Peticiones (feature 007, contracts/ui.md "Salir"): con imágenes en cola o generándose, la navegación
// interna pide confirmación y cerrar o recargar la pestaña muestra el aviso nativo del navegador (lo terminado ya está
// guardado en el historial). Al aceptar, se aborta la cola y se vacía la selección. El guardián del router vive solo mientras la página está montada
// (no depende de que la página sea el componente de `<RouterView>`).
// Página de generación (2026-11-15): `keep` dice a qué rutas se pasa la cola sin avisar ni vaciarla (de /peticiones a una
// generación y de vuelta); la página de destino toma el guardián. Al desmontarse, la página vacía la cola y la selección
// salvo que se haya ido a una de esas rutas.
export function usePrayerLeaveGuard({ keep = () => false }: { keep?: (path: string) => boolean } = {}) {
  const images = usePrayerImages()
  const selection = usePrayerSelection()
  const router = useRouter()
  const { confirm } = useConfirm()
  const m = messages.prayers

  /** La última salida aceptada fue a una ruta que se queda con la cola. */
  let handedOff = false
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = router.beforeEach(async (to, from) => {
      if (to.path === from.path) return true
      if (keep(to.path)) {
        handedOff = true
        return true
      }
      handedOff = false
      if (!images.needsLeaveGuard.value) return true
      if (!await confirm({ title: m.leaveTitle, message: m.leaveBody, confirmLabel: m.leaveConfirm, danger: true })) return false
      images.reset()
      selection.clear()
      return true
    })
  })
  // La cola y la selección viven mientras se está en Peticiones: al salir se liberan (el guardián ya confirmó si hacía
  // falta). Lo generado ya está guardado en el historial.
  onBeforeUnmount(() => {
    stop?.()
    if (handedOff) return
    images.reset()
    selection.clear()
  })

  if (import.meta.client) {
    useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
      if (!images.needsLeaveGuard.value) return
      event.preventDefault()
      // Navegadores que todavía piden `returnValue` para mostrar el aviso.
      event.returnValue = ''
    })
  }
}

/** Rutas de una generación: `/peticiones/generaciones/<id>`. */
export const isPrayerGenerationPath = (path: string) => path.startsWith('/peticiones/generaciones/')
