// Página de una generación de Peticiones (`/peticiones/generaciones/:id`, enmienda «Página de generación»): encabezado
// (título, autor, avance), sus estados (cargando, no encontrada, error con reintento, vacía y contenido), el pase de
// diapositivas con su pie y sus miniaturas, descargar una o varias (de una en una, con pausa), guardar en el drive y en
// una colección, «Generar las faltantes» y las acciones de cada diapositiva sobre la cola, y el guardián de salida que
// conserva la cola entre /peticiones y una generación.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { Me, PrayerGeneratedImage, PrayerGeneration, PrayerGenerationGroup } from '#shared/types/api'
import GenerationPage from '~/pages/peticiones/generaciones/[id].vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated, prayer } from './prayer-fixtures'

const { visible, triggerDownload, drive } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    visible: ref(true),
    triggerDownload: vi.fn(),
    drive: {
      save: vi.fn((_images: readonly { image: { id: string }, label: string }[]) => 0),
      hasSaves: ref(false),
      list: ref<never[]>([]),
      cancel: vi.fn(),
      retry: vi.fn(),
      dismiss: vi.fn(),
    },
  }
})
// happy-dom no tiene IntersectionObserver: la cercanía de las miniaturas (`near`) se controla a mano.
mockNuxtImport('useElementVisibility', () => () => visible)
// La descarga real crea un enlace y lo pulsa: aquí solo interesa qué se pide descargar y con qué nombre.
mockNuxtImport('triggerDownload', () => triggerDownload)
// «Guardar en el drive» tiene su propia prueba: aquí se comprueba qué le pasa la página.
mockNuxtImport('usePrayerDriveSave', () => () => drive)

const GEN = '30000000-0000-4000-8000-000000000001'
const OTHER = '30000000-0000-4000-8000-000000000002'
const URL = `/api/peticiones/generaciones/${GEN}`
const PATH = `/peticiones/generaciones/${GEN}`
const CREATED_AT = '2026-11-15T10:32:00.000Z'

type Reply = (event: H3Event) => unknown
interface ImageBody { fileIds: string[], generationId?: string }
type Page = Awaited<ReturnType<typeof mountSuspended<typeof GenerationPage>>>

const ids = (...numbers: number[]) => numbers.map(n => prayer(n).id)

/** La imagen guardada del grupo `index`. */
const imageOf = (index: number, numbers: number[], changes: Partial<PrayerGeneratedImage> = {}) =>
  generated(index, { fileIds: ids(...numbers), requestCount: numbers.length, generationId: GEN, ...changes })

const group = (index: number, numbers: number[], image: PrayerGeneratedImage | null = null): PrayerGenerationGroup =>
  ({ index, fileIds: ids(...numbers), image })

const generation = (groups: PrayerGenerationGroup[], changes: Partial<PrayerGeneration> = {}): PrayerGeneration => ({
  id: GEN,
  createdAt: CREATED_AT,
  author: { userId: 'u1', name: 'Ana', active: true },
  groups,
  ...changes,
})

/** Dos imágenes listas (la segunda, de alguien que ya no está activo) y una sin terminar. */
const standard = () => generation([
  group(1, [1, 2], imageOf(1, [1, 2])),
  group(2, [3], imageOf(2, [3], { author: { userId: 'u9', name: 'Beto', active: false } })),
  group(3, [4]),
])

// ---- POST /api/peticiones/imagenes: la respuesta se cambia por prueba y se puede dejar esperando.
const saved: Reply = async (event) => {
  const body = await readBody<ImageBody>(event)
  setResponseStatus(event, 201)
  return generated(90, { id: `saved-${body.fileIds[0]}`, fileIds: body.fileIds, requestCount: body.fileIds.length, generationId: body.generationId ?? null })
}
const fail = (status: number, code: string): Reply => (event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', data: { code } }
}
let reply: Reply = saved
let gates: (() => void)[] = []
/** La respuesta espera hasta `release()` y entonces contesta con `then`. */
const held = (then: Reply = saved): Reply => async (event) => {
  await new Promise<void>(resolve => gates.push(resolve))
  return then(event)
}
function release() {
  for (const open of gates) open()
  gates = []
}
const imagePosts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')

const added = () => useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => [])
const toasts = () => useToast().toasts.value.map(toast => toast.message)

async function mountPage(route = PATH) {
  const wrapper = await mountSuspended(GenerationPage, { attachTo: document.body, route })
  await flush()
  return wrapper
}

// ---- Consultas por rol, nombre accesible o texto
const caption = (wrapper: Page) => wrapper.get('[aria-live="polite"][aria-atomic="true"]').text()
const thumbs = (wrapper: Page) => wrapper.get('ul[aria-label="Todas las imágenes de la generación"]').findAll('li > button')
const thumbLabels = (wrapper: Page) => thumbs(wrapper).map(thumb => thumb.attributes('aria-label'))
const links = (wrapper: Page, text: string) => wrapper.findAll('a').filter(link => link.text().trim() === text)
const checkboxes = (wrapper: Page) => wrapper.findAll('input[type="checkbox"]')
const statuses = (wrapper: Page) => wrapper.findAll('[role="status"]').map(status => status.text())
/** Va a la diapositiva `n` (1-based) por su miniatura. */
async function goTo(wrapper: Page, n: number) {
  await thumbs(wrapper)[n - 1]!.trigger('click')
  await flush()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  visible.value = true
  triggerDownload.mockClear()
  drive.save.mockReset()
  drive.save.mockImplementation(images => images.length)
  drive.hasSaves.value = false
  reply = saved
  gates = []
  usePrayerImages().reset()
  usePrayerSelection().clear()
  added().value = []
  useToast().toasts.value = []
  // happy-dom da todo `<img>` por terminado con ancho 0 (para la diapositiva, «falló antes de hidratar»): en un navegador
  // la imagen recién montada sigue cargando.
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', URL, standard())
  mockApi('GET', '/api/peticiones/colecciones', { items: [] })
  mockApi('POST', '/api/peticiones/imagenes', (event: H3Event) => reply(event))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  release()
  usePrayerImages().reset()
})

describe('/peticiones/generaciones/<id>', () => {
  describe('estados', () => {
    it('cargando: esqueleto y un título para lectores de pantalla', async () => {
      mockApi('GET', URL, () => new Promise(() => {}))
      const wrapper = await mountSuspended(GenerationPage, { attachTo: document.body, route: PATH })
      await nextTick()
      expect(wrapper.get('h1').text()).toBe('Generación')
      expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
      expect(wrapper.find('section[aria-label="Imágenes de la generación"]').exists()).toBe(false)
    })

    it('no encontrada: lo explica y ofrece volver a Peticiones, sin «Reintentar»', async () => {
      mockApi('GET', URL, failWith(404))
      const wrapper = await mountPage()
      expect(wrapper.get('[role="alert"]').text()).toContain('Esta generación ya no existe: se borra cuando ya no le queda ninguna imagen guardada.')
      const back = links(wrapper, 'Volver a Peticiones')
      expect(back).toHaveLength(2)
      expect(back.map(link => link.attributes('href'))).toEqual(['/peticiones', '/peticiones'])
      expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
      expect(wrapper.get('h1').text()).toBe('Generación')
    })

    it('error: ErrorState con «Reintentar», que vuelve a pedir y muestra la generación', async () => {
      mockApi('GET', URL, failWith(500))
      const wrapper = await mountPage()
      expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar la generación. Revisa tu conexión.')
      expect(links(wrapper, 'Volver a Peticiones')).toHaveLength(0)
      mockApi('GET', URL, standard())
      const before = calls.filter(c => c.url === URL).length
      await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
      await flush()
      expect(calls.filter(c => c.url === URL)).toHaveLength(before + 1)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.find('section[aria-label="Imágenes de la generación"]').exists()).toBe(true)
    })

    it('vacía: EmptyState con la forma de volver a generar', async () => {
      mockApi('GET', URL, generation([]))
      const wrapper = await mountPage()
      expect(wrapper.get('h2').text()).toBe('Esta generación no tiene imágenes')
      expect(wrapper.text()).toContain('Vuelve a Peticiones, elige las peticiones y pulsa «Generar imágenes».')
      expect(links(wrapper, 'Volver a Peticiones').map(link => link.attributes('href'))).toEqual(['/peticiones'])
      expect(wrapper.find('section[aria-label="Imágenes de la generación"]').exists()).toBe(false)
    })
  })

  describe('contenido', () => {
    it('encabezado: título con el día y la hora, autor, avance y el aviso de las que faltan', async () => {
      const wrapper = await mountPage()
      const headings = wrapper.findAll('h1')
      expect(headings).toHaveLength(1)
      expect(headings[0]!.text()).toBe(`Generación del ${formatDayTime(CREATED_AT)}`)
      expect(wrapper.text()).toContain('Generada por Ana')
      expect(statuses(wrapper)).toContain('2 de 3 listas')
      expect(wrapper.text()).toContain('1 imagen sin terminar')
      expect(buttonsWithText(wrapper, 'Generar las faltantes')).toHaveLength(1)
      expect(links(wrapper, 'Volver a Peticiones').map(link => link.attributes('href'))).toEqual(['/peticiones'])
      expect(wrapper.get('section[aria-label="Imágenes de la generación"]').attributes('aria-roledescription')).toBe('carrusel')
    })

    it('quien la generó ya no está activo: no se muestra su nombre; una sola imagen va en singular y sin aviso', async () => {
      mockApi('GET', URL, generation([group(1, [1], imageOf(1, [1]))], { author: { userId: 'u9', name: 'Beto', active: false } }))
      const wrapper = await mountPage()
      expect(wrapper.text()).toContain('Generada por Usuario que ya no está activo')
      expect(wrapper.text()).not.toContain('Beto')
      expect(statuses(wrapper)).toContain('1 de 1 lista')
      expect(wrapper.text()).not.toContain('sin terminar')
      expect(buttonsWithText(wrapper, 'Generar las faltantes')).toHaveLength(0)
      // Con una sola diapositiva no hay ‹ › ni «Descargar varias».
      expect(wrapper.find('button[aria-label="Imagen siguiente"]').exists()).toBe(false)
      expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(0)
      expect(links(wrapper, 'Descargar')).toHaveLength(1)
    })

    it('la primera diapositiva: imagen con prioridad alta, pie con quién la generó y sus acciones', async () => {
      const wrapper = await mountPage()
      const first = imageOf(1, [1, 2])
      const img = wrapper.get('img[alt="Imagen 1 de peticiones, con 2 peticiones"]')
      expect(img.attributes('src')).toBe(first.previewUrl)
      expect(img.attributes('fetchpriority')).toBe('high')
      expect(caption(wrapper)).toMatch(/^Imagen 1 de 3 · 2 peticiones · .+ por Ana$/)

      const download = links(wrapper, 'Descargar')
      expect(download).toHaveLength(1)
      expect(download[0]!.attributes('href')).toBe(first.downloadUrl)
      expect(download[0]!.attributes('download')).toBeDefined()
      for (const text of ['Descargar varias', 'Guardar en el drive', 'Guardar en colección']) expect(buttonsWithText(wrapper, text)).toHaveLength(1)
      expect(links(wrapper, 'Volver').map(link => link.attributes('href'))).toEqual(['/peticiones'])
    })

    it('‹ › cambian de diapositiva con vuelta al final, el pie la acompaña y la posición queda en ?i=', async () => {
      const wrapper = await mountPage()
      await wrapper.get('button[aria-label="Imagen siguiente"]').trigger('click')
      await flush()
      // La imagen es de alguien que ya no está activo: el pie no dice su nombre.
      expect(caption(wrapper)).toMatch(/^Imagen 2 de 3 · 1 petición · .+ por Usuario que ya no está activo$/)
      expect(useRoute().query.i).toBe('2')
      // Ya no es la primera pintura.
      expect(wrapper.get('img[alt="Imagen 2 de peticiones, con 1 petición"]').attributes('fetchpriority')).toBe('auto')
      expect(links(wrapper, 'Descargar')[0]!.attributes('href')).toBe(imageOf(2, [3]).downloadUrl)

      await wrapper.get('button[aria-label="Imagen anterior"]').trigger('click')
      await wrapper.get('button[aria-label="Imagen anterior"]').trigger('click')
      await flush()
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · sin terminar')
      expect(useRoute().query.i).toBe('3')
    })

    it('abre en la diapositiva de ?i=; una sin terminar no ofrece descargar ni guardar', async () => {
      const wrapper = await mountPage(`${PATH}?i=3`)
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · sin terminar')
      expect(thumbs(wrapper).map(thumb => thumb.attributes('aria-current'))).toEqual([undefined, undefined, 'true'])
      expect(wrapper.text()).toContain('Esta imagen no llegó a generarse')
      expect(links(wrapper, 'Descargar')).toHaveLength(0)
      expect(buttonsWithText(wrapper, 'Guardar en el drive')).toHaveLength(0)
      expect(buttonsWithText(wrapper, 'Guardar en colección')).toHaveLength(0)
      // Lo que no depende de la diapositiva sigue ahí.
      expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(1)
      expect(links(wrapper, 'Volver')).toHaveLength(1)
    })

    it('con una sola imagen lista no se ofrece «Descargar varias»', async () => {
      mockApi('GET', URL, generation([group(1, [1], imageOf(1, [1])), group(2, [2])]))
      const wrapper = await mountPage()
      expect(links(wrapper, 'Descargar')).toHaveLength(1)
      expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(0)
    })

    it('miniaturas: nombran cada imagen con su estado y solo piden la foto de las listas que están cerca', async () => {
      mockApi('GET', URL, generation([
        group(1, [1], imageOf(1, [1])),
        group(2, [2]),
        group(3, [3]),
        group(4, [4]),
        group(5, [5]),
      ]))
      // Como al llegar desde /peticiones: tres imágenes de esta generación en la cola (dos a la vez) y una sin encolar.
      reply = held(fail(502, 'provider'))
      usePrayerImages().enqueue([[{ id: prayer(2).id }], [{ id: prayer(3).id }], [{ id: prayer(4).id }]], { generationId: GEN })
      visible.value = false
      const wrapper = await mountPage()
      expect(thumbLabels(wrapper)).toEqual([
        'Ver la imagen 1, lista',
        'Ver la imagen 2, generándose',
        'Ver la imagen 3, generándose',
        'Ver la imagen 4, en cola',
        'Ver la imagen 5, sin terminar',
      ])
      // Lejos del borde visible de la fila, ninguna miniatura pide su imagen.
      expect(thumbs(wrapper).map(thumb => thumb.find('img').exists())).toEqual([false, false, false, false, false])

      visible.value = true
      await nextTick()
      expect(thumbs(wrapper).map(thumb => thumb.find('img').exists())).toEqual([true, false, false, false, false])
      const img = thumbs(wrapper)[0]!.get('img')
      expect(img.attributes('src')).toBe(imageOf(1, [1]).previewUrl)
      // Decorativa: el nombre lo da el botón.
      expect(img.attributes('alt')).toBe('')
      expect(statuses(wrapper)).toContain('1 de 5 listas')

      // Las dos que corrían fallan y la que esperaba arranca.
      release()
      await flush(10)
      expect(thumbLabels(wrapper)).toEqual([
        'Ver la imagen 1, lista',
        'Ver la imagen 2, no se pudo generar',
        'Ver la imagen 3, no se pudo generar',
        'Ver la imagen 4, generándose',
        'Ver la imagen 5, sin terminar',
      ])
      expect(thumbs(wrapper).map(thumb => thumb.find('img').exists())).toEqual([true, false, false, false, false])
    })
  })

  describe('generar las faltantes y la cola', () => {
    it('el aviso del encabezado encola las que faltan ligadas a la generación; al terminar, la imagen aparece', async () => {
      const wrapper = await mountPage(`${PATH}?i=3`)
      reply = held()
      await buttonsWithText(wrapper.get('header'), 'Generar las faltantes')[0]!.trigger('click')
      await flush()
      expect(imagePosts().map(c => c.body)).toEqual([{ fileIds: ids(4), generationId: GEN }])
      expect(toasts()).toContain('1 imagen en cola')
      // Ya no hay nada sin terminar: el aviso desaparece y la diapositiva dice que se está generando.
      expect(wrapper.text()).not.toContain('1 imagen sin terminar')
      expect(buttonsWithText(wrapper, 'Generar las faltantes')).toHaveLength(0)
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · generándose')
      expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, generándose')
      expect(wrapper.text()).toContain('Generándose… suele tardar menos de un minuto.')
      expect(statuses(wrapper)).toContain('2 de 3 listas')

      release()
      await flush(10)
      expect(statuses(wrapper)).toContain('3 de 3 listas')
      expect(thumbLabels(wrapper)[2]).toBe('Ver la imagen 3, lista')
      expect(caption(wrapper)).toMatch(/^Imagen 3 de 3 · 1 petición · .+ por Ana$/)
      expect(links(wrapper, 'Descargar')[0]!.attributes('href')).toBe(generated(90).downloadUrl)
      expect(usePrayerImages().items.value).toEqual([])
    })

    it('desde la diapositiva: generar, cancelar, volver a poner en cola, reintentar y descartar actúan sobre su imagen de la cola', async () => {
      const wrapper = await mountPage(`${PATH}?i=3`)
      const stage = () => wrapper.get('section[aria-label="Imágenes de la generación"]')

      // «Generar las faltantes» de la propia diapositiva (hay otro en el encabezado).
      reply = held()
      const missing = buttonsWithText(stage(), 'Generar las faltantes')
      expect(missing).toHaveLength(2)
      await missing[1]!.trigger('click')
      await flush()
      expect(imagePosts()).toHaveLength(1)
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · generándose')

      await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
      await flush()
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · cancelada')
      expect(wrapper.text()).toContain('Cancelaste esta imagen.')
      expect(usePrayerImages().items.value.map(item => item.status)).toEqual(['canceled'])

      // Vuelve a la cola y esta vez el servicio falla con algo que se puede reintentar.
      reply = held(fail(502, 'provider'))
      await buttonsWithText(wrapper, 'Volver a poner en cola')[0]!.trigger('click')
      await flush()
      expect(imagePosts()).toHaveLength(2)
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · generándose')
      release()
      await flush(10)
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · no se pudo generar')
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)

      // Reintentar: ahora se agotó el crédito y reintentar ya no sirve.
      reply = fail(503, 'quota_exceeded')
      await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
      await flush(10)
      expect(imagePosts()).toHaveLength(3)
      expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)

      // Descartar la saca de la cola: vuelve a estar sin terminar.
      await buttonsWithText(wrapper, 'Descartar')[0]!.trigger('click')
      await flush()
      expect(usePrayerImages().items.value).toEqual([])
      expect(caption(wrapper)).toBe('Imagen 3 de 3 · 1 petición · sin terminar')
      expect(wrapper.text()).toContain('1 imagen sin terminar')
    })
  })

  describe('descargar varias', () => {
    async function selecting(wrapper: Page) {
      await buttonsWithText(wrapper, 'Descargar varias')[0]!.trigger('click')
      await flush()
    }

    it('abre el modo de elegir: casillas solo en las imágenes listas, nada elegido y las acciones deshabilitadas', async () => {
      const wrapper = await mountPage()
      expect(checkboxes(wrapper)).toHaveLength(0)
      await selecting(wrapper)
      expect(checkboxes(wrapper).map(box => box.attributes('aria-label'))).toEqual(['Elegir la imagen 1', 'Elegir la imagen 2'])
      expect(statuses(wrapper)).toContain('0 imágenes elegidas')
      expect(wrapper.text()).toContain('Marca las imágenes en la fila de abajo.')
      for (const text of ['Limpiar', 'Descargar 0', 'Guardar 0 en el drive']) expect(buttonsWithText(wrapper, text)[0]!.attributes('disabled')).toBeDefined()
      // Las acciones de una sola imagen dejan su sitio al panel.
      expect(links(wrapper, 'Descargar')).toHaveLength(0)
      expect(buttonsWithText(wrapper, 'Descargar varias')).toHaveLength(0)
      expect(buttonsWithText(wrapper, 'Guardar en colección')).toHaveLength(0)
    })

    it('«Todas», «Limpiar» y las casillas cambian lo elegido; «Terminar» sale y lo olvida', async () => {
      const wrapper = await mountPage()
      await selecting(wrapper)
      await buttonsWithText(wrapper, 'Todas')[0]!.trigger('click')
      expect(statuses(wrapper)).toContain('2 imágenes elegidas')
      expect(checkboxes(wrapper).map(box => (box.element as HTMLInputElement).checked)).toEqual([true, true])
      expect(buttonsWithText(wrapper, 'Descargar 2')[0]!.attributes('disabled')).toBeUndefined()
      expect(buttonsWithText(wrapper, 'Guardar 2 en el drive')[0]!.attributes('disabled')).toBeUndefined()

      await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
      expect(statuses(wrapper)).toContain('0 imágenes elegidas')

      await checkboxes(wrapper)[1]!.trigger('change')
      expect(statuses(wrapper)).toContain('1 imagen elegida')
      expect(buttonsWithText(wrapper, 'Descargar 1')).toHaveLength(1)

      await buttonsWithText(wrapper, 'Terminar')[0]!.trigger('click')
      expect(checkboxes(wrapper)).toHaveLength(0)
      expect(links(wrapper, 'Descargar')).toHaveLength(1)
      // Al volver a entrar no queda nada elegido.
      await selecting(wrapper)
      expect(statuses(wrapper)).toContain('0 imágenes elegidas')
    })

    it('descarga las elegidas de una en una, con una pausa entre ellas, y avisa al terminar', async () => {
      const wrapper = await mountPage()
      await selecting(wrapper)
      await buttonsWithText(wrapper, 'Todas')[0]!.trigger('click')
      const button = buttonsWithText(wrapper, 'Descargar 2')[0]!
      expect(button.attributes('aria-busy')).toBe('false')

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await button.trigger('click')
      expect(triggerDownload.mock.calls).toEqual([[imageOf(1, [1, 2]).downloadUrl, 'peticiones-2026-11-12-100000.png']])
      expect(button.text()).toBe('Descargando 1 de 2…')
      expect(button.attributes('aria-busy')).toBe('true')
      expect(button.attributes('disabled')).toBeDefined()

      // Un clic que llegue mientras tanto no empieza otra tanda.
      button.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(699)
      expect(triggerDownload).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(triggerDownload.mock.calls[1]).toEqual([imageOf(2, [3]).downloadUrl, 'peticiones-2026-11-12-100000.png'])
      await nextTick()
      vi.useRealTimers()
      await flush()
      expect(triggerDownload).toHaveBeenCalledTimes(2)
      expect(toasts()).toContain('Descargamos 2 imágenes')
      expect(button.text()).toBe('Descargar 2')
      expect(button.attributes('aria-busy')).toBe('false')
      // Lo elegido se conserva por si también se quiere guardar en el drive.
      expect(statuses(wrapper)).toContain('2 imágenes elegidas')
    })

    it('una sola elegida se descarga sin pausa y avisa en singular', async () => {
      const wrapper = await mountPage()
      await selecting(wrapper)
      await checkboxes(wrapper)[1]!.trigger('change')
      await buttonsWithText(wrapper, 'Descargar 1')[0]!.trigger('click')
      await flush()
      expect(triggerDownload.mock.calls).toEqual([[imageOf(2, [3]).downloadUrl, 'peticiones-2026-11-12-100000.png']])
      expect(toasts()).toContain('Descargamos 1 imagen')
    })

    it('lo elegido se limita a lo que sigue listo', async () => {
      // La tercera terminó en esta visita: está lista mientras siga en el historial de la visita.
      added().value = [imageOf(3, [4])]
      const wrapper = await mountPage()
      expect(statuses(wrapper)).toContain('3 de 3 listas')
      await selecting(wrapper)
      await buttonsWithText(wrapper, 'Todas')[0]!.trigger('click')
      expect(statuses(wrapper)).toContain('3 imágenes elegidas')

      added().value = []
      await flush()
      expect(checkboxes(wrapper).map(box => box.attributes('aria-label'))).toEqual(['Elegir la imagen 1', 'Elegir la imagen 2'])
      expect(statuses(wrapper)).toContain('2 imágenes elegidas')
      expect(buttonsWithText(wrapper, 'Descargar 2')).toHaveLength(1)

      // Un cambio que no quita nada de lo elegido lo deja igual.
      added().value = [imageOf(3, [4])]
      await flush()
      expect(statuses(wrapper)).toContain('2 imágenes elegidas')
    })

    it('«Guardar N en el drive» pasa las elegidas con su nombre y avisa cuántas entraron en cola', async () => {
      const wrapper = await mountPage()
      await selecting(wrapper)
      await buttonsWithText(wrapper, 'Todas')[0]!.trigger('click')
      await buttonsWithText(wrapper, 'Guardar 2 en el drive')[0]!.trigger('click')
      expect(drive.save).toHaveBeenCalledOnce()
      expect(drive.save.mock.calls[0]![0]).toEqual([
        { image: imageOf(1, [1, 2]), label: 'Imagen 1' },
        { image: imageOf(2, [3], { author: { userId: 'u9', name: 'Beto', active: false } }), label: 'Imagen 2' },
      ])
      expect(toasts()).toContain('2 imágenes en cola para el drive')
    })
  })

  describe('guardar', () => {
    it('«Guardar en el drive» pasa la imagen de la diapositiva actual, sin aviso extra para una sola', async () => {
      const wrapper = await mountPage()
      await wrapper.get('button[aria-label="Imagen siguiente"]').trigger('click')
      await flush()
      await buttonsWithText(wrapper, 'Guardar en el drive')[0]!.trigger('click')
      expect(drive.save).toHaveBeenCalledOnce()
      expect(drive.save.mock.calls[0]![0]).toEqual([
        { image: imageOf(2, [3], { author: { userId: 'u9', name: 'Beto', active: false } }), label: 'Imagen 2' },
      ])
      expect(toasts()).toEqual([])
    })

    it('la lista de guardados en el drive solo aparece cuando hay alguno', async () => {
      const wrapper = await mountPage()
      const heading = () => wrapper.findAll('h2').filter(h2 => h2.text() === 'Guardar en el drive')
      expect(heading()).toHaveLength(0)
      drive.hasSaves.value = true
      // Es un componente diferido (`import()`).
      await vi.waitFor(() => expect(heading()).toHaveLength(1), { timeout: 5000 })
    })

    it('«Guardar en colección» abre el diálogo con la imagen actual y se puede cerrar', async () => {
      const created: unknown[] = []
      mockApi('POST', '/api/peticiones/colecciones', async (event: H3Event) => {
        created.push(await readBody(event))
        setResponseStatus(event, 201)
        return { id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, createdAt: CREATED_AT, updatedAt: CREATED_AT }
      })
      const wrapper = await mountPage()
      expect(wrapper.find('dialog').exists()).toBe(false)
      await buttonsWithText(wrapper, 'Guardar en colección')[0]!.trigger('click')
      // El diálogo es un componente diferido (`import()`).
      await vi.waitFor(() => expect(wrapper.find('dialog h2').exists()).toBe(true), { timeout: 5000 })
      expect(wrapper.get('dialog h2').text()).toBe('Guardar en una colección')

      await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
      await flush()
      expect(wrapper.find('dialog').exists()).toBe(false)

      // Se vuelve a abrir, ahora desde la segunda imagen, y la colección nueva se crea con ella.
      await goTo(wrapper, 2)
      await buttonsWithText(wrapper, 'Guardar en colección')[0]!.trigger('click')
      await vi.waitFor(() => expect(wrapper.find('dialog input[type="text"]').exists()).toBe(true), { timeout: 5000 })
      await wrapper.get('dialog input[type="text"]').setValue('Domingo')
      await wrapper.get('dialog form').trigger('submit')
      await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5000 })
      expect(JSON.stringify(created[0])).toContain(imageOf(2, [3]).id)
      expect(JSON.stringify(created[0])).not.toContain(imageOf(1, [1, 2]).id)
    })
  })

  describe('salir', () => {
    /** Deja una imagen de esta generación generándose. */
    async function busyPage() {
      const wrapper = await mountPage(`${PATH}?i=3`)
      reply = held()
      await buttonsWithText(wrapper.get('header'), 'Generar las faltantes')[0]!.trigger('click')
      await flush()
      expect(usePrayerImages().needsLeaveGuard.value).toBe(true)
      return wrapper
    }

    it('volver a /peticiones o pasar a otra generación no avisa ni vacía la cola', async () => {
      mockApi('GET', '/api/peticiones/generaciones/', failWith(404))
      mockApi('GET', `/api/peticiones/generaciones/${OTHER}`, failWith(404))
      const wrapper = await busyPage()
      const router = useRouter()

      await router.push('/peticiones')
      await flush()
      expect(useConfirm().options.value).toBeFalsy()
      expect(useRoute().path).toBe('/peticiones')
      expect(usePrayerImages().items.value).toHaveLength(1)

      await router.push(`/peticiones/generaciones/${OTHER}`)
      await flush()
      expect(useConfirm().options.value).toBeFalsy()
      expect(usePrayerImages().items.value).toHaveLength(1)

      // La página de destino se queda con la cola: desmontar esta no la vacía.
      wrapper.unmount()
      expect(usePrayerImages().items.value).toHaveLength(1)
    })

    it('salir a otra sección con imágenes generándose pide confirmación; aceptarla cancela la cola', async () => {
      await busyPage()
      const router = useRouter()
      const leaving = router.push('/archivos')
      await flush()
      expect(useConfirm().options.value?.title).toBe('¿Salir de Peticiones?')
      useConfirm().cancel()
      await leaving
      expect(useRoute().path).toBe(PATH)
      expect(usePrayerImages().items.value).toHaveLength(1)

      const leavingAgain = router.push('/archivos')
      await flush()
      useConfirm().accept()
      await leavingAgain
      expect(useRoute().path).toBe('/archivos')
      expect(usePrayerImages().items.value).toEqual([])
    })

    it('sin nada generándose se sale sin preguntar', async () => {
      await mountPage()
      await useRouter().push('/archivos')
      await flush()
      expect(useConfirm().options.value).toBeFalsy()
      expect(useRoute().path).toBe('/archivos')
    })

    it('cerrar la página sin haberla pasado a /peticiones vacía la cola', async () => {
      const wrapper = await busyPage()
      wrapper.unmount()
      expect(usePrayerImages().items.value).toEqual([])
    })

    it('cerrar o recargar la pestaña solo avisa con imágenes en curso', async () => {
      const wrapper = await mountPage(`${PATH}?i=3`)
      const idle = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(idle)
      expect(idle.defaultPrevented).toBe(false)

      reply = held()
      await buttonsWithText(wrapper.get('header'), 'Generar las faltantes')[0]!.trigger('click')
      await flush()
      const busy = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(busy)
      expect(busy.defaultPrevented).toBe(true)
    })
  })
})
