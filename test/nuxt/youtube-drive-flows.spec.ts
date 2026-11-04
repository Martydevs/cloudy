// «Guardar en el drive» desde /youtube (feature 005): menú de la tarjeta del historial, barra de selección y tarjetas de
// lista. Un video va directo; varios pasan por el diálogo con casillas y solo se suben los marcados.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import type { Me, YoutubeHistoryItem, YoutubePlaylist } from '#shared/types/api'
import YoutubePage from '~/pages/youtube/index.vue'
import YoutubeSelectionBar from '~/components/youtube/YoutubeSelectionBar.vue'
import YoutubeDriveDialog from '~/components/youtube/YoutubeDriveDialog.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { start, startMany, active } = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  startMany: vi.fn((videos: unknown[]) => videos.length),
  active: new Set<string>(),
}))
mockNuxtImport('useYoutubeDriveImport', () => () => ({
  start,
  startMany,
  of: (videoId: string) => (active.has(videoId) ? { videoId, stage: 'uploading' } : null),
  isActive: (stage: string) => stage !== 'done' && stage !== 'error',
}))

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]
const ids = (n: number) => Array.from({ length: n }, (_, i) => `video${String(i).padStart(6, '0')}`)
const historyItem = (n: number): YoutubeHistoryItem => ({
  videoId: ids(n + 1)[n]!,
  title: `Video ${n}`,
  channel: 'Canal',
  durationSeconds: 125,
  thumbnailUrl: null,
  viewedAt: new Date(Date.now() - 3_600_000).toISOString(),
  viewedBy: { userId: 'u2', name: 'Luis', active: true },
})
const playlist: YoutubePlaylist = {
  id: 'p1',
  name: 'Domingo',
  author: { userId: 'u1', name: 'Ana', active: true },
  itemCount: 3,
  covers: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
}
const detail = {
  ...playlist,
  items: ids(3).map((videoId, i) => ({ videoId, title: `Lista ${i}`, channel: null, durationSeconds: 60, thumbnailUrl: null, addedAt: '2026-11-01T10:00:00.000Z', addedBy: playlist.author })),
}

function setMe() {
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

/** Menú de la tarjeta del historial (dentro de la página) o, si no está, el flotante de las listas (en `body`). */
const menuItem = (wrapper: Queryable, text: string) => {
  const inside = wrapper.findAll('[role="menuitem"]').find(o => o.text().includes(text))
  if (inside) return inside
  const el = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(o => o.textContent?.includes(text))!
  return new DOMWrapper(el)
}
const checkboxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]'))

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  start.mockClear()
  startMany.mockClear()
  active.clear()
  useToast().toasts.value = []
  useState('youtube-history-selected').value = []
  useState('youtube-downloads').value = { rows: [], groups: [] }
  setMe()
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', '/api/youtube/playlists', { items: [playlist] })
  mockApi('GET', '/api/youtube/playlists/p1', detail)
  mockApi('GET', '/api/youtube/history', { items: [historyItem(0), historyItem(1), historyItem(2)], nextCursor: null })
})

describe('Guardar en el drive · tarjeta del historial', () => {
  it('el menú ofrece video 720p y audio MP3, y sube ese video sin diálogo', async () => {
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Acciones de Video 0"]').trigger('click')
    await menuItem(wrapper, 'Guardar en el drive: audio MP3').trigger('click')
    expect(start).toHaveBeenCalledWith({ videoId: 'video000000', title: 'Video 0' }, 'mp3')

    await wrapper.get('[aria-label="Acciones de Video 1"]').trigger('click')
    await menuItem(wrapper, 'Guardar en el drive: video 720p').trigger('click')
    expect(start).toHaveBeenLastCalledWith({ videoId: 'video000001', title: 'Video 1' }, 'mp4_720')
    expect(document.querySelector('dialog')).toBeNull()
    wrapper.unmount()
  })
})

describe('Guardar en el drive · barra de selección', () => {
  it('emite el formato elegido en «Guardar en el drive»', async () => {
    const bar = await mountSuspended(YoutubeSelectionBar, { props: { count: 2 } })
    const trigger = bar.findAll('button[aria-haspopup="menu"]').find(b => b.text().includes('Guardar en el drive'))!
    await trigger.trigger('click')
    expect(bar.findAll('[role="menuitemradio"]').map(o => o.text())).toEqual(['Video 720p', 'Audio MP3'])
    await bar.findAll('[role="menuitemradio"]').find(o => o.text().includes('Video 720p'))!.trigger('click')
    expect(bar.emitted('drive')).toEqual([['mp4_720']])
    expect(bar.emitted('download')).toBeUndefined()
  })

  it('con varios seleccionados abre el diálogo con todos marcados; solo se suben los que sigan marcados y se limpia la selección', async () => {
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Seleccionar Video 0"]').setValue(true)
    await wrapper.get('[aria-label="Seleccionar Video 1"]').setValue(true)
    await wrapper.get('[aria-label="Seleccionar Video 2"]').setValue(true)
    await flush()
    const bar = wrapper.get('[aria-label="Selección"]')
    await bar.findAll('button[aria-haspopup="menu"]').find(b => b.text().includes('Guardar en el drive'))!.trigger('click')
    await bar.findAll('[role="menuitemradio"]').find(o => o.text().includes('Audio MP3'))!.trigger('click')
    await vi.waitFor(() => expect(checkboxes()).toHaveLength(3), { timeout: 5000 })
    expect(checkboxes().every(c => c.checked)).toBe(true)

    checkboxes()[1]!.click()
    await flush()
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(b => b.textContent?.includes('Subir 2 al drive'))!
    confirm.click()
    await flush()

    expect(startMany).toHaveBeenCalledTimes(1)
    const [videos, format] = startMany.mock.calls[0] as unknown as [{ videoId: string }[], string]
    expect(videos.map(v => v.videoId)).toEqual(['video000000', 'video000002'])
    expect(format).toBe('mp3')
    expect(useToast().toasts.value.some(t => t.message === 'Se guardarán 2 videos en el drive')).toBe(true)
    expect(useState<string[]>('youtube-history-selected').value).toEqual([])
    expect(document.querySelector('dialog')).toBeNull()
    wrapper.unmount()
  })

  it('con un solo video seleccionado sube directo, sin diálogo', async () => {
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Seleccionar Video 1"]').setValue(true)
    await flush()
    const bar = wrapper.get('[aria-label="Selección"]')
    await bar.findAll('button[aria-haspopup="menu"]').find(b => b.text().includes('Guardar en el drive'))!.trigger('click')
    await bar.findAll('[role="menuitemradio"]').find(o => o.text().includes('Video 720p'))!.trigger('click')
    await flush()
    expect(startMany).toHaveBeenCalledWith([expect.objectContaining({ videoId: 'video000001' })], 'mp4_720')
    expect(document.querySelector('dialog')).toBeNull()
    wrapper.unmount()
  })
})

describe('Guardar en el drive · tarjeta de lista', () => {
  it('pide los videos de la lista y abre el diálogo con casillas', async () => {
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    await menuItem(wrapper, 'Guardar en el drive: video 720p').trigger('click')
    await vi.waitFor(() => expect(checkboxes()).toHaveLength(3), { timeout: 5000 })
    expect(document.querySelector('dialog h2')?.textContent).toBe('Domingo')
    expect(document.querySelector('dialog')?.textContent).toContain('Video 720p')
    wrapper.unmount()
  })

  it('si no se pueden pedir los videos de la lista, avisa y no abre el diálogo', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', failWith(500))
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    await menuItem(wrapper, 'Guardar en el drive: audio MP3').trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.type).toBe('error')
    expect(document.querySelector('dialog')).toBeNull()
    wrapper.unmount()
  })
})

describe('YoutubeDriveDialog', () => {
  const videos = ids(3).map((videoId, i) => ({ videoId, title: `Video ${i}`, thumbnailUrl: null, durationSeconds: 60 }))

  it('todos marcados; «Quitar todos» deja el botón deshabilitado y «Marcar todos» lo recupera', async () => {
    const wrapper = await mountSuspended(YoutubeDriveDialog, { props: { videos, format: 'mp3', heading: 'Domingo' }, attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('Subir 3 al drive')
    await button(wrapper, 'Quitar todos')!.trigger('click')
    const confirm = button(wrapper, 'Subir 0 al drive')!
    expect(confirm.attributes('disabled')).toBeDefined()
    await button(wrapper, 'Marcar todos')!.trigger('click')
    expect(button(wrapper, 'Subir 3 al drive')!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('confirma solo los marcados y se cierra; Cancelar no sube nada', async () => {
    const wrapper = await mountSuspended(YoutubeDriveDialog, { props: { videos, format: 'mp4_720', heading: 'Domingo' }, attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('100 MB')
    await wrapper.get('[aria-label="Guardar Video 0"]').setValue(false)
    await button(wrapper, 'Subir 2 al drive')!.trigger('click')
    expect(wrapper.emitted('confirm')![0]![0]).toEqual([videos[1], videos[2]])
    expect(wrapper.emitted('close')).toHaveLength(1)

    const other = await mountSuspended(YoutubeDriveDialog, { props: { videos, format: 'mp3', heading: 'Domingo' }, attachTo: document.body })
    await flush()
    await button(other, 'Cancelar')!.trigger('click')
    expect(other.emitted('confirm')).toBeUndefined()
    expect(other.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    other.unmount()
  })

  it('un video que ya se está guardando aparece deshabilitado y no se envía', async () => {
    active.add('video000001')
    const wrapper = await mountSuspended(YoutubeDriveDialog, { props: { videos, format: 'mp3', heading: 'Domingo' }, attachTo: document.body })
    await flush()
    expect(wrapper.get('[aria-label="Guardar Video 1"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Ya se está guardando')
    await button(wrapper, 'Subir 2 al drive')!.trigger('click')
    expect((wrapper.emitted('confirm')![0]![0] as { videoId: string }[]).map(v => v.videoId)).toEqual(['video000000', 'video000002'])
    wrapper.unmount()
  })
})
