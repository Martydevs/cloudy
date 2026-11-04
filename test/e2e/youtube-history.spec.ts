// T057 — US3 (feature 005, quickstart escenarios 13–15): historial compartido (más reciente primero, sin duplicar),
// selección múltiple con descarga en un .zip o por lotes, quitar con confirmación y la fila reciente de la ficha.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { YOUTUBE_HISTORY_PAGE } from '../../shared/constants/youtube'
import {
  E2E_URL,
  email,
  profileUserId,
  routeYoutubeThumbnails,
  seedYoutubeHistory,
  signedInAs,
  testSql,
  viewports,
  waitForHydration,
} from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
let session: Cookie[] | null = null

async function editorPage(): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'yt-history')
    session = await page.context().cookies()
  }
  await routeYoutubeThumbnails(page)
  return page
}

async function openVideo(page: Page, videoId: string, title: RegExp | string) {
  await page.goto(`${E2E_URL}/youtube/${videoId}`)
  await waitForHydration(page)
  await expect.poll(() => page.getByRole('heading', { name: title, level: 1 }).isVisible()).toBe(true)
}

const cards = (page: Page) => page.getByRole('list', { name: 'Videos consultados' }).getByRole('listitem')

describe('US3 · historial y descarga por lotes', () => {
  it('los videos abiertos aparecen del más reciente al más antiguo, con quién y cuándo; reabrir no duplica', async () => {
    const page = await editorPage()
    await openVideo(page, 'okShortVid1', 'Alabanza de prueba')
    await openVideo(page, 'lowResVid01', 'Video en baja calidad')
    await openVideo(page, 'histVideo01', 'Video histVideo01')
    // La fila reciente de la ficha no repite el video actual.
    const recent = page.getByRole('list', { name: 'Videos consultados recientemente' })
    await expect.poll(() => recent.getByText('Alabanza de prueba').isVisible()).toBe(true)
    expect(await recent.getByText('Video histVideo01').count()).toBe(0)

    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(3)
    expect(await cards(page).first().innerText()).toContain('Video histVideo01')
    expect(await cards(page).first().innerText()).toMatch(/E2E yt-history · hace/)

    await openVideo(page, 'okShortVid1', 'Alabanza de prueba')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await expect.poll(async () => (await cards(page).first().innerText()).includes('Alabanza de prueba')).toBe(true)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM youtube_videos WHERE video_id = 'okShortVid1'` as { count: number }[]
    expect(count).toBe(1)
    await page.close()
  })

  it('con más de una página, el servidor ya pinta «Cargar más» y la hidratación no se desajusta (regresión)', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'yt-history')
    await routeYoutubeThumbnails(page)
    const errors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const viewer = await profileUserId(email('yt-history'))
    await seedYoutubeHistory(viewer, YOUTUBE_HISTORY_PAGE + 4, 'hsp')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await expect.poll(() => cards(page).count()).toBe(YOUTUBE_HISTORY_PAGE)
    expect(await page.getByRole('button', { name: 'Cargar más' }).count()).toBe(1)
    // El HTML del servidor (sin JavaScript) ya trae el botón: sin él, Vue marcaba «Hydration completed but contains mismatches».
    const bare = await createPage(undefined, { viewport: viewports.phone, javaScriptEnabled: false })
    await bare.context().addCookies(await page.context().cookies())
    await bare.goto(`${E2E_URL}/youtube`)
    expect(await bare.getByRole('button', { name: 'Cargar más' }).count()).toBe(1)
    await bare.close()
    expect(errors).toEqual([])
    await page.close()
  })

  it('marcar tres y Descargar selección (MP3) entrega un .zip; Limpiar oculta la barra', async () => {
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-history'))
    const ids = await seedYoutubeHistory(viewer, 3, 'hsa')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    for (const id of ids) await page.getByLabel(`Seleccionar Video ${id}`).check()
    const bar = page.getByRole('region', { name: 'Selección' })
    await expect.poll(() => bar.getByText('3 seleccionados').isVisible()).toBe(true)
    const download = page.waitForEvent('download')
    await bar.getByRole('button', { name: 'Descargar selección' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.zip$/)
    await bar.getByRole('button', { name: 'Limpiar' }).click()
    await expect.poll(() => bar.isVisible()).toBe(false)
    await page.close()
  })

  it('más de 10 marcados entrega dos archivos', async () => {
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-history'))
    const ids = await seedYoutubeHistory(viewer, 12, 'hsb')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    for (const id of ids) await page.getByLabel(`Seleccionar Video ${id}`).check()
    const bar = page.getByRole('region', { name: 'Selección' })
    await expect.poll(() => bar.getByText('Recibirás 2 archivos').isVisible()).toBe(true)
    const files: string[] = []
    page.on('download', d => files.push(d.suggestedFilename()))
    await bar.getByRole('button', { name: 'Descargar selección' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => files.length, { timeout: 30000 }).toBe(2)
    await bar.getByRole('button', { name: 'Limpiar' }).click()
    await page.close()
  })

  it('quitar una entrada pide confirmación; si estaba en una lista, la lista la conserva', async () => {
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-history'))
    const [id] = await seedYoutubeHistory(viewer, 1, 'hsc')
    const [list] = await sql`INSERT INTO youtube_playlists (name, created_by) VALUES ('Conserva e2e', ${viewer}) RETURNING id`
    await sql`INSERT INTO youtube_playlist_items (playlist_id, video_id, added_by) VALUES (${list!.id}, ${id!}, ${viewer})`
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    await page.getByRole('button', { name: `Acciones de Video ${id}` }).click()
    await page.getByRole('menuitem', { name: 'Quitar del historial' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar' }).click()
    await expect.poll(() => page.getByLabel(`Seleccionar Video ${id}`).count()).toBe(0)
    const [item] = await sql`SELECT 1 AS ok FROM youtube_playlist_items WHERE playlist_id = ${list!.id} AND video_id = ${id!}`
    expect(item?.ok).toBe(1)
    await page.close()
  })

  it('una entrada se vuelve a descargar desde el historial sin pegar el enlace', async () => {
    const page = await editorPage()
    const viewer = await profileUserId(email('yt-history'))
    const [id] = await seedYoutubeHistory(viewer, 1, 'hsd')
    await page.goto(`${E2E_URL}/youtube`)
    await waitForHydration(page)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: `Acciones de Video ${id}` }).click()
    await page.getByRole('menuitem', { name: 'Descargar audio MP3' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.mp3$/)
    await page.close()
  })
})
