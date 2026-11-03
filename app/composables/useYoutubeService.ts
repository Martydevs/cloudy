// Estado del servicio de descargas (feature 005, research D7): al abrir la página se hace un ping que lo despierta;
// mientras no responda se reintenta cada 5 s y se muestra el aviso. Se detiene al quedar `up` o al salir.
import { FetchError } from 'ofetch'
import type { YoutubeServiceHealth } from '#shared/types/api'
import { YOUTUBE_HEALTH_RETRY_MS } from '#shared/constants/youtube'

export type YoutubeServiceState = YoutubeServiceHealth['state'] | 'notConfigured' | 'unknown'

export function useYoutubeService() {
  const api = useApi()
  const state = ref<YoutubeServiceState>('unknown')
  let inFlight = false

  async function check() {
    if (inFlight) return
    inFlight = true
    try {
      const health = await api<YoutubeServiceHealth>('/api/youtube/health')
      state.value = health.state
    }
    catch (error) {
      const notConfigured = error instanceof FetchError && error.response?.status === 503
        && (error.data as { data?: { state?: string } } | undefined)?.data?.state === 'notConfigured'
      state.value = notConfigured ? 'notConfigured' : 'waking'
    }
    finally {
      inFlight = false
      if (state.value === 'up' || state.value === 'notConfigured') pause()
      else resume()
    }
  }

  const { pause, resume } = useIntervalFn(check, YOUTUBE_HEALTH_RETRY_MS, { immediate: false })

  /** Una acción falló con 503: se muestra el aviso y se vuelve a sondear. */
  function markWaking() {
    if (state.value === 'notConfigured') return
    state.value = 'waking'
    resume()
  }

  onMounted(check)
  onScopeDispose(pause)

  return { state: readonly(state), retry: check, markWaking }
}
