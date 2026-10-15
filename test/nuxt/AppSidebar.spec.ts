import { beforeAll, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Me } from '#shared/types/api'
import AppSidebar from '~/components/app/AppSidebar.vue'

function setRole(role: 'admin' | 'editor') {
  useState<Me | null>('me').value = {
    user: { id: 'u1', email: 'a@x.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'a@x.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-14T00:00:00Z' },
  }
}

const labels = (wrapper: { findAll: (selector: string) => { attributes: (name: string) => string | undefined, text: () => string }[] }) =>
  wrapper.findAll('nav a').map(a => a.attributes('aria-label') ?? a.text().trim())

describe('AppSidebar', () => {
  beforeAll(() => {
    // Rutas de historias posteriores (US3, US7): la barra solo muestra secciones con página.
    const router = useRouter()
    for (const path of ['/pendientes', '/papelera']) {
      if (router.resolve(path).matched.length === 0) router.addRoute({ name: `stub${path}`, path, component: { render: () => null } })
    }
  })

  it('oculta las secciones que todavía no tienen página', async () => {
    setRole('admin')
    const router = useRouter()
    router.removeRoute('stub/papelera')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    expect(labels(wrapper)).not.toContain('Papelera')
    router.addRoute({ name: 'stub/papelera', path: '/papelera', component: { render: () => null } })
  })

  it('un editor no ve Usuarios ni Actividad', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    const items = labels(wrapper)
    expect(items).toEqual(expect.arrayContaining(['Inicio', 'Archivos', 'Pendientes', 'Papelera', 'Mi perfil']))
    expect(items.join(' ')).not.toMatch(/Usuarios|Actividad/)
  })

  it('un admin ve todas las secciones', async () => {
    setRole('admin')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    expect(labels(wrapper)).toEqual(expect.arrayContaining(['Usuarios', 'Actividad']))
  })

  it('marca el ítem activo con aria-current="page"', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false }, route: '/' })
    const current = wrapper.findAll('nav a').filter(a => a.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]!.text()).toContain('Inicio')
  })

  it('contraída oculta los textos y muestra tooltips', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: true, badges: { '/pendientes': 2 } } })
    const archivos = wrapper.findAll('nav li').find(li => li.attributes('data-tip') === 'Archivos')
    expect(archivos).toBeDefined()
    expect(archivos!.classes()).toContain('tooltip')
    expect(archivos!.find('a').attributes('aria-label')).toBe('Archivos')
    expect(archivos!.find('a span.nav-label').exists()).toBe(false)
    // Contraída, el contador se superpone al ícono.
    expect(wrapper.find('a[href="/pendientes"] .badge').text()).toBe('2')
  })

  it('muestra los contadores por sección y los oculta en 0 (T134a)', async () => {
    setRole('admin')
    const withCount = await mountSuspended(AppSidebar, { props: { collapsed: false, badges: { '/pendientes': 3, '/usuarios': 1 } } })
    expect(withCount.find('a[href="/pendientes"] .badge').text()).toBe('3')
    expect(withCount.find('a[href="/usuarios"] .badge').text()).toBe('1')
    const empty = await mountSuspended(AppSidebar, { props: { collapsed: false, badges: { '/pendientes': 0 } } })
    expect(empty.find('.badge').exists()).toBe(false)
    const none = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    expect(none.find('.badge').exists()).toBe(false)
  })

  it('emite navigate al elegir una sección', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    await wrapper.findAll('nav a')[1]!.trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
  })
})
