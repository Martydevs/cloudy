// Panel de la cola del .zip de Canciones: la lista (región, «N de 3», título y artista, «Quitar {título}», el botón en singular o
// plural), la espera (aria-busy, progreso, botones deshabilitados), el resultado parcial (porqué de cada canción, resumen, nota de
// respaldo, «Descargar de nuevo»), el fallo con y sin reintento, Quitar y Vaciar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import SongBatchQueue from '~/components/songs/SongBatchQueue.vue'
import { buttonsWithText, calls, failFromServer, flush, mockApi, resetCalls } from './helpers/api'

const URL_ = '/api/songs/presentations'
const song = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `Canción ${n}`, artist: n === 1 ? 'Banda' : null })
const S1 = song(1).id
const S2 = song(2).id

const items = [
  { songId: S1, status: 'done', filename: 'Cancion 1.pptx', slideCount: 4, arrangedBy: 'fallback', errorCode: null },
  { songId: S2, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'no_lyrics' },
]

function zip(event: H3Event) {
  setResponseHeader(event, 'content-type', 'application/zip')
  setResponseHeader(event, 'content-disposition', 'attachment; filename="canciones.zip"')
  setResponseHeader(event, 'x-song-presentations', encodeURIComponent(JSON.stringify(items)))
  return Buffer.from([0x50, 0x4B, 5, 6])
}

let clicks: ReturnType<typeof vi.spyOn>
let revoke: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
  useState('songs-presentation-batch-pending').value = false
  useState('songs-presentation-batch-mode').value = false
  useState('songs-presentation-batch-queue').value = []
  useState('songs-presentation-batch-result').value = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:cloudy/1')
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  useSongPresentationBatch().release()
  vi.restoreAllMocks()
})

async function mountWith(...songs: ReturnType<typeof song>[]) {
  const queue = useSongPresentationQueue()
  for (const s of songs) queue.add(s)
  const wrapper = await mountSuspended(SongBatchQueue, { attachTo: document.body })
  return { queue, wrapper }
}

describe('SongBatchQueue', () => {
  it('lista la cola con su conteo, el artista si lo hay y un «Quitar» por canción', async () => {
    const { wrapper } = await mountWith(song(1), song(2))
    const region = wrapper.get('[role="region"]')
    expect(region.attributes('aria-label')).toBe('Cola de presentaciones')
    expect(region.attributes('aria-busy')).toBe('false')
    expect(wrapper.get('h2').text()).toBe('Cola de presentaciones')
    expect(wrapper.get('.badge').text()).toBe('2 de 3')
    const rows = wrapper.get('ul[aria-label="Canciones en la cola"]').findAll('li')
    expect(rows.map(r => r.text())).toEqual(['Canción 1Banda', 'Canción 2'])
    expect(wrapper.find('button[aria-label="Quitar Canción 1"]').exists()).toBe(true)
    expect(buttonsWithText(wrapper, 'Generar 2 presentaciones (.zip)')).toHaveLength(1)
    expect(buttonsWithText(wrapper, 'Descargar de nuevo')).toHaveLength(0)
    wrapper.unmount()
  })

  it('con una canción el botón va en singular', async () => {
    const { wrapper } = await mountWith(song(1))
    expect(buttonsWithText(wrapper, 'Generar 1 presentación (.zip)')).toHaveLength(1)
    wrapper.unmount()
  })

  it('mientras genera: aria-busy, progreso, la espera, todos los botones deshabilitados; anuncia el cambio', async () => {
    let resolve: () => void = () => {}
    mockApi('POST', URL_, (event: H3Event) => new Promise((r) => {
      resolve = () => r(zip(event))
    }))
    const { wrapper } = await mountWith(song(1), song(2))
    await buttonsWithText(wrapper, 'Generar 2 presentaciones (.zip)')[0]!.trigger('click')
    await flush()
    expect(wrapper.get('[role="region"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('progress').attributes('aria-label')).toBe('Generando el .zip')
    expect(wrapper.text()).toContain('Generando el .zip… puede tardar más de un minuto')
    expect(wrapper.get('[role="status"]').text()).toBe('Generando el .zip…')
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled')).toBeDefined()
    resolve()
    await vi.waitUntil(() => wrapper.get('[role="region"]').attributes('aria-busy') === 'false')
    await flush()
    expect(wrapper.get('[role="status"]').text()).toBe('canciones.zip descargado: 1 presentación')
    wrapper.unmount()
  })

  it('resultado parcial: diapositivas, porqué de la fallida, resumen, nota de respaldo y «Descargar de nuevo»', async () => {
    mockApi('POST', URL_, zip)
    const { wrapper } = await mountWith(song(1), song(2))
    await buttonsWithText(wrapper, 'Generar 2 presentaciones (.zip)')[0]!.trigger('click')
    await vi.waitUntil(() => buttonsWithText(wrapper, 'Descargar de nuevo').length > 0)
    const [first, second] = wrapper.findAll('li')
    expect(first!.text()).toContain('4 diapositivas generadas')
    expect(first!.text()).toContain('Las diapositivas se agruparon automáticamente')
    expect(second!.get('.text-error').text()).toBe('La letra guardada no tiene contenido. Vuelve a obtenerla.')
    expect(wrapper.text()).toContain('1 canción no se pudo generar; mira el detalle en la cola.')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(clicks).toHaveBeenCalledTimes(1)
    await buttonsWithText(wrapper, 'Descargar de nuevo')[0]!.trigger('click')
    expect(clicks).toHaveBeenCalledTimes(2)
    expect(calls.filter(c => c.url === URL_)).toHaveLength(1)
    wrapper.unmount()
  })

  it('servicio despertando: alerta y «Reintentar», que vuelve a pedir el lote', async () => {
    mockApi('POST', URL_, failFromServer(503, 'Service Unavailable', 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.', { code: 'waking' }))
    const { wrapper } = await mountWith(song(1))
    await buttonsWithText(wrapper, 'Generar 1 presentación (.zip)')[0]!.trigger('click')
    await vi.waitUntil(() => wrapper.find('[role="alert"]').exists())
    expect(wrapper.get('[role="alert"]').text()).toBe('El servicio de presentaciones está despertando o no responde. Reintenta en un momento.')
    expect(buttonsWithText(wrapper, 'Descargar de nuevo')).toHaveLength(0)
    mockApi('POST', URL_, zip)
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await vi.waitUntil(() => buttonsWithText(wrapper, 'Descargar de nuevo').length > 0)
    expect(calls.filter(c => c.url === URL_)).toHaveLength(2)
    wrapper.unmount()
  })

  it('422 sin reintento: alerta, el porqué de cada canción y el botón vuelve a «Generar»', async () => {
    mockApi('POST', URL_, failFromServer(422, 'Unprocessable Entity', 'No se pudo generar ninguna de las presentaciones.', {
      code: 'presentations_failed',
      items: [{ songId: S1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'not_found' }],
    }))
    const { wrapper } = await mountWith(song(1))
    await buttonsWithText(wrapper, 'Generar 1 presentación (.zip)')[0]!.trigger('click')
    await vi.waitUntil(() => wrapper.find('[role="alert"]').exists())
    expect(wrapper.get('[role="alert"]').text()).toBe('No se pudo generar ninguna de las presentaciones.')
    expect(wrapper.get('li').text()).toContain('Esa canción ya no existe.')
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
    expect(buttonsWithText(wrapper, 'Generar 1 presentación (.zip)')).toHaveLength(1)
    wrapper.unmount()
  })

  it('Quitar saca la canción y anuncia el conteo', async () => {
    const { wrapper, queue } = await mountWith(song(1), song(2))
    await wrapper.get('button[aria-label="Quitar Canción 1"]').trigger('click')
    expect(queue.items.value.map(s => s.id)).toEqual([S2])
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.get('.badge').text()).toBe('1 de 3')
    expect(wrapper.get('[role="status"]').text()).toBe('1 canción en la cola')
    wrapper.unmount()
  })

  it('Vaciar deja la cola sin canciones y suelta el .zip', async () => {
    mockApi('POST', URL_, zip)
    const { wrapper, queue } = await mountWith(song(1), song(2))
    await buttonsWithText(wrapper, 'Generar 2 presentaciones (.zip)')[0]!.trigger('click')
    await vi.waitUntil(() => buttonsWithText(wrapper, 'Descargar de nuevo').length > 0)
    await buttonsWithText(wrapper, 'Vaciar')[0]!.trigger('click')
    expect(queue.count.value).toBe(0)
    expect(queue.visible.value).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:cloudy/1')
    wrapper.unmount()
  })
})
