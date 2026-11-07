// Mensaje legible, siempre en español, de un error de `/api/**`: primero el de validación de un
// campo; el 429 usa el texto común; un 4xx muestra lo que explicó el servidor; el resto (5xx, red),
// el respaldo. Importa `./messages` en relativo para que el proyecto `unit` de Vitest lo resuelva.
import { FetchError } from 'ofetch'
import { messages } from './messages'

interface ErrorBody {
  message?: string
  statusMessage?: string
  data?: { errors?: Record<string, string> }
}

/**
 * `byStatus`: respaldos propios por código (p. ej. 415 → «formato no admitido»). Entran cuando el
 * servidor no explica nada y, para el 429, en lugar del texto común.
 */
export function serverMessage(error: unknown, fallback: string, byStatus: Partial<Record<number, string>> = {}): string {
  if (!(error instanceof FetchError)) return fallback
  const status = error.response?.status ?? 0
  const body = error.data as ErrorBody | undefined
  const fieldError = body?.data?.errors && Object.values(body.data.errors)[0]
  if (fieldError) return fieldError
  if (status === 429) return byStatus[429] ?? messages.common.rateLimited
  if (status >= 400 && status < 500) {
    // Sin `message` propio, h3 copia la frase del estado («Not Found»): eso no es una explicación.
    const explained = body?.message && body.message !== body.statusMessage ? body.message : undefined
    return explained ?? byStatus[status] ?? fallback
  }
  return fallback
}

/**
 * Con `responseType: 'blob'` el cuerpo JSON de un error también llega como `Blob`: se lee para que `serverMessage` lo vea.
 * `FetchError.data` es un getter de `response._data`, así que se reemplaza ahí; lo que no es JSON queda `undefined`.
 */
export async function readBlobError(error: unknown): Promise<unknown> {
  const response = error instanceof FetchError ? error.response as (Response & { _data?: unknown }) | undefined : undefined
  if (response && typeof Blob !== 'undefined' && response._data instanceof Blob) {
    try {
      response._data = JSON.parse(await response._data.text())
    }
    catch {
      response._data = undefined
    }
  }
  return error
}
