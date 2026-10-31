// Feature 003 · US2 — "Abrir cámara" en las páginas de invitados, solo en teléfonos y tabletas (research B12).
// Chromium con cámara falsa: produce un patrón de video real, así que se prueba la captura completa
// (canvas → JPEG → cola → envío → Solicitudes).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { BrowserContextOptions, Cookie, Page } from 'playwright-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { E2E_URL, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({
  host: E2E_URL,
  browser: true,
  browserOptions: { type: 'chromium', launch: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
})

// Verificado al implementar (research B12): con `hasTouch` + `isMobile`, Chromium ya hace coincidir
// `(pointer: coarse)`, así que no hace falta inyectar un `matchMedia` falso.
let ipNo = 0
const PHONE: BrowserContextOptions = { viewport: viewports.phone, hasTouch: true, isMobile: true, permissions: ['camera'] }

async function phonePage({ denyCamera = false } = {}): Promise<Page> {
  const page = await createPage(undefined, PHONE)
  if (denyCamera) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permiso denegado', 'NotAllowedError'))
    })
  }
  const ip = `192.0.2.${++ipNo}`
  await page.route(url => url.origin === E2E_URL, route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }))
  return page
}

async function takePhotos(page: Page, count: number) {
  await page.getByRole('button', { name: 'Abrir cámara' }).click()
  const shutter = page.getByRole('button', { name: 'Tomar foto' })
  for (let i = 0; i < count; i++) {
    await expect.poll(() => shutter.isVisible(), { timeout: 15_000 }).toBe(true)
    await shutter.click()
    await page.getByRole('button', { name: 'Usar foto' }).click()
    // Dos fotos en el mismo segundo tendrían el mismo nombre: se espera un poco entre una y otra.
    if (i < count - 1) await page.waitForTimeout(1100)
  }
  await page.getByRole('button', { name: 'Cerrar cámara' }).click()
}

let editorCookies: Cookie[] = []
beforeAll(async () => {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  await signedInAs(page, 'editor', 'camera-editor')
  editorCookies = await page.context().cookies()
  await page.close()
})

describe('US2 · cámara dentro de Cloudy', () => {
  it('/enviar en un teléfono: dos fotos con "Abrir cámara" llegan a Solicitudes', async () => {
    const name = `Cámara ${runId()}`
    const page = await phonePage()
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const response = await page.goto(`${E2E_URL}/enviar`)
    expect(response?.headers()['permissions-policy']).toContain('camera=(self)')
    await waitForHydration(page)
    await page.getByLabel('Tu nombre').fill(name)

    const openedAt = Date.now()
    await takePhotos(page, 2)
    await expect.poll(() => page.getByText(/^foto-\d{8}-\d{6}\.jpg$/).count()).toBe(2)
    // SC-007: de "Abrir cámara" a las fotos en la cola, en menos de 15 s por foto.
    expect(Date.now() - openedAt).toBeLessThan(30_000)

    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => page.getByText('¡Gracias! Recibimos tu envío').isVisible(), { timeout: 60_000 }).toBe(true)
    await page.close()

    const rows = await testSql()`
      SELECT f.original_name, f.mime_type FROM guest_submission_files f JOIN guest_submissions s ON s.id = f.submission_id
      WHERE s.sender_name = ${name} AND f.upload_status = 'ready'
    `
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toMatchObject({ mime_type: 'image/jpeg', original_name: expect.stringMatching(/^foto-\d{8}-\d{6}\.jpg$/) })

    const editor = await createPage(undefined, { viewport: viewports.desktop })
    await editor.context().addCookies(editorCookies)
    await editor.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(editor)
    await expect.poll(() => editor.getByRole('article', { name: `Envío de ${name}` }).isVisible()).toBe(true)
    await editor.close()
  })

  it('/upload aprobado en un teléfono: la foto se envía con permiso', async () => {
    const name = `Cámara permiso ${runId()}`
    const page = await phonePage()
    const response = await page.goto(`${E2E_URL}/upload`)
    expect(response?.headers()['permissions-policy']).toContain('camera=(self)')
    await waitForHydration(page)
    await page.getByLabel('Tu nombre').fill(name)
    await page.getByRole('button', { name: 'Pedir acceso' }).click()
    await expect.poll(async () => {
      const [row] = await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${name}`
      return row?.id ?? null
    }).not.toBeNull()

    const editor = await createPage(undefined, { viewport: viewports.desktop })
    await editor.context().addCookies(editorCookies)
    const [request] = await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${name}`
    expect((await editor.request.post(`${E2E_URL}/api/access-requests/${request!.id}/approve`)).status()).toBe(204)

    await expect.poll(() => page.getByRole('button', { name: 'Abrir cámara' }).isVisible(), { timeout: 10_000 }).toBe(true)
    await takePhotos(page, 1)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => page.getByText('¡Gracias! Recibimos tu envío').first().isVisible(), { timeout: 60_000 }).toBe(true)
    expect(await testSql()`SELECT origin FROM guest_submissions WHERE sender_name = ${name}`).toEqual([{ origin: 'permission' }])
    await page.close()
    await editor.close()
  })

  it('permiso denegado: lo explica y "Elegir archivos" sigue funcionando', async () => {
    const page = await phonePage({ denyCamera: true })
    await page.goto(`${E2E_URL}/enviar`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Abrir cámara' }).click()
    await expect.poll(() => page.getByRole('alert').first().innerText()).toContain('Cloudy no tiene permiso para usar la cámara')
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await page.getByLabel('Elegir archivos', { exact: true }).setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]) })
    await expect.poll(() => page.getByText('foto.jpg').isVisible()).toBe(true)
    await page.close()
  })

  it.each([
    ['360 px', viewports.phone],
    ['1280 px', viewports.desktop],
  ])('en una computadora (%s, sin táctil) no aparece "Abrir cámara"', async (_, viewport) => {
    const page = await createPage(undefined, { viewport, permissions: ['camera'] })
    for (const path of ['/enviar', '/upload']) {
      await page.goto(`${E2E_URL}${path}`)
      await waitForHydration(page)
      // Se da tiempo a que la disponibilidad se resuelva en el cliente.
      await page.waitForTimeout(500)
      expect(await page.getByRole('button', { name: 'Abrir cámara' }).count(), path).toBe(0)
    }
    // En /upload, ni siquiera con el acceso aprobado.
    const name = `Escritorio ${runId()}-${viewport.width}`
    await page.getByLabel('Tu nombre').fill(name)
    await page.getByRole('button', { name: 'Pedir acceso' }).click()
    await expect.poll(async () => (await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${name}`).length).toBe(1)
    const [request] = await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${name}`
    const editor = await createPage(undefined, { viewport: viewports.desktop })
    await editor.context().addCookies(editorCookies)
    expect((await editor.request.post(`${E2E_URL}/api/access-requests/${request!.id}/approve`)).status()).toBe(204)
    await editor.close()
    await expect.poll(() => page.getByLabel('Elegir archivos', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    expect(await page.getByRole('button', { name: 'Abrir cámara' }).count()).toBe(0)
    await page.close()
  })
})
