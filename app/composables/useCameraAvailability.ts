// "Abrir cámara" solo en teléfonos y tabletas (feature 003, FR-016e, research B9): puntero principal táctil,
// `getUserMedia` disponible (contexto seguro) y al menos una cámara. Independiente del ancho de la ventana.
// Solo en el cliente: en SSR es `false` y el botón aparece tras hidratar, en un espacio ya reservado.
export function useCameraAvailability() {
  const coarse = useMediaQuery('(pointer: coarse)')
  const supported = useSupported(() => !!navigator.mediaDevices?.getUserMedia)
  const hasCamera = ref(false)

  onMounted(async () => {
    if (!supported.value) return
    try {
      // Antes del permiso el navegador expone como máximo un dispositivo por tipo: basta para saber si hay cámara.
      const devices = await navigator.mediaDevices.enumerateDevices()
      hasCamera.value = devices.some(device => device.kind === 'videoinput')
    }
    catch {
      hasCamera.value = false
    }
  })

  return { available: computed(() => coarse.value && supported.value && hasCamera.value) }
}
