// Doble de prueba mínimo del cliente Drizzle: cada consulta encadenada resuelve al siguiente resultado de la cola.
import { vi } from 'vitest'

export function fakeDb(results: unknown[] = []) {
  const queue = [...results]
  const calls: { method: string, args: unknown[] }[] = []
  const next = () => (queue.length ? queue.shift() : [])

  const chain = (): Record<string, unknown> => {
    const target: Record<string, unknown> = {}
    const proxy: Record<string, unknown> = new Proxy(target, {
      get(_, prop: string) {
        if (prop === 'then') {
          const value = next()
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            value instanceof Error ? reject(value) : resolve(value)
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args })
          return proxy
        }
      },
    })
    return proxy
  }

  const db = {
    select: (...args: unknown[]) => (calls.push({ method: 'select', args }), chain()),
    insert: (...args: unknown[]) => (calls.push({ method: 'insert', args }), chain()),
    update: (...args: unknown[]) => (calls.push({ method: 'update', args }), chain()),
    delete: (...args: unknown[]) => (calls.push({ method: 'delete', args }), chain()),
    execute: vi.fn(async () => {
      const value = next()
      if (value instanceof Error) throw value
      return value
    }),
    batch: vi.fn(async (queries: unknown[]) => Promise.all(queries)),
  }
  return { db, calls }
}
