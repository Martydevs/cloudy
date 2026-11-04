// T067 — Datos y acciones de la ficha (feature 005, FR-006–FR-008, FR-013): Descargar con formato o deshabilitado con
// el motivo, Crear lista y Abrir en ventana nueva (siempre disponible: el reproductor es el incrustado de YouTube).
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeVideoDetail } from '#shared/types/api'
import YoutubeVideoMeta from '~/components/youtube/YoutubeVideoMeta.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const video = (changes: Partial<YoutubeVideoDetail> = {}): YoutubeVideoDetail => ({
  videoId: 'okShortVid1', title: 'Alabanza', channel: 'Iglesia', durationSeconds: 185, thumbnailUrl: null,
  availableHeights: [360, 720, 1080], downloadable: true, reason: null, ...changes,
})

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

beforeEach(() => {
  resetCalls()
  useState('youtube-downloads').value = { rows: [], groups: [] }
  useState('youtube-drive-imports').value = {}
  mockApi('POST', '/api/youtube/jobs', { jobId: 'f'.repeat(32), status: 'queued', format: 'mp3', progress: 0, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null })
})

describe('YoutubeVideoMeta', () => {
  it('título, canal, duración y calidades; Descargar → Audio MP3 encola ese video', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video() } })
    expect(wrapper.get('h1').text()).toBe('Alabanza')
    expect(wrapper.text()).toContain('Iglesia')
    expect(wrapper.text()).toContain('3:05')
    expect(wrapper.text()).toContain('Duración: 3 min 5 s')
    expect(wrapper.findAll('.badge').map(b => b.text())).toEqual(['1080p', '720p', '360p'])
    expect(wrapper.text()).toContain('Descarga solo contenido que el equipo tenga permiso de usar.')
    await button(wrapper, 'Descargar')!.trigger('click')
    await wrapper.findAll('[role="menuitemradio"]').find(o => o.text().includes('Audio MP3'))!.trigger('click')
    await flush()
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
  })

  it('Guardar en el drive ofrece audio o video 720p y arranca la importación del video', async () => {
    mockApi('POST', '/api/youtube/jobs', failWith(503))
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video() } })
    await button(wrapper, 'Guardar en el drive')!.trigger('click')
    const options = wrapper.findAll('[role="menuitemradio"]')
    expect(options.map(o => o.text().trim())).toEqual(['Video 720p', 'Audio MP3'])
    await options.find(o => o.text().includes('Audio MP3'))!.trigger('click')
    await flush(10)
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
    // El servicio dormido deja el error visible junto a las acciones y se puede volver a intentar.
    expect(wrapper.get('[role="alert"]').text()).toContain('Despertando el servicio')
    expect(button(wrapper, 'Guardar en el drive')!.attributes('disabled')).toBeUndefined()
  })

  it('muestra el avance de la importación (con la acción deshabilitada) y el aviso al terminar', async () => {
    const state = { videoId: 'okShortVid1', title: 'Alabanza', format: 'mp3', stage: 'uploading', progress: 40, message: null }
    useState('youtube-drive-imports').value = { okShortVid1: state }
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video() } })
    expect(wrapper.get('[role="status"]').text()).toContain('Subiendo al drive…')
    expect(wrapper.get('progress').attributes('value')).toBe('40')
    expect(button(wrapper, 'Guardar en el drive')!.attributes('disabled')).toBeDefined()

    useState('youtube-drive-imports').value = { okShortVid1: { ...state, stage: 'done', progress: 100, message: 'Alabanza.mp3' } }
    await flush()
    expect(wrapper.text()).toContain('«Alabanza.mp3» ya está en el drive')
    expect(wrapper.find('progress').exists()).toBe(false)
    expect(button(wrapper, 'Guardar en el drive')!.attributes('disabled')).toBeUndefined()
  })

  it('sin permiso de descarga, Guardar en el drive también queda deshabilitado', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video({ downloadable: false, reason: 'too_long' }) } })
    expect(button(wrapper, 'Guardar en el drive')!.attributes('disabled')).toBeDefined()
  })

  it('sin 1080p avisa que se entregará la mayor calidad disponible', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video({ availableHeights: [240, 480] }) } })
    await button(wrapper, 'Descargar')!.trigger('click')
    expect(wrapper.text()).toContain('se entregará la mayor calidad disponible')
  })

  it('no descargable: Descargar deshabilitado con el motivo en español', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video({ downloadable: false, reason: 'too_long' }) } })
    expect(button(wrapper, 'Descargar')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Este video dura más de 30 minutos')
  })

  it('Abrir en ventana nueva y Crear lista están siempre habilitadas y avisan; no hay botón de pantalla completa propio', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video() } })
    expect(button(wrapper, 'Abrir en ventana nueva')!.attributes('disabled')).toBeUndefined()
    expect(button(wrapper, 'Pantalla completa')).toBeUndefined()
    await button(wrapper, 'Abrir en ventana nueva')!.trigger('click')
    await button(wrapper, 'Crear lista')!.trigger('click')
    expect(wrapper.emitted('openWindow')).toHaveLength(1)
    expect(wrapper.emitted('playlist')).toHaveLength(1)
  })
})
