// T033 / T051 / T066 / T077 — Página Peticiones (feature 007, quickstart § 3; feature 008): tarjetas de peticiones
// aprobadas, selección, generación de imágenes contra el stub de OpenRouter (guardadas en el historial, enmienda de
// historial) y filtros. Los datos se siembran en la rama de pruebas con `seedPrayerRequest`; las aprobaciones de esta corrida
// son las más recientes (otros archivos e2e corren antes, uno a la vez), así que salen primero en la rejilla. «Generar
// imágenes» abre la revisión del texto de cada petición (US5): el modelo de lectura recibe la foto (URL firmada) y el de
// imágenes, la plantilla y los textos verificados.
import { randomUUID } from 'node:crypto'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PRAYER_ERROR_MESSAGES } from '../../shared/constants/prayers'
import { E2E_URL, fixture, prayerCalls, profileUserId, resetStub, runId, seedPrayerRequest, seedPrayerTranscript, setStubMode, signedInAs, testSql, transcriptCalls, viewports, waitForHydration } from './setup/fixtures'
import type { Credentials, PrayerSeed } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null
let editor: Credentials
let owner: string

async function editorPage(viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    editor = await signedInAs(page, 'editor', 'peticiones')
    session = await page.context().cookies()
  }
  return page
}

async function openPage(page: Page) {
  await page.goto(`${E2E_URL}/peticiones`)
  await waitForHydration(page)
  await expect.poll(() => page.getByRole('list', { name: 'Peticiones aprobadas' }).isVisible()).toBe(true)
}

/** Recorre la fila (horizontal) hasta la última tarjeta cargada, como quien desliza; su centinela va justo después. */
async function scrollToGridEnd(page: Page) {
  await page.getByRole('list', { name: 'Peticiones aprobadas' }).getByRole('listitem').last().scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 300)
}

const card = (page: Page, sender: string) => page.getByRole('article', { name: `Petición de ${sender}`, exact: true })
const box = (page: Page, sender: string) => page.getByRole('checkbox', { name: `Elegir la petición de ${sender}`, exact: true })
const bar = (page: Page) => page.getByRole('region', { name: 'Selección de peticiones' })

/** Siembra en orden: el primero queda como el aprobado más reciente. */
async function seedMany(prefix: string, count: number, extra: PrayerSeed = {}): Promise<string[]> {
  const names: string[] = []
  const base = Date.now()
  for (let i = 0; i < count; i++) {
    const senderName = `${prefix} ${String(i + 1).padStart(2, '0')} ${runId()}`
    await seedPrayerRequest(owner, { senderName, reviewedAt: new Date(base - i * 1000), ...extra })
    names.push(senderName)
  }
  return names
}

/**
 * Siembra `count` peticiones y devuelve nombre e id de archivo; la primera queda como la aprobada más reciente (sale primero
 * en la rejilla y última en las imágenes).
 */
async function seedRequests(prefix: string, count: number, extra: PrayerSeed = {}): Promise<{ name: string, fileId: string }[]> {
  const base = Date.now()
  const seeded: { name: string, fileId: string }[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix} ${String(i + 1).padStart(2, '0')} ${runId()}`
    const { fileId } = await seedPrayerRequest(owner, { senderName: name, reviewedAt: new Date(base - i * 1000), ...extra })
    seeded.push({ name, fileId })
  }
  return seeded
}

beforeAll(async () => {
  const page = await editorPage()
  owner = await profileUserId(editor.email)
  await page.close()
})

describe('US1 · ver las peticiones y elegir cuáles proyectar', () => {
  it('solo aparecen las aprobadas, con foto, nombre, fechas y nota', async () => {
    // Nombres propios de este archivo: la cola de Solicitudes es compartida y `guest-queue.spec.ts` usa «Rechazada <runId>».
    const hidden = {
      pending: `Petición por revisar ${runId()}`,
      rejected: `Petición rechazada ${runId()}`,
      trashed: `Petición en papelera ${runId()}`,
    }
    await seedPrayerRequest(owner, { senderName: hidden.pending, status: 'pending' })
    await seedPrayerRequest(owner, { senderName: hidden.rejected, status: 'rejected' })
    await seedPrayerRequest(owner, { senderName: hidden.trashed, deleted: true })
    const [shown] = await seedMany('Visible', 1, { note: 'para el domingo' })

    const page = await editorPage()
    await openPage(page)
    const visible = card(page, shown!)
    await expect.poll(() => visible.isVisible()).toBe(true)
    const text = await visible.innerText()
    expect(text).toContain(shown!)
    expect(text).toMatch(/Aprobada hace/)
    expect(text).toContain('Enviada el')
    expect(text).toContain('para el domingo')
    await visible.scrollIntoViewIfNeeded()
    await expect.poll(() => visible.getByRole('img').getAttribute('src')).toMatch(/\/api\/files\/[0-9a-f-]+\/content$/)
    for (const name of Object.values(hidden)) expect(await card(page, name).count()).toBe(0)
    await page.close()
  })

  it('marcar con clic en la tarjeta, en la casilla y con Espacio; desmarcar; Abrir foto no cambia la selección', async () => {
    const names = await seedMany('Elegir', 4)
    const page = await editorPage()
    await openPage(page)

    // Toda la tarjeta es objetivo de la casilla.
    await card(page, names[0]!).click({ position: { x: 40, y: 40 } })
    await box(page, names[1]!).check()
    await box(page, names[2]!).focus()
    await page.keyboard.press('Space')
    await expect.poll(() => bar(page).innerText()).toContain('3 peticiones → 1 imagen')
    expect(await box(page, names[2]!).isChecked()).toBe(true)

    await box(page, names[1]!).uncheck()
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      card(page, names[3]!).getByRole('link', { name: 'Abrir foto' }).click(),
    ])
    await popup.close()
    expect(await box(page, names[3]!).isChecked()).toBe(false)
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')
    expect(await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).isEnabled()).toBe(true)
    await page.close()
  })

  it('cualquier petición aprobada se puede marcar: su texto se lee y se revisa después, al generar', async () => {
    const [name] = await seedMany('Marcable', 1)
    const page = await editorPage()
    await openPage(page)
    // Ya no hay transcripción: ninguna tarjeta queda bloqueada ni muestra el estado de la lectura automática.
    expect(await box(page, name!).isDisabled()).toBe(false)
    expect(await card(page, name!).innerText()).not.toMatch(/sin texto|no se pudo leer|ilegible/i)
    await page.close()
  })

  it('con 14 nuevas se cargan 12 y al desplazarse el resto, sin duplicados, conservando la selección', async () => {
    const names = await seedMany('Scroll', 14)
    const page = await editorPage()
    await openPage(page)
    const cards = page.getByRole('list', { name: 'Peticiones aprobadas' }).getByRole('article')
    expect(await cards.count()).toBe(12)
    await box(page, names[0]!).check()
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')

    // Hasta el aviso de fin (detrás de las de esta corrida pueden venir las aprobadas por otros archivos e2e). La fila es
    // una sola y horizontal: se recorre hasta la última tarjeta, no hasta el fondo de la página.
    await expect.poll(async () => {
      await scrollToGridEnd(page)
      return page.getByText('Ya viste todas las peticiones').isVisible()
    }, { timeout: 60_000 }).toBe(true)
    for (const name of names) expect(await card(page, name).count(), name).toBe(1)
    expect(await box(page, names[0]!).isChecked()).toBe(true)
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')
    await page.close()
  })

  it('Copiar enlace para invitados confirma con un aviso', async () => {
    const page = await editorPage()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URL })
    await openPage(page)
    await page.getByRole('button', { name: 'Copiar enlace para invitados' }).first().click()
    await expect.poll(() => page.getByText('Enlace para invitados copiado').isVisible()).toBe(true)
    await page.close()
  })

  it('a 360 px no hay scroll horizontal', async () => {
    await seedMany('Movil', 2, { note: 'Una nota larga para comprobar que el texto se ajusta sin desbordar la tarjeta en un teléfono pequeño' })
    const page = await editorPage(viewports.phone)
    await openPage(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})

describe('US2 · generar las imágenes de peticiones del día', () => {
  const history = (page: Page) => page.getByRole('list', { name: 'Imágenes generadas', exact: true })
  /** La tarjeta del historial de una imagen guardada (por su enlace de descarga). */
  const saved = (page: Page, id: string) => history(page).getByRole('listitem').filter({ has: page.locator(`a[href="/api/peticiones/imagenes/${id}/content?download=1"]`) })
  const review = (page: Page) => page.getByRole('dialog', { name: 'Revisa el texto de las peticiones' })
  /** Miniatura de una imagen en la página de la generación, con su estado en el nombre accesible. */
  const thumb = (page: Page, n: number, state: string) => page.getByRole('button', { name: `Ver la imagen ${n}, ${state}`, exact: true })
  const onGenerationPage = (page: Page) => page.waitForURL(url => url.pathname.startsWith('/peticiones/generaciones/'))

  /** Ids de las imágenes que el servidor guardó (respuestas 201 de `POST /api/peticiones/imagenes`), en orden de llegada. */
  function trackSaved(page: Page): { id: string, fileIds: string[], createdAt: string }[] {
    const ids: { id: string, fileIds: string[], createdAt: string }[] = []
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/peticiones/imagenes' || response.status() !== 201) return
      ids.push(await response.json())
    })
    return ids
  }

  /**
   * Deja verificado el texto de cada petición («Oración N», con N su posición al sembrarla: sin lecturas del modelo), las
   * elige y abre la revisión, donde ya aparecen todas verificadas.
   */
  async function reviewVerified(page: Page, requests: { name: string, fileId: string }[], texts: string[] = requests.map((_, i) => `Oración ${i + 1}`)) {
    for (const [i, request] of requests.entries()) await seedPrayerTranscript(request.fileId, owner, { text: texts[i]! })
    for (const { name } of requests) await box(page, name).check()
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => review(page).getByRole('button', { name: 'Generar imágenes', exact: true }).isEnabled(), { timeout: 15_000 }).toBe(true)
  }

  /** Revisión ya verificada → «Generar imágenes» del diálogo: crea la generación y lleva a su página. */
  async function generate(page: Page, requests: { name: string, fileId: string }[], texts?: string[]) {
    await reviewVerified(page, requests, texts)
    await review(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await onGenerationPage(page)
  }

  beforeEach(async () => {
    await resetStub()
  })

  it('5 → 2 imágenes: la plantilla y los textos verificados (sin fotos, nombres ni notas) viajan al stub; se ven en la página de la generación, quedan en el historial, sobreviven a una recarga, se descargan y se amplían', async () => {
    const seeded = await seedRequests('Generar', 5, { note: `Nota privada ${runId()}` })
    const fileIds = seeded.map(s => s.fileId)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, seeded)

    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => page.getByText('2 de 2 listas').isVisible(), { timeout: 15_000 }).toBe(true)
    for (const n of [1, 2]) await expect.poll(() => thumb(page, n, 'lista').isVisible()).toBe(true)

    const calls = await prayerCalls()
    expect(calls).toHaveLength(2)
    // Orden de aprobación: la más antigua (la última sembrada) abre la primera imagen.
    const byTexts = [...calls].sort((a, b) => b.texts.length - a.texts.length)
    expect(byTexts.map(c => c.texts)).toEqual([['Oración 5', 'Oración 4', 'Oración 3', 'Oración 2'], ['Oración 1']])
    for (const call of calls) {
      expect(call).toMatchObject({ model: '@preset/pray-requests-image-generation', template: true, status: 200 })
      expect(call.modalities).toContain('image')
      // Al modelo de imágenes ya no le llega ninguna foto de invitado.
      expect(call.photos).toEqual([])
      for (const { name } of seeded) expect(call.prompt).not.toContain(name)
      expect(call.prompt).not.toContain('Nota privada')
      for (const id of fileIds) expect(call.prompt).not.toContain(id)
    }
    // Ninguna lectura: los textos ya estaban guardados y verificados.
    expect(await transcriptCalls()).toHaveLength(0)
    // La fila guarda los ids de sus peticiones.
    const four = ids.find(i => i.fileIds.length === 4)!
    const one = ids.find(i => i.fileIds.length === 1)!
    expect(one.fileIds).toEqual([seeded[0]!.fileId])

    // De vuelta en Peticiones (una carga nueva), las dos están en el historial.
    await openPage(page)
    await page.locator('#historial').scrollIntoViewIfNeeded()
    for (const { id } of ids) await expect.poll(() => saved(page, id).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await saved(page, four.id).innerText()).toContain('4 peticiones')

    // Descargar: enlace con el nombre `peticiones-AAAA-MM-DD-<6 del id>.png` (fecha UTC).
    const download = page.waitForEvent('download')
    await saved(page, one.id).getByRole('link', { name: 'Descargar' }).click()
    expect((await download).suggestedFilename()).toBe(`peticiones-${one.createdAt.slice(0, 10)}-${one.id.slice(0, 6)}.png`)

    await saved(page, one.id).getByRole('button', { name: 'Ver en grande' }).click()
    const preview = page.getByRole('dialog', { name: /^Imagen de peticiones con 1 petición/ })
    await expect.poll(() => preview.getByRole('img').getAttribute('src')).toBe(`/api/peticiones/imagenes/${one.id}/content`)
    await preview.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect.poll(() => preview.isVisible()).toBe(false)

    // El menú del historial no ofrece **Generar de nuevo**.
    await saved(page, one.id).getByRole('button', { name: 'Opciones de la imagen' }).click()
    expect(await page.getByRole('menuitem', { name: 'Generar de nuevo' }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.close()
  })

  it('una sola petición: una imagen con la plantilla y su texto', async () => {
    const [request] = await seedRequests('Una sola', 1)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [request!], ['Por mi familia\ny mi trabajo'])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    const [call] = await prayerCalls()
    expect(call).toMatchObject({ template: true, photos: [], texts: ['Por mi familia\ny mi trabajo'], status: 200 })
    // La plantilla viaja como URL firmada de su copia en el bucket (sin base64) y la salida va acotada.
    expect(call).toMatchObject({ templateKind: 'url', imageConfig: { aspect_ratio: '16:9', image_size: '1K' } })
    await page.close()
  })

  it('un fallo del servicio muestra el motivo y Reintentar solo en esa imagen; la otra se guarda', async () => {
    // La más antigua (última) cae en la imagen 1 junto con otras tres; la más reciente sola en la 2.
    const seeded = await seedRequests('Falla', 5)
    await setStubMode({ scenario: 'falla-una-vez', match: 'Oración 5' })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, seeded)

    await expect.poll(() => thumb(page, 1, 'no se pudo generar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.getByRole('alert').filter({ hasText: PRAYER_ERROR_MESSAGES.provider }).isVisible()).toBe(true)
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    expect(ids[0]!.fileIds).toEqual([seeded[0]!.fileId])
    await expect.poll(() => thumb(page, 2, 'lista').isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => page.getByText('2 de 2 listas').isVisible()).toBe(true)
    await page.close()
  })

  it('sin crédito: el motivo sin Reintentar y nada se guarda', async () => {
    const [request] = await seedRequests('Sin credito', 1)
    await setStubMode({ scenario: 'sin-credito' })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [request!])
    await expect.poll(() => thumb(page, 1, 'no se pudo generar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.getByRole('alert').filter({ hasText: PRAYER_ERROR_MESSAGES.quota_exceeded }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Reintentar', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Descartar', exact: true }).isVisible()).toBe(true)
    expect(ids).toHaveLength(0)
    await page.close()
  })

  // Regresión: con una clave borrada, OpenRouter responde 401 «User not found.» y la página mostraba un 502 reintentable.
  it('clave rechazada por OpenRouter: «no está configurada», sin Reintentar, y una sola llamada', async () => {
    const [request] = await seedRequests('Clave rechazada', 1)
    await setStubMode({ scenario: 'clave-rechazada' })
    const page = await editorPage()
    const statuses: number[] = []
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/peticiones/imagenes') statuses.push(response.status())
    })
    await openPage(page)
    await generate(page, [request!])
    await expect.poll(() => thumb(page, 1, 'no se pudo generar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.getByRole('alert').filter({ hasText: PRAYER_ERROR_MESSAGES.not_configured }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Reintentar', exact: true }).count()).toBe(0)
    expect(statuses).toEqual([503])
    // Un 401 no se reintenta.
    expect((await prayerCalls()).map(call => call.status)).toEqual([401])
    await page.close()
  })

  it('el servicio no devuelve imagen: el motivo con Reintentar', async () => {
    const [request] = await seedRequests('Sin imagen', 1)
    await setStubMode({ scenario: 'sin-imagen' })
    const page = await editorPage()
    await openPage(page)
    await generate(page, [request!])
    await expect.poll(() => thumb(page, 1, 'no se pudo generar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.getByRole('alert').filter({ hasText: PRAYER_ERROR_MESSAGES.invalid_output }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Reintentar', exact: true }).isVisible()).toBe(true)
    await page.close()
  })

  it('una petición enviada a la papelera con la revisión abierta → 409: sale de la selección y de la revisión, se avisa y nada llega al modelo', async () => {
    const [kept, trashed] = await seedRequests('Papelera', 2)
    const page = await editorPage()
    await openPage(page)
    await reviewVerified(page, [kept!, trashed!])
    // Otra persona la envía a la papelera mientras tanto (rama de pruebas, como `seedPrayerRequest({ deleted: true })`).
    await testSql()`UPDATE files SET deleted_at = now(), deleted_by = ${owner}, trash_root_id = id WHERE id = ${trashed!.fileId}`

    await review(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => page.getByText('Quitamos 1 petición que ya no está disponible').isVisible(), { timeout: 30_000 }).toBe(true)
    // La revisión sigue abierta solo con la que queda; nada se generó ni se navegó.
    await expect.poll(() => review(page).getByRole('button', { name: `Petición de ${trashed!.name}: verificada`, exact: true }).count()).toBe(0)
    expect(await review(page).getByRole('button', { name: `Petición de ${kept!.name}: verificada`, exact: true }).isVisible()).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/peticiones')
    expect(await prayerCalls()).toHaveLength(0)
    await page.close()
  })

  it('salir con una imagen generándose pide confirmación; una ya guardada no', async () => {
    const [slow, quick] = await seedRequests('Salir', 2)
    await setStubMode({ scenario: 'lento', match: 'Petición lenta' })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)

    const leave = () => page.evaluate(() => {
      const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } } }).__vue_app__
      void app.config.globalProperties.$router.push('/')
    })
    const dialog = page.getByRole('dialog', { name: '¿Salir de Peticiones?' })

    // Guardada: salir de la página de la generación no pregunta (se vuelve a Peticiones para la segunda parte).
    await generate(page, [quick!], ['Petición rápida'])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    await leave()
    await page.waitForURL(url => url.pathname === '/')
    expect(await dialog.count()).toBe(0)
    await openPage(page)

    // Generándose (el stub tarda con «lento»): pregunta; Cancelar se queda.
    await generate(page, [slow!], ['Petición lenta'])
    await expect.poll(() => thumb(page, 1, 'generándose').isVisible()).toBe(true)
    await leave()
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    expect(new URL(page.url()).pathname).toMatch(/^\/peticiones\/generaciones\//)

    await leave()
    await dialog.getByRole('button', { name: 'Salir' }).click()
    await page.waitForURL(url => url.pathname === '/')
    // Si la llamada lenta llegó al stub antes de cancelarse, el stub la registra al terminar su espera (4 s): se deja pasar
    // ese plazo para que no se cuele en las cuentas de la prueba siguiente.
    await page.waitForTimeout(5_000)
    await page.close()
  })

  it('con la red cortada no se crea la generación: se avisa, la revisión sigue abierta y al volver la red se genera', async () => {
    const [request] = await seedRequests('Sin red', 1)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await reviewVerified(page, [request!])
    await page.context().setOffline(true)
    await review(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => page.getByText('No pudimos preparar la generación. Inténtalo de nuevo.').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await review(page).isVisible()).toBe(true)
    expect(await box(page, request!.name).isChecked()).toBe(true)

    await page.context().setOffline(false)
    await review(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await onGenerationPage(page)
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    await page.close()
  })
})

describe('US4 · buscar, filtrar por fecha y ordenar', () => {
  const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Buscar por nombre o nota' })
  const preset = (page: Page, label: string) => page.getByRole('group', { name: 'Fecha de aprobación' }).getByRole('button', { name: label, exact: true })
  const visibleNames = (page: Page) => page.getByRole('list', { name: 'Peticiones aprobadas' }).getByRole('heading', { level: 3 }).allInnerTexts()

  /** `AAAA-MM-DD` local de `date`. */
  const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const localMidnight = (daysAgo: number) => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)
  }

  async function search(page: Page, text: string) {
    await searchBox(page).fill(text)
    await expect.poll(() => page.getByRole('search').getByRole('status').innerText()).toContain(text)
  }

  it('la búsqueda no distingue tildes y cubre el nombre y la nota', async () => {
    const token = `tk${runId()}`
    const [withAccent] = await seedRequests('Busqueda', 1, { note: `Una oración especial ${token}` })
    const [named] = await seedRequests(`Lucía ${token}`, 1, { note: `Otra cosa ${token}` })
    const page = await editorPage()
    await openPage(page)

    await search(page, `oracion especial ${token}`)
    await expect.poll(() => visibleNames(page)).toEqual([withAccent!.name])

    await search(page, `lucia ${token}`)
    await expect.poll(() => visibleNames(page)).toEqual([named!.name])

    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click()
    await expect.poll(async () => (await visibleNames(page)).length).toBeGreaterThan(1)
    await page.close()
  })

  it('Hoy incluye una enviada ayer y aprobada hoy y excluye una aprobada ayer; Rango filtra por aprobación', async () => {
    const token = `fecha${runId()}`
    await seedPrayerRequest(owner, { senderName: `Hoy ${token}`, sentAt: new Date(localMidnight(1).getTime() + 12 * 3_600_000), reviewedAt: new Date() })
    await seedPrayerRequest(owner, { senderName: `Ayer ${token}`, reviewedAt: new Date(localMidnight(0).getTime() - 3_600_000) })
    await seedPrayerRequest(owner, { senderName: `Hace diez ${token}`, reviewedAt: new Date(localMidnight(10).getTime() + 12 * 3_600_000) })
    await seedPrayerRequest(owner, { senderName: `Hace veinte ${token}`, reviewedAt: new Date(localMidnight(20).getTime() + 12 * 3_600_000) })
    const page = await editorPage()
    await openPage(page)
    await search(page, token)
    await expect.poll(async () => (await visibleNames(page)).length).toBe(4)

    await preset(page, 'Hoy').click()
    await expect.poll(() => visibleNames(page)).toEqual([`Hoy ${token}`])
    expect(await page.getByRole('search').getByRole('status').innerText()).toContain('Aprobadas hoy')

    await preset(page, '7 días').click()
    await expect.poll(() => visibleNames(page)).toEqual([`Hoy ${token}`, `Ayer ${token}`])

    await preset(page, 'Rango').click()
    await page.getByLabel('Desde').fill(ymd(localMidnight(12)))
    await page.getByLabel('Hasta').fill(ymd(localMidnight(8)))
    await expect.poll(() => visibleNames(page)).toEqual([`Hace diez ${token}`])
    await page.close()
  })

  it('Más antiguas primero recorre la lista sin repetir ni omitir; cambiar filtros no cambia la selección; sin coincidencias → Quitar filtros', async () => {
    const token = `orden${runId()}`
    const seeded = await seedRequests(`Orden ${token}`, 14)
    const names = seeded.map(s => s.name)
    const page = await editorPage()
    await openPage(page)
    await search(page, token)
    await expect.poll(async () => (await visibleNames(page)).length).toBe(12)
    // Elige la más reciente (primera en el orden por defecto).
    await box(page, names[0]!).check()
    await box(page, names[1]!).check()
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    await page.getByRole('combobox', { name: 'Orden' }).selectOption('asc')
    await expect.poll(async () => (await visibleNames(page))[0]).toBe(names[13])
    await expect.poll(async () => {
      await scrollToGridEnd(page)
      return page.getByText('Ya viste todas las peticiones').isVisible()
    }, { timeout: 60_000 }).toBe(true)
    expect(await visibleNames(page)).toEqual([...names].reverse())
    expect(await bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    await search(page, `nadie-${token}`)
    await expect.poll(() => page.getByText('No hay peticiones con esos filtros').isVisible()).toBe(true)
    expect(await bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    await page.getByRole('button', { name: 'Quitar filtros' }).last().click()
    await expect.poll(() => page.getByText('No hay peticiones con esos filtros').isVisible()).toBe(false)
    expect(await searchBox(page).inputValue()).toBe('')
    await expect.poll(async () => (await visibleNames(page)).length).toBe(12)
    expect(await bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    // Las elegidas se generan aunque el filtro las oculte: la revisión las trae de la selección y el modelo recibe su texto verificado.
    await search(page, `nadie-${token}`)
    await expect.poll(() => page.getByText('No hay peticiones con esos filtros').isVisible()).toBe(true)
    await resetStub()
    const texts = [`Texto uno ${token}`, `Texto dos ${token}`]
    await seedPrayerTranscript(seeded[0]!.fileId, owner, { text: texts[0]! })
    await seedPrayerTranscript(seeded[1]!.fileId, owner, { text: texts[1]! })
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Revisa el texto de las peticiones' })
    const generate = dialog.getByRole('button', { name: 'Generar imágenes', exact: true })
    await expect.poll(() => generate.isEnabled(), { timeout: 15_000 }).toBe(true)
    await generate.click()
    await page.waitForURL(url => url.pathname.startsWith('/peticiones/generaciones/'))
    await expect.poll(async () => (await prayerCalls()).length, { timeout: 30_000 }).toBe(1)
    const [call] = await prayerCalls()
    expect(call!.photos).toHaveLength(0)
    expect([...call!.texts].sort()).toEqual([...texts].sort())
    await page.close()
  })

  it('a 360 px los filtros caben sin scroll horizontal', async () => {
    const page = await editorPage(viewports.phone)
    await openPage(page)
    await preset(page, 'Rango').click()
    await expect.poll(() => page.getByLabel('Desde').isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})

describe('US5 · revisar el texto de cada petición antes de generar', () => {
  const review = (page: Page) => page.getByRole('dialog', { name: 'Revisa el texto de las peticiones' })
  /** La tarjeta de una petición en el diálogo, por su nombre accesible: a quién pertenece y en qué estado está. */
  const reviewCard = (page: Page, sender: string, state: string) => review(page).getByRole('button', { name: `Petición de ${sender}: ${state}`, exact: true })
  const verifiedBox = (page: Page, sender: string) => review(page).getByRole('checkbox', { name: `Verificada: petición de ${sender}`, exact: true })
  const text = (page: Page) => review(page).getByLabel('Texto de la petición')
  const generateButton = (page: Page) => review(page).getByRole('button', { name: 'Generar imágenes', exact: true })

  /** Elige las tarjetas y pulsa «Generar imágenes» de la barra: abre la revisión, todavía sin crear nada. */
  async function openReview(page: Page, names: string[]) {
    for (const name of names) await box(page, name).check()
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => review(page).isVisible()).toBe(true)
  }

  beforeEach(async () => {
    await resetStub()
  })

  it('invitado aprobado → elegir → revisión: lee las fotos en orden, se corrige y verifica cada texto, genera con el texto verificado (sin fotos) y lleva a la generación; lo guardado se comparte y no se vuelve a leer', async () => {
    // La primera sembrada es la aprobada más reciente: en las imágenes va la última.
    const seeded = await seedRequests('Revisar', 3, { note: `Nota privada ${runId()}` })
    const inImageOrder = [...seeded].reverse()
    // Con un pequeño retraso se ve que las fotos se leen de una en una.
    await setStubMode({ transcriptDelayMs: 400 })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, seeded.map(s => s.name))

    // Mientras lee, generar está deshabilitado y dice por qué.
    expect(await generateButton(page).isDisabled()).toBe(true)
    for (const { name } of seeded) await expect.poll(() => reviewCard(page, name, 'sin verificar').isVisible(), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => review(page).getByText('Falta verificar 3 peticiones para generar.').isVisible()).toBe(true)

    // Una llamada por foto, en el orden de las imágenes, solo con la foto (URL firmada) y la instrucción.
    const reads = await transcriptCalls()
    expect(reads.map(call => inImageOrder.findIndex(s => call.photo?.includes(s.fileId)))).toEqual([0, 1, 2])
    for (const call of reads) {
      expect(call).toMatchObject({ model: '@preset/pray-requests-transcription', images: 1, structured: true, status: 200 })
      expect(call.photo).toMatch(/^https:\/\/.+X-Amz-Signature=/)
      for (const { name, fileId } of seeded) {
        expect(call.prompt).not.toContain(name)
        expect(call.prompt).not.toContain(fileId)
      }
      expect(call.prompt).not.toContain('Nota privada')
    }
    // Nada se generó ni se creó todavía.
    expect(await prayerCalls()).toHaveLength(0)

    // La primera queda activa: se corrige y se guarda (queda verificada). Su foto está oculta hasta pedirla.
    expect(await text(page).inputValue()).toBe('Texto leído 1')
    expect(await review(page).getByRole('button', { name: 'Ver imagen', exact: true }).getAttribute('aria-expanded')).toBe('false')
    expect(await review(page).getByRole('img', { name: `Foto de la petición de ${inImageOrder[0]!.name}` }).count()).toBe(0)
    expect(await review(page).getByRole('link', { name: 'Abrir foto' }).count()).toBe(0)
    await text(page).fill('Por la salud de mi mamá\ny de mi abuela')
    await review(page).getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    await expect.poll(() => reviewCard(page, inImageOrder[0]!.name, 'verificada').isVisible()).toBe(true)
    expect(await verifiedBox(page, inImageOrder[0]!.name).isChecked()).toBe(true)

    // La segunda estaba bien: se marca a mano, sin tocar el texto. La casilla refleja al servidor (vuelve atrás hasta que
    // responde), así que se pulsa con `click` y se espera el estado, en vez de `check`, que exige el cambio al instante.
    await verifiedBox(page, inImageOrder[1]!.name).click()
    await expect.poll(() => reviewCard(page, inImageOrder[1]!.name, 'verificada').isVisible()).toBe(true)
    expect(await generateButton(page).isDisabled()).toBe(true)
    await expect.poll(() => review(page).getByText('Falta verificar 1 petición para generar.').isVisible()).toBe(true)

    // La tercera: se abre su tarjeta, se pide su foto con «Ver imagen» para comparar y se verifica.
    await reviewCard(page, inImageOrder[2]!.name, 'sin verificar').click()
    await expect.poll(() => text(page).inputValue()).toBe('Texto leído 3')
    await review(page).getByRole('button', { name: 'Ver imagen', exact: true }).click()
    await expect.poll(() => review(page).getByRole('img', { name: `Foto de la petición de ${inImageOrder[2]!.name}` }).isVisible()).toBe(true)
    expect(await review(page).getByRole('button', { name: 'Ocultar imagen', exact: true }).getAttribute('aria-expanded')).toBe('true')
    expect(await review(page).getByRole('link', { name: 'Abrir foto' }).isVisible()).toBe(true)
    // La foto sigue a la vista al volver a otra tarjeta.
    await reviewCard(page, inImageOrder[0]!.name, 'verificada').click()
    await expect.poll(() => review(page).getByRole('img', { name: `Foto de la petición de ${inImageOrder[0]!.name}` }).isVisible()).toBe(true)
    await reviewCard(page, inImageOrder[2]!.name, 'sin verificar').click()
    await expect.poll(() => text(page).inputValue()).toBe('Texto leído 3')
    await verifiedBox(page, inImageOrder[2]!.name).click()
    await expect.poll(() => generateButton(page).isEnabled()).toBe(true)
    await expect.poll(() => review(page).getByText('Todo verificado: saldrá 1 imagen.').isVisible()).toBe(true)

    // Generar: crea la generación, lleva a su página y el modelo recibe la plantilla y los textos verificados, sin fotos.
    await generateButton(page).click()
    await page.waitForURL(url => url.pathname.startsWith('/peticiones/generaciones/'))
    await expect.poll(async () => (await prayerCalls()).length, { timeout: 30_000 }).toBe(1)
    const [call] = await prayerCalls()
    expect(call).toMatchObject({ model: '@preset/pray-requests-image-generation', template: true, photos: [], status: 200 })
    expect(call!.texts).toEqual(['Por la salud de mi mamá\ny de mi abuela', 'Texto leído 2', 'Texto leído 3'])
    for (const { name, fileId } of seeded) {
      expect(call!.prompt).not.toContain(name)
      expect(call!.prompt).not.toContain(fileId)
    }
    expect(call!.prompt).not.toContain('Nota privada')
    await expect.poll(() => page.getByText('1 de 1 lista').isVisible(), { timeout: 30_000 }).toBe(true)

    // De vuelta en Peticiones (y tras recargar), los textos siguen guardados y verificados: no se vuelve a leer nada.
    await openPage(page)
    await openReview(page, seeded.map(s => s.name))
    for (const { name } of seeded) await expect.poll(() => reviewCard(page, name, 'verificada').isVisible(), { timeout: 15_000 }).toBe(true)
    expect(await text(page).inputValue()).toBe('Por la salud de mi mamá\ny de mi abuela')
    expect(await transcriptCalls()).toHaveLength(3)
    await page.close()
  })

  it('cerrar la revisión conserva la selección y no genera nada; el diálogo cabe a 360 px sin scroll horizontal', async () => {
    const seeded = await seedRequests('Cerrar', 2)
    const page = await editorPage(viewports.phone)
    await openPage(page)
    await openReview(page, seeded.map(s => s.name))
    for (const { name } of seeded) await expect.poll(() => reviewCard(page, name, 'sin verificar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // Los controles táctiles miden al menos 44 px.
    const photoToggle = review(page).getByRole('button', { name: 'Ver imagen', exact: true })
    for (const control of [verifiedBox(page, seeded[0]!.name).locator('xpath=..'), reviewCard(page, seeded[0]!.name, 'sin verificar'), generateButton(page), photoToggle]) {
      const size = await control.boundingBox()
      expect(Math.min(size!.width, size!.height)).toBeGreaterThanOrEqual(44)
    }
    // Con la foto a la vista tampoco hay scroll horizontal.
    await photoToggle.click()
    await expect.poll(() => review(page).getByRole('img', { name: /^Foto de la petición de / }).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.keyboard.press('Escape')
    await expect.poll(() => review(page).count()).toBe(0)
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')
    expect(await box(page, seeded[0]!.name).isChecked()).toBe(true)
    expect(await prayerCalls()).toHaveLength(0)
    expect(new URL(page.url()).pathname).toBe('/peticiones')
    await page.close()
  })

  it('una foto sin texto legible: la tarjeta lo dice, el área queda en blanco y se escribe a mano', async () => {
    const [request] = await seedRequests('Sin texto', 1)
    await setStubMode({ scenario: 'sin-texto' })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, [request!.name])
    await expect.poll(() => reviewCard(page, request!.name, 'sin texto en la foto').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await text(page).inputValue()).toBe('')
    expect(await review(page).getByText('No encontramos texto en esta foto. Si lo tiene, escríbelo a mano.').isVisible()).toBe(true)
    expect(await verifiedBox(page, request!.name).isDisabled()).toBe(true)
    expect(await generateButton(page).isDisabled()).toBe(true)

    // Vacío no se puede verificar: el campo dice qué falta.
    await review(page).getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    await expect.poll(() => review(page).getByText('Escribe el texto de la petición para marcarla como verificada').isVisible()).toBe(true)

    await text(page).fill('Por mi vecina')
    await review(page).getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    await expect.poll(() => reviewCard(page, request!.name, 'verificada').isVisible()).toBe(true)
    await expect.poll(() => generateButton(page).isEnabled()).toBe(true)
    await page.close()
  })

  it('una lectura que falla muestra el motivo con Reintentar y Escribir a mano, sin detener a las demás', async () => {
    // La más antigua (la última sembrada) se lee primero y falla; la otra se lee bien.
    const [fine, broken] = await seedRequests('Lectura falla', 2)
    await setStubMode({ scenario: 'lectura-falla', match: broken!.fileId })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, [fine!.name, broken!.name])
    await expect.poll(() => reviewCard(page, broken!.name, 'no se pudo leer').isVisible(), { timeout: 60_000 }).toBe(true)
    await expect.poll(() => reviewCard(page, fine!.name, 'sin verificar').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await review(page).getByRole('alert').innerText()).toBe('No pudimos leer esta foto. Reintenta o escribe el texto a mano.')
    expect(await review(page).getByRole('button', { name: 'Escribir a mano', exact: true }).isVisible()).toBe(true)
    expect(await review(page).getByRole('button', { name: 'Ver imagen', exact: true }).isVisible()).toBe(true)
    expect(await generateButton(page).isDisabled()).toBe(true)

    // El servicio se recupera: Reintentar la lee.
    await setStubMode({})
    await review(page).getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect.poll(() => reviewCard(page, broken!.name, 'sin verificar').isVisible(), { timeout: 30_000 }).toBe(true)
    await page.close()
  })

  it('sin crédito: la lectura se detiene para todas, se avisa que hace falta un administrador y se puede escribir a mano', async () => {
    const seeded = await seedRequests('Lectura sin credito', 2)
    await setStubMode({ scenario: 'sin-credito' })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, seeded.map(s => s.name))
    for (const { name } of seeded) await expect.poll(() => reviewCard(page, name, 'no se pudo leer').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await review(page).getByText('Se agotó el crédito del servicio de lectura. Avisa a un administrador; mientras tanto puedes escribir cada texto a mano.').isVisible()).toBe(true)
    expect(await review(page).getByRole('button', { name: 'Reintentar', exact: true }).count()).toBe(0)
    // Solo se intentó la primera foto.
    expect((await transcriptCalls()).map(call => call.status)).toEqual([402])

    await review(page).getByRole('button', { name: 'Escribir a mano', exact: true }).click()
    await text(page).fill('Por mi hermano')
    await review(page).getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    await expect.poll(() => verifiedBox(page, seeded[1]!.name).isChecked()).toBe(true)
    await page.close()
  })

  it('una HEIC antigua se lee con su copia JPEG; una HEIC sin copia no se puede leer: sin Reintentar ni llamar al modelo, se escribe a mano o se quita', async () => {
    const copy = `e2e/${runId()}/textsrc/copia-${Date.now()}.jpg`
    const [legacy] = await seedRequests('HEIC con copia', 1, { fixtureName: 'nota.heic', previewKey: copy })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, [legacy!.name])
    await expect.poll(() => reviewCard(page, legacy!.name, 'sin verificar').isVisible(), { timeout: 30_000 }).toBe(true)
    const [read] = await transcriptCalls()
    expect(read!.photo).toContain(copy)

    await resetStub()
    const [raw] = await seedRequests('HEIC sin copia', 1, { fixtureName: 'nota.heic' })
    await openPage(page)
    await openReview(page, [raw!.name])
    await expect.poll(() => reviewCard(page, raw!.name, 'no se pudo leer').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await review(page).getByRole('alert').innerText()).toBe('Esta foto no se puede leer automáticamente. Escribe el texto a mano o quítala de la selección.')
    expect(await review(page).getByRole('button', { name: 'Reintentar', exact: true }).count()).toBe(0)
    expect(await review(page).getByRole('button', { name: 'Escribir a mano', exact: true }).isVisible()).toBe(true)
    expect(await transcriptCalls()).toHaveLength(0)

    // Quitarla de la selección: era la única, así que la revisión se cierra.
    await review(page).getByRole('button', { name: 'Quitar de la selección', exact: true }).click()
    await expect.poll(() => review(page).count()).toBe(0)
    await expect.poll(() => bar(page).count()).toBe(0)
    expect(await box(page, raw!.name).isChecked()).toBe(false)
    await page.close()
  })

  it('el servidor no acepta generar sin texto verificado, aunque el navegador lo pida directamente', async () => {
    const [verified, draft] = await seedRequests('Sin verificar', 2)
    await seedPrayerTranscript(verified!.fileId, owner, { text: 'Por mi familia' })
    await seedPrayerTranscript(draft!.fileId, owner, { text: 'Por mi trabajo', status: 'draft' })
    const page = await editorPage()
    const generation = await page.request.post(`${E2E_URL}/api/peticiones/generaciones`, { data: { groups: [[verified!.fileId, draft!.fileId]] } })
    expect(generation.status()).toBe(409)
    expect((await generation.json()).data).toEqual({ code: 'transcript_unverified', ids: [draft!.fileId] })
    const image = await page.request.post(`${E2E_URL}/api/peticiones/imagenes`, { data: { fileIds: [verified!.fileId, draft!.fileId] } })
    expect(image.status()).toBe(409)
    expect((await image.json()).data).toEqual({ code: 'transcript_unverified', ids: [draft!.fileId] })
    // No se gastó crédito.
    expect(await prayerCalls()).toHaveLength(0)
    await page.close()
  })

  it('una lectura más larga que el tope de una petición no se recorta en silencio: falla y se ofrece escribir a mano', async () => {
    const [request] = await seedRequests('Lectura larga', 1)
    await setStubMode({ transcriptText: 'Por mi familia. '.repeat(70) })
    const page = await editorPage()
    await openPage(page)
    await openReview(page, [request!.name])
    await expect.poll(() => reviewCard(page, request!.name, 'no se pudo leer').isVisible(), { timeout: 60_000 }).toBe(true)
    expect(await review(page).getByRole('button', { name: 'Escribir a mano', exact: true }).isVisible()).toBe(true)
    expect(await review(page).getByRole('button', { name: 'Reintentar', exact: true }).isVisible()).toBe(true)
    expect(await generateButton(page).isDisabled()).toBe(true)
    // El modelo respondió (una sola llamada, sin reintento) y no se guardó nada.
    const calls = await transcriptCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.text!.length).toBeGreaterThan(1000)
    expect(await testSql()`SELECT file_id FROM prayer_transcripts WHERE file_id = ${request!.fileId}`).toEqual([])

    await review(page).getByRole('button', { name: 'Escribir a mano', exact: true }).click()
    await text(page).fill('Por mi familia')
    await review(page).getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    await expect.poll(() => reviewCard(page, request!.name, 'verificada').isVisible()).toBe(true)
    await page.close()
  })
})

/** Un envío de invitado pendiente con un archivo listo, como lo deja `/upload` (sin objeto en el bucket). */
async function seedPendingSubmission(senderName: string): Promise<string> {
  const sql = testSql()
  const now = new Date().toISOString()
  const [row] = await sql`
    INSERT INTO guest_submissions (sender_name, status, sender_key, created_at, completed_at)
    VALUES (${senderName}, 'pending', ${`e2e-${runId()}`}, ${now}, ${now})
    RETURNING id
  ` as { id: string }[]
  await sql`
    INSERT INTO guest_submission_files (submission_id, original_name, extension, mime_type, category, size_bytes, storage_key, upload_status)
    VALUES (${row!.id}, 'foto.jpg', 'jpg', 'image/jpeg', 'image', 10, ${`e2e/${runId()}/guest/pendiente-${randomUUID()}`}, 'ready')
  `
  return row!.id
}

describe('US6 · agregar una petición a mano', () => {
  const manual = (page: Page) => page.getByRole('dialog', { name: 'Agregar petición' })

  async function openManual(page: Page) {
    await page.getByRole('button', { name: 'Agregar petición', exact: true }).first().click()
    await expect.poll(() => manual(page).isVisible()).toBe(true)
  }

  it('un editor agrega una foto: queda aprobada al instante, sale primera con su nombre y no pasa por Solicitudes', async () => {
    const note = `Entregada en papel ${runId()} ${Date.now()}`
    const page = await editorPage()
    await openPage(page)
    const pendingCount = async () => (await (await page.request.get(`${E2E_URL}/api/realtime/pulse`)).json() as { pendingCount: number }).pendingCount
    const pendingBefore = await pendingCount()
    await openManual(page)

    // El nombre es el de la sesión y no se puede cambiar.
    const name = manual(page).getByLabel('Tu nombre')
    expect(await name.inputValue()).toBe(editor.name!)
    expect(await name.getAttribute('readonly')).not.toBeNull()
    expect(await manual(page).getByLabel('Elegir archivos', { exact: true }).getAttribute('accept')).toBe('.jpg,.jpeg,.png,.webp,.gif,.heic')

    await manual(page).getByLabel('Nota para el equipo (opcional)').fill(note)
    await manual(page).getByLabel('Elegir archivos', { exact: true }).setInputFiles(fixture('foto.jpg'))
    await manual(page).getByRole('button', { name: 'Agregar petición', exact: true }).click()
    await expect.poll(async () => {
      if (await page.getByText('Petición agregada', { exact: true }).isVisible()) return 'ok'
      const alert = manual(page).getByRole('alert')
      return (await alert.count()) > 0 ? `alert: ${await alert.first().innerText()}` : 'esperando'
    }, { timeout: 60_000 }).toBe('ok')
    await expect.poll(() => manual(page).count()).toBe(0)

    // La lista se recarga sola: la nueva es la aprobada más reciente, con el nombre de quien la agregó.
    const first = page.getByRole('list', { name: 'Peticiones aprobadas' }).getByRole('listitem').first()
    await expect.poll(() => first.innerText(), { timeout: 15_000 }).toContain(note)
    // Y queda a la vista: la fila vuelve a su inicio (el navegador, al anteponer la tarjeta, conservaba las que ya se veían).
    await expect.poll(async () => {
      const cardBox = await first.boundingBox()
      return !!cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= viewports.desktop.width
    }).toBe(true)
    expect(await first.getByRole('article', { name: `Petición de ${editor.name!}`, exact: true }).isVisible()).toBe(true)
    await expect.poll(() => first.locator('img').evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0), { timeout: 15_000 }).toBe(true)

    // Aprobada por su autor en el momento de cerrar la subida, con la imagen lista en la raíz del drive.
    const sql = testSql()
    const rows = await sql`
      SELECT s.id, s.status, s.sender_name, s.sender_key, s.reviewed_by, s.completed_at IS NOT NULL AS closed, s.completed_at = s.reviewed_at AS same_instant,
        f.folder_id, f.category, f.upload_status, f.origin, f.guest_name, g.upload_status AS guest_status
      FROM guest_submissions s
      JOIN files f ON f.submission_id = s.id
      JOIN guest_submission_files g ON g.id = f.id
      WHERE s.note = ${note}
    `
    expect(rows).toEqual([expect.objectContaining({
      status: 'approved', sender_name: editor.name!, sender_key: `manual:${owner}`, reviewed_by: owner, closed: true, same_instant: true,
      folder_id: null, category: 'image', upload_status: 'ready', origin: 'guest', guest_name: editor.name!, guest_status: 'ready',
    })])
    const activity = await sql`SELECT actor_id, meta FROM activity_log WHERE action = 'submission.approve' AND target_id = ${rows[0]!.id}`
    expect(activity).toEqual([{ actor_id: owner, meta: { files: 1, folderId: null, manual: true } }])

    // Nunca estuvo en la cola: ni en la lista de pendientes ni en su contador.
    const pending = await (await page.request.get(`${E2E_URL}/api/submissions`)).json() as { id: string }[]
    expect(pending.some(s => s.id === rows[0]!.id)).toBe(false)
    expect(await pendingCount()).toBe(pendingBefore)
    await page.close()
  })

  it('solo imágenes: un PDF queda marcado en la cola y no se envía; el servidor también lo rechaza (415)', async () => {
    const page = await editorPage()
    await openPage(page)
    await openManual(page)
    await manual(page).getByLabel('Elegir archivos', { exact: true }).setInputFiles(fixture('slides.pdf'))
    await expect.poll(() => manual(page).getByText('«slides.pdf»: solo se aceptan imágenes').isVisible()).toBe(true)
    await manual(page).getByRole('button', { name: 'Agregar petición', exact: true }).click()
    await expect.poll(() => manual(page).getByRole('alert').filter({ hasText: 'Agrega al menos' }).innerText()).toBe('Agrega al menos un archivo válido')

    const before = await testSql()`SELECT count(*)::int AS n FROM guest_submissions WHERE sender_key = ${`manual:${owner}`}` as { n: number }[]
    const direct = await page.request.post(`${E2E_URL}/api/peticiones/manual`, { data: { files: [{ name: 'slides.pdf', size: 1000, mimeType: 'application/pdf' }] } })
    expect(direct.status()).toBe(415)
    expect((await direct.json()).message).toBe('«slides.pdf»: solo se aceptan imágenes')
    expect(await testSql()`SELECT count(*)::int AS n FROM guest_submissions WHERE sender_key = ${`manual:${owner}`}`).toEqual(before)

    // Cerrar con Escape devuelve a la página sin crear nada.
    await page.keyboard.press('Escape')
    await expect.poll(() => manual(page).count()).toBe(0)
    await page.close()
  })

  it('el cierre del alta manual no sirve para aprobar el envío de un invitado (404) y el nombre del cuerpo se ignora', async () => {
    const guestName = `Invitada cola ${runId()} ${Date.now()}`
    const guestSubmission = await seedPendingSubmission(guestName)
    const page = await editorPage()
    const foreign = await page.request.post(`${E2E_URL}/api/peticiones/manual/${guestSubmission}/complete`)
    expect(foreign.status()).toBe(404)
    expect(await testSql()`SELECT status FROM guest_submissions WHERE id = ${guestSubmission}`).toEqual([{ status: 'pending' }])
    // Se retira de la cola para no dejar pendientes a otras pruebas.
    expect((await page.request.post(`${E2E_URL}/api/submissions/${guestSubmission}/reject`, { data: { reason: '' } })).status()).toBe(204)

    const created = await page.request.post(`${E2E_URL}/api/peticiones/manual`, {
      data: { senderName: 'Otra persona', files: [{ name: 'foto.jpg', size: 8386, mimeType: 'image/jpeg' }] },
    })
    expect(created.status()).toBe(201)
    const { submissionId } = await created.json() as { submissionId: string }
    expect(await testSql()`SELECT sender_name, sender_key, status FROM guest_submissions WHERE id = ${submissionId}`)
      .toEqual([{ sender_name: editor.name!, sender_key: `manual:${owner}`, status: 'pending' }])
    // Sin subir la foto, el cierre no encuentra nada válido: 422 y no queda ni el envío.
    expect((await page.request.post(`${E2E_URL}/api/peticiones/manual/${submissionId}/complete`)).status()).toBe(422)
    expect(await testSql()`SELECT id FROM guest_submissions WHERE id = ${submissionId}`).toEqual([])
    await page.close()
  })

  it('a 360 px el diálogo cabe sin scroll horizontal y sus controles miden 44 px o más', async () => {
    const page = await editorPage(viewports.phone)
    await openPage(page)
    await openManual(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await manual(page).locator('.modal-box').evaluate(box => box.scrollWidth <= box.clientWidth)).toBe(true)
    for (const control of [manual(page).getByRole('button', { name: 'Cerrar', exact: true }), manual(page).getByRole('button', { name: 'Agregar petición', exact: true })]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.close()
  })
})

describe('los avisos se ven y se pulsan con un modal abierto', () => {
  /**
   * El aviso con ese texto: en qué diálogo está montado (su título) y si es lo que se pinta en su propio centro
   * (`elementFromPoint`): un `toBeVisible` no detecta que un `<dialog>` de la top layer lo tape.
   */
  const toastState = (page: Page, message: string) => page.evaluate((text) => {
    const alert = [...document.querySelectorAll('[data-toast-region] .alert')].find(el => el.textContent?.includes(text))
    if (!alert) return null
    const rect = alert.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      onTop: !!hit && alert.contains(hit),
      dialog: alert.closest('dialog[open]')?.querySelector('h2, h3')?.textContent?.trim() ?? null,
      regions: document.querySelectorAll('[data-toast-region]').length,
      inViewport: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    }
  }, message)

  async function dismissToast(page: Page, message: string) {
    await page.locator('[data-toast-region] .alert').filter({ hasText: message }).getByRole('button', { name: 'Cerrar aviso' }).click()
    await expect.poll(() => toastState(page, message)).toBeNull()
  }

  for (const [label, viewport] of [['1280 px', viewports.desktop], ['360 px', viewports.phone]] as const) {
    it(`colección y confirmación apilada (${label}): el aviso queda sobre el diálogo de arriba, baja al anterior y se cierra con un clic`, async () => {
      const original = `Avisos ${runId()} ${Date.now()}`
      const renamed = `${original} bis`
      const page = await editorPage(viewport)
      expect((await page.request.post(`${E2E_URL}/api/peticiones/colecciones`, { data: { name: original } })).status()).toBe(201)
      await openPage(page)
      await page.getByRole('button', { name: new RegExp(`^Abrir la colección ${original}`) }).click()
      const dialog = page.getByRole('dialog', { name: original })
      await expect.poll(() => dialog.isVisible()).toBe(true)

      // Renombrar avisa con el diálogo todavía abierto.
      await dialog.getByRole('button', { name: 'Renombrar', exact: true }).click()
      await dialog.getByLabel('Nuevo nombre').fill(renamed)
      await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
      const message = `Ahora se llama «${renamed}»`
      await expect.poll(() => toastState(page, message)).toEqual({ onTop: true, dialog: renamed, regions: 1, inViewport: true })

      // Con la confirmación encima, el aviso sube a ella; al cancelarla vuelve al diálogo de la colección.
      await page.getByRole('dialog', { name: renamed }).getByRole('button', { name: 'Eliminar colección', exact: true }).click()
      const confirmTitle = `¿Eliminar la colección «${renamed}»?`
      await expect.poll(() => page.getByRole('dialog', { name: confirmTitle }).isVisible()).toBe(true)
      await expect.poll(() => toastState(page, message)).toEqual({ onTop: true, dialog: confirmTitle, regions: 1, inViewport: true })
      await page.getByRole('dialog', { name: confirmTitle }).getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect.poll(async () => (await toastState(page, message))?.dialog ?? 'sin aviso').toBe(renamed)
      expect((await toastState(page, message))!.onTop).toBe(true)
      await dismissToast(page, message)

      // Al cerrar el último modal los avisos siguen en su lugar de siempre, fuera de cualquier diálogo.
      await page.getByRole('dialog', { name: renamed }).getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URL })
      await page.getByRole('button', { name: 'Copiar enlace para invitados' }).first().click()
      await expect.poll(() => toastState(page, 'Enlace para invitados copiado')).toEqual({ onTop: true, dialog: null, regions: 1, inViewport: true })
      await page.close()
    })
  }

  it('revisión de Peticiones: «Guardar y verificar» avisa sobre el diálogo', async () => {
    await resetStub()
    const name = `Aviso revision ${runId()} ${Date.now()}`
    await seedPrayerRequest(owner, { senderName: name })
    const page = await editorPage()
    await openPage(page)
    await box(page, name).check()
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Revisa el texto de las peticiones' })
    await expect.poll(() => review.getByRole('button', { name: `Petición de ${name}: sin verificar`, exact: true }).isVisible(), { timeout: 30_000 }).toBe(true)
    await review.getByRole('button', { name: 'Guardar y verificar', exact: true }).click()
    const message = `Texto de ${name} guardado y verificado`
    await expect.poll(() => toastState(page, message)).toEqual({ onTop: true, dialog: 'Revisa el texto de las peticiones', regions: 1, inViewport: true })
    await dismissToast(page, message)
    await page.close()
  })

  it('Solicitudes: el aviso de un envío nuevo llega con el diálogo de rechazo abierto, se ve encima y su enlace se puede pulsar', async () => {
    const first = `Aviso cola ${runId()} ${Date.now()}`
    const firstId = await seedPendingSubmission(first)
    const page = await editorPage()
    await page.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(page)
    const card = page.getByRole('article', { name: `Envío de ${first}` })
    await expect.poll(() => card.isVisible()).toBe(true)
    await card.getByRole('button', { name: 'Rechazar' }).click()
    const reject = page.getByRole('dialog', { name: `¿Rechazar el envío de ${first}?` })
    await expect.poll(() => reject.isVisible()).toBe(true)

    // Otro invitado cierra su envío: el pulso (cada 5 s) lo anuncia mientras el diálogo sigue abierto.
    const second = `Aviso nuevo ${runId()} ${Date.now()}`
    const secondId = await seedPendingSubmission(second)
    const message = `Nuevo envío de ${second} (1 archivo)`
    await expect.poll(() => toastState(page, message), { timeout: 20_000 })
      .toEqual({ onTop: true, dialog: `¿Rechazar el envío de ${first}?`, regions: 1, inViewport: true })
    expect(await page.locator('[data-toast-region] .alert').filter({ hasText: message }).getByRole('link', { name: 'Ver', exact: true }).isVisible()).toBe(true)
    await dismissToast(page, message)

    // El diálogo sigue usable debajo del aviso: se rechaza y la cola queda como estaba.
    await reject.getByRole('button', { name: 'Rechazar envío' }).click()
    await expect.poll(() => toastState(page, `Se rechazó el envío de ${first}`)).toMatchObject({ onTop: true, dialog: null })
    expect((await page.request.post(`${E2E_URL}/api/submissions/${secondId}/reject`, { data: { reason: '' } })).status()).toBe(204)
    expect(await testSql()`SELECT status FROM guest_submissions WHERE id IN (${firstId}, ${secondId})`).toEqual([{ status: 'rejected' }, { status: 'rejected' }])
    await page.close()
  })
})
