// Trabajo en segundo plano con `waitUntil` de `@vercel/functions` (feature 002, research A6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const vercel = vi.hoisted(() => ({
  waitUntil: vi.fn((_promise: Promise<unknown>) => {}),
  getDeadline: vi.fn((): Date | undefined => undefined),
}))
vi.mock('@vercel/functions', () => vercel)

const { remainingMs, runInBackground } = await import('../../server/utils/background')

let logged: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vercel.waitUntil.mockReset()
  vercel.getDeadline.mockReset()
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runInBackground', () => {
  it('entrega a waitUntil una promesa que ejecuta la tarea', async () => {
    const task = vi.fn(async () => {})
    runInBackground(task)
    expect(vercel.waitUntil).toHaveBeenCalledTimes(1)
    await vercel.waitUntil.mock.calls[0]![0]
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('un fallo se registra solo con id y código, sin el mensaje, y no se propaga', async () => {
    const failure = Object.assign(new Error('Oremos por Ana: texto sensible'), { code: 'ECONNRESET' })
    runInBackground(async () => {
      throw failure
    })
    await expect(vercel.waitUntil.mock.calls[0]![0]).resolves.toBeUndefined()
    const line = String(logged.mock.calls[0]?.[0])
    expect(line).toMatch(/^\[background\] [0-9a-f]{8} failed \(ECONNRESET\)$/)
    expect(logged.mock.calls.flat().join(' ')).not.toContain('Oremos')
  })

  it('sin código usa el nombre del error, y si no hay nada, "unknown"', async () => {
    runInBackground(async () => {
      throw new TypeError('x')
    })
    runInBackground(() => Promise.reject('texto'))
    await Promise.all(vercel.waitUntil.mock.calls.map(c => c[0]))
    expect(logged.mock.calls[0]?.[0]).toContain('(TypeError)')
    expect(logged.mock.calls[1]?.[0]).toContain('(unknown)')
  })

  it('si waitUntil lanza por falta de contexto, la tarea corre igual', async () => {
    vercel.waitUntil.mockImplementation(() => {
      throw new Error('sin contexto de petición')
    })
    let done!: () => void
    const finished = new Promise<void>(resolve => (done = resolve))
    expect(() => runInBackground(async () => done())).not.toThrow()
    await finished
  })
})

describe('remainingMs', () => {
  it('milisegundos hasta el plazo de la invocación', () => {
    vercel.getDeadline.mockReturnValue(new Date(Date.now() + 100_000))
    expect(remainingMs()).toBeGreaterThan(99_000)
    expect(remainingMs()).toBeLessThanOrEqual(100_000)
  })

  it('sin plazo o si getDeadline lanza → undefined', () => {
    vercel.getDeadline.mockReturnValue(undefined)
    expect(remainingMs()).toBeUndefined()
    vercel.getDeadline.mockImplementation(() => {
      throw new Error('x')
    })
    expect(remainingMs()).toBeUndefined()
  })

  it('nunca es negativo', () => {
    vercel.getDeadline.mockReturnValue(new Date(Date.now() - 5000))
    expect(remainingMs()).toBe(0)
  })
})
