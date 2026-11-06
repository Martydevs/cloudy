// T045 — US2 (feature 006, quickstart § 3): generar y descargar la presentación desde la ficha. Contra los stubs de Apify y
// `cloudy-api`: la letra va en blanco, el nombre sugerido lleva tildes, un doble clic hace una sola petición, el reparto de
// respaldo se avisa, los 422 no ofrecen Reintentar, el servicio dormido sí, y generar otra vez no vuelve a rastrear.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { letrasUrl } from './setup/constants'
import { apifyStubCalls, cloudyStubCalls, E2E_URL, runId, setCloudyStubState, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null

async function editorPage(): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'songs-pptx')
    session = await page.context().cookies()
  }
  return page
}

/** Obtiene la canción del enlace (rastreo contra el stub) y deja la ficha abierta. */
async function openSong(page: Page, slug: string) {
  await page.goto(`${E2E_URL}/canciones`)
  await waitForHydration(page)
  await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slug))
  await page.getByRole('button', { name: 'Ver letra' }).click()
  await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
  await expect.poll(() => page.getByRole('button', { name: 'Generar presentación' }).isEnabled()).toBe(true)
}

const tray = (page: Page) => page.getByRole('list', { name: 'Presentaciones de canciones' })

afterEach(async () => {
  await setCloudyStubState('up')
})

describe('US2 · presentación PowerPoint', () => {
  it('descarga «<Título>.pptx» con tildes, avisa las diapositivas y manda la letra en blanco', async () => {
    const page = await editorPage()
    await openSong(page, `con-tildes-${runId()}`)
    expect(await page.getByText('La letra va en blanco: proyecta la presentación sobre un fondo oscuro.').isVisible()).toBe(true)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Generar presentación' }).click()
    expect((await download).suggestedFilename()).toBe('Canción del Señor.pptx')
    await expect.poll(() => tray(page).innerText()).toContain('2 diapositivas generadas')
    const sent = (await cloudyStubCalls()).pptx.filter(c => c.title === 'Canción del Señor')
    expect(sent.at(-1)?.fontColor).toBe('FFFFFF')
    expect(sent.at(-1)?.html).toContain('<div class="lyric-original">')
    await page.close()
  })

  it('un doble clic hace una sola petición y generar de nuevo no vuelve a rastrear', async () => {
    const slug = `doble-clic-${runId()}`
    const page = await editorPage()
    await openSong(page, slug)
    let posts = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/songs\/[0-9a-f-]+\/pptx$/.test(req.url())) posts += 1
    })
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Generar presentación' }).dblclick()
    await download
    expect(posts).toBe(1)

    const again = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Generar presentación' }).click()
    await again
    expect(posts).toBe(2)
    expect((await apifyStubCalls()).runs.filter(q => q.includes(slug))).toHaveLength(1)
    await page.close()
  })

  it('con el reparto de respaldo se descarga igual y aparece la nota', async () => {
    const page = await editorPage()
    await openSong(page, `reparto-respaldo-${runId()}`)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Generar presentación' }).click()
    await download
    await expect.poll(() => tray(page).innerText()).toContain('Las diapositivas se agruparon automáticamente')
    await page.close()
  })

  it('un 422 del servicio muestra su motivo sin Reintentar', async () => {
    const page = await editorPage()
    await openSong(page, `demasiado-larga-${runId()}`)
    await page.getByRole('button', { name: 'Generar presentación' }).click()
    await expect.poll(() => tray(page).innerText()).toContain('Eso no parece una canción')
    expect(await tray(page).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    await page.close()
  })

  it('con el servicio dormido aparece el aviso y la generación ofrece Reintentar, que termina al despertar', async () => {
    const page = await editorPage()
    await openSong(page, `dormido-${runId()}`)
    await setCloudyStubState('asleep')
    await page.reload()
    await waitForHydration(page)
    await expect.poll(() => page.getByText('Despertando el servicio').isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Generar presentación' }).click()
    await expect.poll(() => tray(page).getByRole('button', { name: 'Reintentar' }).isVisible()).toBe(true)

    await setCloudyStubState('up')
    const download = page.waitForEvent('download')
    await tray(page).getByRole('button', { name: 'Reintentar' }).click()
    await download
    await expect.poll(() => tray(page).innerText()).toContain('diapositivas generadas')
    await page.close()
  })
})
