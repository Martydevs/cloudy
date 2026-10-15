import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { Me } from '#shared/types/api'
import AppSidebar from '~/components/app/AppSidebar.vue'

const { client } = vi.hoisted(() => ({ client: { logout: vi.fn() } }))
mockNuxtImport('useAuthClient', () => () => client)

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
    expect(items).toEqual(expect.arrayContaining(['Inicio', 'Archivos', 'Pendientes', 'Papelera']))
    expect(items.join(' ')).not.toMatch(/Usuarios|Actividad|Mi perfil/)
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

  it('contraída oculta los textos y muestra avisos teletransportados', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: true, badges: { '/pendientes': 2 } } })
    const archivos = wrapper.findAll('nav li').find(li => li.find('a').attributes('aria-label') === 'Archivos')
    expect(archivos).toBeDefined()
    expect(archivos!.attributes('data-tip')).toBeUndefined()
    expect(archivos!.find('a span.nav-label').exists()).toBe(false)
    // Contraída, el contador se superpone al ícono.
    expect(wrapper.find('a[href="/pendientes"] .badge').text()).toBe('2')
    // El nav no abre un scroll horizontal: el globo ya no ensancha la lista.
    expect(wrapper.get('nav').classes()).toContain('overflow-x-clip')

    await archivos!.trigger('mouseenter')
    await nextTick()
    const tip = document.body.querySelector('[aria-hidden="true"].fixed')
    expect(tip?.textContent).toBe('Archivos')

    await archivos!.trigger('mouseleave')
    await nextTick()
    expect(document.body.querySelector('[aria-hidden="true"].fixed')).toBeNull()
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

  it('contraída, el logo es el botón de expandir y no queda el botón inferior', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: true } })
    const expand = wrapper.get('button[aria-label="Expandir barra lateral"]')
    expect(expand.text()).toContain('Cloudy')
    expect(expand.classes()).toContain('cursor-ew-resize')
    expect(wrapper.find('button[aria-label="Contraer barra lateral"]').exists()).toBe(false)
    await expand.trigger('click')
    expect(wrapper.emitted('toggleCollapse')).toHaveLength(1)
  })

  it('expandida, el encabezado lleva el logo y un botón de contraer solo con ícono', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    const collapse = wrapper.get('button[aria-label="Contraer barra lateral"]')
    // Sin texto visible: solo el ícono, junto al logo completo en la misma fila del encabezado.
    expect(collapse.text()).not.toContain('Contraer')
    expect(collapse.html()).toContain('panel-left-close')
    expect(wrapper.findAll('button[aria-label$="barra lateral"]')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="Expandir barra lateral"]').exists()).toBe(false)
    await collapse.trigger('click')
    expect(wrapper.emitted('toggleCollapse')).toHaveLength(1)
  })

  it('emite navigate al elegir una sección', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    await wrapper.findAll('nav a')[1]!.trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
  })
})

describe('AppSidebar · menú de cuenta', () => {
  const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')
  const menuItem = (text: string) =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(i => i.textContent?.trim() === text)!

  beforeEach(() => {
    client.logout.mockReset()
  })

  it('la fila de cuenta va al pie, tras un divisor, y abre el menú con nombre, correo, tema, Mi perfil y Cerrar sesión', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const trigger = wrapper.get('button[aria-label="Menú de usuario"]')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.text()).toContain('Ana')
    expect(trigger.text()).toContain('a@x.org')
    expect(trigger.classes()).toContain('min-h-11')
    // Fuera del nav y separada por un divisor.
    expect(wrapper.find('nav button[aria-label="Menú de usuario"]').exists()).toBe(false)
    expect(wrapper.get('nav').element.nextElementSibling?.classList.contains('divider')).toBe(true)
    expect(menu()).toBeNull()

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const opened = menu()!
    expect(opened.textContent).toContain('Ana')
    expect(opened.textContent).toContain('a@x.org')
    expect(opened.querySelector('button[aria-label^="Cambiar a tema"]')).not.toBeNull()
    expect(menuItem('Mi perfil').getAttribute('href')).toBe('/perfil')
    expect(menuItem('Cerrar sesión')).toBeDefined()
    // Se pinta en body con posición fija: el aside recorta su contenido.
    expect(opened.parentElement).toBe(document.body)
    expect(opened.classList.contains('fixed')).toBe(true)

    menuItem('Mi perfil').click()
    await nextTick()
    expect(wrapper.emitted('navigate')).toHaveLength(1)
    wrapper.unmount()
  })

  it('Esc cierra el menú y devuelve el foco; el clic fuera también cierra', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const trigger = wrapper.get('button[aria-label="Menú de usuario"]')
    await trigger.trigger('click')
    expect(menu()).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    expect(menu()).not.toBeNull()
    // `onClickOutside` ignora un segundo clic en el mismo tick que el del disparador.
    await new Promise(resolve => setTimeout(resolve, 0))
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('Cerrar sesión llama a logout', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    await wrapper.get('button[aria-label="Menú de usuario"]').trigger('click')
    menuItem('Cerrar sesión').click()
    expect(client.logout).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('contraída muestra solo el avatar y el menú se abre a la derecha del riel', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: true } })
    const trigger = wrapper.get('button[aria-label="Menú de usuario"]')
    expect(trigger.text()).toBe('A')
    expect(trigger.classes()).toContain('btn-circle')
    expect(trigger.find('span').classes()).toContain('size-full')

    await trigger.trigger('click')
    const opened = menu()!
    expect(opened.classList.contains('w-60')).toBe(true)
    expect(opened.textContent).toContain('Cerrar sesión')
    // Al expandirse, el menú se cierra porque su posición ya no vale.
    await wrapper.setProps({ collapsed: false })
    expect(menu()).toBeNull()
    wrapper.unmount()
  })
})
