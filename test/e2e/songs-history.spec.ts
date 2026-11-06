// T067 — US4 (feature 006, quickstart § 4 Historial): historial compartido (la más reciente primero, sin duplicar, con quién y
// cuándo), selección múltiple con generación por lotes, regenerar sin rastrear, quitar sin tocar sus colecciones y la fila
// reciente de la ficha. Contra los stubs de Apify y `cloudy-api`.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { letrasUrl } from './setup/constants'
import { apifyStubCalls, E2E_URL, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
let session: Cookie[] | null = null

async function editorPage(viewport = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'songs-history')
    session = await page.context().cookies()
  }
  return page
}

async function openIndex(page: Page) {
  await page.goto(`${E2E_URL}/canciones`)
  await waitForHydration(page)
}

async function fetchSong(page: Page, slug: string) {
  await openIndex(page)
  await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slug))
  await page.getByRole('button', { name: 'Ver letra' }).click()
  await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
  await expect.poll(() => page.getByRole('heading', { level: 1 }).isVisible()).toBe(true)
}

const cards = (page: Page) => page.getByRole('list', { name: 'Canciones consultadas', exact: true }).getByRole('listitem')
const slugs = [1, 2, 3].map(n => `historial-${n}-${runId()}`)
const titles = [1, 2, 3].map(n => `Historial ${n} ${runId()}`)

describe('US4 · historial y generación por lotes', () => {
  it('las canciones aparecen de la más reciente a la más antigua, con quién y cuándo; reabrir no duplica', async () => {
    const page = await editorPage()
    for (const slug of slugs) await fetchSong(page, slug)
    // La fila reciente de la ficha no repite la canción actual.
    const recent = page.getByRole('list', { name: 'Canciones consultadas recientemente' })
    await expect.poll(() => recent.getByText(titles[1]!).isVisible()).toBe(true)
    expect(await recent.getByText(titles[2]!).count()).toBe(0)

    await openIndex(page)
    await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(3)
    expect(await cards(page).first().innerText()).toContain(titles[2])
    expect(await cards(page).first().innerText()).toMatch(/E2E songs-history · hace/)

    await fetchSong(page, slugs[0]!)
    await openIndex(page)
    await expect.poll(async () => (await cards(page).first().innerText()).includes(titles[0]!)).toBe(true)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM songs WHERE source_url = ${`https://letras.com/e2e/${slugs[0]}`}` as { count: number }[]
    expect(count).toBe(1)
    expect((await apifyStubCalls()).runs.filter(q => q.includes(slugs[0]!))).toHaveLength(1)
    await page.close()
  })

  it('marcar tres → barra con el conteo y Generar selección → aviso de 3 archivos → tres descargas de una en una', async () => {
    const page = await editorPage()
    await openIndex(page)
    for (const title of titles) await page.getByRole('checkbox', { name: `Seleccionar ${title}` }).check()
    const bar = page.getByRole('region', { name: 'Selección' })
    await expect.poll(() => bar.innerText()).toContain('3 seleccionadas')
    const downloads: string[] = []
    page.on('download', d => downloads.push(d.suggestedFilename()))
    let inFlight = 0
    let maxInFlight = 0
    page.on('request', (req) => {
      if (/\/api\/songs\/[0-9a-f-]+\/pptx$/.test(req.url())) maxInFlight = Math.max(maxInFlight, ++inFlight)
    })
    page.on('requestfinished', (req) => {
      if (/\/api\/songs\/[0-9a-f-]+\/pptx$/.test(req.url())) inFlight -= 1
    })
    await bar.getByRole('button', { name: 'Generar selección' }).click()
    const confirm = page.getByRole('dialog')
    await expect.poll(() => confirm.innerText()).toContain('Recibirás 3 archivos, uno por canción.')
    await confirm.getByRole('button', { name: 'Generar 3 presentaciones' }).click()
    await expect.poll(() => downloads.length).toBe(3)
    expect(maxInFlight).toBe(1)
    const runsBefore = (await apifyStubCalls()).runs.length
    // Regenerar desde una entrada no vuelve a rastrear.
    await page.getByRole('button', { name: `Acciones de ${titles[0]}` }).click()
    await page.getByRole('menuitem', { name: 'Generar presentación' }).click()
    await expect.poll(() => downloads.length).toBe(4)
    expect((await apifyStubCalls()).runs.length).toBe(runsBefore)
    await page.close()
  })

  it('quitar una entrada (con confirmación) no la saca de su colección', async () => {
    const page = await editorPage()
    const [{ id: songId }] = await sql`SELECT id FROM songs WHERE source_url = ${`https://letras.com/e2e/${slugs[1]}`}` as { id: string }[]
    await page.goto(`${E2E_URL}/canciones/${songId}`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Agregar a colección' }).click()
    await page.getByRole('dialog').getByLabel('Nombre').fill(`Historial ${runId()}`)
    await page.getByRole('dialog').getByRole('button', { name: 'Crear colección' }).click()
    await expect.poll(() => page.getByText(`Colección «Historial ${runId()}» creada`).isVisible()).toBe(true)

    await openIndex(page)
    await page.getByRole('button', { name: `Acciones de ${titles[1]}` }).click()
    await page.getByRole('menuitem', { name: 'Quitar del historial' }).click()
    await page.locator('dialog[open]', { hasText: '¿Quitar' }).getByRole('button', { name: 'Quitar' }).click()
    await expect.poll(() => page.getByText(`Se quitó «${titles[1]}» del historial`).isVisible()).toBe(true)
    expect(await cards(page).filter({ hasText: titles[1]! }).count()).toBe(0)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM song_collection_items WHERE song_id = ${songId}::uuid` as { count: number }[]
    expect(count).toBe(1)
    await page.close()
  })

  it('a 360 px la barra de selección no provoca desplazamiento horizontal', async () => {
    const page = await editorPage(viewports.phone)
    await openIndex(page)
    await page.getByRole('checkbox', { name: `Seleccionar ${titles[0]}` }).check()
    await expect.poll(() => page.getByRole('region', { name: 'Selección' }).isVisible()).toBe(true)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.close()
  })
})
