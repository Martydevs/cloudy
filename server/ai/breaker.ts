// Cortacircuito local a una ejecución del pool de invitados (research A6): deja de probar a un
// proveedor caído. Es un cierre sin estado de módulo: nada se comparte entre invocaciones.
import type { ImageTextCandidate, ImageTextProvider } from './providers/candidates'

export interface ProviderBreaker {
  isOpen(provider: ImageTextProvider): boolean
  /** `true` si no queda ningún candidato cerrado. */
  exhausted(candidates: ImageTextCandidate[]): boolean
  /** Devuelve `true` si este fallo acaba de abrir el proveedor. */
  recordFailure(provider: ImageTextProvider, persistent: boolean): boolean
  recordSuccess(provider: ImageTextProvider): void
}

export function createProviderBreaker(threshold = 3): ProviderBreaker {
  const failures = new Map<ImageTextProvider, number>()
  const open = new Set<ImageTextProvider>()

  return {
    isOpen: provider => open.has(provider),
    exhausted: candidates => candidates.every(c => open.has(c.provider)),
    recordFailure(provider, persistent) {
      if (open.has(provider)) return false
      const count = (failures.get(provider) ?? 0) + 1
      failures.set(provider, count)
      if (persistent || count >= threshold) {
        open.add(provider)
        return true
      }
      return false
    },
    recordSuccess(provider) {
      failures.set(provider, 0)
    },
  }
}
