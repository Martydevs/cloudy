// T033 / T051 / T066 / T077 — Página Peticiones (feature 007, quickstart § 3): tarjetas de peticiones aprobadas, selección,
// generación de imágenes contra el stub de OpenRouter (guardadas en el historial, enmienda de historial), corrección de
// transcripciones y filtros. Los datos se siembran en la
// rama de pruebas con `seedPrayerRequest`; las aprobaciones de esta corrida son las más recientes (otros archivos e2e corren
// antes, uno a la vez), así que salen primero en la rejilla.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PRAYER_ERROR_MESSAGES } from '../../shared/constants/prayers'
import { E2E_URL, prayerCalls, profileUserId, resetStub, runId, seedPrayerRequest, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'
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
    await seedPrayerRequest(owner, { senderName, text: `Petición ${i + 1} de ${prefix}`, reviewedAt: new Date(base - i * 1000), ...extra })
    names.push(senderName)
  }
  return names
}

/** Siembra una petición por texto; la primera queda como la aprobada más reciente (sale primero en la rejilla y última en las imágenes). */
async function seedTexts(prefix: string, texts: string[], extra: PrayerSeed = {}): Promise<{ name: string, fileId: string }[]> {
  const base = Date.now()
  const seeded: { name: string, fileId: string }[] = []
  for (const [i, text] of texts.entries()) {
    const name = `${prefix} ${String(i + 1).padStart(2, '0')} ${runId()}`
    const { fileId } = await seedPrayerRequest(owner, { senderName: name, text, reviewedAt: new Date(base - i * 1000), ...extra })
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
  it('solo aparecen las aprobadas, con foto, texto, nombre y fechas', async () => {
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
    expect(text).toContain('Petición 1 de Visible')
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

    await bar(page).getByRole('button', { name: 'Ver elegidas' }).click()
    const dialog = page.getByRole('dialog', { name: 'Peticiones elegidas' })
    await expect.poll(() => dialog.innerText()).toContain(names[0])
    expect(await dialog.innerText()).toContain(names[2])
    await dialog.getByRole('button', { name: 'Cerrar' }).first().click()
    await page.close()
  })

  it('una tarjeta sin texto no se puede marcar y dice por qué', async () => {
    const [name] = await seedMany('Sin texto', 1, { textStatus: 'empty', text: null })
    const page = await editorPage()
    await openPage(page)
    expect(await box(page, name!).isDisabled()).toBe(true)
    expect(await card(page, name!).innerText()).toContain('Sin texto: escríbelo primero')
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
  /** Tarjeta en curso de la cola (en cola, generándose, fallida o cancelada). */
  const result = (page: Page, n: number) => page.getByRole('article', { name: `Imagen de peticiones ${n}`, exact: true })
  const history = (page: Page) => page.getByRole('list', { name: 'Imágenes generadas', exact: true })
  /** La tarjeta del historial de una imagen guardada (por su enlace de descarga). */
  const saved = (page: Page, id: string) => history(page).getByRole('listitem').filter({ has: page.locator(`a[href="/api/peticiones/imagenes/${id}/content?download=1"]`) })

  /** Ids de las imágenes que el servidor guardó (respuestas 201 de `POST /api/peticiones/imagenes`), en orden de llegada. */
  function trackSaved(page: Page): { id: string, fileIds: string[], createdAt: string }[] {
    const ids: { id: string, fileIds: string[], createdAt: string }[] = []
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/peticiones/imagenes' || response.status() !== 201) return
      ids.push(await response.json())
    })
    return ids
  }

  /** Elige las tarjetas, pulsa **Generar imágenes** y acepta la confirmación con `confirmLabel`. */
  async function generate(page: Page, names: string[], confirmLabel = 'Generar') {
    for (const name of names) await box(page, name).check()
    await bar(page).getByRole('button', { name: 'Generar imágenes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Generar imágenes' })
    await dialog.getByRole('button', { name: confirmLabel, exact: true }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
  }

  beforeEach(async () => {
    await resetStub()
  })

  it('5 → 2 imágenes: la plantilla y los textos (sin nombres ni notas) viajan al stub; se guardan en el historial, sobreviven a una recarga, se descargan, se amplían y se generan de nuevo', async () => {
    const texts = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map(word => `Petición ${word} ${runId()}`)
    const seeded = await seedTexts('Generar', texts, { note: `Nota privada ${runId()}` })
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, seeded.map(s => s.name))

    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    for (const { id } of ids) await expect.poll(() => saved(page, id).isVisible(), { timeout: 10_000 }).toBe(true)
    // Lo guardado sale de la cola: ya no hay tarjetas en curso.
    await expect.poll(() => page.getByRole('list', { name: 'Imágenes en curso' }).count()).toBe(0)
    // La selección se conserva para corregir y volver a generar.
    expect(await bar(page).innerText()).toContain('5 peticiones → 2 imágenes')

    const calls = await prayerCalls()
    expect(calls).toHaveLength(2)
    // Orden de aprobación: la más antigua (la última sembrada) abre la primera imagen.
    const byTags = [...calls].sort((a, b) => b.tags - a.tags)
    expect(byTags.map(c => c.texts)).toEqual([[texts[4], texts[3], texts[2], texts[1]], [texts[0]]])
    for (const call of calls) {
      expect(call).toMatchObject({ model: '@preset/pray-requests-image-generation', template: true, status: 200 })
      expect(call.modalities).toContain('image')
      for (const { name } of seeded) expect(call.prompt).not.toContain(name)
      expect(call.prompt).not.toContain('Nota privada')
    }
    // La fila guarda los ids de sus peticiones, nunca su texto.
    const four = ids.find(i => i.fileIds.length === 4)!
    const one = ids.find(i => i.fileIds.length === 1)!
    expect(one.fileIds).toEqual([seeded[0]!.fileId])
    expect(await saved(page, four.id).innerText()).toContain('4 peticiones')

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

    // **Generar de nuevo** desde el historial: las mismas peticiones, otra imagen guardada; las anteriores siguen.
    await saved(page, one.id).getByRole('button', { name: 'Opciones de la imagen' }).click()
    await page.getByRole('menuitem', { name: 'Generar de nuevo' }).click()
    await expect.poll(async () => (await prayerCalls()).length, { timeout: 30_000 }).toBe(3)
    expect((await prayerCalls())[2]!.texts).toEqual([texts[0]])
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(3)
    expect(ids[2]!.fileIds).toEqual(one.fileIds)
    await expect.poll(() => saved(page, ids[2]!.id).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await saved(page, one.id).isVisible()).toBe(true)
    await page.close()
  })

  it('con texto [ilegible] la confirmación avisa y ofrece «Generar de todos modos»', async () => {
    const [unreadable] = await seedTexts('Ilegible', [`Oremos por [ilegible] ${runId()}`])
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await box(page, unreadable!.name).check()
    await expect.poll(() => bar(page).innerText()).toContain('1 petición todavía tiene texto ilegible')
    await bar(page).getByRole('button', { name: 'Generar imágenes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Generar imágenes' })
    await expect.poll(() => dialog.innerText()).toContain('1 petición todavía tiene texto ilegible')
    await dialog.getByRole('button', { name: 'Generar de todos modos' }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    expect((await prayerCalls()).map(c => c.texts)).toEqual([[`Oremos por [ilegible] ${runId()}`]])
    await page.close()
  })

  it('un fallo del servicio muestra el motivo y Reintentar solo en esa imagen; la otra se guarda', async () => {
    // La más antigua (última) cae en la imagen 1 junto con otras tres; la más reciente sola en la 2.
    const texts = [`Sigue bien ${runId()}`, `B ${runId()}`, `C ${runId()}`, `D ${runId()}`, `falla-una-vez ${runId()}`]
    const seeded = await seedTexts('Falla', texts)
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, seeded.map(s => s.name))

    await expect.poll(() => result(page, 1).getByRole('alert').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await result(page, 1).getByRole('alert').innerText()).toBe(PRAYER_ERROR_MESSAGES.provider)
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    expect(ids[0]!.fileIds).toEqual([seeded[0]!.fileId])
    expect(await result(page, 2).count()).toBe(0)

    await result(page, 1).getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => result(page, 1).count()).toBe(0)
    await page.close()
  })

  it('sin crédito: el motivo sin Reintentar y nada se guarda', async () => {
    const [request] = await seedTexts('Sin credito', [`sin-credito ${runId()}`])
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await generate(page, [request!.name])
    await expect.poll(() => result(page, 1).getByRole('alert').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await result(page, 1).getByRole('alert').innerText()).toBe(PRAYER_ERROR_MESSAGES.quota_exceeded)
    expect(await result(page, 1).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    expect(await result(page, 1).getByRole('button', { name: 'Descartar' }).isVisible()).toBe(true)
    expect(ids).toHaveLength(0)
    await page.close()
  })

  it('una petición enviada a la papelera tras elegirla → 409: se retira de la selección con un aviso', async () => {
    const [kept, trashed] = await seedTexts('Papelera', [`Se queda ${runId()}`, `Se va ${runId()}`])
    const page = await editorPage()
    await openPage(page)
    for (const { name } of [kept!, trashed!]) await box(page, name).check()
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')
    // Otra persona la envía a la papelera mientras tanto (rama de pruebas, como `seedPrayerRequest({ deleted: true })`).
    await testSql()`UPDATE files SET deleted_at = now(), deleted_by = ${owner}, trash_root_id = id WHERE id = ${trashed!.fileId}`

    await bar(page).getByRole('button', { name: 'Generar imágenes' }).click()
    await page.getByRole('dialog', { name: 'Generar imágenes' }).getByRole('button', { name: 'Generar', exact: true }).click()
    await expect.poll(() => page.getByText('Quitamos 1 petición que ya no está disponible').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await result(page, 1).getByRole('alert').innerText()).toBe(PRAYER_ERROR_MESSAGES.request_unavailable)
    expect(await result(page, 1).getByRole('button', { name: 'Reintentar' }).count()).toBe(0)
    expect(await box(page, trashed!.name).isChecked()).toBe(false)
    expect(await box(page, kept!.name).isChecked()).toBe(true)
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')
    expect(await prayerCalls()).toHaveLength(0)
    await page.close()
  })

  it('salir con una imagen generándose pide confirmación; una ya guardada no', async () => {
    const [slow, quick] = await seedTexts('Salir', [`lento antes de salir ${runId()}`, `Rápida ${runId()}`])
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

    // Generándose (el stub tarda con «lento»): pregunta; Cancelar se queda.
    await generate(page, [slow!.name])
    await expect.poll(() => result(page, 1).getByRole('status').isVisible()).toBe(true)
    await leave()
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    expect(new URL(page.url()).pathname).toBe('/peticiones')

    await leave()
    await dialog.getByRole('button', { name: 'Salir' }).click()
    await page.waitForURL(url => url.pathname === '/')
    // Si la llamada lenta llegó al stub antes de cancelarse, el stub la registra al terminar su espera (4 s): se deja pasar
    // ese plazo para que no se cuele en las cuentas de la prueba siguiente.
    await page.waitForTimeout(5_000)
    await page.close()
  })

  it('con la red cortada la imagen queda en error reintentable con un mensaje accionable y la selección se conserva', async () => {
    const [request] = await seedTexts('Sin red', [`Sin conexión ${runId()}`])
    const page = await editorPage()
    const ids = trackSaved(page)
    await openPage(page)
    await box(page, request!.name).check()
    await page.context().setOffline(true)
    await bar(page).getByRole('button', { name: 'Generar imágenes' }).click()
    await page.getByRole('dialog', { name: 'Generar imágenes' }).getByRole('button', { name: 'Generar', exact: true }).click()

    await expect.poll(() => result(page, 1).getByRole('alert').isVisible(), { timeout: 30_000 }).toBe(true)
    expect(await result(page, 1).getByRole('alert').innerText()).toContain('Se perdió la conexión al generar la imagen')
    expect(await box(page, request!.name).isChecked()).toBe(true)
    expect(await bar(page).innerText()).toContain('1 petición → 1 imagen')

    await page.context().setOffline(false)
    await result(page, 1).getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(() => ids.length, { timeout: 30_000 }).toBe(1)
    await page.close()
  })
})

describe('US3 · corregir la transcripción antes de generar', () => {
  const textDialog = (page: Page, sender: string) => page.getByRole('dialog', { name: `Transcripción de ${sender}` })
  const textbox = (page: Page, sender: string) => textDialog(page, sender).getByRole('textbox', { name: 'Texto de la imagen' })

  /** Abre el diálogo desde la tarjeta con `button` y entra en edición con `edit` («Editar» o «Escribir el texto»). */
  async function openEditor(page: Page, sender: string, button: string, edit = 'Editar') {
    await card(page, sender).getByRole('button', { name: button }).click()
    const dialog = textDialog(page, sender)
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: edit }).click()
    await expect.poll(() => textbox(page, sender).isVisible()).toBe(true)
    return dialog
  }

  async function closeDialog(page: Page, sender: string) {
    await textDialog(page, sender).getByRole('button', { name: 'Cerrar' }).first().click()
    await expect.poll(() => textDialog(page, sender).isVisible()).toBe(false)
  }

  beforeEach(async () => {
    await resetStub()
  })

  it('[ilegible] → Corregir texto → la tarjeta queda Editada y sin aviso; recargar lo conserva; genera con el texto nuevo', async () => {
    const name = `Corregir ${runId()}`
    const fixed = `Oremos por la familia Pérez ${runId()}`
    await seedPrayerRequest(owner, { senderName: name, text: `Oremos por la familia [ilegible] ${runId()}` })
    const page = await editorPage()
    await openPage(page)
    expect(await card(page, name).innerText()).toContain('Texto por corregir')
    await box(page, name).check()
    await expect.poll(() => bar(page).innerText()).toContain('1 petición todavía tiene texto ilegible')

    const dialog = await openEditor(page, name, 'Corregir texto')
    await expect.poll(() => dialog.getByRole('img', { name: `Foto enviada por ${name}` }).isVisible()).toBe(true)
    await textbox(page, name).fill(fixed)
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => page.getByText('Texto guardado').isVisible()).toBe(true)
    await closeDialog(page, name)

    await expect.poll(() => card(page, name).innerText()).toContain(fixed)
    const text = await card(page, name).innerText()
    expect(text).toContain('Editada')
    expect(text).not.toContain('Texto por corregir')
    // La copia elegida también tomó el texto: la barra ya no avisa y genera con el texto corregido.
    expect(await box(page, name).isChecked()).toBe(true)
    await expect.poll(() => bar(page).innerText()).not.toContain('ilegible')
    await bar(page).getByRole('button', { name: 'Generar imágenes' }).click()
    await page.getByRole('dialog', { name: 'Generar imágenes' }).getByRole('button', { name: 'Generar', exact: true }).click()
    await expect.poll(async () => (await prayerCalls()).length, { timeout: 30_000 }).toBe(1)
    expect((await prayerCalls())[0]!.texts).toEqual([fixed])

    await page.reload()
    await waitForHydration(page)
    await expect.poll(() => card(page, name).innerText()).toContain(fixed)
    expect(await card(page, name).innerText()).toContain('Editada')
    await page.close()
  })

  it('una tarjeta sin texto: Escribir transcripción → guardar → ya se puede marcar', async () => {
    const name = `Escribir ${runId()}`
    await seedPrayerRequest(owner, { senderName: name, textStatus: 'empty', text: null })
    const page = await editorPage()
    await openPage(page)
    expect(await box(page, name).isDisabled()).toBe(true)

    const dialog = await openEditor(page, name, 'Escribir transcripción', 'Escribir el texto')
    await textbox(page, name).fill(`Escrito a mano ${runId()}`)
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => card(page, name).innerText()).toContain(`Escrito a mano ${runId()}`)
    await closeDialog(page, name)
    expect(await box(page, name).isDisabled()).toBe(false)
    await box(page, name).check()
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')
    await page.close()
  })

  it('vacío o de más de 10 000 caracteres no se puede guardar y lo indica', async () => {
    const name = `Validar ${runId()}`
    await seedPrayerRequest(owner, { senderName: name, text: `Texto original ${runId()}` })
    const page = await editorPage()
    await openPage(page)
    const dialog = await openEditor(page, name, 'Corregir texto')
    const save = dialog.getByRole('button', { name: 'Guardar' })

    await textbox(page, name).fill('   ')
    expect(await save.isDisabled()).toBe(true)
    expect(await textbox(page, name).getAttribute('aria-invalid')).toBe('true')

    await textbox(page, name).fill('a'.repeat(10_001))
    expect(await save.isDisabled()).toBe(true)
    expect(await dialog.innerText()).toContain('10 001 / 10 000')
    await closeDialog(page, name)
    expect(await card(page, name).innerText()).toContain(`Texto original ${runId()}`)
    await page.close()
  })

  it('sin red, Guardar avisa y conserva lo escrito; al volver la red, guardar funciona', async () => {
    const name = `Sin red texto ${runId()}`
    const typed = `Escrito sin conexión ${runId()}`
    await seedPrayerRequest(owner, { senderName: name, text: `Antes ${runId()}` })
    const page = await editorPage()
    await openPage(page)
    const dialog = await openEditor(page, name, 'Corregir texto')
    await textbox(page, name).fill(typed)

    await page.context().setOffline(true)
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => page.getByText('No pudimos guardar el texto').isVisible()).toBe(true)
    expect(await textbox(page, name).inputValue()).toBe(typed)

    await page.context().setOffline(false)
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => card(page, name).innerText()).toContain(typed)
    await page.close()
  })
})

describe('US4 · buscar, filtrar por fecha y ordenar', () => {
  const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Buscar por nombre, nota o texto' })
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

  it('la búsqueda no distingue tildes y un nombre muestra solo sus tarjetas', async () => {
    const token = `tk${runId()}`
    const [withAccent] = await seedTexts('Busqueda', [`Una oración especial ${token}`])
    const [named] = await seedTexts(`Lucía ${token}`, [`Otra cosa ${token}`])
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
    // Las elegidas siguen listadas aunque el filtro las oculte.
    await bar(page).getByRole('button', { name: 'Ver elegidas' }).click()
    const chosen = page.getByRole('dialog', { name: 'Peticiones elegidas' })
    await expect.poll(() => chosen.innerText()).toContain(names[0])
    expect(await chosen.innerText()).toContain(names[1])
    await chosen.getByRole('button', { name: 'Cerrar' }).first().click()

    await page.getByRole('button', { name: 'Quitar filtros' }).last().click()
    await expect.poll(() => page.getByText('No hay peticiones con esos filtros').isVisible()).toBe(false)
    expect(await searchBox(page).inputValue()).toBe('')
    await expect.poll(async () => (await visibleNames(page)).length).toBe(12)
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
