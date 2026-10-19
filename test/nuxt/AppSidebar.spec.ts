import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('oculta las secciones que todavía no tienen página', async () => {
    setRole('admin')
    // Todas las secciones ya tienen página: se quita una temporalmente para simular una historia sin hacer.
    const router = useRouter()
    const page = router.getRoutes().find(r => r.path === '/papelera')!
    router.removeRoute(page.name!)
    const wrapper = await mountSuspended(AppSidebar, { props: { collapsed: false } })
    expect(labels(wrapper)).not.toContain('Papelera')
    router.addRoute({ name: page.name, path: page.path, meta: page.meta, component: page.components!.default! })
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

  it('los enlaces del menú llevan un anillo de foco visible en el color de su texto (daisyUI lo quita en `.menu`)', async () => {
    setRole('admin')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const ring = ['focus-visible:outline-2', 'focus-visible:outline-current']
    const links = wrapper.findAll('nav a')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link.classes(), link.text()).toEqual(expect.arrayContaining(ring))

    await wrapper.get('button[aria-label="Menú de usuario"]').trigger('click')
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"], [role="menu"] button')]
    expect(items.length).toBe(3)
    for (const item of items) expect([...item.classList], item.textContent ?? '').toEqual(expect.arrayContaining(ring))
    wrapper.unmount()
  })

  it('al contraer o expandir con el teclado, el foco sigue en el botón de alternar', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const collapse = wrapper.get('button[aria-label="Contraer barra lateral"]')
    ;(collapse.element as HTMLButtonElement).focus()
    await collapse.trigger('click')
    expect(wrapper.emitted('toggleCollapse')).toHaveLength(1)
    // El layout responde al evento cambiando la prop; el botón se sustituye por el de expandir.
    await wrapper.setProps({ collapsed: true })
    await nextTick()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Expandir barra lateral')

    await wrapper.get('button[aria-label="Expandir barra lateral"]').trigger('click')
    await wrapper.setProps({ collapsed: false })
    await nextTick()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Contraer barra lateral')
    wrapper.unmount()
  })

  it('el aviso de la barra contraída también sale con el foco del teclado y se va al desplazar o expandir', async () => {
    setRole('editor')
    const tip = () => document.body.querySelector('[aria-hidden="true"].fixed')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: true } })
    const item = wrapper.findAll('nav li').find(li => li.find('a').attributes('aria-label') === 'Pendientes')!

    // Tabular hasta el enlace lo muestra; mover el foco dentro del mismo ítem no lo quita.
    await item.trigger('focusin')
    await nextTick()
    expect(tip()?.textContent).toBe('Pendientes')
    item.element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: item.find('a').element, bubbles: true }))
    await nextTick()
    expect(tip()?.textContent).toBe('Pendientes')
    // Salir del ítem sí lo quita.
    item.element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true }))
    await nextTick()
    expect(tip()).toBeNull()

    // Al desplazar la lista el aviso quedaría desalineado: desaparece.
    await item.trigger('mouseenter')
    await nextTick()
    expect(tip()).not.toBeNull()
    await wrapper.get('nav').trigger('scroll')
    await nextTick()
    expect(tip()).toBeNull()

    // Al expandir la barra ya no hace falta.
    await item.trigger('mouseenter')
    await nextTick()
    expect(tip()).not.toBeNull()
    await wrapper.setProps({ collapsed: false })
    await nextTick()
    expect(tip()).toBeNull()
    // Expandida, pasar el cursor no muestra nada: el texto ya está a la vista.
    await item.trigger('mouseenter')
    await nextTick()
    expect(tip()).toBeNull()
    wrapper.unmount()
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

  it('el teclado entra al menú: ↓ abre y enfoca la primera entrada, ↑/↓ recorren en círculo, Tab lo cierra y devuelve el foco (T162, defecto 4)', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const trigger = wrapper.get('button[aria-label="Menú de usuario"]')
    const entries = () => [...document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"], [role="menu"] button')]
    const focused = () => (document.activeElement as HTMLElement | null)?.textContent?.trim()
    const press = (key: string) => menu()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await vi.waitFor(() => expect(menu()).not.toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(entries()[0]))
    expect(entries().map(e => e.textContent?.trim())).toEqual(['Cambiar a tema claro', 'Mi perfil', 'Cerrar sesión'])

    press('ArrowDown')
    expect(focused()).toBe('Mi perfil')
    press('ArrowDown')
    expect(focused()).toBe('Cerrar sesión')
    press('ArrowDown')
    expect(document.activeElement).toBe(entries()[0])
    press('ArrowUp')
    expect(focused()).toBe('Cerrar sesión')
    press('Home')
    expect(document.activeElement).toBe(entries()[0])
    press('End')
    expect(focused()).toBe('Cerrar sesión')

    // Tab sale del menú: se cierra y el foco está en el disparador cuando el navegador avanza.
    press('Tab')
    await nextTick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger.element)

    // ↑ abre por el final; el clic también deja el foco dentro.
    await trigger.trigger('keydown', { key: 'ArrowUp' })
    await vi.waitFor(() => expect(focused()).toBe('Cerrar sesión'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    await vi.waitFor(() => expect(document.activeElement).toBe(entries()[0]))
    wrapper.unmount()
  })

  it('el menú se cierra al cambiar el tamaño de la ventana y al navegar; Esc sin menú no hace nada', async () => {
    setRole('editor')
    const wrapper = await mountSuspended(AppSidebar, { attachTo: document.body, props: { collapsed: false } })
    const trigger = wrapper.get('button[aria-label="Menú de usuario"]')

    // La posición se calcula al abrir: si la ventana cambia, se cierra en vez de quedar flotando mal.
    await trigger.trigger('click')
    expect(menu()).not.toBeNull()
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(menu()).toBeNull()

    await trigger.trigger('click')
    expect(menu()).not.toBeNull()
    await useRouter().push('/perfil')
    await nextTick()
    expect(menu()).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(menu()).toBeNull()
    expect(trigger.attributes('aria-expanded')).toBe('false')
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
