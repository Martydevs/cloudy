// Página Papelera (US7): cuatro estados, acciones por fila y "Vaciar papelera" solo para admin.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Me, TrashItem } from '#shared/types/api'
import PapeleraPage from '~/pages/papelera.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

function setMe(role: 'admin' | 'editor') {
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

const folder: TrashItem = {
  id: 'f1', kind: 'folder', name: 'Ensayo', originalPath: ['Domingo', 'Fotos'], deletedBy: 'Ana',
  deletedAt: new Date().toISOString(), daysLeft: 30, itemCount: 4, bytes: 3072,
}
const file: TrashItem = {
  id: 'a1', kind: 'file', name: 'foto.jpg', originalPath: [], deletedBy: null,
  deletedAt: new Date().toISOString(), daysLeft: 5, itemCount: 0, bytes: 1024,
}

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
})

describe('/papelera', () => {
  it('estados de carga, error con reintento y vacío', async () => {
    mockApi('GET', '/api/trash', () => new Promise(() => {}))
    const loading = await mountSuspended(PapeleraPage)
    await nextTick()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/trash', failWith(500))
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar la papelera')

    mockApi('GET', '/api/trash', [])
    await button(wrapper, 'Reintentar')!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('La papelera está vacía')
    expect(button(wrapper, 'Vaciar papelera')).toBeUndefined()
  })

  it('muestra ubicación original, quién eliminó, contenido y días restantes', async () => {
    mockApi('GET', '/api/trash', [folder, file])
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Ubicación original: /Domingo/Fotos')
    expect(rows[0]!.text()).toContain('Eliminado por Ana')
    expect(rows[0]!.text()).toContain('4 elementos')
    expect(rows[0]!.get('.badge').text()).toBe('Quedan 30 días')
    expect(rows[0]!.get('.badge').classes()).not.toContain('badge-warning')
    expect(rows[1]!.text()).toContain('Ubicación original: /')
    expect(rows[1]!.get('.badge').text()).toBe('Quedan 5 días')
    expect(rows[1]!.get('.badge').classes()).toContain('badge-warning')
    // Editor: no puede vaciar la papelera.
    expect(button(wrapper, 'Vaciar papelera')).toBeUndefined()
  })

  it('restaurar avisa la ubicación final y recarga la lista', async () => {
    mockApi('GET', '/api/trash', [folder])
    mockApi('POST', '/api/trash/folder/f1/restore', { name: 'Ensayo', restoredTo: { folderId: 'p1', path: ['Domingo', 'Fotos'] }, movedToRoot: false })
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    await wrapper.get('button[aria-label="Restaurar Ensayo"]').trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ message: '«Ensayo» se restauró en /Domingo/Fotos', type: 'success' })
    expect(calls.filter(c => c.method === 'GET' && c.url === '/api/trash').length).toBeGreaterThanOrEqual(2)
  })

  it('si la carpeta original sigue en la papelera, avisa que quedó en Archivos', async () => {
    mockApi('GET', '/api/trash', [file])
    mockApi('POST', '/api/trash/file/a1/restore', { name: 'foto (2).jpg', restoredTo: { folderId: null, path: [] }, movedToRoot: true })
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    await wrapper.get('button[aria-label="Restaurar foto.jpg"]').trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({
      message: '«foto (2).jpg» se restauró en Archivos porque su carpeta original sigue en la papelera',
      type: 'info',
    })
  })

  it('un error al restaurar se informa con un toast', async () => {
    mockApi('GET', '/api/trash', [file])
    mockApi('POST', '/api/trash/file/a1/restore', failWith(404, undefined, 'El elemento ya no está en la papelera'))
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    await wrapper.get('button[aria-label="Restaurar foto.jpg"]').trigger('click')
    await flush()
    // El endpoint simulado no transmite `message` (el servidor real sí): se ve el texto de respaldo.
    expect(useToast().toasts.value.at(-1)).toMatchObject({ message: 'No pudimos restaurarlo. Inténtalo de nuevo.', type: 'error' })
    expect(calls.filter(c => c.method === 'GET' && c.url === '/api/trash').length).toBeGreaterThanOrEqual(2)
  })

  it('eliminar definitivamente pide confirmación', async () => {
    mockApi('GET', '/api/trash', [folder])
    mockApi('DELETE', '/api/trash/folder/f1', null)
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    const purge = wrapper.get('button[aria-label="Eliminar definitivamente Ensayo"]')

    await purge.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Eliminar definitivamente «Ensayo»?', danger: true })
    expect(useConfirm().options.value?.message).toContain('4 elementos')
    expect(useConfirm().options.value?.message).toContain('no se puede deshacer')
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)

    await purge.trigger('click')
    await nextTick()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/trash/folder/f1')).toBe(true)
    expect(useToast().toasts.value.at(-1)?.message).toBe('«Ensayo» se eliminó definitivamente')
  })

  it('avisa cuando queda un día o se borra hoy', async () => {
    mockApi('GET', '/api/trash', [{ ...file, id: 'a2', daysLeft: 1 }, { ...file, id: 'a3', name: 'hoy.jpg', daysLeft: 0 }])
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    const badges = wrapper.findAll('li .badge')
    expect(badges.map(b => b.text())).toEqual(['Queda 1 día', 'Se borra hoy'])
    expect(badges.every(b => b.classes().includes('badge-warning'))).toBe(true)
  })

  it('cancelar «Vaciar papelera» no borra nada', async () => {
    setMe('admin')
    mockApi('GET', '/api/trash', [folder])
    mockApi('DELETE', '/api/trash', { purged: 1 })
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    await button(wrapper, 'Vaciar papelera')!.trigger('click')
    await nextTick()
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    expect(wrapper.text()).toContain('Ensayo')
  })

  it('el admin puede vaciar la papelera tras confirmar', async () => {
    setMe('admin')
    mockApi('GET', '/api/trash', [folder, file])
    mockApi('DELETE', '/api/trash', { purged: 2 })
    const wrapper = await mountSuspended(PapeleraPage)
    await flush()
    await button(wrapper, 'Vaciar papelera')!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Vaciar la papelera?', danger: true })
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/trash')).toBe(true)
    expect(useToast().toasts.value.at(-1)?.message).toBe('Se eliminaron 2 elementos definitivamente')
  })
})
