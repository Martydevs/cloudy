// Estado del invitado en `/upload` (feature 003, contracts/ui.md): primera vista con SSR (la cookie llega al
// servidor), sondeo cada 5 s pausado con la pestaña oculta o sin conexión, y caducidad visual sin esperar al
// sondeo. Las vigencias las decide el servidor; el cliente solo adelanta el "caducó" (research B3).
import { FetchError } from 'ofetch'
import { TERMINAL_ACCESS_STATES } from '#shared/constants/access'
import { POLL_INTERVAL_MS } from '#shared/constants/files'
import type { AccessState, GuestAccess } from '#shared/types/api'

const CURRENT = '/api/public/access/current'

/** Minutos que muestra el 429: redondeo hacia arriba, mínimo 1. */
const minutesOf = (seconds: number) => Math.max(1, Math.ceil(seconds / 60))

export function useGuestAccess() {
  // Diferencia entre el reloj del servidor y el del dispositivo, leída de la cabecera `Date` de cada respuesta del
  // cliente. Hasta la primera respuesta es `null` y el estado lo manda solo el servidor: un teléfono con la hora
  // mal puesta no debe adelantar ni atrasar el "caducó" (las vigencias son del servidor, research B3).
  // `useState` y no un `ref` local: `useFetch` comparte los datos por clave y su `refresh` usa el `onResponse` de la
  // primera instancia, así que el valor tiene que ser común a todas.
  const clockSkew = useState<number | null>('guest-clock-skew', () => null)
  function trackClock({ response }: { response: { headers: Headers } }) {
    if (import.meta.server) return
    const serverTime = Date.parse(response.headers.get('date') ?? '')
    clockSkew.value = Number.isNaN(serverTime) ? 0 : serverTime - Date.now()
  }

  const { data, error, status, refresh: refetch } = useFetch<GuestAccess>(CURRENT, { key: 'guest-access', onResponse: trackClock })
  // Se deriva de `data` (no se copia en el setup): en SSR los datos llegan después del setup y los watchers no
  // corren, así que una copia pintaría el esqueleto y desajustaría la hidratación. `local` es lo que respondió el
  // POST o "pedir de nuevo", hasta el siguiente sondeo; `lastGood`, lo que se ve si un sondeo falla (Nuxt vacía `data`).
  const local = ref<GuestAccess | null>(null)
  const lastGood = shallowRef<GuestAccess | null>(data.value ?? null)
  watch(data, (value) => {
    if (!value) return
    lastGood.value = value
    local.value = null
  })
  const access = computed(() => local.value ?? data.value ?? lastGood.value)

  // Durante la hidratación se usa la hora del render del servidor (sin desajustes); ya montada, el reloj real.
  const { now: reference } = useRelativeTime()
  const now = ref(reference())
  const tick = () => {
    now.value = Date.now()
  }
  onMounted(tick)
  useIntervalFn(tick, 1000)

  const uploading = ref(false)
  const requesting = ref(false)
  const requestError = ref('')

  const expiresAtMs = computed(() => (access.value?.expiresAt ? Date.parse(access.value.expiresAt) : null))

  const state = computed<AccessState>(() => {
    const current = access.value?.state ?? 'none'
    // Con un envío en curso solo el servidor cambia el estado: la vigencia cuenta al iniciar, no al terminar.
    if (uploading.value || expiresAtMs.value === null || clockSkew.value === null || now.value + clockSkew.value <= expiresAtMs.value) return current
    if (current === 'waiting') return 'expired'
    if (current === 'approved') return 'accessExpired'
    return current
  })

  // Minuto más cercano (mínimo 1): recién pedida, una solicitud de 8 min dice "8", no "9" por unos milisegundos.
  const minutesLeft = computed(() => (expiresAtMs.value === null ? 0 : Math.max(1, Math.round((expiresAtMs.value - (now.value + (clockSkew.value ?? 0))) / 60_000))))
  const loading = computed(() => !access.value && status.value === 'pending')
  const loadError = computed(() => !access.value && !!error.value)

  async function refresh() {
    await refetch()
  }

  /** Pide acceso; maneja el 429 con `Retry-After` (por navegador o por red) y deja el mensaje en `requestError`. */
  async function request(senderName: string): Promise<boolean> {
    requesting.value = true
    requestError.value = ''
    try {
      local.value = await $fetch<GuestAccess>('/api/public/access', { method: 'POST', body: { senderName }, onResponse: trackClock })
      return true
    }
    catch (err) {
      if (err instanceof FetchError && err.response?.status === 429) {
        const body = err.data as { data?: { scope?: string, retryAfter?: number } } | undefined
        const seconds = Number(err.response.headers.get('retry-after')) || body?.data?.retryAfter || 60
        requestError.value = body?.data?.scope === 'network' ? messages.access.networkBusy(minutesOf(seconds)) : messages.access.tooMany(minutesOf(seconds))
      }
      else {
        requestError.value = serverMessage(err, messages.access.requestFailed)
      }
      return false
    }
    finally {
      requesting.value = false
    }
  }

  /** Vuelve al formulario de pedir acceso conservando el nombre. */
  function restart() {
    requestError.value = ''
    local.value = { state: 'none', senderName: access.value?.senderName ?? null, expiresAt: null }
  }

  /** Mientras hay un envío en curso, la caducidad local no cambia el estado (spec, "el acceso caduca mientras sube"). */
  function holdWhileUploading(active: boolean) {
    uploading.value = active
  }

  // Sondeo: solo en estados no terminales, con la pestaña visible y conexión.
  const visibility = useDocumentVisibility()
  const online = useOnline()
  let inFlight = false
  async function poll() {
    if (inFlight || visibility.value !== 'visible' || !online.value) return
    inFlight = true
    try {
      await refetch()
    }
    finally {
      inFlight = false
    }
  }
  const polling = useIntervalFn(poll, POLL_INTERVAL_MS, { immediate: false })
  const terminal = computed(() => TERMINAL_ACCESS_STATES.includes(state.value))
  onMounted(() => {
    // Tras el SSR no hay respuesta del cliente de la que leer la hora del servidor: se consulta una vez al montar para
    // conocer el desfase antes de que el reloj local pueda marcar la caducidad.
    if (clockSkew.value === null) poll()
    watch(terminal, (stop) => {
      if (stop) polling.pause()
      else polling.resume()
    }, { immediate: true })
    // Al volver a la pestaña o recuperar la conexión se consulta de inmediato.
    watch([visibility, online], ([visible, isOnline]) => {
      if (visible === 'visible' && isOnline && !terminal.value) poll()
    })
  })

  return {
    state,
    senderName: computed(() => access.value?.senderName ?? null),
    expiresAt: computed(() => access.value?.expiresAt ?? null),
    minutesLeft,
    loading,
    loadError,
    requesting,
    requestError,
    request,
    refresh,
    restart,
    holdWhileUploading,
  }
}
