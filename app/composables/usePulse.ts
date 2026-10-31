// "Tiempo real" por sondeo cada 5 s (research R7): se pausa con la pestaña oculta o sin conexión.
import type { Pulse } from '#shared/types/api'
import { POLL_INTERVAL_MS } from '#shared/constants/files'

export function usePulse() {
  const pendingCount = useState('pulse-pending', () => 0)
  const newSubmissions = useState<Pulse['newSubmissions']>('pulse-new', () => [])
  const cursor = useState<string | null>('pulse-cursor', () => null)
  const pendingUsers = useState('pulse-pending-users', () => 0)
  /** Solicitudes de acceso abiertas (feature 003). */
  const openAccessRequests = useState('pulse-access', () => 0)
  return { pendingCount, newSubmissions, cursor, pendingUsers, openAccessRequests }
}

// Solo en el cliente: el sondeo vive en el layout y las páginas piden un pulso extra tras una acción.
let pollNow: (() => Promise<void>) | null = null

/** Pulso inmediato (p. ej. tras aprobar a un usuario) para no esperar hasta 5 s. */
export function refreshPulse() {
  return pollNow?.() ?? Promise.resolve()
}

/** Arranca el sondeo; se llama una vez desde el layout del dashboard. */
export function usePulsePolling() {
  const { pendingCount, newSubmissions, cursor, pendingUsers, openAccessRequests } = usePulse()
  const api = useApi()
  const toast = useToast()
  const visibility = useDocumentVisibility()
  const online = useOnline()
  let inFlight = false
  // El cursor se solapa (`PULSE_OVERLAP_MS`): cada envío o solicitud se anuncia una sola vez.
  const announced = new Set<string>()
  function unannounced<T extends { id: string }>(items: T[] = []): T[] {
    if (announced.size > 500) announced.clear()
    return items.filter((item) => {
      if (announced.has(item.id)) return false
      announced.add(item.id)
      return true
    })
  }

  async function poll() {
    if (inFlight || visibility.value !== 'visible' || !online.value) return
    inFlight = true
    try {
      const pulse = await api<Pulse>('/api/realtime/pulse', { query: cursor.value ? { since: cursor.value } : {} })
      pendingCount.value = pulse.pendingCount
      const freshSubmissions = unannounced(pulse.newSubmissions)
      const freshRequests = unannounced(pulse.newAccessRequests)
      newSubmissions.value = freshSubmissions
      pendingUsers.value = pulse.pendingUsers ?? 0
      openAccessRequests.value = pulse.openAccessRequests ?? 0
      cursor.value = pulse.cursor
      // Aviso en vivo de cada envío nuevo (FR-018) y de cada solicitud de acceso (feature 003, FR-007), con enlace a Solicitudes.
      for (const submission of freshSubmissions) {
        toast.info(messages.submissions.received(submission.senderName, submission.fileCount), { action: { label: 'Ver', to: '/solicitudes' } })
      }
      for (const request of freshRequests) {
        toast.info(messages.access.requested(request.senderName), { action: { label: 'Ver', to: '/solicitudes' } })
      }
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
    pollNow = poll
    poll()
    resume()
  })
  onScopeDispose(() => {
    if (pollNow === poll) pollNow = null
  })

  // Pulso inmediato al volver a la pestaña o recuperar la conexión.
  watch([visibility, online], ([visible, isOnline]) => {
    if (visible === 'visible' && isOnline) poll()
  })

  return { poll, pause, resume }
}
