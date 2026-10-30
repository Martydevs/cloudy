// Stream de la cámara y captura de fotos (feature 003, research B8). Prefiere la cámara trasera (`ideal`: cae a
// la frontal si no hay otra) y nunca pide audio. Se apaga al ocultarse la pestaña y al desmontar.
import type { CameraErrorKey } from '~/utils/camera'

const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
}

export function useCameraCapture() {
  // `useUserMedia` detiene las pistas al desmontar (scope dispose).
  const { stream, start: startStream, stop } = useUserMedia({ enabled: false, constraints: CONSTRAINTS })
  const errorKey = ref<CameraErrorKey | null>(null)
  const starting = ref(false)

  /** Pide el permiso (solo al tocar "Abrir cámara") y deja el error traducido en `errorKey`. */
  async function start() {
    errorKey.value = null
    starting.value = true
    try {
      await startStream()
      // Sin API (contexto no seguro o navegador sin soporte) no hay stream ni excepción.
      if (!stream.value) errorKey.value = 'failed'
    }
    catch (error) {
      errorKey.value = cameraErrorKey(error)
    }
    finally {
      starting.value = false
    }
  }

  /** Fotograma actual del video al tamaño real de la pista, como JPEG `foto-….jpg`. */
  async function capture(video: HTMLVideoElement): Promise<File> {
    const settings = stream.value?.getVideoTracks()[0]?.getSettings()
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || settings?.width || 1280
    canvas.height = video.videoHeight || settings?.height || 720
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas no disponible')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await encodeJpeg(canvas)
    return new File([blob], photoFileName(new Date()), { type: 'image/jpeg' })
  }

  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state !== 'visible') stop()
  })

  return { stream, errorKey, starting, start, stop, capture }
}
