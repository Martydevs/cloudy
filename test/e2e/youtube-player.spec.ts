// T068 — US4 (feature 005, quickstart escenarios 16–18): el reproductor incrustado de YouTube arranca solo al pulsar
// Play (sin preparar nada ni llamar al servicio de descargas) y la ventana externa lo muestra ya en marcha; rutas protegidas.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { E2E_URL, ensureAccount, email, login, routeYoutubeEmbed, routeYoutubeThumbnails, setProfile, signedInAs, viewports, waitForHydration } from './setup/fixtures'

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
  await routeYoutubeEmbed(page)
  return page
}

describe('US4 · reproductor incrustado y ventana externa', () => {
  it('Reproducir monta el reproductor oficial al instante, sin crear ningún trabajo', async () => {
    const page = await editorPage()
    const jobRequests: string[] = []
    page.on('request', request => { if (request.url().includes('/api/youtube/jobs')) jobRequests.push(request.url()) })
    await page.goto(`${E2E_URL}/youtube/okShortVid1`)
    await waitForHydration(page)
    expect(await page.locator('iframe').count()).toBe(0)
    await page.getByRole('button', { name: /^Reproducir/ }).click()
    const frame = page.locator('iframe[title^="YouTube"]')
    await expect.poll(() => frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/okShortVid1\?autoplay=1/)
    await expect.poll(() => page.frameLocator('iframe[title^="YouTube"]').locator('#embed-id').textContent()).toBe('okShortVid1')
    expect(jobRequests).toEqual([])
    expect(await page.getByRole('button', { name: 'Pantalla completa' }).count()).toBe(0)
    await page.close()
  })

  it('Abrir en ventana nueva abre /ventana con el video ya en marcha y sin barra lateral', async () => {
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube/okShortVid1`)
    await waitForHydration(page)
    // En el contexto, no en la ventana: la ventana pide el embed al abrirse, antes de que un listener propio exista.
    await routeYoutubeThumbnails(page.context())
    await routeYoutubeEmbed(page.context())
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Abrir en ventana nueva' }).click(),
    ])
    await popup.waitForURL(url => /^\/youtube\/okShortVid1\/ventana$/.test(url.pathname) && url.search === '')
    await expect.poll(() => popup.frameLocator('iframe[title^="YouTube"]').locator('#embed-id').textContent(), { timeout: 15000 }).toBe('okShortVid1')
    expect(await popup.getByRole('navigation').count()).toBe(0)
    expect(await popup.getByRole('button', { name: 'Cerrar ventana' }).isVisible()).toBe(true)
    await popup.close()
    await page.close()
  })

  it('con teclado: Tab llega al botón Reproducir y Enter monta el reproductor', async () => {
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube/okShortVid1`)
    await waitForHydration(page)
    const play = page.getByRole('button', { name: /^Reproducir/ })
    await play.focus()
    expect(await play.evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('iframe[title^="YouTube"]').count()).toBe(1)
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
