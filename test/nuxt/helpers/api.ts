// Endpoints simulados con respuesta intercambiable por prueba sobre `registerEndpoint`
// (que acumula registros por URL y usa el primero que coincide).
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { createError, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { DOMWrapper } from '@vue/test-utils'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Impl = (event: H3Event) => unknown

const current = new Map<string, Impl>()
const registered = new Set<string>()

export const calls: { method: string, url: string, body?: unknown }[] = []

export function mockApi(method: Method, url: string, impl: Impl): void
export function mockApi(method: Method, url: string, value: unknown): void
export function mockApi(method: Method, url: string, impl: unknown) {
  const key = `${method} ${url}`
  current.set(key, typeof impl === 'function' ? impl as Impl : () => impl)
  if (registered.has(key)) return
  registered.add(key)
  registerEndpoint(url, {
    method,
    handler: async (event: H3Event) => {
      const body = method === 'GET' ? undefined : await readJson(event)
      // El entorno de pruebas monta los endpoints bajo `/_`; se registra la ruta pública.
      calls.push({ method, url: event.path.replace(/^\/_/, '').split('?')[0]!, body })
      return current.get(key)!(event)
    },
  })
}

async function readJson(event: H3Event): Promise<unknown> {
  const { readBody } = await import('h3')
  return readBody(event).catch(() => undefined)
}

export function failWith(statusCode: number, data?: Record<string, unknown>, message?: string): Impl {
  return () => {
    throw createError({ statusCode, data, message })
  }
}

/**
 * Error como lo envía un endpoint real: `statusMessage` genérico y `message` en español (lo que muestra
 * `serverMessage`). Se devuelve el cuerpo con el estado: un `createError` lanzado aquí pierde su `message`.
 */
export function failFromServer(statusCode: number, statusMessage: string, message: string, data?: Record<string, unknown>): Impl {
  return (event) => {
    setResponseStatus(event, statusCode, statusMessage)
    return { statusCode, statusMessage, message, ...(data ? { data } : {}) }
  }
}

export function resetCalls() {
  calls.length = 0
}

/** Espera a que se resuelvan las peticiones y los re-renders pendientes. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/** Lo mínimo de un wrapper de @vue/test-utils que usan los helpers de las pruebas. */
export interface Queryable {
  findAll: (selector: string) => DOMWrapper<Element>[]
}

export interface QueryableWithGet extends Queryable {
  get: (selector: string) => Omit<DOMWrapper<Element>, 'exists'>
}

export function buttonsWithText(wrapper: Queryable, text: string): DOMWrapper<Element>[] {
  return wrapper.findAll('button').filter(b => b.text().trim() === text)
}
