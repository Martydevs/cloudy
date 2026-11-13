// T023 — US1 (feature 005, quickstart §2 escenarios 1–7): pegar un enlace, ver la ficha con su reproductor y descargar
// como video o audio; enlaces inválidos, videos no descargables, servicio dormido y rutas protegidas. Todo contra el
// stub del servicio (`test/e2e/setup/cloudy-api-stub.ts`): nunca se llama a YouTube ni al servicio real.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cloudyStubCalls,
  E2E_URL,
  ensureAccount,
  email,
  login,
  profileUserId,
  resetCloudyStub,
  routeYoutubeEmbed,
  routeYoutubeThumbnails,
  seedYoutubeVideo,
  setCloudyStubState,
  setProfile,
  signedInAs,
  viewports,
  waitForHydration,
} from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null

/** Una sola sesión de editor en todo el archivo (Neon Auth limita los inicios de sesión). */
async function editorPage(viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'yt-editor')
    session = await page.context().cookies()
  }
  await routeYoutubeThumbnails(page)
  await routeYoutubeEmbed(page)
  return page
}

async function openVideo(page: Page, videoId: string) {
  await page.goto(`${E2E_URL}/youtube/${videoId}`)
  await waitForHydration(page)
}

afterEach(async () => {
  await setCloudyStubState('up')
})

describe('US1 · pegar un enlace, ver y descargar', () => {
  it('el enlace con tiempo lleva a la ficha solo con el ID, con título, canal, duración y miniatura', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    const keyHeaders: string[] = []
    page.on('request', (req) => {
      if (req.headers()['x-api-key']) keyHeaders.push(req.url())
    })
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await page.getByLabel('Enlace de YouTube').fill('https://youtu.be/okShortVid1?t=30')
    await page.getByLabel('Enlace de YouTube').press('Enter')
    await page.waitForURL(url => url.pathname === '/youtube/okShortVid1')
    expect(new URL(page.url()).search).toBe('')
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible()).toBe(true)
    // Acotado a los datos del video: el historial reciente de abajo también muestra «Canal Cloudy».
    const meta = page.getByRole('region', { name: 'Datos del video' })
    expect(await meta.getByText('Canal Cloudy').isVisible()).toBe(true)
    expect(await meta.getByText('3:05').isVisible()).toBe(true)
    expect(await page.locator('img[src*="i.ytimg.com/vi/okShortVid1"]').count()).toBeGreaterThan(0)
    // Abrir la ficha no prepara el video: la cola de la instancia gratuita queda libre.
    expect((await cloudyStubCalls()).jobsCreated).toBe(0)
    expect(keyHeaders).toEqual([])
    await page.close()
  })

  it.each([
    ['hola', 'Pega un enlace completo, por ejemplo https://youtu.be/…'],
    ['https://www.youtube.com/playlist?list=PL123', 'Ese enlace es de una lista de YouTube. Pega el de un video.'],
  ])('«%s» muestra su mensaje y no navega', async (text, message) => {
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await page.getByLabel('Enlace de YouTube').fill(text)
    await page.getByRole('button', { name: 'Ver video' }).click()
    await expect.poll(() => page.getByText(message).isVisible()).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/youtube')
    await page.close()
  })

  it('Descargar → Audio MP3 muestra la bandeja con avance y baja un .mp3 con el título; Video 720p baja un MP4', async () => {
    const page = await editorPage()
    const keyHeaders: string[] = []
    page.on('request', (req) => {
      if (req.headers()['x-api-key']) keyHeaders.push(req.url())
    })
    await openVideo(page, 'okShortVid1')
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible()).toBe(true)

    const mp3 = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => page.getByRole('heading', { name: /Descargas/ }).isVisible()).toBe(true)
    const audio = await mp3
    expect(audio.suggestedFilename()).toContain('Alabanza de prueba')
    expect(audio.suggestedFilename()).toMatch(/\.mp3$/)
    // El archivo llega directo del servicio, no de Cloudy.
    expect(audio.url()).toMatch(/\/api\/jobs\/[0-9a-f]{32}\/file\?exp=\d+&sig=/)
    await expect.poll(() => page.getByRole('button', { name: 'Guardar archivo' }).isVisible()).toBe(true)

    const mp4 = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Video 720p' }).click()
    expect((await mp4).suggestedFilename()).toMatch(/\.mp4$/)
    expect(keyHeaders).toEqual([])
    await page.close()
  })

  it('lo descargado aparece en «Descargas» de /youtube (con su formato), compartido y sin repetirse', async () => {
    const page = await editorPage()
    await openVideo(page, 'okShortVid1')
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible()).toBe(true)
    const file = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await file
    await expect.poll(() => page.getByRole('button', { name: 'Guardar archivo' }).isVisible()).toBe(true)

    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    const switcher = page.getByRole('group', { name: 'Cambiar de sección' })
    await expect.poll(() => switcher.getByRole('button', { name: 'Historial' }).getAttribute('aria-pressed')).toBe('true')
    await switcher.getByRole('button', { name: 'Descargas' }).click()
    const tile = page.getByRole('list', { name: 'Videos descargados' }).getByRole('link', { name: /Alabanza de prueba/ })
    // El registro lo hace el navegador al guardar el archivo; si aún no llegó, la lista se actualiza al volver.
    await expect.poll(async () => {
      await page.reload()
      await waitForHydration(page)
      await switcher.getByRole('button', { name: 'Descargas' }).click()
      // La cuadrícula se pide al abrirla: se espera a ver la lista o el estado vacío antes de contar.
      await page.getByRole('list', { name: 'Videos descargados' }).or(page.getByText('Todavía no hay descargas')).waitFor()
      return tile.count()
    }, { timeout: 15_000 }).toBe(1)
    expect(await tile.textContent()).toContain('Audio MP3')
    expect(await page.getByRole('heading', { level: 2, name: 'Descargas' }).isVisible()).toBe(true)
    await tile.click()
    await page.waitForURL(url => url.pathname === '/youtube/okShortVid1')
    await page.close()
  })

  it('Video 1080p de un video que no llega a 1080p avisa antes y la bandeja dice «Entregado en 480p»', async () => {
    const page = await editorPage()
    await openVideo(page, 'lowResVid01')
    await expect.poll(() => page.getByRole('heading', { name: 'Video en baja calidad' }).isVisible()).toBe(true)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar' }).click()
    expect(await page.getByText('se entregará la mayor calidad disponible').isVisible()).toBe(true)
    await page.getByRole('menuitemradio', { name: /Video 1080p/ }).click()
    await download
    await expect.poll(() => page.getByText('Entregado en 480p').isVisible()).toBe(true)
    await page.close()
  })

  it.each([
    ['tooLongVid1', 'Conferencia muy larga', 'Este video dura más de 30 minutos'],
    ['liveVideo01', 'Transmisión en vivo', 'Es una transmisión en vivo o un estreno'],
  ])('%s muestra sus datos con Descargar deshabilitado y el motivo', async (videoId, title, reason) => {
    const page = await editorPage()
    await openVideo(page, videoId)
    await expect.poll(() => page.getByRole('heading', { name: title }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Descargar' }).isDisabled()).toBe(true)
    expect(await page.getByText(reason).first().isVisible()).toBe(true)
    await page.close()
  })

  it('un video privado sin datos previos muestra el motivo y la vuelta a YouTube', async () => {
    const page = await editorPage()
    await openVideo(page, 'privateVid1')
    await expect.poll(() => page.getByRole('alert').filter({ hasText: 'Este video es privado' }).isVisible()).toBe(true)
    expect(await page.getByRole('link', { name: 'Volver a YouTube' }).first().isVisible()).toBe(true)
    await page.close()
  })

  it('con el servicio dormido aparece el aviso con Reintentar en menos de 1 s y se recupera solo al despertar', async () => {
    await setCloudyStubState('asleep')
    const page = await editorPage()
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    const banner = page.getByRole('status').filter({ hasText: 'Despertando el servicio' })
    await expect.poll(() => banner.isVisible(), { timeout: 1000 }).toBe(true)
    expect(await page.getByRole('button', { name: 'Reintentar' }).isVisible()).toBe(true)

    // La ficha también lo avisa y se vuelve a pedir sola cuando el servicio responde.
    await openVideo(page, 'okShortVid1')
    await expect.poll(() => banner.isVisible()).toBe(true)
    await setCloudyStubState('up')
    // El ping se repite cada 5 s: la interfaz vuelve sin recargar (SC-010).
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible(), { timeout: 6500 }).toBe(true)
    expect(await banner.isVisible()).toBe(false)
    await page.close()
  })

  it('Reproducir no crea trabajos: Video 720p genera el suyo al descargar', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    await openVideo(page, 'okShortVid1')
    await page.getByRole('button', { name: /^Reproducir/ }).click()
    await expect.poll(() => page.locator('iframe[title^="YouTube"]').count()).toBe(1)
    expect((await cloudyStubCalls()).jobsCreated).toBe(0)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Video 720p' }).click()
    await download
    expect((await cloudyStubCalls()).formats).toEqual(['mp4_720'])
    await page.close()
  })

  it('Guardar en el drive → Audio MP3 sube el archivo a la raíz del drive', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    await openVideo(page, 'okShortVid1')
    await page.getByRole('button', { name: 'Guardar en el drive' }).click()
    expect(await page.getByRole('menuitemradio').allTextContents()).toEqual([expect.stringContaining('Video 720p'), expect.stringContaining('Audio MP3')])
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => page.getByText(/ya está en el drive/).first().isVisible(), { timeout: 30000 }).toBe(true)
    expect((await cloudyStubCalls()).formats).toEqual(['mp3'])

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await expect.poll(() => page.getByText(/Alabanza de prueba.*\.mp3/).first().isVisible()).toBe(true)

    await page.close()
  })

  it('funciona a 360 px sin desplazamiento horizontal', async () => {
    const page = await editorPage(viewports.phone)
    await openVideo(page, 'okShortVid1')
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})

// Cuando el servicio no puede con un video (p. ej. el bloqueo anti-robots de YouTube) la persona ve la causa, no el
// aviso de «despertando». Hay un solo motor: nada se repite por su cuenta.
describe('fallos del servicio con un video', () => {
  const trayRows = (page: Page) => page.getByRole('list', { name: 'Trabajos de descarga' }).locator('> li')
  const botCheck = 'YouTube bloqueó la descarga con su verificación anti-robots. Intenta de nuevo en unos minutos.'

  it('botCheckVd1: YouTube bloquea al sondear y al crear → la ficha y la descarga dicen la causa', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    await openVideo(page, 'botCheckVd1')
    await expect.poll(() => page.getByText(botCheck).first().isVisible()).toBe(true)
    // No es el servicio dormido: se ofrece reintentar, sin el aviso de «despertando».
    expect(await page.getByRole('button', { name: 'Reintentar' }).isVisible()).toBe(true)
    expect(await page.getByText('Despertando el servicio').count()).toBe(0)
    // Un 502 con causa no se repite solo (`retryStatusCodes` sin 502).
    expect((await cloudyStubCalls()).probes).toBe(1)

    // La descarga desde el historial (sin pasar por la ficha) falla igual, con el mismo motivo.
    await seedYoutubeVideo(await profileUserId(email('yt-editor')), 'botCheckVd1', 'Bloqueado por YouTube')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Acciones de Bloqueado por YouTube' }).click()
    await page.getByRole('menuitem', { name: 'Descargar audio MP3' }).click()
    // Las filas, no toda la bandeja: su región `sr-only` anuncia lo mismo y duplicaría la coincidencia.
    await expect.poll(() => trayRows(page).getByText(botCheck).isVisible(), { timeout: 15_000 }).toBe(true)
    expect(await trayRows(page).getByText('No se pudo descargar').isVisible()).toBe(true)
    const calls = await cloudyStubCalls()
    expect(calls.createAttempts).toBe(1)
    expect(calls.jobsCreated).toBe(0)
    await page.close()
  })

  it('itemBotChk1: el video falla dentro del trabajo → la fila falla con la causa y no se repite', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    await openVideo(page, 'itemBotChk1')
    await expect.poll(() => page.getByRole('heading', { name: 'Bloqueado dentro del trabajo' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => trayRows(page).getByText('No se pudo descargar').isVisible(), { timeout: 20_000 }).toBe(true)
    expect(await trayRows(page).getByText(botCheck).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Preparar de nuevo' }).isVisible()).toBe(true)
    const calls = await cloudyStubCalls()
    expect(calls.createAttempts).toBe(1)
    expect(calls.jobsCreated).toBe(1)
    expect(await trayRows(page).count()).toBe(1)
    await page.close()
  })
})

describe('US1 · rutas protegidas', () => {
  it.each(['/youtube', '/youtube/okShortVid1'])('sin sesión, %s lleva a login con redirect', async (path) => {
    const page = await createPage()
    await page.goto(`${E2E_URL}${path}`)
    await page.waitForURL(url => url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(path)
    await page.close()
  })

  it('una cuenta pendiente va a /pendiente y las APIs responden 401/403', async () => {
    const creds = { name: 'E2E yt pending', email: email('yt-pending') }
    const cookie = await ensureAccount(creds)
    await setProfile(creds.email, { status: 'pending', role: null })
    const page = await createPage()
    await login(page, creds)
    for (const path of ['/youtube', '/youtube/okShortVid1']) {
      await page.goto(`${E2E_URL}${path}`)
      await page.waitForURL(url => url.pathname === '/pendiente')
    }
    await page.close()
    for (const path of ['/api/youtube/health', '/api/youtube/videos/okShortVid1', `/api/youtube/jobs/${'a'.repeat(32)}`]) {
      expect((await fetch(`${E2E_URL}${path}`)).status, path).toBe(401)
      expect((await fetch(`${E2E_URL}${path}`, { headers: { cookie } })).status, path).toBe(403)
    }
  })
})
