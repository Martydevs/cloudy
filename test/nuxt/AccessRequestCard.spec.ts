// Feature 003 (US1) — tarjeta de una solicitud de acceso y la lista de la página Solicitudes.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { AccessRequest, Me } from '#shared/types/api'
import AccessRequestCard from '~/components/guests/AccessRequestCard.vue'
import AccessRequestList from '~/components/guests/AccessRequestList.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!
const request = (changes: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1',
  senderName: 'Rut',
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 6 * 60_000).toISOString(),
  ...changes,
})
const me: Me = {
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
}
const lastToast = () => useToast().toasts.value.at(-1)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useMe().me.value = me
  mockApi('GET', '/api/me', me)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-29T10:00:00.000Z', pendingCount: 0, newSubmissions: [], pendingUsers: 0, openAccessRequests: 0, newAccessRequests: [] })
})

describe('AccessRequestCard', () => {
  it('la cuenta regresiva avanza sola con el tiempo, sin esperar a que cambie la solicitud', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
      expect(wrapper.text()).toContain('caduca en 6 min')
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      await nextTick()
      expect(wrapper.text()).toContain('caduca en 3 min')
      wrapper.unmount()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('muestra el nombre, hace cuánto y cuánto le queda', async () => {
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    expect(wrapper.get('h3').text()).toBe('Rut')
    expect(wrapper.text()).toContain('hace 2 minutos')
    expect(wrapper.text()).toContain('caduca en 6 min')
    // Botones de tamaño normal (≥ 44 px): nunca btn-sm/btn-xs como base.
    for (const b of wrapper.findAll('button')) expect(b.classes().some(c => /^btn-(xs|sm)$/.test(c))).toBe(false)
  })

  it('"Dar acceso" con un toque: POST, aviso, decided y pulso inmediato', async () => {
    mockApi('POST', '/api/access-requests/r1/approve', null)
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    const pulses = calls.filter(c => c.url === '/api/realtime/pulse').length
    await button(wrapper, 'Dar acceso').trigger('click')
    // Mientras corre la petición, los dos botones se deshabilitan.
    expect(wrapper.findAll('button').every(b => b.attributes('disabled') !== undefined)).toBe(true)
    await flush()
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/access-requests/r1/approve')).toBe(true)
    expect(lastToast()).toMatchObject({ type: 'success', message: 'Diste acceso a Rut' })
    expect(wrapper.emitted('decided')).toHaveLength(1)
    expect(wrapper.findAll('button').every(b => b.attributes('disabled') === undefined)).toBe(true)
    // `refreshPulse` sin un sondeo montado no hace nada: basta con que no falle.
    expect(calls.filter(c => c.url === '/api/realtime/pulse').length).toBeGreaterThanOrEqual(pulses)
  })

  it('"Rechazar" pide confirmación y solo al confirmar hace el POST', async () => {
    mockApi('POST', '/api/access-requests/r1/reject', null)
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    const confirm = useConfirm()

    await button(wrapper, 'Rechazar').trigger('click')
    await nextTick()
    expect(confirm.options.value).toMatchObject({ title: '¿Rechazar la solicitud de Rut?', danger: true })
    confirm.cancel()
    await flush()
    expect(calls.some(c => c.url === '/api/access-requests/r1/reject')).toBe(false)
    expect(wrapper.emitted('decided')).toBeUndefined()

    await button(wrapper, 'Rechazar').trigger('click')
    await nextTick()
    confirm.accept()
    await flush()
    expect(calls.some(c => c.url === '/api/access-requests/r1/reject')).toBe(true)
    expect(lastToast()).toMatchObject({ type: 'success', message: 'Rechazaste la solicitud de Rut' })
    expect(wrapper.emitted('decided')).toHaveLength(1)
  })

  it('409: aviso informativo con el texto del servidor tal cual, y emite decided', async () => {
    mockApi('POST', '/api/access-requests/r1/approve', failFromServer(409, 'Conflict', 'Luis ya dio acceso a esta persona', { state: 'approved', decidedBy: { name: 'Luis' } }))
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    await button(wrapper, 'Dar acceso').trigger('click')
    await flush()
    expect(lastToast()).toMatchObject({ type: 'info', message: 'Luis ya dio acceso a esta persona' })
    expect(wrapper.emitted('decided')).toHaveLength(1)
  })

  it.each([
    [410, 'Gone', 'La solicitud caducó antes de atenderla'],
    [404, 'No encontrado', 'La solicitud ya no existe'],
  ])('%i: aviso de error con el texto del servidor y emite decided', async (status, statusMessage, message) => {
    mockApi('POST', '/api/access-requests/r1/approve', failFromServer(status, statusMessage, message))
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    await button(wrapper, 'Dar acceso').trigger('click')
    await flush()
    expect(lastToast()).toMatchObject({ type: 'error', message })
    expect(wrapper.emitted('decided')).toHaveLength(1)
  })

  it('sin mensaje del servidor usa el respaldo', async () => {
    mockApi('POST', '/api/access-requests/r1/approve', failWith(500))
    const wrapper = await mountSuspended(AccessRequestCard, { props: { request: request() } })
    await button(wrapper, 'Dar acceso').trigger('click')
    await flush()
    expect(lastToast()).toMatchObject({ type: 'error', message: 'No pudimos guardar tu decisión. Inténtalo de nuevo' })
  })
})

describe('AccessRequestList', () => {
  it('lista las solicitudes y se recarga cuando una tarjeta decide', async () => {
    let list = [request(), request({ id: 'r2', senderName: 'Noé' })]
    mockApi('GET', '/api/access-requests', () => list)
    mockApi('POST', '/api/access-requests/r1/approve', null)
    const wrapper = await mountSuspended(AccessRequestList)
    await flush()
    expect(wrapper.findAll('li').map(li => li.get('h3').text())).toEqual(['Rut', 'Noé'])

    list = [request({ id: 'r2', senderName: 'Noé' })]
    await button(wrapper, 'Dar acceso').trigger('click')
    await flush(10)
    expect(wrapper.findAll('li').map(li => li.get('h3').text())).toEqual(['Noé'])
  })

  it('una recarga fallida conserva la lista que ya se veía', async () => {
    let failing = false
    mockApi('GET', '/api/access-requests', event => (failing ? failWith(500)(event) : [request()]))
    const wrapper = await mountSuspended(AccessRequestList)
    await flush()
    failing = true
    usePulse().openAccessRequests.value += 1
    await flush(10)
    expect(wrapper.text()).toContain('Rut')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await vi.waitFor(() => expect(calls.filter(c => c.url === '/api/access-requests').length).toBeGreaterThanOrEqual(2))
  })
})
