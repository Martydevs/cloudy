// Traduce un error del AI SDK a un código interno y decide si activa el respaldo (research A11).
// Función pura: sin red ni estado.
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai'

export type ProviderErrorCode = 'timeout' | 'provider' | 'rate_limited' | 'quota_exceeded' | 'invalid_output'

export interface ClassifiedError {
  code: ProviderErrorCode
  /** Pasar al siguiente candidato (si queda uno). */
  fallback: boolean
  /** No se arregla en segundos (cuota, clave, permisos, modelo): abre el cortacircuito al instante. */
  persistent: boolean
}

/** Saldo o cuota agotados, sin ambigüedad (OpenAI y Gemini). */
const QUOTA_MARKERS = ['insufficient_quota', 'billing_hard_limit_reached', 'FAILED_PRECONDITION']
/** Clave o permisos rechazados en un 400 de Gemini. */
const KEY_MARKERS = ['API_KEY_INVALID', 'PERMISSION_DENIED']

const transient = (code: ProviderErrorCode): ClassifiedError => ({ code, fallback: true, persistent: false })
const persistent = (code: ProviderErrorCode): ClassifiedError => ({ code, fallback: true, persistent: true })

/** Cuerpo del error del proveedor como texto, para buscar sus códigos. */
function bodyText(error: APICallError): string {
  let data = ''
  try {
    data = JSON.stringify(error.data ?? null)
  }
  catch {
    // `data` circular: basta con `responseBody`.
  }
  return `${data} ${error.responseBody ?? ''}`
}

export function classifyProviderError(error: unknown): ClassifiedError {
  if (RetryError.isInstance(error)) return classifyProviderError(error.lastError)

  // El `timeout` del propio intento llega como `DOMException` de tipo `TimeoutError`.
  if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return transient('timeout')

  if (NoObjectGeneratedError.isInstance(error)) {
    // Un bloqueo por política del proveedor puede no repetirse en otro; una respuesta fuera del esquema, sí.
    return error.finishReason === 'content-filter'
      ? transient('provider')
      : { code: 'invalid_output', fallback: false, persistent: false }
  }
  // El modelo respondió sin una salida legible (el bloqueo por política se detecta antes, por `finishReason`).
  if (NoOutputGeneratedError.isInstance(error)) return { code: 'invalid_output', fallback: false, persistent: false }

  if (LoadAPIKeyError.isInstance(error)) return persistent('provider')

  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    if (status === undefined) return transient('provider')
    const body = bodyText(error)
    if (status === 402 || QUOTA_MARKERS.some(marker => body.includes(marker))) return persistent('quota_exceeded')
    if (status === 429) return transient('rate_limited')
    if (status === 401 || status === 403 || status === 404) return persistent('provider')
    if (KEY_MARKERS.some(marker => body.includes(marker))) return persistent('provider')
    return transient('provider')
  }

  // Excepción no reconocida del SDK o de la red: se asume fallo del proveedor.
  return transient('provider')
}
