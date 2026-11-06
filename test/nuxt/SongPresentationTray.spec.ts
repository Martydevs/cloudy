// T043 — Bandeja de presentaciones (feature 006): fila por canción con su estado, «N diapositivas generadas», nota del reparto de
// respaldo, Cancelar, Reintentar solo en transitorios, Descargar de nuevo, Descartar y anuncios con role="status".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseHeader } from 'h3'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { PresentationItem } from '~/composables/useSongPresentations'
import SongPresentationTray from '~/components/songs/SongPresentationTray.vue'
import { buttonsWithText, calls, flush, mockApi, resetCalls } from './helpers/api'

const set = (items: PresentationItem[]) => {
  useState('songs-presentations').value = items
}

beforeEach(() => {
  set([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SongPresentationTray', () => {
  it('una fila por canción con el estado, el avance y sus acciones', async () => {
    set([
      { songId: 'a', title: 'Generándose', status: 'running' },
      { songId: 'b', title: 'En espera', status: 'queued' },
      { songId: 'c', title: 'Lista', status: 'done', slides: 7, arrangedBy: 'fallback' },
      { songId: 'd', title: 'Dormido', status: 'failed', error: 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.', retryable: true },
      { songId: 'e', title: 'Larga', status: 'failed', error: 'Eso no parece una canción: la letra pasa de 300 líneas.', retryable: false },
    ])
    const wrapper = await mountSuspended(SongPresentationTray)
    await flush()
    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(5)
    expect(wrapper.text()).toContain('2 en curso')
    expect(rows[0]!.text()).toContain('Generando…')
    expect(rows[0]!.find('progress').exists()).toBe(true)
    expect(buttonsWithText(rows[0]!, 'Cancelar')).toHaveLength(1)
    expect(rows[1]!.text()).toContain('En cola')
    expect(rows[2]!.text()).toContain('7 diapositivas generadas')
    expect(rows[2]!.text()).toContain('Las diapositivas se agruparon automáticamente')
    expect(buttonsWithText(rows[2]!, 'Descartar')).toHaveLength(1)
    expect(buttonsWithText(rows[3]!, 'Reintentar')).toHaveLength(1)
    expect(rows[3]!.text()).toContain('despertando')
    expect(buttonsWithText(rows[4]!, 'Reintentar')).toHaveLength(0)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('Descartar quita la fila y Reintentar vuelve a pedir la presentación', async () => {
    set([
      { songId: 'a', title: 'A', status: 'failed', retryable: true, error: 'x' },
      { songId: 'b', title: 'B', status: 'done', slides: 2 },
    ])
    resetCalls()
    mockApi('POST', '/api/songs/a/pptx', () => new Promise(() => {}))
    const wrapper = await mountSuspended(SongPresentationTray)
    await flush()
    await buttonsWithText(wrapper.findAll('li')[1]!, 'Descartar')[0]!.trigger('click')
    expect(useState<PresentationItem[]>('songs-presentations').value.map(i => i.songId)).toEqual(['a'])
    await buttonsWithText(wrapper.findAll('li')[0]!, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(calls.filter(c => c.url === '/api/songs/a/pptx')).toHaveLength(1)
    expect(useState<PresentationItem[]>('songs-presentations').value[0]!.status).toBe('running')
    await buttonsWithText(wrapper.findAll('li')[0]!, 'Cancelar')[0]!.trigger('click')
    await flush()
    expect(useState<PresentationItem[]>('songs-presentations').value[0]!.status).toBe('canceled')
  })

  it('«Descargar de nuevo» vuelve a entregar el archivo ya generado sin pedirlo otra vez', async () => {
    resetCalls()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:cloudy/tray')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockApi('POST', '/api/songs/r1/pptx', (event: Parameters<typeof setResponseHeader>[0]) => {
      setResponseHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      setResponseHeader(event, 'content-disposition', 'attachment; filename="Lista.pptx"')
      setResponseHeader(event, 'x-slide-count', '3')
      return Buffer.from([0x50, 0x4B, 3, 4])
    })
    useSongPresentations().enqueue([{ id: 'r1', title: 'Lista' }])
    const wrapper = await mountSuspended(SongPresentationTray)
    await vi.waitUntil(() => useState<PresentationItem[]>('songs-presentations').value[0]?.status === 'done', { timeout: 5000 })
    await flush()
    expect(clicks).toHaveBeenCalledTimes(1)
    await buttonsWithText(wrapper.findAll('li')[0]!, 'Descargar de nuevo')[0]!.trigger('click')
    expect(clicks).toHaveBeenCalledTimes(2)
    expect(calls.filter(c => c.url === '/api/songs/r1/pptx')).toHaveLength(1)
    await buttonsWithText(wrapper.findAll('li')[0]!, 'Descartar')[0]!.trigger('click')
  })

  it('se puede ocultar y mostrar', async () => {
    set([{ songId: 'a', title: 'A', status: 'done', slides: 1 }])
    const wrapper = await mountSuspended(SongPresentationTray)
    await wrapper.get('button[aria-label="Ocultar presentaciones"]').trigger('click')
    expect(wrapper.get('ul').attributes('style')).toContain('display: none')
    expect(wrapper.find('button[aria-label="Mostrar presentaciones"]').exists()).toBe(true)
  })
})
