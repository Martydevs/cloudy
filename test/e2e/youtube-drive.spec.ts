// «Guardar en el drive» desde /youtube (feature 005): menú de la tarjeta del historial, barra de selección con lista de
// casillas y tarjeta de lista. El progreso se ve en la bandeja y los archivos llegan a la raíz del drive.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  cloudyStubCalls,
  E2E_URL,
  email,
  profileUserId,
  resetCloudyStub,
  routeYoutubeThumbnails,
  seedYoutubeHistory,
  seedYoutubeVideo,
  signedInAs,
  testSql,
  viewports,
  waitForHydration,
} from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
let session: Cookie[] | null = null

async function editorPage(viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'yt-drive')
    session = await page.context().cookies()
  }
  await routeYoutubeThumbnails(page)
  return page
}

async function openYoutube(page: Page) {
  await page.goto(`${E2E_URL}/youtube`)
  await waitForHydration(page)
}

const tray = (page: Page) => page.getByRole('region', { name: /Descargas/ })

describe('Guardar en el drive · historial, selección y listas', () => {
  it('el menú de la tarjeta sube ese video y la bandeja muestra «ya está en el drive»', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-drive'))
    const [id] = await seedYoutubeHistory(viewer, 1, 'dra')
    await openYoutube(page)
    await page.getByRole('button', { name: `Acciones de Video ${id}` }).click()
    await page.getByRole('menuitem', { name: 'Guardar en el drive: audio MP3' }).click()
    await expect.poll(() => tray(page).getByText(/ya está en el drive/).first().isVisible(), { timeout: 30000 }).toBe(true)
    expect((await cloudyStubCalls()).formats).toEqual(['mp3'])

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await expect.poll(() => page.getByText(new RegExp(`Video ${id}.*\\.mp3`)).first().isVisible()).toBe(true)
    await page.close()
  })

  it('varios seleccionados: la lista con casillas deja subir solo los marcados, de uno en uno', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-drive'))
    const ids = await seedYoutubeHistory(viewer, 3, 'drb')
    await openYoutube(page)
    for (const id of ids) await page.getByLabel(`Seleccionar Video ${id}`).check()
    const bar = page.getByRole('region', { name: 'Selección' })
    await expect.poll(() => bar.getByText('3 seleccionados').isVisible()).toBe(true)
    await bar.getByRole('button', { name: 'Guardar en el drive' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()

    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.isVisible()).toBe(true)
    for (const id of ids) expect(await dialog.getByLabel(`Guardar Video ${id}`).isChecked()).toBe(true)
    await dialog.getByLabel(`Guardar Video ${ids[1]}`).uncheck()
    await dialog.getByRole('button', { name: 'Subir 2 al drive' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    // La selección se limpia al confirmar.
    await expect.poll(() => bar.isVisible()).toBe(false)

    // Solo cuentan las filas de la bandeja (el aviso emergente repite el texto de la primera).
    await expect.poll(() => tray(page).getByText(/ya está en el drive/).count(), { timeout: 60000 }).toBe(2)
    expect((await cloudyStubCalls()).formats).toEqual(['mp3', 'mp3'])
    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await expect.poll(() => page.getByText(new RegExp(`Video ${ids[0]}.*\\.mp3`)).first().isVisible()).toBe(true)
    await expect.poll(() => page.getByText(new RegExp(`Video ${ids[2]}.*\\.mp3`)).first().isVisible()).toBe(true)
    expect(await page.getByText(new RegExp(`Video ${ids[1]}.*\\.mp3`)).count()).toBe(0)
    await page.close()
  })

  it('un video que falla dentro del trabajo no se guarda: la bandeja dice la causa y no se repite', async () => {
    await resetCloudyStub()
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-drive'))
    await seedYoutubeVideo(viewer, 'itemBotChk1', 'Bloqueado dentro del trabajo')
    await openYoutube(page)

    await page.getByRole('button', { name: 'Acciones de Bloqueado dentro del trabajo' }).click()
    await page.getByRole('menuitem', { name: 'Guardar en el drive: audio MP3' }).click()
    await expect.poll(() => tray(page).getByText('YouTube bloqueó la descarga con su verificación anti-robots. Intenta de nuevo en unos minutos.').isVisible(), { timeout: 30000 }).toBe(true)
    // Un solo trabajo, sin reintentos por su cuenta.
    expect(await cloudyStubCalls()).toMatchObject({ createAttempts: 1, jobsCreated: 1 })

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    expect(await page.getByText(/Bloqueado dentro del trabajo.*\.mp3/).count()).toBe(0)
    await page.close()
  })

  it('la tarjeta de una lista agrupa descargas y «Guardar en el drive», y abre la lista de casillas', async () => {
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-drive'))
    const ids = await seedYoutubeHistory(viewer, 2, 'drc')
    const [row] = await sql`INSERT INTO youtube_playlists (name, created_by) VALUES ('Drive e2e', ${viewer}) RETURNING id`
    await sql.query(
      `INSERT INTO youtube_playlist_items (playlist_id, video_id, added_by, added_at)
       SELECT $1::uuid, v, $2, now() - (n || ' seconds')::interval FROM unnest($3::text[]) WITH ORDINALITY AS t(v, n)`,
      [row!.id as string, viewer, ids],
    )
    await openYoutube(page)
    await page.getByRole('button', { name: 'Opciones de Drive e2e' }).click()
    expect(await page.getByRole('menuitem').allTextContents()).toEqual([
      expect.stringContaining('Descargar video 720p'),
      expect.stringContaining('Descargar video 1080p'),
      expect.stringContaining('Descargar audio MP3'),
      expect.stringContaining('Guardar en el drive: video 720p'),
      expect.stringContaining('Guardar en el drive: audio MP3'),
    ])
    await page.getByRole('menuitem', { name: 'Guardar en el drive: video 720p' }).click()
    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.getByRole('checkbox').count()).toBe(2)
    expect(await dialog.getByText('100 MB').first().isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    await page.close()
  })

  it('a 360 px el menú, la barra y el diálogo no desbordan la pantalla', async () => {
    const page = await editorPage(viewports.phone)
    const viewer = await profileUserId(email('yt-drive'))
    const ids = await seedYoutubeHistory(viewer, 2, 'drd')
    await openYoutube(page)
    for (const id of ids) await page.getByLabel(`Seleccionar Video ${id}`).check()
    const bar = page.getByRole('region', { name: 'Selección' })
    await bar.getByRole('button', { name: 'Guardar en el drive' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => page.getByRole('dialog').isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})
