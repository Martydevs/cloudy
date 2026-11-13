// Historial de imágenes generadas (feature 007, enmienda de historial): la tarjeta (imagen diferida, datos, descarga como
// enlace, menú con eliminar solo para la autora o un admin) y la sección (cola en curso arriba, cuatro estados,
// desplazamiento infinito con error recuperable, eliminar con confirmación, generar de nuevo y la región viva).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import { getQuery } from 'h3'
import type { Me, PrayerGeneratedImage } from '#shared/types/api'
import PrayerHistory from '~/components/prayers/PrayerHistory.vue'
import PrayerHistoryCard from '~/components/prayers/PrayerHistoryCard.vue'
import type { PrayerImageItem } from '~/composables/usePrayerImages'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated } from './prayer-fixtures'

const { visible } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { visible: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => visible)

const toasts = () => useToast().toasts.value.map(t => t.message)
const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))
const historyCalls = () => calls.filter(c => c.method === 'GET' && c.url === '/api/peticiones/imagenes')

function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const page = (from: number, to: number, nextCursor: string | null) =>
  ({ items: Array.from({ length: to - from + 1 }, (_, i) => generated(from + i)), nextCursor })

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  visible.value = false
  useToast().toasts.value = []
  usePrayerImages().reset()
  useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY).value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/peticiones/colecciones', { items: [] })
  mockApi('GET', '/api/peticiones/imagenes', event => (getQuery(event).cursor ? page(13, 14, null) : page(1, 12, 'c1')))
})

describe('PrayerHistoryCard', () => {
  it('la imagen llega al acercarse, en una caja con la proporción de la plantilla; datos, descarga y ampliar', async () => {
    const wrapper = await mountSuspended(PrayerHistoryCard, { props: { image: generated(1) } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.aspect-\\[1376\\/768\\] .skeleton').exists()).toBe(true)
    visible.value = true
    await flush()
    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe(generated(1).previewUrl)
    expect(img.attributes('decoding')).toBe('async')
    expect(img.attributes('alt')).toMatch(/^Imagen de peticiones con 2 peticiones, generada /)
    expect(wrapper.get('h3').text()).toBe('2 peticiones')
    expect(wrapper.text()).toMatch(/Generada .+ por Ana/)
    const download = wrapper.get('a[download]')
    expect(download.attributes('href')).toBe(generated(1).downloadUrl)
    expect(download.text()).toBe('Descargar')
    await buttonsWithText(wrapper, 'Ver en grande')[0]!.trigger('click')
    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('si la imagen no carga, avisa sin vista previa', async () => {
    visible.value = true
    const wrapper = await mountSuspended(PrayerHistoryCard, { props: { image: generated(1, { author: { userId: 'u2', name: 'Luis', active: false } }) } })
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('Sin vista previa')
    expect(wrapper.text()).toContain('Usuario que ya no está activo')
  })

  it('el menú ofrece guardar y generar de nuevo; eliminar solo si puede', async () => {
    const reader = await mountSuspended(PrayerHistoryCard, { props: { image: generated(1) }, attachTo: document.body })
    await reader.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Guardar en colección', 'Generar de nuevo'])
    await menuItems()[0]!.trigger('click')
    expect(reader.emitted('collection')).toHaveLength(1)
    await reader.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    await menuItems()[1]!.trigger('click')
    expect(reader.emitted('regenerate')).toHaveLength(1)
    reader.unmount()

    const owner = await mountSuspended(PrayerHistoryCard, { props: { image: generated(1), canRemove: true }, attachTo: document.body })
    await owner.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Guardar en colección', 'Generar de nuevo', 'Eliminar'])
    await menuItems()[2]!.trigger('click')
    expect(owner.emitted('remove')).toHaveLength(1)
    owner.unmount()
  })

  it('ningún control es btn-sm o btn-xs de base', async () => {
    const wrapper = await mountSuspended(PrayerHistoryCard, { props: { image: generated(1) } })
    for (const el of [...wrapper.findAll('button'), ...wrapper.findAll('a')]) expect(el.classes().some(c => /^btn-(sm|xs)$/.test(c))).toBe(false)
  })
})

describe('PrayerHistory', () => {
  it('encabezado, la nota de los 30 días y el contenido: una tarjeta por imagen, la más reciente primero', async () => {
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    expect(wrapper.get('h2').text()).toBe('Historial de imágenes generadas')
    expect(wrapper.text()).toContain('Se conservan 30 días, salvo las que estén en una colección.')
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(12)
    expect(historyCalls()[0]).toBeTruthy()
  })

  it('cargando: esqueletos con aria-busy', async () => {
    mockApi('GET', '/api/peticiones/imagenes', () => new Promise(() => {}))
    const wrapper = await mountSuspended(PrayerHistory)
    await flush()
    expect(wrapper.get('[aria-busy="true"]').text()).toContain('Cargando imágenes generadas…')
  })

  it('vacío y error con Reintentar', async () => {
    mockApi('GET', '/api/peticiones/imagenes', failWith(500))
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar el historial de imágenes')
    mockApi('GET', '/api/peticiones/imagenes', { items: [], nextCursor: null })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).toContain('Aún no hay imágenes generadas')
  })

  it('la siguiente página al acercarse al final; un fallo no pierde lo cargado y Reintentar sigue', async () => {
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    mockApi('GET', '/api/peticiones/imagenes', event => (getQuery(event).cursor ? failWith(500)(event) : page(1, 12, 'c1')))
    visible.value = true
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar más imágenes.')
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(12)
    mockApi('GET', '/api/peticiones/imagenes', event => (getQuery(event).cursor ? page(13, 14, null) : page(1, 12, 'c1')))
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(14)
    expect(wrapper.text()).toContain('Ya viste todas las imágenes generadas')
    expect(historyCalls().filter(c => c.url === '/api/peticiones/imagenes').length).toBeGreaterThanOrEqual(3)
  })

  it('Cargar más (teclado) muestra esqueletos mientras llega la página', async () => {
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    mockApi('GET', '/api/peticiones/imagenes', event => (getQuery(event).cursor ? new Promise(() => {}) : page(1, 12, 'c1')))
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await flush()
    expect(wrapper.get('[aria-label="Cargando más imágenes…"]').findAll('.skeleton')).toHaveLength(3)
  })

  it('la cola en curso va arriba, y una imagen recién guardada entra primera sin repetirse', async () => {
    useState<PrayerImageItem[]>('prayer-images').value = [{ key: 'img-1', index: 1, fileIds: ['a'], status: 'running' }]
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    const html = wrapper.html()
    expect(html.indexOf('aria-label="Imágenes en curso"')).toBeLessThan(html.indexOf('aria-label="Imágenes generadas"'))
    useState<PrayerImageItem[]>('prayer-images').value = []
    useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY).value = [generated(99), generated(1)]
    await flush()
    const ids = wrapper.findAll('ul[aria-label="Imágenes generadas"] > li a[download]').map(a => a.attributes('href'))
    expect(ids[0]).toBe(generated(99).downloadUrl)
    expect(ids.filter(href => href === generated(1).downloadUrl)).toHaveLength(1)
    expect(ids).toHaveLength(13)
  })

  it('sin historial pero con una imagen en curso no muestra el vacío', async () => {
    mockApi('GET', '/api/peticiones/imagenes', { items: [], nextCursor: null })
    useState<PrayerImageItem[]>('prayer-images').value = [{ key: 'img-1', index: 1, fileIds: ['a'], status: 'failed', retryable: false, error: 'x' }]
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    expect(wrapper.text()).not.toContain('Aún no hay imágenes generadas')
    await buttonsWithText(wrapper, 'Descartar')[0]!.trigger('click')
    expect(usePrayerImages().items.value).toEqual([])
    expect(wrapper.text()).toContain('Aún no hay imágenes generadas')
  })

  it('la región viva anuncia lo que dice la cola', async () => {
    const wrapper = await mountSuspended(PrayerHistory)
    await flush(10)
    useState('prayer-images-announcement').value = 'Imagen 1 lista y guardada en el historial'
    await flush()
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Imagen 1 lista y guardada en el historial')
  })

  it('eliminar: pide confirmación, la quita y avisa; solo la autora o un admin la ven', async () => {
    mockApi('GET', '/api/peticiones/imagenes', { items: [generated(1), generated(2, { author: { userId: 'u2', name: 'Luis', active: true } })], nextCursor: null })
    mockApi('DELETE', `/api/peticiones/imagenes/${generated(1).id}`, null)
    const wrapper = await mountSuspended(PrayerHistory, { attachTo: document.body })
    await flush(10)
    const options = wrapper.findAll('button[aria-label="Opciones de la imagen"]')
    await options[1]!.trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).not.toContain('Eliminar')
    await options[1]!.trigger('click')
    await options[0]!.trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Eliminar')!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar esta imagen?')
    useConfirm().cancel()
    await flush()
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(2)

    await options[0]!.trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Eliminar')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush(10)
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/peticiones/imagenes/${generated(1).id}`)).toBe(true)
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(1)
    expect(toasts()).toContain('Imagen eliminada')
    wrapper.unmount()
  })

  it('un admin puede eliminar la imagen de otra persona; un fallo del servidor se avisa y la imagen sigue', async () => {
    setMe('admin', 'u9')
    mockApi('GET', '/api/peticiones/imagenes', { items: [generated(1)], nextCursor: null })
    mockApi('DELETE', `/api/peticiones/imagenes/${generated(1).id}`, failFromServer(404, 'No encontrado', 'Esa imagen ya no está guardada.'))
    const wrapper = await mountSuspended(PrayerHistory, { attachTo: document.body })
    await flush(10)
    await wrapper.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Eliminar')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush(10)
    expect(toasts()).toContain('Esa imagen ya no está guardada.')
    expect(wrapper.findAll('ul[aria-label="Imágenes generadas"] > li')).toHaveLength(1)
    wrapper.unmount()
  })

  it('Generar de nuevo encola los mismos ids; Guardar en colección se emite con la imagen; Ver en grande abre el modal', async () => {
    mockApi('GET', '/api/peticiones/imagenes', { items: [generated(1)], nextCursor: null })
    mockApi('POST', '/api/peticiones/imagenes', () => new Promise(() => {}))
    const wrapper = await mountSuspended(PrayerHistory, { attachTo: document.body })
    await flush(10)
    await wrapper.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Generar de nuevo')!.trigger('click')
    await flush(5)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')?.body).toEqual({ fileIds: generated(1).fileIds })
    expect(toasts()).toContain('Generando de nuevo con el texto actual de sus peticiones')
    expect(wrapper.find('[aria-label="Imágenes en curso"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="Opciones de la imagen"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Guardar en colección')!.trigger('click')
    expect(wrapper.emitted('collection')![0]).toEqual([generated(1)])

    await buttonsWithText(wrapper, 'Ver en grande')[0]!.trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector('dialog img')?.getAttribute('src')).toBe(generated(1).previewUrl), { timeout: 5000 })
    usePrayerImages().reset()
    wrapper.unmount()
  })
})
