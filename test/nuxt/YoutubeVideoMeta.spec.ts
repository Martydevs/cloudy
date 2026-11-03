// T067 — Datos y acciones de la ficha (feature 005, FR-006–FR-008, FR-013): Descargar con formato o deshabilitado con
// el motivo, Crear lista, y Pantalla completa / Ventana nueva habilitadas solo con el reproductor listo.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeVideoDetail } from '#shared/types/api'
import YoutubeVideoMeta from '~/components/youtube/YoutubeVideoMeta.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, flush, mockApi, resetCalls } from './helpers/api'

const video = (changes: Partial<YoutubeVideoDetail> = {}): YoutubeVideoDetail => ({
  videoId: 'okShortVid1', title: 'Alabanza', channel: 'Iglesia', durationSeconds: 185, thumbnailUrl: null,
  availableHeights: [360, 720, 1080], downloadable: true, reason: null, ...changes,
})

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

beforeEach(() => {
  resetCalls()
  useState('youtube-downloads').value = { rows: [], groups: [] }
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

  it('Pantalla completa y Ventana nueva deshabilitadas hasta que el reproductor esté listo', async () => {
    const wrapper = await mountSuspended(YoutubeVideoMeta, { props: { video: video(), playerReady: false } })
    for (const label of ['Pantalla completa', 'Abrir en ventana nueva']) {
      const action = button(wrapper, label)!
      expect(action.attributes('disabled'), label).toBeDefined()
      expect(action.attributes('aria-describedby'), label).toBeTruthy()
    }
    expect(wrapper.text()).toContain('Prepara el video para usar estas acciones')

    await wrapper.setProps({ playerReady: true })
    expect(button(wrapper, 'Pantalla completa')!.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Prepara el video para usar estas acciones')
    await button(wrapper, 'Pantalla completa')!.trigger('click')
    await button(wrapper, 'Abrir en ventana nueva')!.trigger('click')
    await button(wrapper, 'Crear lista')!.trigger('click')
    expect(wrapper.emitted('fullscreen')).toHaveLength(1)
    expect(wrapper.emitted('openWindow')).toHaveLength(1)
    expect(wrapper.emitted('playlist')).toHaveLength(1)
  })
})
