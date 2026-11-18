// Página de una generación de Peticiones (feature 007, enmienda «Página de generación», 2026-11-15): cuatro estados, el pase de
// diapositivas (imagen lista, estados de la cola, «Sin terminar» + «Generar las faltantes»), ‹ › con vuelta, ← → del teclado,
// la posición en `?i=`, elegir varias para descargar, guardar en el drive y en colección, y el guardián de salida que deja
// pasar a /peticiones sin vaciar la cola.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { Me, PrayerGeneratedImage, PrayerGeneration } from '#shared/types/api'
import { PRAYER_ERROR_MESSAGES } from '#shared/constants/prayers'
import GenerationPage from '~/pages/peticiones/generaciones/[id].vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated, prayer } from './prayer-fixtures'

const { download, near } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { download: vi.fn(), near: ref(true) }
})
// happy-dom no tiene IntersectionObserver: las miniaturas se dan por cercanas.
mockNuxtImport('useElementVisibility', () => () => near)
mockNuxtImport('triggerDownload', () => download)

const GEN = '30000000-0000-4000-8000-000000000001'
const F = (n: number) => prayer(n).id
const image = (n: number, fileIds: string[]) => generated(n, { fileIds, requestCount: fileIds.length, generationId: GEN })
const generation = (groups: { fileIds: string[], image: PrayerGeneratedImage | null }[], changes: Partial<PrayerGeneration> = {}): PrayerGeneration => ({
  id: GEN,
  createdAt: '2026-11-15T16:32:00.000Z',
  author: { userId: 'u1', name: 'Ana', active: true },
  groups: groups.map((group, i) => ({ index: i + 1, ...group })),
  ...changes,
})
/** Dos listas y una sin imagen. */
const twoReady = () => generation([{ fileIds: [F(1), F(2)], image: image(1, [F(1), F(2)]) }, { fileIds: [F(3)], image: image(2, [F(3)]) }, { fileIds: [F(4)], image: null }])

const route = `/peticiones/generaciones/${GEN}`
const mount = (path = route) => mountSuspended(GenerationPage, { route: path, attachTo: document.body })
type Page = Awaited<ReturnType<typeof mount>>

const region = (wrapper: Page) => wrapper.get('[aria-label="Imágenes de la generación"]')
const thumbs = (wrapper: Page) => wrapper.findAll('ul[aria-label="Todas las imágenes de la generación"] > li > button')
const thumbLabels = (wrapper: Page) => thumbs(wrapper).map(button => button.attributes('aria-label'))
const current = (wrapper: Page) => thumbs(wrapper).findIndex(button => button.attributes('aria-current') === 'true')
const progress = (wrapper: Page) => wrapper.findAll('[role="status"]').find(el => /\d+ de \d+ lista/.test(el.text()))!.text()
const toasts = () => useToast().toasts.value.map(t => t.message)
const posts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')

/** La imagen guardada que responde el servidor, con la generación del cuerpo. */
const saved = async (event: H3Event): Promise<PrayerGeneratedImage> => {
  const { fileIds, generationId } = await readBody<{ fileIds: string[], generationId?: string }>(event)
  setResponseStatus(event, 201)
  return generated(9, { id: `40000000-0000-4000-8000-${fileIds[0]!.slice(-12)}`, previewUrl: `/api/peticiones/imagenes/nueva-${fileIds[0]}/content`, fileIds, requestCount: fileIds.length, generationId: generationId ?? null })
}
const failing = (status: number, code: string) => (event: H3Event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', data: { code } }
}

enableAutoUnmount(afterEach)

// happy-dom da por «completa» (y sin ancho) toda imagen nada más crearla, lo que la diapositiva leería como un fallo de carga
// del SSR; en el navegador una imagen recién pedida no está completa.
const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')

beforeEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => false })
  clearNuxtData()
  resetCalls()
  download.mockClear()
  near.value = true
  usePrayerImages().reset()
  useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY).value = []
  useState('prayer-drive-saves').value = {}
  useToast().toasts.value = []
  useConfirm().options.value = null
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', `/api/peticiones/generaciones/${GEN}`, () => twoReady())
  mockApi('GET', '/api/peticiones/colecciones', { items: [] })
  mockApi('POST', '/api/peticiones/imagenes', saved)
})

afterEach(() => {
  if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete)
})

describe('/peticiones/generaciones/:id · estados', () => {
  it('cargando: esqueleto con aria-busy y el h1 de la página', async () => {
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, () => new Promise(() => {}))
    const wrapper = await mount()
    await nextTick()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toBe('Generación')
  })

  it('no existe (404): aviso con Volver a Peticiones', async () => {
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, failWith(404))
    const wrapper = await mount()
    await flush()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Esta generación ya no existe')
    expect(alert.get('a').attributes('href')).toBe('/peticiones')
    expect(wrapper.findAll('a').filter(a => a.text().includes('Volver a Peticiones'))).toHaveLength(2)
    expect(wrapper.find('[aria-label="Imágenes de la generación"]').exists()).toBe(false)
  })

  it('error (500): ErrorState con Reintentar que vuelve a pedir y sale del error', async () => {
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, failWith(500))
    const wrapper = await mount()
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar la generación')
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, () => twoReady())
    const before = calls.filter(c => c.url === `/api/peticiones/generaciones/${GEN}`).length
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(calls.filter(c => c.url === `/api/peticiones/generaciones/${GEN}`).length).toBe(before + 1)
    expect(wrapper.find('[aria-label="Imágenes de la generación"]').exists()).toBe(true)
  })

  it('sin grupos: EmptyState con cómo generar', async () => {
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, () => generation([]))
    const wrapper = await mount()
    await flush()
    expect(wrapper.text()).toContain('Esta generación no tiene imágenes')
    expect(wrapper.text()).toContain('pulsa «Generar imágenes»')
  })
})

describe('/peticiones/generaciones/:id · contenido', () => {
  it('encabezado, progreso, la imagen lista en el escenario, el pie, las miniaturas y el aviso de las que faltan', async () => {
    const wrapper = await mount()
    await flush()
    expect(wrapper.get('h1').text()).toMatch(/^Generación del /)
    expect(wrapper.text()).toContain('Generada por Ana')
    expect(progress(wrapper)).toBe('2 de 3 listas')
    expect(region(wrapper).attributes('aria-roledescription')).toBe('carrusel')
    const img = region(wrapper).get('img[alt="Imagen 1 de peticiones, con 2 peticiones"]')
    expect(img.attributes('src')).toBe(image(1, [F(1), F(2)]).previewUrl)
    expect(img.attributes('fetchpriority')).toBe('high')
    const caption = wrapper.get('[aria-live="polite"][aria-atomic="true"]').text()
    expect(caption).toContain('Imagen 1 de 3 · 2 peticiones')
    expect(caption).toContain('por Ana')
    expect(thumbLabels(wrapper)).toEqual(['Ver la imagen 1, lista', 'Ver la imagen 2, lista', 'Ver la imagen 3, sin terminar'])
    expect(current(wrapper)).toBe(0)
    expect(thumbs(wrapper)[0]!.find('img').attributes('src')).toBe(image(1, [F(1), F(2)]).previewUrl)
    expect(wrapper.text()).toContain('1 imagen sin terminar')
    // Descargar la actual es un enlace; Volver a Peticiones está arriba y abajo.
    expect(wrapper.get('a[download]').attributes('href')).toBe(image(1, [F(1), F(2)]).downloadUrl)
    expect(wrapper.findAll('a').filter(a => a.attributes('href') === '/peticiones').length).toBeGreaterThanOrEqual(2)
    for (const el of [...wrapper.findAll('button'), ...wrapper.findAll('a')]) expect(el.classes().some(c => /^btn-(sm|xs)$/.test(c)), el.text()).toBe(false)
  })

  it('«Generar las faltantes» encola el grupo sin imagen ligado a la generación y la diapositiva pasa a lista al guardarse', async () => {
    const wrapper = await mount()
    await flush()
    await thumbs(wrapper)[2]!.trigger('click')
    await flush()
    expect(region(wrapper).text()).toContain('Sin terminar')
    expect(region(wrapper).text()).toContain('no llegó a generarse')
    await buttonsWithText(wrapper, 'Generar las faltantes')[0]!.trigger('click')
    await flush(15)
    expect(posts().map(c => c.body)).toEqual([{ fileIds: [F(4)], generationId: GEN }])
    expect(toasts()).toContain('1 imagen en cola')
    await vi.waitFor(() => expect(progress(wrapper)).toBe('3 de 3 listas'))
    expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, lista')
    expect(wrapper.text()).not.toContain('sin terminar')
    expect(region(wrapper).get('img[alt="Imagen 3 de peticiones, con 1 petición"]').attributes('src')).toContain(`nueva-${F(4)}`)
    expect(usePrayerImages().items.value).toEqual([])
  })

  it('en cola o generándose: esqueleto con estado y Cancelar; cancelada: Volver a poner en cola la encola de nuevo', async () => {
    mockApi('POST', '/api/peticiones/imagenes', () => new Promise(() => {}))
    usePrayerImages().enqueue([[{ id: F(4) }]], { generationId: GEN })
    const wrapper = await mount()
    await flush()
    expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, generándose')
    await thumbs(wrapper)[2]!.trigger('click')
    await flush()
    expect(region(wrapper).text()).toContain('Generándose…')
    expect(wrapper.text()).not.toContain('sin terminar')
    await buttonsWithText(region(wrapper), 'Cancelar')[0]!.trigger('click')
    await flush()
    expect(usePrayerImages().items.value[0]!.status).toBe('canceled')
    expect(region(wrapper).text()).toContain('Cancelaste esta imagen')
    expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, cancelada')
    await buttonsWithText(region(wrapper), 'Volver a poner en cola')[0]!.trigger('click')
    await flush()
    expect(usePrayerImages().items.value[0]!.status).toBe('running')
    expect(posts()).toHaveLength(2)
  })

  it('fallida sin reintento (foto ilegible): el motivo sin Reintentar; Descartar la deja sin terminar', async () => {
    mockApi('POST', '/api/peticiones/imagenes', failing(422, 'unreadable_image'))
    const wrapper = await mount()
    await flush()
    await buttonsWithText(wrapper, 'Generar las faltantes')[0]!.trigger('click')
    await flush(15)
    await thumbs(wrapper)[2]!.trigger('click')
    await flush()
    expect(region(wrapper).get('[role="alert"]').text()).toBe(PRAYER_ERROR_MESSAGES.unreadable_image)
    expect(buttonsWithText(region(wrapper), 'Reintentar')).toHaveLength(0)
    expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, no se pudo generar')
    await buttonsWithText(region(wrapper), 'Descartar')[0]!.trigger('click')
    await flush()
    expect(usePrayerImages().items.value).toEqual([])
    expect(region(wrapper).text()).toContain('Sin terminar')
  })

  it('fallida reintentable: Reintentar vuelve a pedir la misma imagen y llega', async () => {
    let attempts = 0
    mockApi('POST', '/api/peticiones/imagenes', (event: H3Event) => (++attempts === 1 ? failing(502, 'provider')(event) : saved(event)))
    const wrapper = await mount()
    await flush()
    await buttonsWithText(wrapper, 'Generar las faltantes')[0]!.trigger('click')
    await flush(15)
    await thumbs(wrapper)[2]!.trigger('click')
    await flush()
    expect(region(wrapper).get('[role="alert"]').text()).toBe(PRAYER_ERROR_MESSAGES.provider)
    await buttonsWithText(region(wrapper), 'Reintentar')[0]!.trigger('click')
    await flush(15)
    expect(posts().map(c => c.body)).toEqual([{ fileIds: [F(4)], generationId: GEN }, { fileIds: [F(4)], generationId: GEN }])
    await vi.waitFor(() => expect(progress(wrapper)).toBe('3 de 3 listas'))
  })
})

describe('/peticiones/generaciones/:id · pase de diapositivas', () => {
  it('‹ › cambian de imagen y dan la vuelta; la miniatura actual lleva aria-current y la posición va en ?i=', async () => {
    const wrapper = await mount()
    await flush()
    const router = useRouter()
    await wrapper.get('button[aria-label="Imagen siguiente"]').trigger('click')
    await flush()
    expect(current(wrapper)).toBe(1)
    expect(router.currentRoute.value.query.i).toBe('2')
    await wrapper.get('button[aria-label="Imagen siguiente"]').trigger('click')
    await wrapper.get('button[aria-label="Imagen siguiente"]').trigger('click')
    await flush()
    expect(current(wrapper)).toBe(0)
    expect(router.currentRoute.value.query.i).toBe('1')
    await wrapper.get('button[aria-label="Imagen anterior"]').trigger('click')
    await flush()
    expect(current(wrapper)).toBe(2)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Imagen 3 de 3')
  })

  it('abre en la diapositiva de ?i= y una posición fuera de rango cae en la última (regresión: el pase quedaba vacío)', async () => {
    const wrapper = await mount(`${route}?i=2`)
    await flush()
    expect(current(wrapper)).toBe(1)
    const beyond = await mount(`${route}?i=9`)
    await flush()
    expect(current(beyond)).toBe(2)
    expect(beyond.get('[aria-live="polite"]').text()).toContain('Imagen 3 de 3')
    expect(useRouter().currentRoute.value.query.i).toBe('3')
  })

  it('← → cambian de imagen solo con el foco dentro del pase', async () => {
    const wrapper = await mount()
    await flush()
    const first = thumbs(wrapper)[0]!
    ;(first.element as HTMLButtonElement).focus()
    await first.trigger('keydown', { key: 'ArrowRight' })
    await flush()
    expect(current(wrapper)).toBe(1)
    await first.trigger('keydown', { key: 'ArrowLeft' })
    await flush()
    expect(current(wrapper)).toBe(0)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await region(wrapper).trigger('keydown', { key: 'ArrowRight' })
    await flush()
    expect(current(wrapper)).toBe(0)
  })

  it('con una sola imagen no hay ‹ ›', async () => {
    mockApi('GET', `/api/peticiones/generaciones/${GEN}`, () => generation([{ fileIds: [F(1)], image: image(1, [F(1)]) }]))
    const wrapper = await mount()
    await flush()
    expect(wrapper.find('button[aria-label="Imagen siguiente"]').exists()).toBe(false)
    expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(0)
  })
})

describe('/peticiones/generaciones/:id · acciones', () => {
  it('«Descargar varias»: casillas solo en las listas, Todas, Descargar N de una en una con aviso, Limpiar y Terminar', async () => {
    const wrapper = await mount()
    await flush()
    await buttonsWithText(wrapper, 'Descargar varias')[0]!.trigger('click')
    await flush()
    const boxes = () => wrapper.findAll('ul[aria-label="Todas las imágenes de la generación"] input[type="checkbox"]')
    expect(boxes().map(box => box.attributes('aria-label'))).toEqual(['Elegir la imagen 1', 'Elegir la imagen 2'])
    expect(wrapper.text()).toContain('0 imágenes elegidas')
    await buttonsWithText(wrapper, 'Todas')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('2 imágenes elegidas')
    expect(boxes().every(box => (box.element as HTMLInputElement).checked)).toBe(true)
    await buttonsWithText(wrapper, 'Descargar 2')[0]!.trigger('click')
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2), { timeout: 5000 })
    expect(download.mock.calls.map(c => c[0])).toEqual([image(1, [F(1), F(2)]).downloadUrl, image(2, [F(3)]).downloadUrl])
    await vi.waitFor(() => expect(toasts()).toContain('Descargamos 2 imágenes'))
    await boxes()[0]!.trigger('change')
    await flush()
    expect(wrapper.text()).toContain('1 imagen elegida')
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('0 imágenes elegidas')
    await buttonsWithText(wrapper, 'Terminar')[0]!.trigger('click')
    await flush()
    expect(boxes()).toHaveLength(0)
    expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(1)
  })

  it('«Guardar en el drive» encola la imagen actual (aparece la lista de avances) y Cancelar la retira', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: unknown, init?: unknown) => (String(input).includes('/api/peticiones/imagenes/') ? new Promise(() => {}) : realFetch(input as RequestInfo, init as RequestInit)))
    try {
      const wrapper = await mount()
      await flush()
      await buttonsWithText(wrapper, 'Guardar en el drive')[0]!.trigger('click')
      await vi.waitFor(() => expect(wrapper.findAll('h2').some(h => h.text() === 'Guardar en el drive')).toBe(true), { timeout: 5000 })
      expect(wrapper.text()).toContain('Imagen 1')
      expect(wrapper.text()).toContain('Preparando la imagen…')
      expect(usePrayerDriveSave().list.value.map(save => [save.imageId, save.stage])).toEqual([[image(1, [F(1), F(2)]).id, 'downloading']])
      const list = wrapper.findAll('section').find(s => s.text().includes('Preparando la imagen…'))!
      await buttonsWithText(list, 'Cancelar')[0]!.trigger('click')
      await flush(10)
      expect(usePrayerDriveSave().list.value).toEqual([])
      expect(toasts()).toContain('Cancelamos el guardado en el drive')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('«Guardar en colección» abre el diálogo de colecciones para la imagen actual', async () => {
    const wrapper = await mount()
    await flush()
    await buttonsWithText(wrapper, 'Guardar en colección')[0]!.trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector('dialog h2')?.textContent).toBe('Guardar en una colección'), { timeout: 5000 })
    await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
    await flush()
    expect(document.body.querySelector('dialog[open]')).toBeNull()
  })
})

describe('/peticiones/generaciones/:id · guardián de salida', () => {
  it('volver a /peticiones con algo en curso no pregunta ni vacía la cola; salir a otra página pregunta y aceptar la cancela', async () => {
    mockApi('POST', '/api/peticiones/imagenes', () => new Promise(() => {}))
    usePrayerImages().enqueue([[{ id: F(4) }]], { generationId: GEN })
    await mount()
    await flush()
    const router = useRouter()
    await router.push('/peticiones')
    await flush()
    expect(useConfirm().options.value).toBeNull()
    expect(router.currentRoute.value.path).toBe('/peticiones')
    expect(usePrayerImages().items.value).toHaveLength(1)

    const leaving = router.push('/archivos')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Salir de Peticiones?')
    useConfirm().cancel()
    await leaving
    expect(usePrayerImages().items.value).toHaveLength(1)
    const leavingAgain = router.push('/archivos')
    await flush()
    useConfirm().accept()
    await leavingAgain
    expect(usePrayerImages().items.value).toEqual([])
    expect(router.currentRoute.value.path).toBe('/archivos')
  })

  it('sin nada en curso, salir no pregunta', async () => {
    await mount()
    await flush()
    const router = useRouter()
    await router.push('/archivos')
    await flush()
    expect(useConfirm().options.value).toBeNull()
    expect(router.currentRoute.value.path).toBe('/archivos')
  })
})
