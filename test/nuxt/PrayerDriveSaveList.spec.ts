// Lista de avance de «Guardar en el drive» en la página de una generación: una fila por imagen con el texto de su
// etapa, la barra de progreso (solo con valor mientras sube) y los botones Cancelar / Reintentar / Descartar, que
// llaman a la acción correspondiente de `usePrayerDriveSave`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { DOMWrapper } from '@vue/test-utils'
import PrayerDriveSaveList from '~/components/prayers/PrayerDriveSaveList.vue'
import type { PrayerDriveSave, PrayerDriveStage } from '~/composables/usePrayerDriveSave'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, flush, mockApi, resetCalls } from './helpers/api'
import { generated } from './prayer-fixtures'

const m = messages.prayers.generation.drive
const NAME = 'peticiones-2026-11-12-100000.png'

const save = (n: number, stage: PrayerDriveStage, changes: Partial<PrayerDriveSave> = {}): PrayerDriveSave => {
  const image = generated(n)
  return { imageId: image.id, label: `Imagen ${n}`, image: { id: image.id, previewUrl: image.previewUrl, createdAt: image.createdAt }, stage, progress: 0, message: null, ...changes }
}
const state = () => useState<Record<string, PrayerDriveSave>>('prayer-drive-saves')
function setSaves(...saves: PrayerDriveSave[]) {
  state().value = Object.fromEntries(saves.map(item => [item.imageId, item]))
}
const mount = () => mountSuspended(PrayerDriveSaveList)

const rows = (wrapper: Queryable) => wrapper.findAll('li')
const buttonTexts = (row: DOMWrapper<Element>) => row.findAll('button').map(b => b.text().trim())
const button = (row: DOMWrapper<Element>, text: string) => buttonsWithText(row, text)[0]!
const toasts = () => useToast().toasts.value

const realFetch = globalThis.fetch
let download: ReturnType<typeof vi.fn<(url: string) => unknown>>
/** Solo la lectura de la imagen se simula; los endpoints de prueba siguen por el `fetch` real. */
function stubDownload(impl: () => unknown) {
  download = vi.fn(async (_url: string) => impl())
  vi.stubGlobal('fetch', (input: unknown, init?: unknown) => (String(input).startsWith('/api/peticiones/imagenes/')
    ? download(String(input))
    : realFetch(input as RequestInfo, init as RequestInit)))
}

beforeEach(() => {
  resetCalls()
  state().value = {}
  useState('prayer-drive-saves-finished').value = []
  useToast().toasts.value = []
  stubDownload(() => new Promise<never>(() => {}))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PrayerDriveSaveList', () => {
  it('es una región con título «Guardar en el drive» y una fila por imagen', async () => {
    setSaves(save(1, 'queued'), save(2, 'downloading'), save(3, 'done', { progress: 100, message: NAME }))
    const wrapper = await mount()
    const heading = wrapper.get('h2')
    expect(heading.text()).toBe('Guardar en el drive')
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(rows(wrapper).map(row => row.get('span').text())).toEqual(['Imagen 1', 'Imagen 2', 'Imagen 3'])
  })

  it('sin imágenes solo queda el título', async () => {
    const wrapper = await mount()
    expect(wrapper.get('h2').text()).toBe(m.title)
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it.each<[PrayerDriveStage, string]>([
    ['queued', 'En cola'],
    ['downloading', 'Preparando la imagen…'],
  ])('%s: muestra «%s», una barra sin valor y solo Cancelar', async (stage, text) => {
    setSaves(save(1, stage))
    const wrapper = await mount()
    const row = rows(wrapper)[0]!
    expect(row.get('[role="status"]').text()).toBe(text)
    const bar = row.get('progress')
    expect(bar.attributes('aria-label')).toBe(text)
    expect(bar.attributes('value')).toBeUndefined()
    expect(bar.attributes('max')).toBe('100')
    expect(row.find('[role="alert"]').exists()).toBe(false)
    expect(buttonTexts(row)).toEqual(['Cancelar'])
  })

  it('subiendo: la barra lleva el avance y solo se ofrece Cancelar', async () => {
    setSaves(save(1, 'uploading', { progress: 40 }))
    const wrapper = await mount()
    const row = rows(wrapper)[0]!
    expect(row.get('[role="status"]').text()).toBe('Subiendo al drive…')
    const bar = row.get('progress')
    expect(bar.attributes('aria-label')).toBe('Subiendo al drive…')
    expect(bar.attributes('value')).toBe('40')
    expect(buttonTexts(row)).toEqual(['Cancelar'])

    // El avance se refleja al cambiar el estado.
    state().value = { ...state().value, [generated(1).id]: save(1, 'uploading', { progress: 99 }) }
    await flush()
    expect(rows(wrapper)[0]!.get('progress').attributes('value')).toBe('99')
  })

  it('guardada: muestra el nombre con el que quedó, «Guardada», sin barra, y solo Descartar', async () => {
    setSaves(save(1, 'done', { progress: 100, message: NAME }))
    const wrapper = await mount()
    const row = rows(wrapper)[0]!
    expect(row.text()).toContain(NAME)
    expect(row.get('[role="status"]').text()).toBe('Guardada')
    expect(row.find('progress').exists()).toBe(false)
    expect(row.find('[role="alert"]').exists()).toBe(false)
    expect(buttonTexts(row)).toEqual(['Descartar'])
  })

  it('fallida: anuncia el motivo como alerta, sin barra, con Reintentar y Descartar', async () => {
    setSaves(save(1, 'error', { message: m.downloadFailed }))
    const wrapper = await mount()
    const row = rows(wrapper)[0]!
    expect(row.get('[role="alert"]').text()).toBe(m.downloadFailed)
    expect(row.find('[role="status"]').exists()).toBe(false)
    expect(row.find('progress').exists()).toBe(false)
    expect(buttonTexts(row)).toEqual(['Reintentar', 'Descartar'])
  })

  it('Descartar quita la fila de una guardada y de una fallida', async () => {
    setSaves(save(1, 'done', { progress: 100, message: NAME }), save(2, 'error', { message: m.failed }), save(3, 'uploading', { progress: 10 }))
    const wrapper = await mount()
    await button(rows(wrapper)[0]!, 'Descartar').trigger('click')
    await flush()
    expect(rows(wrapper).map(row => row.get('span').text())).toEqual(['Imagen 2', 'Imagen 3'])
    await button(rows(wrapper)[0]!, 'Descartar').trigger('click')
    await flush()
    expect(rows(wrapper).map(row => row.get('span').text())).toEqual(['Imagen 3'])
    expect(toasts()).toHaveLength(0)
  })

  it('Cancelar saca de la cola una imagen que espera y avisa', async () => {
    setSaves(save(1, 'uploading', { progress: 10 }), save(2, 'queued'))
    const wrapper = await mount()
    await button(rows(wrapper)[1]!, 'Cancelar').trigger('click')
    await flush()
    expect(rows(wrapper).map(row => row.get('span').text())).toEqual(['Imagen 1'])
    expect(toasts().map(toast => [toast.type, toast.message])).toEqual([['info', 'Cancelamos el guardado en el drive']])
    expect(download).not.toHaveBeenCalled()
  })

  it('Reintentar vuelve a guardar la fallida y Cancelar la detiene en curso', async () => {
    setSaves(save(1, 'error', { message: m.downloadFailed }))
    const wrapper = await mount()
    await button(rows(wrapper)[0]!, 'Reintentar').trigger('click')
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith(generated(1).previewUrl))
    await flush()
    const row = rows(wrapper)[0]!
    expect(row.find('[role="alert"]').exists()).toBe(false)
    expect(row.get('[role="status"]').text()).toBe('Preparando la imagen…')
    expect(buttonTexts(row)).toEqual(['Cancelar'])

    await button(row, 'Cancelar').trigger('click')
    await vi.waitFor(() => expect(rows(wrapper)).toHaveLength(0))
    expect(toasts().map(toast => [toast.type, toast.message])).toEqual([['info', m.cancelled]])
    expect(calls.filter(c => c.url.startsWith('/api/uploads'))).toHaveLength(0)
  })

  it('Reintentar con la lectura ya disponible termina en «Guardada» con el nombre del archivo', async () => {
    stubDownload(() => ({ ok: true, blob: async () => new Blob([new Uint8Array(3)], { type: 'image/png' }) }))
    mockApi('POST', '/api/uploads', { fileId: 'list-f1', uploadUrl: 'https://s3.test/put', headers: {} })
    mockApi('DELETE', '/api/uploads/list-f1', null)
    mockApi('POST', '/api/uploads/list-f1/complete', { id: 'list-f1', name: NAME })
    // El PUT real al bucket no existe en la prueba: se responde como una subida correcta.
    class FakeXhr {
      upload: { onprogress: ((event: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
      status = 200
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      open() {}
      setRequestHeader() {}
      abort() {}
      send() {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)

    setSaves(save(1, 'error', { message: m.failed }))
    const wrapper = await mount()
    await button(rows(wrapper)[0]!, 'Reintentar').trigger('click')
    await vi.waitFor(() => expect(rows(wrapper)[0]!.find('[role="status"]').text()).toBe('Guardada'), { timeout: 5000 })
    expect(rows(wrapper)[0]!.text()).toContain(NAME)
    expect(buttonTexts(rows(wrapper)[0]!)).toEqual(['Descartar'])
    expect(toasts().at(-1)).toMatchObject({ type: 'success', action: { label: 'Ver en Archivos', to: '/archivos' } })
  })
})
