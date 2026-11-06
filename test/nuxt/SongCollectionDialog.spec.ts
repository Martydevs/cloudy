// T056 — Diálogo de colecciones (feature 006, FR-020–FR-024): crear vacía, crear con la canción, agregar a una existente
// («ya estaba» sin duplicar), ver la colección con sus canciones, quitar con confirmación, generar y renombrar/eliminar
// solo si puede gestionarla.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Me, SongCollection, SongCollectionDetail } from '#shared/types/api'
import SongCollectionDialog from '~/components/songs/SongCollectionDialog.vue'
import { buttonsWithText, calls, flush, mockApi, resetCalls } from './helpers/api'

const SONG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const collection = (changes: Partial<SongCollection> = {}): SongCollection => ({
  id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 2,
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', ...changes,
})
const detail = (changes: Partial<SongCollectionDetail> = {}): SongCollectionDetail => ({
  ...collection(),
  items: [
    { id: 's1', title: 'Primera', artist: 'Banda', sourceUrl: 'https://letras.com/a/b', addedAt: '2026-11-05T10:00:00.000Z', addedBy: { userId: 'u2', name: 'Luis', active: true } },
    { id: 's2', title: 'Segunda', artist: null, sourceUrl: 'https://letras.com/a/c', addedAt: '2026-11-05T11:00:00.000Z', addedBy: { userId: 'u1', name: 'Ana', active: true } },
  ],
  ...changes,
})
const toasts = () => useToast().toasts.value.map(t => t.message)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('songs-presentations').value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/songs/collections', { items: [collection()] })
  mockApi('GET', '/api/songs/collections/c1', detail())
  mockApi('POST', '/api/songs/collections', collection({ id: 'c2', name: 'Ensayo', itemCount: 0 }))
})

describe('SongCollectionDialog', () => {
  it('crear vacía: sin canción, valida el nombre y crea la colección', async () => {
    const wrapper = await mountSuspended(SongCollectionDialog, { attachTo: document.body })
    expect(wrapper.get('h2').text()).toBe('Nueva colección')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    await wrapper.get('input').setValue('  Ensayo  ')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/songs/collections')?.body).toEqual({ name: 'Ensayo' })
    expect(toasts()).toContain('Colección «Ensayo» creada')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('desde una canción: crear con la canción', async () => {
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { songId: SONG, songTitle: 'De Buenas' }, attachTo: document.body })
    expect(wrapper.text()).toContain('Canción: De Buenas')
    await wrapper.get('input').setValue('Domingo')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/songs/collections')?.body).toEqual({ name: 'Domingo', songId: SONG })
    wrapper.unmount()
  })

  it('desde una canción: agregar a una existente, y «ya estaba» sin duplicar', async () => {
    mockApi('POST', '/api/songs/collections/c1/items', { added: true })
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { songId: SONG, songTitle: 'De Buenas' }, attachTo: document.body })
    await buttonsWithText(wrapper, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    const option = wrapper.findAll('[aria-label="Colecciones del equipo"] button')[0]!
    expect(option.text()).toContain('Domingo')
    await option.trigger('click')
    await flush(10)
    expect(calls.find(c => c.url === '/api/songs/collections/c1/items')?.body).toEqual({ songId: SONG })
    expect(toasts()).toContain('Agregada a «Domingo»')
    wrapper.unmount()

    mockApi('POST', '/api/songs/collections/c1/items', { added: false })
    const again = await mountSuspended(SongCollectionDialog, { props: { songId: SONG }, attachTo: document.body })
    await buttonsWithText(again, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    await again.findAll('[aria-label="Colecciones del equipo"] button')[0]!.trigger('click')
    await flush(10)
    expect(toasts()).toContain('Ya estaba en «Domingo»')
    again.unmount()
  })

  it('ver una colección: sus canciones con título y artista, generar una y quitar con confirmación', async () => {
    mockApi('DELETE', '/api/songs/collections/c1/items/s1', null)
    mockApi('POST', '/api/songs/s2/pptx', () => new Promise(() => {}))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    const rows = wrapper.findAll('[aria-label="Canciones de Domingo"] li')
    expect(rows.map(r => r.text())).toEqual([expect.stringContaining('Primera'), expect.stringContaining('Segunda')])
    expect(rows[0]!.text()).toContain('Banda · Agregada por Luis')
    expect(rows[0]!.get('a').attributes('href')).toBe('/canciones/s1')

    await rows[1]!.get('button[aria-label="Generar la presentación de Segunda"]').trigger('click')
    await flush()
    expect(calls.filter(c => c.url === '/api/songs/s2/pptx')).toHaveLength(1)

    await rows[0]!.get('button[aria-label="Quitar Primera de la colección"]').trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Quitar «Primera» de la colección?')
    useConfirm().accept()
    await flush(10)
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/songs/collections/c1/items/s1')).toBe(true)
    expect(toasts()).toContain('Se quitó «Primera» de la colección')
    useState('songs-presentations').value = []
    wrapper.unmount()
  })

  it('generar la colección avisa cuántos archivos llegarán y encola las dos', async () => {
    mockApi('POST', '/api/songs/s1/pptx', () => new Promise(() => {}))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    await buttonsWithText(wrapper, 'Generar colección')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.message).toBe('Recibirás 2 archivos, uno por canción.')
    useConfirm().accept()
    await flush()
    expect(useState<{ songId: string }[]>('songs-presentations').value.map(i => i.songId)).toEqual(['s1', 's2'])
    useState('songs-presentations').value = []
    wrapper.unmount()
  })

  it('renombrar y eliminar solo para el autor o un admin', async () => {
    setMe('editor', 'u2')
    const other = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    expect(buttonsWithText(other, 'Renombrar')).toHaveLength(0)
    expect(buttonsWithText(other, 'Eliminar colección')).toHaveLength(0)
    other.unmount()

    setMe('admin', 'u9')
    mockApi('PATCH', '/api/songs/collections/c1', collection({ name: 'Ensayo' }))
    const admin = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    await buttonsWithText(admin, 'Renombrar')[0]!.trigger('click')
    await flush()
    await admin.get('form input').setValue('Ensayo')
    await admin.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: 'Ensayo' })
    expect(toasts()).toContain('Ahora se llama «Ensayo»')

    mockApi('DELETE', '/api/songs/collections/c1', null)
    await buttonsWithText(admin, 'Eliminar colección')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar la colección «Domingo»? Las canciones siguen en el historial.')
    useConfirm().accept()
    await flush(10)
    expect(toasts()).toContain('Se eliminó la colección «Domingo»')
    expect(admin.emitted('close')).toHaveLength(1)
    admin.unmount()
  })
})
