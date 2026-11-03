// Sección «Descargas» de /youtube: rejilla de miniaturas (sin tarjetas), cuatro estados y página siguiente al llegar al
// final (centinela visible) sin repetir videos.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import type { YoutubeDownloadItem, YoutubeDownloadsPage } from '#shared/types/api'
import YoutubeDownloadsGrid from '~/components/youtube/YoutubeDownloadsGrid.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { sentinelVisible } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { sentinelVisible: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => sentinelVisible)

const item = (n: number, changes: Partial<YoutubeDownloadItem> = {}): YoutubeDownloadItem => ({
  videoId: `video${String(n).padStart(6, '0')}`,
  title: `Descarga ${n}`,
  channel: 'Canal',
  durationSeconds: 125,
  thumbnailUrl: null,
  format: 'mp3',
  downloadedAt: new Date(Date.now() - 3_600_000).toISOString(),
  downloadedBy: { userId: 'u2', name: 'Luis', active: true },
  ...changes,
})
const page = (items: YoutubeDownloadItem[], nextCursor: string | null = null): YoutubeDownloadsPage => ({ items, nextCursor })
const requests = () => calls.filter(c => c.url === '/api/youtube/downloads')

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  sentinelVisible.value = false
})

describe('YoutubeDownloadsGrid', () => {
  it('rejilla de miniaturas con formato, duración, quién y cuándo; el enlace abre la ficha', async () => {
    mockApi('GET', '/api/youtube/downloads', page([
      item(0, { thumbnailUrl: 'https://i.ytimg.com/a.jpg' }),
      item(1, { format: 'mp4_1080', durationSeconds: null, downloadedBy: { userId: 'u3', name: 'Eva', active: false } }),
      item(2, { downloadedBy: null }),
    ]))
    const wrapper = await mountSuspended(YoutubeDownloadsGrid)
    await flush()
    const grid = wrapper.get('ul[aria-label="Videos descargados"]')
    expect(grid.classes()).toContain('grid')
    const tiles = grid.findAll('li')
    expect(tiles).toHaveLength(3)
    expect(tiles[0]!.get('a').attributes('href')).toBe('/youtube/video000000')
    expect(tiles[0]!.get('img').attributes('loading')).toBe('lazy')
    expect(tiles[0]!.text()).toContain('Audio MP3')
    expect(tiles[0]!.text()).toContain('2:05')
    expect(tiles[0]!.text()).toContain('Luis')
    expect(tiles[1]!.text()).toContain('Video 1080p')
    expect(tiles[1]!.text()).not.toContain('2:05')
    expect(tiles[1]!.text()).toContain(messages.youtube.inactiveUser)
    expect(tiles[1]!.find('img').exists()).toBe(false)
    expect(tiles[2]!.text()).toContain(messages.youtube.inactiveUser)
    // Sin tarjetas: ni borde ni fondo de `card`.
    expect(grid.find('.card').exists()).toBe(false)
    wrapper.unmount()
  })

  it('cargando, error con Reintentar y vacío', async () => {
    mockApi('GET', '/api/youtube/downloads', () => new Promise(() => {}))
    const loading = await mountSuspended(YoutubeDownloadsGrid)
    await flush()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)
    loading.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/downloads', failWith(500))
    const failed = await mountSuspended(YoutubeDownloadsGrid)
    await vi.waitFor(() => expect(failed.text()).toContain('No pudimos cargar las descargas'), { timeout: 5000 })

    mockApi('GET', '/api/youtube/downloads', page([]))
    await failed.get('[role="alert"] button').trigger('click')
    await vi.waitFor(() => expect(failed.text()).toContain('Todavía no hay descargas'), { timeout: 5000 })
    expect(failed.text()).toContain('Descarga un video y aparecerá aquí.')
    failed.unmount()
  })

  it('al llegar al final pide la página siguiente con su cursor, sin repetir videos', async () => {
    mockApi('GET', '/api/youtube/downloads', (event) => {
      const { cursor } = getQuery(event)
      return cursor ? page([item(1), item(2)]) : page([item(0), item(1)], 'siguiente')
    })
    const wrapper = await mountSuspended(YoutubeDownloadsGrid)
    await flush()
    expect(wrapper.findAll('li')).toHaveLength(2)
    sentinelVisible.value = true
    await vi.waitFor(() => expect(wrapper.findAll('li')).toHaveLength(3), { timeout: 5000 })
    expect(requests()).toHaveLength(2)
    expect(wrapper.findAll('li').map(li => li.text().match(/Descarga \d/)![0])).toEqual(['Descarga 0', 'Descarga 1', 'Descarga 2'])
    expect(wrapper.find('button.btn').exists()).toBe(false)
    wrapper.unmount()
  })

  it('«Cargar más» sigue disponible, muestra el aviso si falla y se puede reintentar', async () => {
    mockApi('GET', '/api/youtube/downloads', (event) => {
      if (getQuery(event).cursor) throw Object.assign(new Error('x'), { statusCode: 500 })
      return page([item(0)], 'siguiente')
    })
    const wrapper = await mountSuspended(YoutubeDownloadsGrid)
    await flush()
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('No pudimos cargar más descargas'), { timeout: 5000 })

    mockApi('GET', '/api/youtube/downloads', (event) => (getQuery(event).cursor ? page([item(3)]) : page([item(0)], 'siguiente')))
    await wrapper.get('[role="alert"] button').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('li')).toHaveLength(2), { timeout: 5000 })
    expect(wrapper.text()).not.toContain('No pudimos cargar más descargas')
    wrapper.unmount()
  })

  it('mientras llega la página siguiente muestra el indicador de carga', async () => {
    mockApi('GET', '/api/youtube/downloads', (event) => (getQuery(event).cursor ? new Promise(() => {}) : page([item(0)], 'siguiente')))
    const wrapper = await mountSuspended(YoutubeDownloadsGrid)
    await flush()
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Cargando más descargas"]').exists()).toBe(true), { timeout: 5000 })
    wrapper.unmount()
  })
})
