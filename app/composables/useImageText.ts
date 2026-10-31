// Estado del texto de una imagen en el cliente (feature 002, contracts/ui): obtener, leer como respaldo,
// consultar mientras dura `reading`, reintentar, copiar y corregir. El servidor decide los estados.
import type { ImageText } from '#shared/types/api'
import { TEXT_POLL_INTERVAL_MS } from '#shared/constants/image-text'

export interface UseImageTextOptions {
  /** Estado que ya vino en un listado (tarjeta de Solicitudes); evita el primer `GET`. */
  initial?: ImageText | null
  /** Lee como respaldo si la imagen sigue pendiente. */
  autoRead?: boolean
}

export function useImageText(endpoint: MaybeRefOrGetter<string>, options: UseImageTextOptions = {}) {
  const api = useApi()
  const toast = useToast()
  const visibility = useDocumentVisibility()
  const online = useOnline()
  const { copy: copyToClipboard } = useClipboard({ legacy: true })

  const state = ref<ImageText | null>(options.initial ?? null)
  /** Primera carga o lectura en la petición (`POST`). */
  const loading = ref(false)
  /** Error de red del propio panel, no el de la lectura. */
  const error = ref<string | null>(null)
  let inFlight = false

  const { pause, resume } = useIntervalFn(poll, TEXT_POLL_INTERVAL_MS, { immediate: false })

  /** Consulta mientras la lectura sigue en curso y se detiene en un estado terminal. */
  function follow(next: ImageText) {
    state.value = next
    if (next.status === 'reading') resume()
    else pause()
  }

  async function poll() {
    if (inFlight || visibility.value !== 'visible' || !online.value) return
    inFlight = true
    try {
      follow(await api<ImageText>(toValue(endpoint)))
    }
    catch {
      // Una consulta fallida no cambia lo que se ve; la siguiente lo reintenta.
    }
    finally {
      inFlight = false
    }
  }

  async function read(force = false) {
    loading.value = true
    error.value = null
    try {
      follow(await api<ImageText>(toValue(endpoint), { method: 'POST', body: { force } }))
    }
    catch (e) {
      if (force) toast.error(serverMessage(e, messages.imageText.failedRetryable))
      else error.value = serverMessage(e, messages.imageText.loadFailed)
    }
    finally {
      loading.value = false
    }
  }

  /** Estado inicial (o `GET`) y, solo si sigue pendiente, la lectura de respaldo. */
  async function load() {
    error.value = null
    if (!state.value) {
      loading.value = true
      try {
        state.value = await api<ImageText>(toValue(endpoint))
      }
      catch (e) {
        error.value = serverMessage(e, messages.imageText.loadFailed)
        return
      }
      finally {
        loading.value = false
      }
    }
    if (state.value.status === 'pending') {
      if (options.autoRead) await read()
    }
    else {
      follow(state.value)
    }
  }

  async function copy() {
    const text = state.value?.text
    if (!text) return
    try {
      await copyToClipboard(text)
      toast.success(messages.imageText.copied)
    }
    catch {
      toast.error(messages.imageText.copyFailed)
    }
  }

  /** Corrección manual (US3). Devuelve si se guardó. */
  async function save(text: string): Promise<boolean> {
    try {
      follow(await api<ImageText>(toValue(endpoint), { method: 'PATCH', body: { text } }))
      toast.success(messages.imageText.saved)
      return true
    }
    catch (e) {
      toast.error(serverMessage(e, messages.imageText.saveFailed))
      return false
    }
  }

  onMounted(load)

  // Al volver a la pestaña o recuperar la conexión, una consulta inmediata.
  watch([visibility, online], ([visible, isOnline]) => {
    if (visible === 'visible' && isOnline && state.value?.status === 'reading') poll()
  })

  return { state, loading, error, load, read, copy, save }
}
