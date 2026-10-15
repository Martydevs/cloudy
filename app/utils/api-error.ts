// Mensaje legible de un error de `/api/**`: primero el de validación de un campo, luego el del servidor.
import { FetchError } from 'ofetch'

export function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof FetchError) {
    const data = error.data as { message?: string, data?: { errors?: Record<string, string> } } | undefined
    const fieldError = data?.data?.errors && Object.values(data.data.errors)[0]
    return fieldError ?? data?.message ?? fallback
  }
  return fallback
}
