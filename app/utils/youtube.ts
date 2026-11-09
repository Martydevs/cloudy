// Formatos y textos de la página YouTube (feature 005). Importa `./messages` en relativo para que el proyecto `unit`
// de Vitest lo resuelva.
import { YOUTUBE_ENGINES_FAILED } from '#shared/constants/youtube'
import { messages } from './messages'

/**
 * Texto de un error `engines_failed` de `/api/youtube/**` (ningún motor del servicio pudo), según su causa; `null` si
 * el error es otro. Sirve para un `FetchError` y para el `NuxtError` de `useFetch`: los dos traen el cuerpo en `data`.
 * Hace falta porque `serverMessage` solo toma el texto del servidor en un 4xx y este error es un 502.
 */
export function engineFailureMessage(error: unknown): string | null {
  const data = (error as { data?: { data?: { code?: unknown, cause?: unknown } } } | null | undefined)?.data?.data
  if (data?.code !== YOUTUBE_ENGINES_FAILED) return null
  const service = messages.youtube.service
  if (data.cause === 'botCheck') return service.botCheck
  return data.cause === 'waking' ? service.waking : service.engineFailed
}

/** Duración «m:ss» o «h:mm:ss»; vacía si no se conoce (en vivo). */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Duración legible para lectores de pantalla («3 min 5 s»). */
export function spokenDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h ? `${h} h` : '', m ? `${m} min` : '', s || (!h && !m) ? `${s} s` : ''].filter(Boolean).join(' ')
}
