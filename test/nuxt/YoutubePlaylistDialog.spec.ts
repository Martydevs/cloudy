// T044 — Diálogo de listas (feature 005, FR-015–FR-018, FR-027): crear con un video, agregar sin duplicar y el detalle
// con sus cuatro estados, acciones por video y permisos de autor o administrador.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Me, YoutubePlaylist, YoutubePlaylistDetail } from '#shared/types/api'
import YoutubePlaylistDialog from '~/components/youtube/YoutubePlaylistDialog.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

function setMe(role: 'admin' | 'editor', userId: string) {
  const me: Me = {
    user: { id: userId, email: `${userId}@iglesia.org`, name: userId },
    profile: { userId, email: `${userId}@iglesia.org`, name: userId, role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

const playlist = (changes: Partial<YoutubePlaylist> = {}): YoutubePlaylist => ({
  id: 'p1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, covers: [],
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...changes,
})

const detail = (changes: Partial<YoutubePlaylistDetail> = {}): YoutubePlaylistDetail => ({
  ...playlist(),
  items: [{
    videoId: 'okShortVid1', title: 'Alabanza', channel: null, durationSeconds: 185, thumbnailUrl: null,
    addedAt: '2026-11-01T10:00:00.000Z', addedBy: { userId: 'u2', name: 'Luis', active: true },
  }],
  ...changes,
})

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('youtube-downloads').value = { rows: [], groups: [] }
  setMe('editor', 'u1')
  mockApi('GET', '/api/youtube/playlists', { items: [playlist()] })
})

describe('YoutubePlaylistDialog · con un video', () => {
  it('Nueva lista valida el nombre (1–80) y crea la lista con el video', async () => {
    mockApi('POST', '/api/youtube/playlists', playlist({ name: 'Ensayo' }))
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { videoId: 'okShortVid1', videoTitle: 'Alabanza' }, attachTo: document.body })
    await flush()
    const input = wrapper.get('input[type="text"]')
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Nombre')
    await input.setValue('a'.repeat(81))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Debe tener como máximo 80 caracteres')
    expect(calls.some(c => c.method === 'POST')).toBe(false)

    await input.setValue('  Ensayo ')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ name: 'Ensayo', videoId: 'okShortVid1' })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Lista «Ensayo» creada')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('Agregar a una existente avisa «Ya estaba» sin duplicar', async () => {
    mockApi('POST', '/api/youtube/playlists/p1/items', { added: false })
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { videoId: 'okShortVid1' }, attachTo: document.body })
    await flush()
    await wrapper.findAll('[role="tab"]').find(t => t.text() === 'Agregar a una existente')!.trigger('click')
    await flush()
    await wrapper.findAll('button').find(b => b.text().includes('Domingo'))!.trigger('click')
    await flush()
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ videoId: 'okShortVid1' })
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'info', message: 'Ya estaba en «Domingo»' })
    mockApi('POST', '/api/youtube/playlists/p1/items', { added: true })
    wrapper.unmount()
  })
})

describe('YoutubePlaylistDialog · fallos', () => {
  it('crear o agregar que fallan avisan y dejan el diálogo abierto; sin listas, la pestaña lo explica', async () => {
    mockApi('POST', '/api/youtube/playlists', failWith(500))
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { videoId: 'okShortVid1' }, attachTo: document.body })
    await flush()
    await wrapper.get('input[type="text"]').setValue('Ensayo')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'No pudimos crear la lista. Inténtalo de nuevo.' })
    expect(wrapper.emitted('close')).toBeUndefined()

    mockApi('POST', '/api/youtube/playlists/p1/items', failWith(500))
    await wrapper.findAll('[role="tab"]').find(t => t.text() === 'Agregar a una existente')!.trigger('click')
    await flush()
    await wrapper.findAll('button').find(b => b.text().includes('Domingo'))!.trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('No pudimos agregar el video. Inténtalo de nuevo.')
    await button(wrapper, 'Cerrar')?.trigger('click')
    wrapper.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/playlists', { items: [] })
    const empty = await mountSuspended(YoutubePlaylistDialog, { props: { videoId: 'okShortVid1' } })
    await flush()
    await empty.findAll('[role="tab"]').find(t => t.text() === 'Agregar a una existente')!.trigger('click')
    await flush()
    expect(empty.text()).toContain('Crea la primera en la pestaña «Nueva lista».')
    empty.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/playlists', failWith(500))
    const broken = await mountSuspended(YoutubePlaylistDialog, { props: { videoId: 'okShortVid1' } })
    await flush()
    await broken.findAll('[role="tab"]').find(t => t.text() === 'Agregar a una existente')!.trigger('click')
    await flush()
    expect(broken.text()).toContain('No pudimos cargar las listas')
    broken.unmount()
  })

  it('renombrar inválido no guarda; cancelar vuelve a los botones; fallos al renombrar, eliminar o quitar avisan', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', detail({ author: { userId: 'u1', name: 'Ana', active: false } }))
    mockApi('PATCH', '/api/youtube/playlists/p1', failWith(500))
    mockApi('DELETE', '/api/youtube/playlists/p1', failWith(500))
    mockApi('DELETE', '/api/youtube/playlists/p1/items/okShortVid1', failWith(500))
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' }, attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('Creada por Usuario que ya no está activo')
    await button(wrapper, 'Renombrar')!.trigger('click')
    await wrapper.get('input[type="text"]').setValue('')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    await wrapper.get('input[type="text"]').setValue('Nuevo')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('No pudimos renombrar la lista. Inténtalo de nuevo.')
    await button(wrapper, 'Cancelar')!.trigger('click')
    expect(button(wrapper, 'Renombrar')).toBeDefined()

    await button(wrapper, 'Eliminar lista')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('No pudimos eliminar la lista. Inténtalo de nuevo.')

    await wrapper.get('[aria-label="Quitar Alabanza de la lista"]').trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('No pudimos quitar el video. Inténtalo de nuevo.')

    // Cancelar la confirmación no llama a la API.
    resetCalls()
    await button(wrapper, 'Eliminar lista')!.trigger('click')
    await flush()
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    wrapper.unmount()
  })
})

describe('YoutubePlaylistDialog · detalle', () => {
  it('cargando, error con Reintentar, vacío y contenido', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', () => new Promise(() => {}))
    const loading = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' } })
    await nextTick()
    await flush()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)
    loading.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/playlists/p1', failWith(500))
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' } })
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar la lista')
    mockApi('GET', '/api/youtube/playlists/p1', detail({ items: [], itemCount: 0 }))
    await button(wrapper, 'Reintentar')!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Esta lista aún no tiene videos')
    wrapper.unmount()
  })

  it('por video: Abrir, Descargar y Quitar con confirmación; renombrar y eliminar para el autor', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', detail())
    mockApi('DELETE', '/api/youtube/playlists/p1/items/okShortVid1', null)
    mockApi('POST', '/api/youtube/jobs', { jobId: 'f'.repeat(32), status: 'queued', format: 'mp3', progress: 0, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null })
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' }, attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('Agregado por Luis')
    expect(wrapper.get('a[aria-label="Abrir Alabanza"]').attributes('href')).toBe('/youtube/okShortVid1')
    expect(button(wrapper, 'Renombrar')).toBeDefined()
    expect(button(wrapper, 'Eliminar lista')).toBeDefined()

    await wrapper.findAll('button').find(b => b.text().startsWith('Descargar'))!.trigger('click')
    await wrapper.findAll('[role="menuitemradio"]').find(o => o.text().includes('Audio MP3'))!.trigger('click')
    await flush()
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/youtube/jobs')?.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })

    await wrapper.get('[aria-label="Quitar Alabanza de la lista"]').trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/youtube/playlists/p1/items/okShortVid1')).toBe(true)
    wrapper.unmount()
  })

  it('renombrar valida y guarda; eliminar confirma y cierra', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', detail())
    mockApi('PATCH', '/api/youtube/playlists/p1', playlist({ name: 'Ensayo' }))
    mockApi('DELETE', '/api/youtube/playlists/p1', null)
    const wrapper = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' }, attachTo: document.body })
    await flush()
    await button(wrapper, 'Renombrar')!.trigger('click')
    await flush()
    const input = wrapper.get('input[type="text"]')
    expect((input.element as HTMLInputElement).value).toBe('Domingo')
    await input.setValue('Ensayo')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: 'Ensayo' })
    expect(useToast().toasts.value.some(t => t.message === 'Ahora se llama «Ensayo»')).toBe(true)

    await button(wrapper, 'Eliminar lista')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/youtube/playlists/p1')).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('otro editor no ve renombrar ni eliminar; un admin sí', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', detail())
    setMe('editor', 'u2')
    const other = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' } })
    await flush()
    expect(button(other, 'Renombrar')).toBeUndefined()
    expect(button(other, 'Eliminar lista')).toBeUndefined()
    other.unmount()

    setMe('admin', 'u9')
    const admin = await mountSuspended(YoutubePlaylistDialog, { props: { playlistId: 'p1' } })
    await flush()
    expect(button(admin, 'Renombrar')).toBeDefined()
    expect(button(admin, 'Eliminar lista')).toBeDefined()
    admin.unmount()
  })
})
