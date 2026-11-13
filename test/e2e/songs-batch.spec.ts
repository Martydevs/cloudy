// Cola del .zip de Canciones (contracts/ui.md, contracts/api.md § 4b): en modo cola cada enlace pegado se agrega a la cola en vez
// de abrir la ficha; «Generar N presentaciones (.zip)» hace una sola petición y descarga `canciones.zip`. Éxito parcial con el
// porqué de cada canción, todas fallidas sin reintento, cola llena sin gastar un rastreo, servicio dormido con «Reintentar», el
// modo apagado sigue abriendo la ficha, «Descargar en un .zip» de la barra de selección y 360 px. Contra los stubs de Apify y
// `cloudy-api` (`POST /api/lyrics/pptx/batch`, mismos escenarios por título: «vacia», «respaldo»).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Locator, Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { letrasUrl } from './setup/constants'
import { apifyStubCalls, cloudyStubCalls, E2E_URL, runId, setCloudyStubState, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null

async function editorPage(viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'songs-batch')
    session = await page.context().cookies()
  }
  return page
}

async function openIndex(page: Page) {
  await page.goto(`${E2E_URL}/canciones`)
  await waitForHydration(page)
}

const queuePanel = (page: Page) => page.getByRole('region', { name: 'Cola de presentaciones' })
const toggle = (page: Page) => page.getByRole('button', { name: 'Agregar a la cola' })

async function batchModeOn(page: Page) {
  await toggle(page).click()
  await expect.poll(() => toggle(page).getAttribute('aria-pressed')).toBe('true')
}

/** Pega el enlace en modo cola y espera a que la cola llegue a `count`. */
async function addToQueue(page: Page, slug: string, count: number) {
  await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slug))
  await page.getByRole('button', { name: 'Agregar', exact: true }).click()
  await expect.poll(async () => (await queuePanel(page).isVisible()) && (await queuePanel(page).innerText()).includes(`${count} de 3`)).toBe(true)
}

/** Peticiones de la página a `POST /api/songs/presentations`. */
function countBatchRequests(page: Page): { readonly count: number } {
  const counter = { count: 0 }
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/songs/presentations')) counter.count += 1
  })
  return counter
}

async function minHeight(...locators: Locator[]) {
  const boxes = await Promise.all(locators.map(l => l.boundingBox()))
  return Math.min(...boxes.map(b => b?.height ?? 0))
}

const slugs = {
  accents: `con-tildes-lote-${runId()}`,
  one: `lote-uno-${runId()}`,
  two: `lote-dos-${runId()}`,
  three: `lote-tres-${runId()}`,
  four: `lote-cuatro-${runId()}`,
  empty: `vacia-lote-${runId()}`,
  asleep: `lote-dormido-${runId()}`,
}
const title = (slug: string) => {
  const words = slug.replace(/-+/g, ' ')
  return words[0]!.toUpperCase() + words.slice(1)
}

afterEach(async () => {
  await setCloudyStubState('up')
})

describe('Canciones · cola del .zip', () => {
  it('modo cola: dos enlaces → «2 de 3» → un solo canciones.zip con letra en blanco; «Descargar de nuevo» sin otra petición; «Vaciar»', async () => {
    const page = await editorPage()
    await openIndex(page)
    const requests = countBatchRequests(page)
    const batchesBefore = (await cloudyStubCalls()).pptxBatch.length
    await batchModeOn(page)
    expect(await page.getByText('Modo cola: cada enlace que pegues').isVisible()).toBe(true)
    await addToQueue(page, slugs.accents, 1)
    await addToQueue(page, slugs.one, 2)
    expect(new URL(page.url()).pathname).toBe('/canciones')
    const list = queuePanel(page).getByRole('list', { name: 'Canciones en la cola' })
    expect(await list.innerText()).toContain('Canción del Señor')
    expect(await list.innerText()).toContain(title(slugs.one))

    const download = page.waitForEvent('download')
    await queuePanel(page).getByRole('button', { name: 'Generar 2 presentaciones (.zip)' }).click()
    expect((await download).suggestedFilename()).toBe('canciones.zip')
    // El aviso (toast); el panel también lo anuncia en su región sr-only.
    await expect.poll(() => page.locator('.toast').getByText('canciones.zip descargado: 2 presentaciones').isVisible()).toBe(true)
    expect(requests.count).toBe(1)
    const batches = (await cloudyStubCalls()).pptxBatch.slice(batchesBefore)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.map(item => item.title)).toEqual(['Canción del Señor', title(slugs.one)])
    expect(batches[0]!.every(item => item.fontColor === 'FFFFFF')).toBe(true)
    await expect.poll(() => list.innerText()).toContain('2 diapositivas generadas')

    const again = page.waitForEvent('download')
    await queuePanel(page).getByRole('button', { name: 'Descargar de nuevo' }).click()
    expect((await again).suggestedFilename()).toBe('canciones.zip')
    expect(requests.count).toBe(1)
    expect((await cloudyStubCalls()).pptxBatch.length).toBe(batchesBefore + 1)

    await queuePanel(page).getByRole('button', { name: 'Vaciar' }).click()
    await expect.poll(() => queuePanel(page).count()).toBe(0)
    await page.close()
  })

  it('éxito parcial: el .zip baja con las logradas y la fallida dice por qué', async () => {
    const page = await editorPage()
    await openIndex(page)
    await batchModeOn(page)
    await addToQueue(page, slugs.two, 1)
    await addToQueue(page, slugs.empty, 2)
    const download = page.waitForEvent('download')
    await queuePanel(page).getByRole('button', { name: 'Generar 2 presentaciones (.zip)' }).click()
    expect((await download).suggestedFilename()).toBe('canciones.zip')
    await expect.poll(() => queuePanel(page).innerText()).toContain('1 canción no se pudo generar; mira el detalle en la cola.')
    const failed = queuePanel(page).getByRole('listitem').filter({ hasText: title(slugs.empty) })
    expect(await failed.innerText()).toContain('La letra guardada no tiene contenido. Vuelve a obtenerla.')
    await page.close()
  })

  it('si ninguna sale: sin descarga, alerta y sin «Reintentar»', async () => {
    const page = await editorPage()
    await openIndex(page)
    await batchModeOn(page)
    await addToQueue(page, slugs.empty, 1)
    let downloads = 0
    page.on('download', () => (downloads += 1))
    await queuePanel(page).getByRole('button', { name: 'Generar 1 presentación (.zip)' }).click()
    await expect.poll(() => queuePanel(page).getByRole('alert').isVisible()).toBe(true)
    expect(await queuePanel(page).getByRole('alert').innerText()).toBe('No se pudo generar ninguna de las presentaciones.')
    expect(await queuePanel(page).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    expect(downloads).toBe(0)
    await page.close()
  })

  it('con la cola llena avisa junto al campo y el cuarto enlace no se rastrea', async () => {
    const page = await editorPage()
    await openIndex(page)
    await batchModeOn(page)
    await addToQueue(page, slugs.one, 1)
    await addToQueue(page, slugs.two, 2)
    await addToQueue(page, slugs.three, 3)
    await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slugs.four))
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await expect.poll(() => page.getByText('La cola está llena: admite hasta 3 canciones. Genera el .zip o quita una.').isVisible()).toBe(true)
    expect((await apifyStubCalls()).runs.filter(q => q.includes(slugs.four))).toHaveLength(0)
    await page.close()
  })

  it('con el servicio dormido: alerta y «Reintentar», que descarga al despertar', async () => {
    const page = await editorPage()
    await openIndex(page)
    await batchModeOn(page)
    await addToQueue(page, slugs.asleep, 1)
    await setCloudyStubState('asleep')
    await queuePanel(page).getByRole('button', { name: 'Generar 1 presentación (.zip)' }).click()
    await expect.poll(() => queuePanel(page).getByRole('button', { name: 'Reintentar' }).isVisible()).toBe(true)
    expect(await queuePanel(page).getByRole('alert').isVisible()).toBe(true)

    await setCloudyStubState('up')
    const download = page.waitForEvent('download')
    await queuePanel(page).getByRole('button', { name: 'Reintentar' }).click()
    expect((await download).suggestedFilename()).toBe('canciones.zip')
    await page.close()
  })

  it('con el modo cola apagado, el enlace sigue abriendo la ficha', async () => {
    const page = await editorPage()
    await openIndex(page)
    expect(await toggle(page).getAttribute('aria-pressed')).toBe('false')
    await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slugs.one))
    await page.getByRole('button', { name: 'Ver letra' }).click()
    await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
    await page.close()
  })

  it('barra de selección: con 2 marcadas «Descargar en un .zip» baja canciones.zip y limpia la selección; con 1 no aparece', async () => {
    const page = await editorPage()
    await openIndex(page)
    const bar = page.getByRole('region', { name: 'Selección' })
    await page.getByRole('checkbox', { name: `Seleccionar ${title(slugs.one)}` }).check()
    await expect.poll(() => bar.innerText()).toContain('1 seleccionada')
    expect(await bar.getByRole('button', { name: 'Descargar en un .zip' }).count()).toBe(0)
    await page.getByRole('checkbox', { name: `Seleccionar ${title(slugs.two)}` }).check()
    const download = page.waitForEvent('download')
    await bar.getByRole('button', { name: 'Descargar en un .zip' }).click()
    expect((await download).suggestedFilename()).toBe('canciones.zip')
    await expect.poll(() => bar.count()).toBe(0)
    await expect.poll(() => queuePanel(page).getByRole('button', { name: 'Descargar de nuevo' }).isVisible()).toBe(true)
    await page.close()
  })

  it('a 360 px: sin desplazamiento horizontal y objetivos de al menos 44 px', async () => {
    const page = await editorPage(viewports.phone)
    await openIndex(page)
    await batchModeOn(page)
    await addToQueue(page, slugs.three, 1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const height = await minHeight(
      toggle(page),
      queuePanel(page).getByRole('button', { name: 'Generar 1 presentación (.zip)' }),
      queuePanel(page).getByRole('button', { name: `Quitar ${title(slugs.three)}` }),
    )
    expect(height).toBeGreaterThanOrEqual(44)
    await page.close()
  })
})
