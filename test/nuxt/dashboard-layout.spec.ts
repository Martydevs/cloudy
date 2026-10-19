// Interacciones del layout del dashboard (US5/US9): contraer la barra lateral se recuerda; en teléfono el
// panel se cierra al tocar el fondo, al navegar y al pasar a escritorio, y bloquea el scroll mientras está abierto.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Me } from '#shared/types/api'
import DashboardLayout from '~/layouts/dashboard.vue'
import { flush, mockApi, resetCalls } from './helpers/api'

const me: Me = {
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
}

/** `useBreakpoints` lee el ancho con `matchMedia`; happy-dom lo reevalúa al cambiar el viewport. */
function resize(width: number) {
  const { happyDOM } = window as unknown as { happyDOM: { setViewport: (viewport: { width: number, height: number }) => void } }
  happyDOM.setViewport({ width, height: 800 })
}

const mount = () => mountSuspended(DashboardLayout, { slots: { default: () => 'página' } })
const drawer = (wrapper: Awaited<ReturnType<typeof mount>>) => wrapper.get('input.drawer-toggle').element as HTMLInputElement

beforeEach(() => {
  resetCalls()
  localStorage.clear()
  useMe().me.value = me
  mockApi('GET', '/api/me', me)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [], pendingUsers: 0 })
})

describe('layout dashboard', () => {
  it('en escritorio, contraer la barra lateral se recuerda para la próxima visita', async () => {
    resize(1280)
    const wrapper = await mount()
    await flush()
    await wrapper.get('button[aria-label="Contraer barra lateral"]').trigger('click')
    await nextTick()
    expect(wrapper.find('button[aria-label="Expandir barra lateral"]').exists()).toBe(true)
    expect(JSON.parse(localStorage.getItem('cloudy-sidebar-collapsed') ?? 'false')).toBe(true)

    await wrapper.get('button[aria-label="Expandir barra lateral"]').trigger('click')
    await nextTick()
    expect(wrapper.find('button[aria-label="Contraer barra lateral"]').exists()).toBe(true)
    expect(JSON.parse(localStorage.getItem('cloudy-sidebar-collapsed') ?? 'true')).toBe(false)
    wrapper.unmount()
  })

  it('en teléfono el panel bloquea el scroll y se cierra al tocar el fondo, al navegar y al pasar a escritorio', async () => {
    resize(360)
    const wrapper = await mount()
    await flush()
    const open = async () => {
      await wrapper.get('button[aria-label="Abrir menú"]').trigger('click')
      await nextTick()
      expect(drawer(wrapper).checked).toBe(true)
    }

    await open()
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.get('button[aria-label="Cerrar menú"]').trigger('click')
    await nextTick()
    expect(drawer(wrapper).checked).toBe(false)
    expect(document.body.style.overflow).not.toBe('hidden')

    await open()
    await useRouter().push('/perfil')
    await flush()
    expect(drawer(wrapper).checked).toBe(false)

    await open()
    resize(1280)
    await flush()
    expect(drawer(wrapper).checked).toBe(false)
    expect(document.body.style.overflow).not.toBe('hidden')
    wrapper.unmount()
  })

  it('en teléfono, abrir el panel enfoca su primer enlace y deja la página inert; al cerrar, el foco vuelve a «Abrir menú» (T162, defecto 5)', async () => {
    resize(360)
    const wrapper = await mountSuspended(DashboardLayout, { attachTo: document.body, slots: { default: () => 'página' } })
    await flush()
    const opener = wrapper.get('button[aria-label="Abrir menú"]')
    const content = () => wrapper.get('.drawer-content')
    ;(opener.element as HTMLElement).focus()
    expect(document.activeElement).toBe(opener.element)

    await opener.trigger('click')
    await flush()
    expect(drawer(wrapper).checked).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.drawer-side nav a').element)
    expect(content().attributes('inert')).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flush()
    expect(drawer(wrapper).checked).toBe(false)
    expect(document.activeElement).toBe(opener.element)
    expect(content().attributes('inert')).toBeUndefined()
    wrapper.unmount()
  })
})
