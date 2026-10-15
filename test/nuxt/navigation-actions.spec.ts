import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { FileItem, FolderItem, Me } from '#shared/types/api'
import DashboardLayout from '~/layouts/dashboard.vue'
import FileCard from '~/components/files/FileCard.vue'
import FileList from '~/components/files/FileList.vue'
import FolderCard from '~/components/files/FolderCard.vue'
import type { Queryable, QueryableWithGet } from './helpers/api'
import { mockApi } from './helpers/api'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const file: FileItem = {
  id: 'f1', folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 1,
  hasThumbnail: false, origin: 'team', uploadedBy: null, guestName: null, createdAt: new Date().toISOString(), updatedAt: '',
}
const folder: FolderItem = { id: 'd1', name: 'Domingo', parentId: null, createdAt: '', updatedAt: '' }

async function choose(wrapper: QueryableWithGet, menuLabel: string, option: string) {
  await wrapper.get(`button[aria-label="${menuLabel}"]`).trigger('click')
  await wrapper.findAll('[role="menuitem"]').find(o => o.text() === option)!.trigger('click')
}

beforeEach(() => {
  navigateToMock.mockReset()
})

describe('"Abrir" desde el menú ⋯ navega al detalle o a la carpeta', () => {
  it('tarjetas', async () => {
    await choose(await mountSuspended(FileCard, { props: { file } }), 'Acciones de foto.jpg', 'Abrir')
    expect(navigateToMock).toHaveBeenLastCalledWith('/archivos/ver/f1')
    await choose(await mountSuspended(FolderCard, { props: { folder } }), 'Acciones de la carpeta Domingo', 'Abrir')
    expect(navigateToMock).toHaveBeenLastCalledWith('/archivos/d1')
  })

  it('lista', async () => {
    const wrapper = await mountSuspended(FileList, { props: { folders: [folder], items: [file] } })
    await choose(wrapper, 'Acciones de foto.jpg', 'Abrir')
    expect(navigateToMock).toHaveBeenLastCalledWith('/archivos/ver/f1')
    await choose(wrapper, 'Acciones de la carpeta Domingo', 'Abrir')
    expect(navigateToMock).toHaveBeenLastCalledWith('/archivos/d1')
    // "Eliminar" de una carpeta se delega al explorador.
    await choose(wrapper, 'Acciones de la carpeta Domingo', 'Eliminar')
    expect(wrapper.emitted('folderAction')![0]![0]).toBe('trash')
  })
})

describe('tema', () => {
  it('un valor de cookie desconocido vuelve al tema oscuro por defecto', async () => {
    useState('theme').value = undefined
    useCookie('cloudy-theme').value = 'rosa'
    clearNuxtState('theme')
    const { theme, isDark, set } = useTheme()
    expect(theme.value).toBe('cloudy')
    expect(isDark.value).toBe(true)
    set('cloudy-light')
    expect(theme.value).toBe('cloudy-light')
    await nextTick()
    expect(document.cookie).toContain('cloudy-theme=cloudy-light')
    set('cloudy')
  })
})

describe('barra lateral contraíble', () => {
  it('guarda la preferencia en el dispositivo', async () => {
    useState<Me | null>('me').value = {
      user: { id: 'u1', email: 'a@x.org', name: 'Ana' },
      profile: { userId: 'u1', email: 'a@x.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
    }
    mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [] })
    localStorage.removeItem('cloudy-sidebar-collapsed')
    const wrapper = await mountSuspended(DashboardLayout)
    await wrapper.get('button[aria-label="Contraer barra lateral"]').trigger('click')
    expect(localStorage.getItem('cloudy-sidebar-collapsed')).toBe('true')
    wrapper.unmount()
    localStorage.removeItem('cloudy-sidebar-collapsed')
  })
})
