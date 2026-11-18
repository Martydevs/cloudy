// T033 / T051 / T066 / T077 — Página Peticiones (feature 007, quickstart § 3; feature 008): tarjetas de peticiones
// aprobadas, selección, generación de imágenes contra el stub de OpenRouter (guardadas en el historial, enmienda de
// historial) y filtros. Los datos se siembran en la rama de pruebas con `seedPrayerRequest`; las aprobaciones de esta corrida
// son las más recientes (otros archivos e2e corren antes, uno a la vez), así que salen primero en la rejilla. Ya no hay texto
// que escribir: «Generar imágenes» encola al instante y el modelo recibe la plantilla y las fotos (URLs firmadas).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PRAYER_ERROR_MESSAGES } from '../../shared/constants/prayers'
import { E2E_URL, prayerCalls, profileUserId, resetStub, runId, seedPrayerRequest, setStubMode, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'
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

// ---- Página de una generación (`/peticiones/generaciones/:id`, enmienda 2026-11-15)
const slideshow = (page: Page) => page.getByRole('region', { name: 'Imágenes de la generación' })
/** La imagen de la diapositiva actual (las miniaturas no tienen nombre accesible). */
const stageImage = (page: Page) => slideshow(page).getByRole('img', { name: /^Imagen \d+ de peticiones/ })
/** El motivo de la diapositiva actual cuando falló. */
const failure = (page: Page) => slideshow(page).getByRole('alert')
/** «N de M listas». */
const progress = (page: Page) => slideshow(page).getByRole('status').filter({ hasText: /\d+ de \d+ lista/ })
/** Miniatura n (1-based); su nombre lleva el estado («Ver la imagen 2, lista»). */
const thumb = (page: Page, n: number) => slideshow(page).getByRole('button', { name: new RegExp(`^Ver la imagen ${n},`) })
const thumbState = async (page: Page, n: number) => (await thumb(page, n).getAttribute('aria-label'))!.replace(`Ver la imagen ${n}, `, '')

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

  it('cualquier petición aprobada se puede marcar: el modelo lee el texto en la foto', async () => {
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

  /** Ids de las imágenes que el servidor guardó (respuestas 201 de `POST /api/peticiones/imagenes`), en orden de llegada. */
  function trackSaved(page: Page): { id: string, fileIds: string[], createdAt: string, generationId: string | null }[] {
    const ids: { id: string, fileIds: string[], createdAt: string, generationId: string | null }[] = []
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/peticiones/imagenes' || response.status() !== 201) return
      ids.push(await response.json())
    })
    return ids
  }

  /**
   * Elige las tarjetas y pulsa «Generar imágenes»: se crea la generación, se encola sin diálogo, la selección se vacía y
   * se abre la página de la generación. Devuelve su id (el de la URL).
   */
  async function generate(page: Page, names: string[]): Promise<string> {
    for (const name of names) await box(page, name).check()
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await page.waitForURL(/\/peticiones\/generaciones\/[0-9a-f-]{36}(\?.*)?$/, { timeout: 30_000 })
    await waitForHydration(page)
    return new URL(page.url()).pathname.split('/').pop()!
  }

  /** Las fotos de una llamada apuntan a estos archivos (su id va en la clave del bucket), en este orden. */
  const photosOf = (photos: string[], fileIds: string[]) => photos.map(url => fileIds.findIndex(id => url.includes(id)))

  beforeEach(async () => {
    await resetStub()
  })

  it('5 → 2 imágenes sin diálogo: la plantilla y las fotos (URLs firmadas, sin nombres ni notas) viajan al stub; llegan al pase de la generación y al historial con «Ver generación», sobreviven a una recarga, se descargan y se amplían', async () => {
    const seeded = await seedRequests('Generar', 5, { note: `Nota privada ${runId()}` })
    const fileIds = seeded.map(s => s.fileId)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    const generationId = await generate(page, seeded.map(s => s.name))
    expect(await page.getByRole('dialog').count()).toBe(0)
    await expect.poll(() => page.getByText('2 imágenes en cola').isVisible()).toBe(true)

    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    // Cada imagen queda ligada a la generación y el pase las muestra: la más antigua (con otras tres) abre la primera.
    for (const image of ids) expect(image.generationId).toBe(generationId)
    const four = ids.find(i => i.fileIds.length === 4)!
    const one = ids.find(i => i.fileIds.length === 1)!
    expect(one.fileIds).toEqual([seeded[0]!.fileId])
    await expect.poll(() => progress(page).innerText(), { timeout: 10_000 }).toBe('2 de 2 listas')
    await expect.poll(() => stageImage(page).getAttribute('src')).toBe(`/api/peticiones/imagenes/${four.id}/content`)
    expect(await stageImage(page).getAttribute('alt')).toBe('Imagen 1 de peticiones, con 4 peticiones')
    await thumb(page, 2).click()
    await expect.poll(() => stageImage(page).getAttribute('src')).toBe(`/api/peticiones/imagenes/${one.id}/content`)
    await expect.poll(() => new URL(page.url()).searchParams.get('i')).toBe('2')
    expect(await thumb(page, 2).getAttribute('aria-current')).toBe('true')

    const calls = await prayerCalls()
    expect(calls).toHaveLength(2)
    // Orden de aprobación: la más antigua (la última sembrada) abre la primera imagen.
    const byPhotos = [...calls].sort((a, b) => b.photos.length - a.photos.length)
    expect(byPhotos.map(c => photosOf(c.photos, fileIds))).toEqual([[4, 3, 2, 1], [0]])
    for (const call of calls) {
      expect(call).toMatchObject({ model: '@preset/pray-requests-image-generation', template: true, status: 200 })
      expect(call.modalities).toContain('image')
      // Cada foto llega como URL firmada del bucket (OpenRouter la descarga) y con su rótulo.
      for (const url of call.photos) expect(url).toMatch(/^https:\/\/.+X-Amz-Signature=/)
      expect(call.prompt).toContain('Foto de la petición 1')
      for (const { name } of seeded) expect(call.prompt).not.toContain(name)
      expect(call.prompt).not.toContain('Nota privada')
      for (const id of fileIds) expect(call.prompt).not.toContain(id)
    }

    // De vuelta en Peticiones, el historial tiene las dos con su enlace a la generación; nada queda en curso.
    await page.getByRole('link', { name: 'Volver a Peticiones' }).first().click()
    await page.waitForURL(url => url.pathname === '/peticiones')
    await page.getByRole('link', { name: 'Ver imágenes generadas' }).click()
    for (const { id } of ids) await expect.poll(() => saved(page, id).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await page.getByRole('list', { name: 'Imágenes en curso' }).count()).toBe(0)
    expect(await saved(page, four.id).innerText()).toContain('4 peticiones')
    expect(await saved(page, one.id).getByRole('link', { name: 'Ver generación' }).getAttribute('href')).toBe(`/peticiones/generaciones/${generationId}`)

    // Sobreviven a una recarga.
    await page.reload()
    await waitForHydration(page)
    await page.locator('#historial').scrollIntoViewIfNeeded()
    for (const { id } of ids) await expect.poll(() => saved(page, id).isVisible(), { timeout: 10_000 }).toBe(true)

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

    // «Ver generación» abre la página con las dos listas (persistidas en el servidor).
    await saved(page, one.id).getByRole('link', { name: 'Ver generación' }).click()
    await page.waitForURL(url => url.pathname === `/peticiones/generaciones/${generationId}`)
    await waitForHydration(page)
    await expect.poll(() => progress(page).innerText(), { timeout: 10_000 }).toBe('2 de 2 listas')
    expect(await page.getByRole('heading', { level: 1 }).innerText()).toMatch(/^Generación del /)
    await page.close()
  })

  it('una sola petición: una imagen con la plantilla y su foto', async () => {
    const [request] = await seedRequests('Una sola', 1)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [request!.name])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    const [call] = await prayerCalls()
    expect(call).toMatchObject({ template: true, status: 200 })
    expect(photosOf(call!.photos, [request!.fileId])).toEqual([0])
    await expect.poll(() => progress(page).innerText()).toBe('1 de 1 lista')
    // Con una sola imagen no hay ‹ ›.
    expect(await slideshow(page).getByRole('button', { name: 'Imagen siguiente' }).count()).toBe(0)
    await page.close()
  })

  it('una HEIC antigua va con su copia JPEG; una HEIC sin copia queda fallida con su motivo, sin Reintentar ni llamar al modelo', async () => {
    const copy = `e2e/${runId()}/textsrc/copia-${Date.now()}.jpg`
    const [legacy] = await seedRequests('HEIC con copia', 1, { fixtureName: 'nota.heic', previewKey: copy })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [legacy!.name])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    const [call] = await prayerCalls()
    expect(call!.photos).toHaveLength(1)
    expect(call!.photos[0]).toContain(copy)

    await resetStub()
    const [raw] = await seedRequests('HEIC sin copia', 1, { fixtureName: 'nota.heic' })
    await openPage(page)
    await generate(page, [raw!.name])
    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toBe(PRAYER_ERROR_MESSAGES.unreadable_image)
    expect(await slideshow(page).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    expect(await thumbState(page, 1)).toBe('no se pudo generar')
    expect(await prayerCalls()).toHaveLength(0)
    await page.close()
  })

  it('un fallo del servicio muestra el motivo y Reintentar solo en esa imagen; la otra se guarda', async () => {
    // La más antigua (última) cae en la imagen 1 junto con otras tres; la más reciente sola en la 2.
    const seeded = await seedRequests('Falla', 5)
    await setStubMode({ scenario: 'falla-una-vez', match: seeded[4]!.fileId })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, seeded.map(s => s.name))

    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toBe(PRAYER_ERROR_MESSAGES.provider)
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    expect(ids[0]!.fileIds).toEqual([seeded[0]!.fileId])
    await expect.poll(() => thumbState(page, 2)).toBe('lista')
    expect(await thumbState(page, 1)).toBe('no se pudo generar')
    expect(await progress(page).innerText()).toBe('1 de 2 listas')

    await slideshow(page).getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => progress(page).innerText()).toBe('2 de 2 listas')
    await expect.poll(() => stageImage(page).getAttribute('src')).toBe(`/api/peticiones/imagenes/${ids[1]!.id}/content`)
    await page.close()
  })

  it('sin crédito: el motivo sin Reintentar y nada se guarda; Descartar deja la imagen sin terminar', async () => {
    const [request] = await seedRequests('Sin credito', 1)
    await setStubMode({ scenario: 'sin-credito' })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [request!.name])
    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toBe(PRAYER_ERROR_MESSAGES.quota_exceeded)
    expect(await slideshow(page).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    expect(await slideshow(page).getByRole('button', { name: 'Descartar' }).isVisible()).toBe(true)
    expect(ids).toHaveLength(0)
    await slideshow(page).getByRole('button', { name: 'Descartar' }).click()
    await expect.poll(() => thumbState(page, 1)).toBe('sin terminar')
    expect(await slideshow(page).getByRole('button', { name: 'Generar las faltantes' }).count()).toBeGreaterThan(0)
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
    await generate(page, [request!.name])
    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toBe(PRAYER_ERROR_MESSAGES.not_configured)
    expect(await slideshow(page).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
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
    await generate(page, [request!.name])
    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toBe(PRAYER_ERROR_MESSAGES.invalid_output)
    expect(await slideshow(page).getByRole('button', { name: 'Reintentar' }).isVisible()).toBe(true)
    await page.close()
  })

  it('una petición enviada a la papelera tras elegirla → 409 al crear la generación: se quita de la selección con aviso, no se navega y nada llega al modelo', async () => {
    const [kept, trashed] = await seedRequests('Papelera', 2)
    const page = await editorPage()
    await openPage(page)
    for (const { name } of [kept!, trashed!]) await box(page, name).check()
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')
    // Otra persona la envía a la papelera mientras tanto (rama de pruebas, como `seedPrayerRequest({ deleted: true })`).
    await testSql()`UPDATE files SET deleted_at = now(), deleted_by = ${owner}, trash_root_id = id WHERE id = ${trashed!.fileId}`

    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => page.getByText('Quitamos 1 petición que ya no está disponible').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/peticiones')
    // La que sigue disponible se queda elegida: un segundo clic la genera sola.
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')
    expect(await box(page, kept!.name).isChecked()).toBe(true)
    expect(await box(page, trashed!.name).isChecked()).toBe(false)
    expect(await page.getByRole('list', { name: 'Imágenes en curso' }).count()).toBe(0)
    expect(await prayerCalls()).toHaveLength(0)
    await page.close()
  })

  it('salir con una imagen generándose pide confirmación (en la generación y en Peticiones); volver a Peticiones no pregunta ni vacía la cola; una ya guardada no pregunta', async () => {
    const [slow, quick] = await seedRequests('Salir', 2)
    // 10 s: la prueba navega entre la generación y Peticiones mientras la imagen sigue generándose.
    await setStubMode({ scenario: 'lento', match: slow!.fileId, prayerDelayMs: 10_000 })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)

    const leave = () => page.evaluate(() => {
      const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } } }).__vue_app__
      void app.config.globalProperties.$router.push('/')
    })
    const dialog = page.getByRole('dialog', { name: '¿Salir de Peticiones?' })

    // Guardada: salir no pregunta (se vuelve a la página para la segunda parte).
    await generate(page, [quick!.name])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    await leave()
    await page.waitForURL(url => url.pathname === '/')
    expect(await dialog.count()).toBe(0)
    await openPage(page)

    // Generándose (el stub tarda con «lento»): la página de la generación pregunta; Cancelar se queda.
    const generationId = await generate(page, [slow!.name])
    await expect.poll(() => slideshow(page).getByText('Generándose…').isVisible()).toBe(true)
    await leave()
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    expect(new URL(page.url()).pathname).toBe(`/peticiones/generaciones/${generationId}`)

    // Volver a Peticiones no pregunta y la cola sigue en curso allí.
    await page.getByRole('link', { name: 'Volver a Peticiones' }).first().click()
    await page.waitForURL(url => url.pathname === '/peticiones')
    expect(await dialog.count()).toBe(0)
    await expect.poll(() => page.getByRole('list', { name: 'Imágenes en curso' }).getByRole('article').count()).toBe(1)

    // Desde Peticiones, salir también pregunta; Salir cancela.
    await leave()
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Salir' }).click()
    await page.waitForURL(url => url.pathname === '/')
    // Si la llamada lenta llegó al stub antes de cancelarse, el stub la registra al terminar su espera (10 s): se deja pasar
    // ese plazo para que no se cuele en las cuentas de la prueba siguiente.
    await page.waitForTimeout(11_000)
    await page.close()
  })

  it('con la red cortada no se crea la generación y la selección se conserva; una imagen sin respuesta queda en error reintentable con un mensaje accionable', async () => {
    const [request] = await seedRequests('Sin red', 1)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await box(page, request!.name).check()
    await page.context().setOffline(true)
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await expect.poll(() => page.getByText(/^No pudimos preparar la generación/).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/peticiones')
    expect(await box(page, request!.name).isChecked()).toBe(true)
    await page.context().setOffline(false)

    // La generación se crea, pero la imagen no obtiene respuesta.
    await page.route('**/api/peticiones/imagenes', route => route.abort('internetdisconnected'))
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await page.waitForURL(/\/peticiones\/generaciones\//, { timeout: 30_000 })
    await expect.poll(() => failure(page).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await failure(page).innerText()).toContain('Se perdió la conexión al generar la imagen')

    await page.unroute('**/api/peticiones/imagenes')
    await slideshow(page).getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    await page.close()
  })
})

describe('Página de generación (enmienda 2026-11-15)', () => {
  const generationUrl = (id: string, query = '') => `${E2E_URL}/peticiones/generaciones/${id}${query}`

  /** Una generación guardada sin imágenes (como la deja cerrar la pestaña antes de que terminen). */
  async function seedGeneration(groups: string[][]): Promise<string> {
    const [row] = await testSql()`INSERT INTO prayer_generations (created_by, groups) VALUES (${owner}, ${JSON.stringify(groups)}::jsonb) RETURNING id` as { id: string }[]
    return row!.id
  }

  beforeEach(async () => {
    await resetStub()
  })

  it('al abrirla con ?i= los grupos sin imagen salen «Sin terminar»; «Generar las faltantes» los genera ligados a la generación; ‹ › dan la vuelta y la posición va en la URL', async () => {
    const seeded = await seedRequests('Faltantes', 2)
    const id = await seedGeneration([[seeded[1]!.fileId], [seeded[0]!.fileId]])
    const page = await editorPage()
    const ids: { generationId: string | null }[] = []
    page.on('response', async (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/peticiones/imagenes' && response.status() === 201) ids.push(await response.json())
    })
    await page.goto(generationUrl(id, '?i=2'))
    await waitForHydration(page)
    expect(await page.getByRole('heading', { level: 1 }).innerText()).toMatch(/^Generación del /)
    await expect.poll(() => progress(page).innerText()).toBe('0 de 2 listas')
    expect(await thumb(page, 2).getAttribute('aria-current')).toBe('true')
    expect(await thumbState(page, 1)).toBe('sin terminar')
    await expect.poll(() => slideshow(page).getByText('Sin terminar', { exact: true }).isVisible()).toBe(true)
    expect(await page.getByText('2 imágenes sin terminar').isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Generar las faltantes' }).first().click()
    await expect.poll(() => page.getByText('2 imágenes en cola').isVisible()).toBe(true)
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    for (const image of ids) expect(image.generationId).toBe(id)
    await expect.poll(() => progress(page).innerText(), { timeout: 10_000 }).toBe('2 de 2 listas')
    expect(await page.getByText('sin terminar').count()).toBe(0)
    await expect.poll(() => stageImage(page).getAttribute('alt')).toBe('Imagen 2 de peticiones, con 1 petición')

    // ‹ › con vuelta: desde la 2 (la última), siguiente lleva a la 1.
    await slideshow(page).getByRole('button', { name: 'Imagen siguiente' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('i')).toBe('1')
    await expect.poll(() => stageImage(page).getAttribute('alt')).toBe('Imagen 1 de peticiones, con 1 petición')
    await slideshow(page).getByRole('button', { name: 'Imagen anterior' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('i')).toBe('2')

    // Una posición fuera de rango cae en la última (regresión: el pase quedaba vacío).
    await page.goto(generationUrl(id, '?i=9'))
    await waitForHydration(page)
    await expect.poll(() => thumb(page, 2).getAttribute('aria-current')).toBe('true')
    await expect.poll(() => new URL(page.url()).searchParams.get('i')).toBe('2')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })

  it('«Guardar en el drive» sube la imagen por el navegador a la raíz de Archivos con su nombre; «Descargar varias» descarga de una en una', async () => {
    const seeded = await seedRequests('Drive', 2)
    const id = await seedGeneration([[seeded[1]!.fileId], [seeded[0]!.fileId]])
    const page = await editorPage()
    const ids: { id: string, createdAt: string }[] = []
    page.on('response', async (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/peticiones/imagenes' && response.status() === 201) ids.push(await response.json())
    })
    await page.goto(generationUrl(id))
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Generar las faltantes' }).first().click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => progress(page).innerText(), { timeout: 10_000 }).toBe('2 de 2 listas')

    // La actual (la 1) al drive: el navegador la lee del bucket y la sube con el flujo de subidas.
    await expect.poll(() => stageImage(page).getAttribute('src')).toMatch(/^\/api\/peticiones\/imagenes\/[0-9a-f-]+\/content$/)
    const currentId = (await stageImage(page).getAttribute('src'))!.split('/')[4]!
    const current = ids.find(image => image.id === currentId)!
    const expectedName = `peticiones-${current.createdAt.slice(0, 10)}-${current.id.slice(0, 6)}.png`
    await page.getByRole('button', { name: 'Guardar en el drive', exact: true }).click()
    await expect.poll(() => page.getByText(`«${expectedName}» quedó en la raíz de Archivos`).isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await page.getByRole('link', { name: 'Ver en Archivos' }).getAttribute('href')).toBe('/archivos')
    await expect.poll(() => page.getByText('Guardada', { exact: true }).isVisible()).toBe(true)
    const [file] = await testSql()`SELECT folder_id, uploaded_by, upload_status, mime_type, size_bytes::int AS size_bytes FROM files WHERE name = ${expectedName} AND deleted_at IS NULL` as { folder_id: string | null, uploaded_by: string, upload_status: string, mime_type: string, size_bytes: number }[]
    expect(file).toMatchObject({ folder_id: null, uploaded_by: owner, upload_status: 'ready', mime_type: 'image/png' })
    expect(file!.size_bytes).toBeGreaterThan(0)

    // Descargar varias: casillas en la fila, Todas y una descarga por imagen.
    await page.getByRole('button', { name: 'Descargar varias' }).click()
    await page.getByRole('button', { name: 'Todas', exact: true }).click()
    await expect.poll(() => page.getByText('2 imágenes elegidas').isVisible()).toBe(true)
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    await page.getByRole('button', { name: 'Descargar 2' }).click()
    await expect.poll(() => downloads.length, { timeout: 15_000 }).toBe(2)
    expect(downloads.every(name => /^peticiones-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.png$/.test(name))).toBe(true)
    await expect.poll(() => page.getByText('Descargamos 2 imágenes').isVisible()).toBe(true)
    await page.close()
  })

  it('una generación inexistente avisa con Volver a Peticiones; la API exige sesión de equipo y rechaza grupos inválidos y fotos ajenas a la generación', async () => {
    const seeded = await seedRequests('Guardas', 2)
    const id = await seedGeneration([[seeded[0]!.fileId]])
    const page = await editorPage()
    await page.goto(generationUrl('00000000-0000-4000-8000-00000000dead'))
    await waitForHydration(page)
    const alert = page.getByRole('alert')
    await expect.poll(() => alert.innerText()).toContain('Esta generación ya no existe')
    await alert.getByRole('link', { name: 'Volver a Peticiones' }).click()
    await page.waitForURL(url => url.pathname === '/peticiones')

    // Sin sesión: 401 (la página privada va a /login con la ruta).
    expect((await fetch(`${E2E_URL}/api/peticiones/generaciones/${id}`)).status).toBe(401)
    expect((await fetch(`${E2E_URL}/api/peticiones/generaciones`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: [[seeded[0]!.fileId]] }) })).status).toBe(401)
    const anonymous = await createPage(undefined, { viewport: viewports.desktop })
    await anonymous.goto(generationUrl(id))
    await anonymous.waitForURL(url => url.pathname === '/login')
    expect(new URL(anonymous.url()).searchParams.get('redirect')).toBe(`/peticiones/generaciones/${id}`)
    await anonymous.close()

    // Con sesión: la generación se lee con sus grupos; grupos inválidos → 422; fotos que no son un grupo → 409 sin llamar al modelo.
    const read = await page.request.get(`${E2E_URL}/api/peticiones/generaciones/${id}`)
    expect(read.status()).toBe(200)
    expect(await read.json()).toMatchObject({ id, groups: [{ index: 1, fileIds: [seeded[0]!.fileId], image: null }] })
    expect((await page.request.post(`${E2E_URL}/api/peticiones/generaciones`, { data: { groups: [] } })).status()).toBe(422)
    expect((await page.request.post(`${E2E_URL}/api/peticiones/generaciones`, { data: { groups: [[seeded[0]!.fileId], [seeded[0]!.fileId]] } })).status()).toBe(422)
    const mismatch = await page.request.post(`${E2E_URL}/api/peticiones/imagenes`, { data: { fileIds: [seeded[1]!.fileId], generationId: id } })
    expect(mismatch.status()).toBe(409)
    expect((await mismatch.json()).data).toEqual({ code: 'generation_mismatch' })
    const missing = await page.request.post(`${E2E_URL}/api/peticiones/imagenes`, { data: { fileIds: [seeded[0]!.fileId], generationId: '00000000-0000-4000-8000-00000000dead' } })
    expect(missing.status()).toBe(404)
    expect((await missing.json()).data).toEqual({ code: 'generation_not_found' })
    expect(await prayerCalls()).toHaveLength(0)
    // Un 409 al crear la generación devuelve los ids que ya no están disponibles.
    const trashed = await page.request.post(`${E2E_URL}/api/peticiones/generaciones`, { data: { groups: [[seeded[0]!.fileId, '00000000-0000-4000-8000-00000000dead']] } })
    expect(trashed.status()).toBe(409)
    expect((await trashed.json()).data).toEqual({ code: 'request_unavailable', ids: ['00000000-0000-4000-8000-00000000dead'] })
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
    const names = await seedMany(`Orden ${token}`, 14)
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

    // Las elegidas se generan aunque el filtro las oculte («Generar imágenes» lleva a la página de la generación).
    await search(page, `nadie-${token}`)
    await expect.poll(() => page.getByText('No hay peticiones con esos filtros').isVisible()).toBe(true)
    await resetStub()
    await bar(page).getByRole('button', { name: 'Generar imágenes', exact: true }).click()
    await page.waitForURL(/\/peticiones\/generaciones\//, { timeout: 30_000 })
    await expect.poll(async () => (await prayerCalls()).length, { timeout: 30_000 }).toBe(1)
    expect((await prayerCalls())[0]!.photos).toHaveLength(2)
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
