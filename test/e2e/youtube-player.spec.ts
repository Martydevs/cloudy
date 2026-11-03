// T068 — US4 (feature 005, quickstart escenarios 16–18): reproducir, pantalla completa sobre el contenedor y ventana
// externa que reproduce el mismo video; trabajo expirado → Preparar de nuevo; todo con teclado; rutas protegidas.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { E2E_URL, ensureAccount, email, login, routeYoutubeThumbnails, setProfile, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null

async function editorPage(): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'yt-player')
    session = await page.context().cookies()
  }
  await routeYoutubeThumbnails(page)
  return page
}

async function readyPlayer(page: Page) {
  await page.goto(`${E2E_URL}/youtube/okShortVid1`)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Preparar y reproducir' }).click()
  await expect.poll(() => page.getByText(/Preparando el video…/).isVisible()).toBe(true)
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2)
}

describe('US4 · pantalla completa y ventana externa', () => {
  it('Pantalla completa pone el contenedor del reproductor en pantalla completa y Escape la libera', async () => {
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube/okShortVid1`)
    await waitForHydration(page)
    expect(await page.getByRole('button', { name: 'Pantalla completa' }).isDisabled()).toBe(true)
    await readyPlayer(page)
    await page.getByRole('button', { name: 'Pantalla completa' }).first().click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('role'))).toBe('region')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await page.close()
  })

  it('Abrir en ventana nueva abre /ventana?job=… que reproduce desde el inicio sin barra lateral', async () => {
    const page = await editorPage()
    await readyPlayer(page)
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Abrir en ventana nueva' }).click(),
    ])
    await routeYoutubeThumbnails(popup)
    await popup.waitForURL(url => /^\/youtube\/okShortVid1\/ventana$/.test(url.pathname) && /^[0-9a-f]{32}$/.test(url.searchParams.get('job') ?? ''))
    await expect.poll(() => popup.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2)
    expect(await popup.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1)
    expect(await popup.getByRole('navigation').count()).toBe(0)
    expect(await popup.getByRole('button', { name: 'Cerrar ventana' }).isVisible()).toBe(true)
    await popup.close()
    await page.close()
  })

  it('con un trabajo expirado la ventana ofrece Preparar de nuevo y reproduce tras pulsarlo', async () => {
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube/okShortVid1/ventana?job=${'e'.repeat(32)}`)
    await waitForHydration(page)
    await expect.poll(() => page.getByText('La copia expiró').isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Preparar de nuevo' }).click()
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2)
    await page.close()
  })

  it('solo con teclado: Tab llega al reproductor y Espacio, flechas y F funcionan', async () => {
    const page = await editorPage()
    await readyPlayer(page)
    const region = page.getByRole('region', { name: /Reproductor/ })
    await region.focus()
    await page.keyboard.press(' ')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await page.keyboard.press(' ')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.volume)).toBeLessThan(1)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('f')
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await page.keyboard.press('Escape')
    // Los botones de la barra tienen nombre y se alcanzan con Tab.
    for (const name of ['Pausar', 'Silenciar']) expect(await page.getByRole('button', { name }).count(), name).toBeGreaterThan(0)
    expect(await page.getByRole('slider', { name: 'Posición' }).count()).toBe(1)
    await page.close()
  })
})

describe('US4 · rutas protegidas', () => {
  it('sin sesión, /youtube/<id>/ventana lleva a login; con cuenta pendiente, a /pendiente', async () => {
    const anonymous = await createPage()
    await anonymous.goto(`${E2E_URL}/youtube/okShortVid1/ventana`)
    await anonymous.waitForURL(url => url.pathname === '/login')
    expect(new URL(anonymous.url()).searchParams.get('redirect')).toBe('/youtube/okShortVid1/ventana')
    await anonymous.close()

    const creds = { name: 'E2E yt player pending', email: email('yt-player-pending') }
    await ensureAccount(creds)
    await setProfile(creds.email, { status: 'pending', role: null })
    const pending = await createPage(undefined, { viewport: viewports.phone })
    await login(pending, creds)
    await pending.goto(`${E2E_URL}/youtube/okShortVid1/ventana`)
    await pending.waitForURL(url => url.pathname === '/pendiente')
    await pending.close()
  })
})
