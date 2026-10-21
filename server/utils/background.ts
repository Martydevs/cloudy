// Trabajo en segundo plano tras responder (research A6). Único módulo que importa `@vercel/functions`:
// `event.waitUntil` de Nitro no está conectado en el preset de Vercel para Node. Sin estado entre peticiones.
import { randomUUID } from 'node:crypto'
import { getDeadline, waitUntil } from '@vercel/functions'

/** Código breve del error para el registro: nunca el mensaje completo (puede llevar texto leído). */
function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, name } = error as { code?: unknown, name?: unknown }
    if (typeof code === 'string' || typeof code === 'number') return String(code)
    if (typeof name === 'string') return name
  }
  return 'unknown'
}

/**
 * Programa `task` para que siga corriendo después de responder. Un fallo se registra solo con un
 * identificador y su código, y nunca se propaga. Fuera de Vercel (dev, tests) no hay contexto de
 * petición: la promesa sigue corriendo en el proceso.
 */
export function runInBackground(task: () => Promise<void>): void {
  const id = randomUUID().slice(0, 8)
  const promise = Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      console.error(`[background] ${id} failed (${errorCode(error)})`)
    })
  try {
    waitUntil(promise)
  }
  catch {
    // Sin contexto de petición: la tarea ya está en marcha.
  }
}

/** Milisegundos hasta el plazo de la invocación, o `undefined` si no hay plazo (fuera de Vercel). */
export function remainingMs(): number | undefined {
  try {
    const deadline = getDeadline()
    if (!deadline) return undefined
    return Math.max(0, deadline.getTime() - Date.now())
  }
  catch {
    return undefined
  }
}
