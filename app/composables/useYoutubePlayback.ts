// Copia de reproducción 720p de un video (feature 005, research D5). El servicio solo entrega archivos: al pulsar
// Reproducir se crea un trabajo `mp4_720` y se sondea; al terminar, el `<video>` reproduce el enlace firmado. La copia
// lista se comparte con las descargas (Video 720p la reutiliza) a través de `useYoutubeDownloads`.
import { FetchError } from 'ofetch'
import type { YoutubeJob } from '#shared/types/api'
import { YOUTUBE_JOB_POLL_MS } from '#shared/constants/youtube'

export type PlaybackState = 'idle' | 'preparing' | 'ready' | 'error' | 'expired'

const isExpired = (error: unknown) =>
  error instanceof FetchError && error.response?.status === 404 && error.data?.data?.code === 'expired'

export function useYoutubePlayback(videoId: MaybeRefOrGetter<string>, { initialJobId }: { initialJobId?: string | null } = {}) {
  const api = useApi()
  const downloads = useYoutubeDownloads()
  const online = useOnline()
  const m = messages.youtube

  const state = ref<PlaybackState>('idle')
  const progress = ref(0)
  const src = ref<string | null>(null)
  const jobId = ref<string | null>(null)
  const message = ref<string | null>(null)
  /** La copia quedó lista tras pulsar Reproducir: el reproductor arranca solo. */
  const autoplay = ref(false)
  let creating = false

  const id = () => toValue(videoId)

  function apply(job: YoutubeJob, auto: boolean) {
    jobId.value = job.jobId
    progress.value = job.progress
    if (job.status === 'done' && job.downloadUrl) {
      src.value = job.downloadUrl
      autoplay.value = auto
      state.value = 'ready'
      downloads.setPreviewJob(id(), job.jobId)
      pause()
    }
    else if (job.status === 'failed') {
      state.value = 'error'
      message.value = m.player.failed
      downloads.forgetPreviewJob(id(), job.jobId)
      pause()
    }
    else if (job.status === 'expired') {
      toExpired()
    }
    else {
      state.value = 'preparing'
      resume()
    }
  }

  function toExpired() {
    if (jobId.value) downloads.forgetPreviewJob(id(), jobId.value)
    state.value = 'expired'
    src.value = null
    pause()
  }

  async function load(auto: boolean) {
    if (!jobId.value) return
    try {
      apply(await api<YoutubeJob>(`/api/youtube/jobs/${jobId.value}`), auto)
    }
    catch (error) {
      if (isExpired(error)) toExpired()
      // Otro fallo durante la preparación: el siguiente sondeo lo reintenta.
    }
  }

  async function poll() {
    if (!online.value || state.value !== 'preparing') return
    await load(true)
  }

  const { pause, resume } = useIntervalFn(poll, YOUTUBE_JOB_POLL_MS, { immediate: false })

  /** Crea la copia 720p (solo al pulsar Reproducir). Un doble clic no crea dos trabajos (FR-031). */
  async function prepare() {
    if (creating || state.value === 'preparing') return
    creating = true
    state.value = 'preparing'
    progress.value = 0
    message.value = null
    src.value = null
    try {
      const job = await api<YoutubeJob>('/api/youtube/jobs', { method: 'POST', body: { videoIds: [id()], format: 'mp4_720' } })
      jobId.value = job.jobId
      downloads.setPreviewJob(id(), job.jobId)
      resume()
    }
    catch (error) {
      state.value = 'error'
      // `serverMessage` solo usa su respaldo por estado en los 4xx: el 503 del servicio dormido se nombra aquí.
      const status = error instanceof FetchError ? error.response?.status : 0
      message.value = status === 503 ? m.service.waking : serverMessage(error, m.player.failed, { 429: m.service.busy })
    }
    finally {
      creating = false
    }
  }

  /** El `<video>` falló o el enlace firmado caducó: se pide uno nuevo; si el servicio olvidó la copia, `expired`. */
  async function renew() {
    if (!jobId.value) return
    const keepAutoplay = autoplay.value
    try {
      const job = await api<YoutubeJob>(`/api/youtube/jobs/${jobId.value}`)
      if (job.status === 'done' && job.downloadUrl === src.value) {
        // El archivo sigue igual y aun así no se reproduce: no hay nada más que renovar.
        state.value = 'error'
        message.value = m.player.failed
        return
      }
      apply(job, keepAutoplay)
    }
    catch (error) {
      if (isExpired(error)) toExpired()
      else {
        state.value = 'error'
        message.value = serverMessage(error, m.player.failed)
      }
    }
  }

  async function cancel() {
    pause()
    const current = jobId.value
    state.value = 'idle'
    progress.value = 0
    jobId.value = null
    if (current) {
      downloads.forgetPreviewJob(id(), current)
      await api(`/api/youtube/jobs/${current}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  onMounted(async () => {
    // Ventana externa: el trabajo llega en la URL. Ficha: una copia ya preparada en esta sesión se reutiliza.
    const start = initialJobId ?? downloads.getPreviewJob(id())
    if (!start) return
    jobId.value = start
    try {
      apply(await api<YoutubeJob>(`/api/youtube/jobs/${start}`), false)
    }
    catch (error) {
      if (initialJobId) {
        if (isExpired(error)) toExpired()
        else {
          state.value = 'error'
          message.value = serverMessage(error, m.player.failed)
        }
      }
      else {
        // Una copia vieja de la ficha que ya no existe no es un error: se vuelve al póster.
        downloads.forgetPreviewJob(id(), start)
        jobId.value = null
        state.value = 'idle'
      }
    }
  })
  onScopeDispose(pause)

  return { state, progress, src, jobId, message, autoplay, prepare, renew, cancel }
}
