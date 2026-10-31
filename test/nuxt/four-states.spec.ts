// T150 — US9: los cuatro estados (Constitución VI) en todas las vistas con datos.
// Cada página muestra el skeleton mientras espera, el `EmptyState` sin datos, el `ErrorState`
// con "Reintentar" ante un 500 y, al reintentar, vuelve a pedir los datos y sale del error.
// Las pruebas por página (pages-*.spec) siguen cubriendo sus textos y acciones específicas.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Component } from 'vue'
import type { DashboardSummary, Me } from '#shared/types/api'
import AccessRequestList from '~/components/guests/AccessRequestList.vue'
import ActividadPage from '~/pages/actividad.vue'
import FilesIndexPage from '~/pages/archivos/index.vue'
import HomePage from '~/pages/index.vue'
import PapeleraPage from '~/pages/papelera.vue'
import SolicitudesPage from '~/pages/solicitudes.vue'
import UsuariosPage from '~/pages/usuarios.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const profile = (changes: Partial<Me['profile']> = {}): Me['profile'] => ({
  userId: 'u1', email: 'ana@iglesia.org', name: 'Ana Pérez', role: 'editor', status: 'active', createdAt: '', ...changes,
})
const setMe = (changes: Partial<Me['profile']> = {}) => {
  useMe().me.value = { user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana Pérez' }, profile: profile(changes) }
}

const emptySummary: DashboardSummary = {
  recentFiles: [],
  pendingCount: 0,
  openAccessRequests: 0,
  totalsByCategory: {
    image: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 },
    presentation: { count: 0, bytes: 0 }, document: { count: 0, bytes: 0 },
  },
  storage: { activeBytes: 0, trashBytes: 0 },
}

interface Row {
  name: string
  page: Component
  /** Ruta con la que se monta (el explorador lee los filtros de la URL). */
  route?: string
  /** Endpoint del que depende la vista; es el que falla y el que se vuelve a pedir. */
  endpoint: string
  /** Respuesta sin datos que debe mostrar el `EmptyState`. */
  emptyPayload: unknown
  errorCopy: string
  emptyCopy: string
}

const rows: Row[] = [
  {
    name: 'Inicio',
    page: HomePage,
    endpoint: '/api/dashboard',
    emptyPayload: emptySummary,
    errorCopy: 'No pudimos cargar el resumen',
    emptyCopy: 'Sube tu primer archivo',
  },
  {
    name: 'Archivos',
    page: FilesIndexPage,
    route: '/archivos',
    endpoint: '/api/folders/root/children',
    emptyPayload: { folder: null, breadcrumbs: [{ id: null, name: 'Archivos' }], folders: [], files: [], nextCursor: null },
    errorCopy: 'No pudimos cargar los archivos',
    emptyCopy: 'Esta carpeta está vacía',
  },
  {
    name: 'Solicitudes',
    page: SolicitudesPage,
    endpoint: '/api/submissions',
    emptyPayload: [],
    errorCopy: 'No pudimos cargar los envíos',
    emptyCopy: 'No hay envíos por revisar',
  },
  {
    name: 'Solicitudes de acceso',
    page: AccessRequestList,
    endpoint: '/api/access-requests',
    emptyPayload: [],
    errorCopy: 'No pudimos cargar las solicitudes de acceso',
    emptyCopy: 'Nadie está pidiendo acceso ahora',
  },
  {
    name: 'Papelera',
    page: PapeleraPage,
    endpoint: '/api/trash',
    emptyPayload: [],
    errorCopy: 'No pudimos cargar la papelera',
    emptyCopy: 'La papelera está vacía',
  },
  {
    name: 'Usuarios',
    page: UsuariosPage,
    endpoint: '/api/users',
    emptyPayload: { items: [], total: 0 },
    errorCopy: 'No pudimos cargar los usuarios',
    emptyCopy: 'Todavía no hay otras cuentas',
  },
  {
    name: 'Actividad',
    page: ActividadPage,
    endpoint: '/api/activity',
    emptyPayload: { items: [], nextCursor: null },
    errorCopy: 'No pudimos cargar la actividad',
    emptyCopy: 'Sin actividad todavía',
  },
]

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  // Usuarios y Actividad son de admin; el resto también se renderiza con ese rol.
  setMe({ role: 'admin' })
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [], pendingUsers: 0, openAccessRequests: 0, newAccessRequests: [] })
  // El filtro por persona de /actividad: no es el endpoint bajo prueba.
  mockApi('GET', '/api/users', { items: [], total: 0 })
  // La sección de solicitudes de acceso de /solicitudes (feature 003): tampoco es el endpoint bajo prueba.
  mockApi('GET', '/api/access-requests', [])
})

describe.each(rows)('$name · los cuatro estados', ({ page, route, endpoint, emptyPayload, errorCopy, emptyCopy }) => {
  const mount = () => mountSuspended(page, route ? { route } : undefined)
  const requests = () => calls.filter(c => c.url === endpoint).length

  it('cargando: muestra el skeleton mientras no llega la respuesta', async () => {
    mockApi('GET', endpoint, () => new Promise(() => {}))
    const wrapper = await mount()
    await nextTick()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('vacío: sin datos muestra el EmptyState', async () => {
    mockApi('GET', endpoint, emptyPayload)
    const wrapper = await mount()
    await flush()
    expect(wrapper.text()).toContain(emptyCopy)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('error: un 500 muestra el ErrorState con "Reintentar"', async () => {
    mockApi('GET', endpoint, failWith(500))
    const wrapper = await mount()
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain(errorCopy)
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(1)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('reintentar: vuelve a pedir los datos y sale del error', async () => {
    mockApi('GET', endpoint, failWith(500))
    const wrapper = await mount()
    await flush()
    const before = requests()

    mockApi('GET', endpoint, emptyPayload)
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(requests()).toBe(before + 1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(emptyCopy)
  })
})
