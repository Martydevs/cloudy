// Traduce un error del AI SDK a un código interno y decide si abre el cortacircuito al instante.
// Función pura: sin red ni estado.
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai'

export type ProviderErrorCode = 'timeout' | 'provider' | 'rate_limited' | 'quota_exceeded' | 'invalid_output'

export interface ClassifiedError {
  code: ProviderErrorCode
  /** No se arregla en segundos (saldo, clave, permisos, modelo): abre el cortacircuito al instante. */
  persistent: boolean
}

const transient = (code: ProviderErrorCode): ClassifiedError => ({ code, persistent: false })
const persistent = (code: ProviderErrorCode): ClassifiedError => ({ code, persistent: true })

export function classifyProviderError(error: unknown): ClassifiedError {
  if (RetryError.isInstance(error)) return classifyProviderError(error.lastError)

  // El `timeout` del propio intento llega como `DOMException` de tipo `TimeoutError`.
  if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return transient('timeout')

  if (NoObjectGeneratedError.isInstance(error)) {
    // Un bloqueo por política puede no repetirse; una respuesta fuera del esquema no es culpa del proveedor.
    return error.finishReason === 'content-filter' ? transient('provider') : transient('invalid_output')
  }
  // El modelo respondió sin una salida legible (el bloqueo por política se detecta antes, por `finishReason`).
  if (NoOutputGeneratedError.isInstance(error)) return transient('invalid_output')

  if (LoadAPIKeyError.isInstance(error)) return persistent('provider')

  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    // OpenRouter responde 402 cuando la cuenta se queda sin créditos.
    if (status === 402) return persistent('quota_exceeded')
    if (status === 429) return transient('rate_limited')
    if (status === 401 || status === 403 || status === 404) return persistent('provider')
    return transient('provider')
  }

  // Excepción no reconocida del SDK o de la red: se asume fallo del proveedor.
  return transient('provider')
}
