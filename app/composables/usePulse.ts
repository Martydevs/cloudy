// "Tiempo real" por sondeo cada 3 s (research R7): se pausa con la pestaña oculta o sin conexión.
import type { Pulse } from '#shared/types/api'
import { POLL_INTERVAL_MS } from '#shared/constants/files'

export function usePulse() {
  const pendingCount = useState('pulse-pending', () => 0)
  const newSubmissions = useState<Pulse['newSubmissions']>('pulse-new', () => [])
  const cursor = useState<string | null>('pulse-cursor', () => null)
  return { pendingCount, newSubmissions, cursor }
}

/** Arranca el sondeo; se llama una vez desde el layout del dashboard. */
export function usePulsePolling() {
  const { pendingCount, newSubmissions, cursor } = usePulse()
  const api = useApi()
  const visibility = useDocumentVisibility()
  const online = useOnline()
  let inFlight = false

  async function poll() {
    if (inFlight || visibility.value !== 'visible' || !online.value) return
    inFlight = true
    try {
      const pulse = await api<Pulse>('/api/realtime/pulse', { query: cursor.value ? { since: cursor.value } : {} })
      pendingCount.value = pulse.pendingCount
      newSubmissions.value = pulse.newSubmissions
      cursor.value = pulse.cursor
    }
    catch {
      // Un pulso fallido no interrumpe la UI; el siguiente lo reintenta.
    }
    finally {
      inFlight = false
    }
  }

  const { pause, resume } = useIntervalFn(poll, POLL_INTERVAL_MS, { immediate: false })

  onMounted(() => {
    poll()
    resume()
  })

  // Pulso inmediato al volver a la pestaña o recuperar la conexión.
  watch([visibility, online], ([visible, isOnline]) => {
    if (visible === 'visible' && isOnline) poll()
  })

  return { poll, pause, resume }
}
