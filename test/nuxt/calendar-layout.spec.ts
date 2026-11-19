// Layout `calendar` (/calendario): el mismo armazón del dashboard (`AppShell`), con el contenido a todo el ancho de la
// columna y la altura del calendario publicada como `--calendar-h`. El layout `dashboard` conserva su tope de ancho.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Me } from '#shared/types/api'
import CalendarLayout from '~/layouts/calendar.vue'
import DashboardLayout from '~/layouts/dashboard.vue'
import { flush, mockApi, resetCalls } from './helpers/api'

const me: Me = {
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
}

beforeEach(() => {
  resetCalls()
  localStorage.clear()
  useMe().me.value = me
  mockApi('GET', '/api/me', me)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [], pendingUsers: 0 })
  useState('songs-presentations').value = []
})

describe('layout calendar', () => {
  it('el contenido usa todo el ancho de la columna y conserva el menú, la barra y el salto al contenido', async () => {
    const wrapper = await mountSuspended(CalendarLayout, { slots: { default: () => 'página' } })
    await flush()
    const main = wrapper.get('main')
    expect(main.text()).toBe('página')
    expect(main.attributes('id')).toBe('contenido')
    expect(main.classes()).toContain('w-full')
    expect(main.classes()).not.toContain('max-w-7xl')
    expect(main.classes()).not.toContain('mx-auto')
    expect(wrapper.get('a[href="#contenido"]').text()).toBe('Saltar al contenido')
    expect(wrapper.find('button[aria-label="Abrir menú"]').exists()).toBe(true)
    expect(wrapper.find('.drawer-side nav').exists()).toBe(true)
    wrapper.unmount()
  })

  it('publica la altura del calendario: el 80 % del alto bajo la barra, con un mínimo de 28 rem', async () => {
    const wrapper = await mountSuspended(CalendarLayout, { slots: { default: () => 'página' } })
    await flush()
    const root = wrapper.get('.drawer').element as HTMLElement
    expect(root.style.getPropertyValue('--calendar-h')).toBe('max(calc((100dvh - 4rem) * 0.8), 28rem)')
    // La variable del menú lateral (del armazón) sigue ahí.
    expect(root.style.getPropertyValue('--app-sidebar-w')).not.toBe('')
    wrapper.unmount()
  })

  it('las bandejas abiertas siguen dejando su alto libre al final del contenido', async () => {
    useState('songs-presentations').value = [{ songId: 's1', title: 'Canción', status: 'done', slides: 3 }]
    const wrapper = await mountSuspended(CalendarLayout, { slots: { default: () => 'página' } })
    await flush()
    expect(wrapper.get('main').classes().join(' ')).toContain('--song-tray-h')
    useState('songs-presentations').value = []
    wrapper.unmount()
  })
})

describe('layout dashboard', () => {
  it('conserva el contenido centrado con su ancho máximo y no publica la altura del calendario', async () => {
    const wrapper = await mountSuspended(DashboardLayout, { slots: { default: () => 'página' } })
    await flush()
    const main = wrapper.get('main')
    expect(main.classes()).toEqual(expect.arrayContaining(['mx-auto', 'w-full', 'max-w-7xl']))
    expect((wrapper.get('.drawer').element as HTMLElement).style.getPropertyValue('--calendar-h')).toBe('')
    wrapper.unmount()
  })
})
