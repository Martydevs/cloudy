// T045 — US2 (feature 005, quickstart escenarios 8–12): listas compartidas con autor, permisos de autor o admin,
// agregar sin duplicar y descarga por lotes de 10 (un .zip por lote). Contra el stub del servicio.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
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
const sessions = new Map<string, Cookie[]>()

/** Una sesión por persona en todo el archivo (Neon Auth limita los inicios de sesión). */
async function pageAs(role: 'admin' | 'editor', label: string): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  const cookies = sessions.get(label)
  if (cookies) await page.context().addCookies(cookies)
  else {
    await signedInAs(page, role, label)
    sessions.set(label, await page.context().cookies())
  }
  await routeYoutubeThumbnails(page)
  return page
}

const cookieOf = (label: string) => sessions.get(label)!.map(c => `${c.name}=${c.value}`).join('; ')

async function seedPlaylist(name: string, owner: string, videoIds: string[]): Promise<string> {
  const [row] = await sql`INSERT INTO youtube_playlists (name, created_by) VALUES (${name}, ${owner}) RETURNING id`
  const id = row!.id as string
  await sql.query(
    `INSERT INTO youtube_playlist_items (playlist_id, video_id, added_by, added_at)
     SELECT $1::uuid, v, $2, now() - (n || ' seconds')::interval FROM unnest($3::text[]) WITH ORDINALITY AS t(v, n)`,
    [id, owner, videoIds],
  )
  return id
}

async function openYoutube(page: Page) {
  await page.goto(`${E2E_URL}/youtube`)
  await waitForHydration(page)
}

describe('US2 · listas de reproducción', () => {
  it('crear una lista desde un video, verla con su autor y agregar el mismo video avisa «Ya estaba»', async () => {
    const page = await pageAs('editor', 'yt-list-a')
    await page.goto(`${E2E_URL}/youtube/okShortVid1`)
    await waitForHydration(page)
    await expect.poll(() => page.getByRole('heading', { name: 'Alabanza de prueba' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Crear lista' }).click()
    await page.getByLabel('Nombre').fill('Domingo e2e')
    await page.getByRole('button', { name: 'Crear lista' }).last().click()
    await expect.poll(() => page.getByText('Lista «Domingo e2e» creada').isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Crear lista' }).click()
    await page.getByRole('tab', { name: 'Agregar a una existente' }).click()
    await page.getByRole('button', { name: /Domingo e2e/ }).click()
    await expect.poll(() => page.getByText('Ya estaba en «Domingo e2e»').isVisible()).toBe(true)

    await openYoutube(page)
    await expect.poll(() => page.getByRole('button', { name: /Abrir la lista Domingo e2e/ }).isVisible()).toBe(true)
    expect(await page.getByText('Creada por E2E yt-list-a').first().isVisible()).toBe(true)
    await page.close()
  })

  it('otro editor ve la lista y agrega o quita videos, pero no puede renombrarla ni eliminarla (403)', async () => {
    const owner = await pageAs('editor', 'yt-list-a')
    await owner.close()
    const ownerId = await profileUserId(email('yt-list-a'))
    const [video] = await seedYoutubeHistory(ownerId, 1, 'plb')
    const playlistId = await seedPlaylist('Ajena e2e', ownerId, [video!])

    const page = await pageAs('editor', 'yt-list-b')
    await openYoutube(page)
    await page.getByRole('button', { name: /Abrir la lista Ajena e2e/ }).click()
    await expect.poll(() => page.getByText('Creada por E2E yt-list-a').last().isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Renombrar' }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Eliminar lista' }).count()).toBe(0)

    const cookie = cookieOf('yt-list-b')
    const headers = { cookie, 'content-type': 'application/json' }
    expect((await fetch(`${E2E_URL}/api/youtube/playlists/${playlistId}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'X' }) })).status).toBe(403)
    expect((await fetch(`${E2E_URL}/api/youtube/playlists/${playlistId}`, { method: 'DELETE', headers })).status).toBe(403)
    expect(await (await fetch(`${E2E_URL}/api/youtube/playlists/${playlistId}/items`, { method: 'POST', headers, body: JSON.stringify({ videoId: 'okShortVid1' }) })).json()).toEqual({ added: true })

    await page.getByRole('button', { name: `Quitar Video ${video} de la lista` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar' }).last().click()
    await expect.poll(() => page.getByText(`Se quitó «Video ${video}» de la lista`).isVisible()).toBe(true)
    await page.close()
  })

  it('el admin renombra y elimina una lista ajena con confirmación; los videos siguen en el historial', async () => {
    const ownerId = await profileUserId(email('yt-list-a'))
    const [video] = await seedYoutubeHistory(ownerId, 1, 'plc')
    await seedPlaylist('Para borrar e2e', ownerId, [video!])
    const page = await pageAs('admin', 'yt-list-admin')
    await openYoutube(page)
    await page.getByRole('button', { name: /Abrir la lista Para borrar e2e/ }).click()
    await page.getByRole('button', { name: 'Renombrar' }).click()
    await page.getByLabel('Nuevo nombre').fill('Renombrada e2e')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => page.getByText('Ahora se llama «Renombrada e2e»').isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Eliminar lista' }).click()
    await page.getByRole('button', { name: 'Eliminar lista' }).last().click()
    await expect.poll(() => page.getByText('Se eliminó la lista «Renombrada e2e»').isVisible()).toBe(true)
    const [still] = await sql`SELECT last_viewed_at FROM youtube_videos WHERE video_id = ${video!}`
    expect(still?.last_viewed_at).not.toBeNull()
    await page.close()
  })

  it('descargar una lista de 3 entrega un .zip; con unavailVid1 trae los demás y nombra el fallido', async () => {
    const ownerId = await profileUserId(email('yt-list-a'))
    const seeded = await seedYoutubeHistory(ownerId, 2, 'pld')
    await sql`INSERT INTO youtube_videos (video_id, title) VALUES ('unavailVid1', 'Video que ya no está') ON CONFLICT DO NOTHING`
    await seedPlaylist('Tres e2e', ownerId, [...seeded, 'unavailVid1'])
    const page = await pageAs('editor', 'yt-list-a')
    await openYoutube(page)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar Tres e2e' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.zip$/)
    await expect.poll(() => page.getByText('Este video ya no está disponible en YouTube').first().isVisible()).toBe(true)
    await page.close()
  })

  it('una lista de 12 entrega dos archivos: lote 1 de 2 y lote 2 de 2', async () => {
    const ownerId = await profileUserId(email('yt-list-a'))
    const seeded = await seedYoutubeHistory(ownerId, 12, 'ple')
    await seedPlaylist('Doce e2e', ownerId, seeded)
    const page = await pageAs('editor', 'yt-list-a')
    await openYoutube(page)
    const files: string[] = []
    page.on('download', d => files.push(d.suggestedFilename()))
    await page.getByRole('button', { name: 'Descargar Doce e2e' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    await expect.poll(() => page.getByText('Recibirás 2 archivos').isVisible()).toBe(true)
    await expect.poll(() => files.length, { timeout: 30000 }).toBe(2)
    expect(files.every(name => name.endsWith('.zip'))).toBe(true)
    expect(await page.getByText('Lote 1 de 2').first().isVisible()).toBe(true)
    expect(await page.getByText('Lote 2 de 2').first().isVisible()).toBe(true)
    await page.close()
  })

  it('desde el detalle, Abrir lleva a la ficha y Descargar baja ese video', async () => {
    const ownerId = await profileUserId(email('yt-list-a'))
    await seedPlaylist('Detalle e2e', ownerId, ['okShortVid1'])
    const page = await pageAs('editor', 'yt-list-a')
    await openYoutube(page)
    await page.getByRole('button', { name: /Abrir la lista Detalle e2e/ }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('dialog').getByRole('button', { name: 'Descargar' }).click()
    await page.getByRole('menuitemradio', { name: 'Audio MP3' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.mp3$/)
    await page.getByRole('link', { name: 'Abrir Alabanza de prueba' }).click()
    await page.waitForURL(url => url.pathname === '/youtube/okShortVid1')
    await page.close()
  })
})
