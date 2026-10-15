// US5 / US9 — Dashboard responsivo y tema oscuro/claro sin parpadeo.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { E2E_URL, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

describe('US5 · dashboard responsivo', () => {
  it('a 360 px no hay scroll horizontal y el menú se abre y se cierra', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'shell-phone')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const sidebar = page.getByRole('navigation', { name: 'Secciones' })
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    expect(await page.getByRole('link', { name: 'Usuarios' }).count()).toBe(0)

    // Elegir una sección cierra el panel.
    await sidebar.getByRole('link', { name: 'Archivos' }).click()
    await page.waitForURL(url => url.pathname === '/archivos')
    await expect.poll(() => sidebar.isVisible()).toBe(false)

    // Esc lo cierra.
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => sidebar.isVisible()).toBe(false)

    // Tocar fuera (el overlay) también.
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    // Se toca el overlay a la derecha del panel; Playwright espera a que termine la animación.
    await page.getByRole('button', { name: 'Cerrar menú' }).click({ position: { x: 340, y: 400 } })
    await expect.poll(() => sidebar.isVisible()).toBe(false)
    await page.close()
  })

  it('en escritorio la barra contraída se mantiene tras recargar', async () => {
    const page = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(page, 'editor', 'shell-desktop')
    await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Expandir barra lateral' }).isVisible()).toBe(true)
    await page.reload()
    await expect.poll(() => page.getByRole('button', { name: 'Expandir barra lateral' }).isVisible()).toBe(true)
    await page.close()
  })
})

// Regresiones de la prueba humana del MVP (T110a–T110d).
describe('US5 · bugs visuales del shell', () => {
  const metrics = (page: Awaited<ReturnType<typeof createPage>>) => page.evaluate(() => {
    const side = document.querySelector('.drawer-side')!
    const aside = side.querySelector('aside')!
    const button = document.querySelector<HTMLElement>('button[aria-label="Menú de usuario"]')!
    const avatar = button.querySelector('span')!
    return {
      sideOverflow: side.scrollHeight - side.clientHeight,
      asideHeight: Math.round(aside.getBoundingClientRect().height),
      viewport: window.innerHeight,
      button: button.getBoundingClientRect(),
      avatar: avatar.getBoundingClientRect(),
    }
  })

  const filtersOverflow = (page: Awaited<ReturnType<typeof createPage>>) => page.evaluate(() => {
    const box = document.querySelector('[aria-label="Filtrar por tipo"]')!.parentElement!
    return box.scrollHeight - box.clientHeight
  })

  it('en escritorio la barra lateral no se desplaza, la fila de cuenta mide ≥ 44 px y los filtros no muestran barras', async () => {
    const page = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(page, 'editor', 'shell-bugs-desktop')

    // Expandida: la cuenta es una fila (avatar + nombre/correo) al pie, con alto táctil.
    const m = await metrics(page)
    expect(m.sideOverflow).toBeLessThanOrEqual(0)
    expect(m.asideHeight).toBe(m.viewport)
    expect(m.button.height).toBeGreaterThanOrEqual(44)

    // Contraída tampoco se desplaza y el avatar llena su botón (el hover no deja un aro).
    await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
    const c = await metrics(page)
    expect(c.sideOverflow).toBeLessThanOrEqual(0)
    expect(c.asideHeight).toBe(c.viewport)
    expect(Math.round(c.avatar.width)).toBe(Math.round(c.button.width))
    expect(Math.round(c.avatar.height)).toBe(Math.round(c.button.height))

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Imágenes' }).click()
    await expect.poll(() => filtersOverflow(page)).toBeLessThanOrEqual(0)
    await page.close()
  })

  it('a 360 px el panel abierto no se desplaza y los filtros no muestran barras', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'shell-bugs-phone')
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => page.getByRole('navigation', { name: 'Secciones' }).isVisible()).toBe(true)

    // El cajón siempre va expandido: la fila de cuenta queda al pie del panel.
    const m = await metrics(page)
    expect(m.sideOverflow).toBeLessThanOrEqual(0)
    expect(m.asideHeight).toBe(m.viewport)
    expect(m.button.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Escape')

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Imágenes' }).click()
    await expect.poll(() => filtersOverflow(page)).toBeLessThanOrEqual(0)
    await page.close()
  })
})

describe('US9 · tema', () => {
  it('la primera visita es oscura aunque el sistema prefiera claro', async () => {
    const page = await createPage(undefined, { colorScheme: 'light' })
    const res = await page.goto(`${E2E_URL}/login`)
    expect(await res?.text()).toMatch(/<html[^>]*data-theme="cloudy"/)
    expect(await page.locator('html').getAttribute('data-theme')).toBe('cloudy')
    await page.close()
  })

  it('el cambio a claro persiste y llega en el HTML del servidor', async () => {
    const page = await createPage('/login')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Cambiar a tema claro' }).click()
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('cloudy-light')

    const res = await page.reload()
    expect(await res?.text()).toMatch(/<html[^>]*data-theme="cloudy-light"/)
    await expect.poll(() => page.getByRole('button', { name: 'Cambiar a tema oscuro' }).isVisible()).toBe(true)
    await page.close()
  })
})
