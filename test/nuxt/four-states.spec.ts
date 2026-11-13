// T150 — US9: los cuatro estados (Constitución VI) en todas las vistas con datos.
// Cada página muestra el skeleton mientras espera, el `EmptyState` sin datos, el `ErrorState`
// con "Reintentar" ante un 500 y, al reintentar, vuelve a pedir los datos y sale del error.
// Las pruebas por página (pages-*.spec) siguen cubriendo sus textos y acciones específicas.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Component } from 'vue'
import type { DashboardSummary, Me } from '#shared/types/api'
import ActividadPage from '~/pages/actividad.vue'
import CancionesPage from '~/pages/canciones/index.vue'
import FilesIndexPage from '~/pages/archivos/index.vue'
import HomePage from '~/pages/index.vue'
import PapeleraPage from '~/pages/papelera.vue'
import PeticionesPage from '~/pages/peticiones.vue'
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
  // /canciones (feature 006) tiene dos vistas con datos, cada una con su endpoint; la otra se simula con contenido (ver beforeEach).
  {
    name: 'Canciones · Colecciones',
    page: CancionesPage,
    endpoint: '/api/songs/collections',
    emptyPayload: { items: [] },
    errorCopy: 'No pudimos cargar las colecciones',
    emptyCopy: 'Aún no hay colecciones',
  },
  {
    name: 'Canciones · Historial',
    page: CancionesPage,
    endpoint: '/api/songs/history',
    emptyPayload: { items: [], nextCursor: null },
    errorCopy: 'No pudimos cargar el historial',
    emptyCopy: 'Todavía no hay canciones',
  },
  // /peticiones tiene tres vistas con datos (feature 007, enmienda de historial); las otras dos se simulan con contenido.
  {
    name: 'Peticiones · Colecciones',
    page: PeticionesPage,
    endpoint: '/api/peticiones/colecciones',
    emptyPayload: { items: [] },
    errorCopy: 'No pudimos cargar las colecciones',
    emptyCopy: 'Aún no hay colecciones',
  },
  {
    name: 'Peticiones',
    page: PeticionesPage,
    endpoint: '/api/peticiones',
    emptyPayload: { items: [], nextCursor: null },
    errorCopy: 'No pudimos cargar las peticiones',
    emptyCopy: 'Todavía no hay peticiones aprobadas',
  },
  {
    name: 'Peticiones · Historial',
    page: PeticionesPage,
    endpoint: '/api/peticiones/imagenes',
    emptyPayload: { items: [], nextCursor: null },
    errorCopy: 'No pudimos cargar el historial de imágenes',
    emptyCopy: 'Aún no hay imágenes generadas',
  },
]

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  // Usuarios y Actividad son de admin; el resto también se renderiza con ese rol.
  setMe({ role: 'admin' })
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [], pendingUsers: 0 })
  // El filtro por persona de /actividad: no es el endpoint bajo prueba.
  mockApi('GET', '/api/users', { items: [], total: 0 })
  // /canciones: la vista que no se prueba responde con contenido, para que su skeleton o aviso no se confunda con el de la otra.
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', '/api/songs/collections', {
    items: [{ id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' }],
  })
  mockApi('GET', '/api/songs/history', {
    items: [{ id: 's1', title: 'Canción 1', artist: 'Artista', sourceUrl: 'https://letras.com/artista/cancion-1', viewedAt: '2026-11-05T10:00:00.000Z', viewedBy: { userId: 'u1', name: 'Ana', active: true } }],
    nextCursor: null,
  })
})

const PRAYER_IMAGE = {
  id: '10000000-0000-4000-8000-000000000001',
  previewUrl: '/api/peticiones/imagenes/10000000-0000-4000-8000-000000000001/content',
  downloadUrl: '/api/peticiones/imagenes/10000000-0000-4000-8000-000000000001/content?download=1',
  fileIds: ['00000000-0000-4000-8000-000000000001'],
  requestCount: 1,
  author: { userId: 'u1', name: 'Ana', active: true },
  createdAt: '2026-11-05T10:00:00.000Z',
}

beforeEach(() => {
  // /peticiones: las vistas que no se prueban responden con contenido.
  useState('prayer-history-added').value = []
  mockApi('GET', '/api/peticiones/colecciones', {
    items: [{ id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' }],
  })
  mockApi('GET', '/api/peticiones/imagenes', { items: [PRAYER_IMAGE], nextCursor: null })
  mockApi('GET', '/api/peticiones', {
    items: [{
      id: '00000000-0000-4000-8000-000000000001', name: 'a.jpg', senderName: 'Eva', note: null, sentAt: '2026-11-05T10:00:00.000Z', approvedAt: '2026-11-05T10:00:00.000Z',
      previewUrl: '/api/files/00000000-0000-4000-8000-000000000001/content',
      text: { status: 'ready', text: 'Oremos', error: null, readAt: null, editedAt: null, editedBy: null },
    }],
    nextCursor: null,
  })
})

describe.each(rows)('$name · los cuatro estados', ({ page, route, endpoint, emptyPayload, errorCopy, emptyCopy }) => {
  const mount = () => mountSuspended(page, route ? { route } : undefined)
  const requests = () => calls.filter(c => c.url === endpoint).length

  it('cargando: muestra el skeleton mientras no llega la respuesta', async () => {
    mockApi('GET', endpoint, () => new Promise(() => {}))
    const wrapper = await mount()
    await nextTick()
    // Una vista diferida (`Lazy*`) llega con su chunk: se espera a que aparezca su skeleton.
    await vi.waitFor(() => expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true), { timeout: 5000 })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('vacío: sin datos muestra el EmptyState', async () => {
    mockApi('GET', endpoint, emptyPayload)
    const wrapper = await mount()
    await flush()
    await vi.waitFor(() => expect(wrapper.text()).toContain(emptyCopy), { timeout: 5000 })
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('error: un 500 muestra el ErrorState con "Reintentar"', async () => {
    mockApi('GET', endpoint, failWith(500))
    const wrapper = await mount()
    await flush()
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true), { timeout: 5000 })
    expect(wrapper.get('[role="alert"]').text()).toContain(errorCopy)
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(1)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('reintentar: vuelve a pedir los datos y sale del error', async () => {
    mockApi('GET', endpoint, failWith(500))
    const wrapper = await mount()
    await flush()
    await vi.waitFor(() => expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(1), { timeout: 5000 })
    const before = requests()

    mockApi('GET', endpoint, emptyPayload)
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(requests()).toBe(before + 1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(emptyCopy)
  })
})
