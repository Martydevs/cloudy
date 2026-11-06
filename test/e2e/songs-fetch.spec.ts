// T027 — US1 (feature 006, quickstart § 2): pegar un enlace de Letras.com → espera → ficha con la letra; el mismo enlace con
// parámetros o sin `www.` abre la misma canción sin rastrear; los inválidos no llegan al servidor; sin letra, sin crédito y
// run fallido muestran su mensaje; **Volver a obtener la letra** pide confirmación. Contra el stub de Apify: nunca Letras.com.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { APIFY_SCENARIOS, letrasUrl } from './setup/constants'
import { apifyStubCalls, E2E_URL, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
let session: Cookie[] | null = null

async function editorPage(viewport = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'editor', 'songs-fetch')
    session = await page.context().cookies()
  }
  return page
}

async function openIndex(page: Page) {
  await page.goto(`${E2E_URL}/canciones`)
  await waitForHydration(page)
}

async function paste(page: Page, url: string) {
  await page.getByLabel('Enlace de Letras.com').fill(url)
  await page.getByRole('button', { name: 'Ver letra' }).click()
}

const runsFor = async (fragment: string) => (await apifyStubCalls()).runs.filter(q => q.includes(fragment)).length

describe('US1 · enlace → letra', () => {
  it('pegar el enlace real lleva a la ficha con título y estrofas; repetirlo normalizado no rastrea de nuevo', async () => {
    const page = await editorPage()
    await openIndex(page)
    await paste(page, APIFY_SCENARIOS.real)
    await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
    const id = new URL(page.url()).pathname.split('/').pop()
    await expect.poll(() => page.getByRole('heading', { name: 'De Buenas (part. Josh Gamez)', level: 1 }).isVisible()).toBe(true)
    expect(await page.getByText('A veces despierto con ganas de no amanecer').isVisible()).toBe(true)
    expect(await page.getByText('Musiko', { exact: true }).first().isVisible()).toBe(true)
    expect(await runsFor('de-buenas-part-josh-gamez')).toBe(1)

    for (const variant of [`${APIFY_SCENARIOS.real}?utm_source=x`, 'https://letras.com/musiko/de-buenas-part-josh-gamez']) {
      await openIndex(page)
      await paste(page, variant)
      await page.waitForURL(url => url.pathname === `/canciones/${id}`)
    }
    expect(await runsFor('de-buenas-part-josh-gamez')).toBe(1)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM songs WHERE source_url = 'https://letras.com/musiko/de-buenas-part-josh-gamez'` as { count: number }[]
    expect(count).toBe(1)
    await page.close()
  })

  it('los enlaces inválidos se rechazan en el navegador, sin ninguna petición', async () => {
    const page = await editorPage()
    await openIndex(page)
    let posts = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/songs/fetch')) posts += 1
    })
    for (const [url, message] of [
      ['http://www.letras.com/a/b/', 'Pega un enlace que empiece con https://'],
      ['https://letras.com.evil.test/a/b/', 'Solo aceptamos enlaces de Letras.com'],
      ['https://letras.com@evil.test/a/b/', 'Solo aceptamos enlaces de Letras.com'],
      ['https://example.com', 'Solo aceptamos enlaces de Letras.com'],
      ['letra de una canción', 'Pega el enlace completo de la canción'],
      ['https://www.letras.com/musiko/', 'Ese enlace no es de una canción'],
    ] as const) {
      await paste(page, url)
      await expect.poll(() => page.getByRole('alert').innerText()).toContain(message)
    }
    expect(posts).toBe(0)
    await page.close()
  })

  it('sin letra: mensaje junto al campo, el texto se conserva y no queda canción guardada', async () => {
    const page = await editorPage()
    await openIndex(page)
    await paste(page, APIFY_SCENARIOS.noLyrics)
    await expect.poll(() => page.getByRole('alert').innerText()).toBe('No encontramos una letra en ese enlace.')
    expect(await page.getByLabel('Enlace de Letras.com').inputValue()).toBe(APIFY_SCENARIOS.noLyrics)
    expect(new URL(page.url()).pathname).toBe('/canciones')
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM songs WHERE source_url LIKE '%sin-letra%'` as { count: number }[]
    expect(count).toBe(0)
    await page.close()
  })

  it('un enlace que Letras redirige a otra canción tampoco se guarda', async () => {
    const page = await editorPage()
    await openIndex(page)
    await paste(page, APIFY_SCENARIOS.redirects)
    await expect.poll(() => page.getByRole('alert').innerText()).toBe('No encontramos una letra en ese enlace.')
    await page.close()
  })

  it.each([
    [APIFY_SCENARIOS.runFailed, 'No pudimos leer la página de la canción. Intenta de nuevo en un momento.'],
    [APIFY_SCENARIOS.noCredit, 'Se agotó el crédito del servicio de rastreo. Avisa a un administrador.'],
    [APIFY_SCENARIOS.tooLong, 'Eso no parece una canción: la letra pasa de 300 líneas.'],
  ])('%s muestra su mensaje y se puede reintentar', async (url, message) => {
    const page = await editorPage()
    await openIndex(page)
    await paste(page, url)
    await expect.poll(() => page.getByRole('alert').innerText()).toBe(message)
    expect(await page.getByRole('button', { name: 'Ver letra' }).isEnabled()).toBe(true)
    await page.close()
  })

  it('Volver a obtener la letra pide confirmación y vuelve a rastrear', async () => {
    const slug = `refrescar-${runId()}`
    const page = await editorPage()
    await openIndex(page)
    await paste(page, letrasUrl(slug))
    await page.waitForURL(url => url.pathname.startsWith('/canciones/') && url.pathname !== '/canciones')
    await expect.poll(() => page.getByText(`Coro de Refrescar ${runId()}`).isVisible()).toBe(true)
    expect(await runsFor(slug)).toBe(1)

    await page.getByRole('button', { name: 'Volver a obtener la letra' }).click()
    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.innerText()).toContain('Reemplaza la guardada si el nuevo rastreo tiene éxito.')
    await dialog.getByRole('button', { name: 'Volver a obtener' }).click()
    await expect.poll(() => page.getByText('Letra actualizada').isVisible()).toBe(true)
    expect(await runsFor(slug)).toBe(2)
    await page.close()
  })

  it('a 360 px la ficha no tiene desplazamiento horizontal', async () => {
    const page = await editorPage(viewports.phone)
    await openIndex(page)
    await paste(page, APIFY_SCENARIOS.real)
    await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
    await expect.poll(() => page.getByRole('heading', { level: 1 }).isVisible()).toBe(true)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.close()
  })
})
