// Cortacircuito local a una ejecución del pool de invitados (research A6): deja de llamar a OpenRouter
// durante una caída o sin saldo. Es un cierre sin estado de módulo: nada se comparte entre invocaciones.
export interface ProviderBreaker {
  isOpen(): boolean
  /** Devuelve `true` si este fallo acaba de abrir el cortacircuito. */
  recordFailure(persistent: boolean): boolean
  recordSuccess(): void
}

export function createProviderBreaker(threshold = 3): ProviderBreaker {
  let failures = 0
  let open = false

  return {
    isOpen: () => open,
    recordFailure(persistent) {
      if (open) return false
      failures++
      open = persistent || failures >= threshold
      return open
    },
    recordSuccess() {
      failures = 0
    },
  }
}
