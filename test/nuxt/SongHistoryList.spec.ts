// T066 — Historial de Canciones (feature 006): rejilla con casillas y v-model:selected, siguiente página, «Cargar más» con su
// propio error, acciones por entrada (abrir, agregar a colección, generar, quitar con confirmación), modo reciente y los
// cuatro estados.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { SongHistoryItem } from '#shared/types/api'
import SongHistoryList from '~/components/songs/SongHistoryList.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const item = (n: number, changes: Partial<SongHistoryItem> = {}): SongHistoryItem => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, title: `Canción ${n}`, artist: n % 2 ? 'Banda' : null,
  sourceUrl: `https://letras.com/a/c${n}`, viewedAt: new Date(Date.now() - 3_600_000).toISOString(),
  viewedBy: { userId: 'u2', name: 'Luis', active: true }, ...changes,
})
// El centinela del final: happy-dom no tiene IntersectionObserver, así que su visibilidad se controla a mano.
const { sentinelVisible, navigateToMock } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { sentinelVisible: ref(false), navigateToMock: vi.fn() }
})
mockNuxtImport('useElementVisibility', () => () => sentinelVisible)
mockNuxtImport('navigateTo', () => navigateToMock)

const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  sentinelVisible.value = false
  navigateToMock.mockClear()
})

describe('SongHistoryList', () => {
  it('cargando, error con reintento, vacío y contenido', async () => {
    mockApi('GET', '/api/songs/history', () => new Promise(() => {}))
    const loading = await mountSuspended(SongHistoryList)
    await nextTick()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/songs/history', failWith(500))
    const wrapper = await mountSuspended(SongHistoryList)
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar el historial')
    mockApi('GET', '/api/songs/history', { items: [], nextCursor: null })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Todavía no hay canciones')
    expect(wrapper.text()).toContain('Pega el primer enlace arriba.')

    mockApi('GET', '/api/songs/history', { items: [item(1), item(2, { viewedBy: { userId: 'u3', name: 'Eva', active: false } })], nextCursor: null })
    await refreshNuxtData('songs-history')
    await flush()
    const cards = wrapper.findAll('[aria-label="Canciones consultadas"] li')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Canción 1')
    expect(cards[0]!.text()).toMatch(/Luis · hace 1 hora/)
    expect(cards[1]!.text()).toContain('Usuario que ya no está activo')
    expect(cards[0]!.get('a').attributes('href')).toBe(`/canciones/${item(1).id}`)
  })

  it('las casillas actualizan v-model:selected', async () => {
    mockApi('GET', '/api/songs/history', { items: [item(1), item(2)], nextCursor: null })
    const wrapper = await mountSuspended(SongHistoryList, { props: { selected: [item(2).id] } })
    await flush()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect((boxes[1]!.element as HTMLInputElement).checked).toBe(true)
    expect(boxes[0]!.attributes('aria-label')).toBe('Seleccionar Canción 1')
    await boxes[0]!.trigger('change')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[item(2).id, item(1).id]])
    // Desmarcar una marcada la quita de la selección.
    await boxes[1]!.trigger('change')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[item(1).id]])
  })

  it('songsOf devuelve las canciones cargadas en el orden pedido e ignora las que no están', async () => {
    mockApi('GET', '/api/songs/history', { items: [item(1), item(2)], nextCursor: null })
    const wrapper = await mountSuspended(SongHistoryList)
    await flush()
    const { songsOf } = wrapper.vm as unknown as { songsOf: (ids: readonly string[]) => SongHistoryItem[] }
    expect(songsOf([item(2).id, 'no-cargada', item(1).id]).map(s => s.title)).toEqual(['Canción 2', 'Canción 1'])
  })

  it('«Cargar más» pide la página siguiente con el cursor y tiene su propio error', async () => {
    mockApi('GET', '/api/songs/history', (event: { path: string }) => (event.path.includes('cursor=c1')
      ? { items: [item(3)], nextCursor: null }
      : { items: [item(1), item(2)], nextCursor: 'c1' }))
    const wrapper = await mountSuspended(SongHistoryList)
    await flush()
    mockApi('GET', '/api/songs/history', failWith(500))
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar más canciones.')
    mockApi('GET', '/api/songs/history', (event: { path: string }) => (event.path.includes('cursor=c1')
      ? { items: [item(3)], nextCursor: null }
      : { items: [item(1), item(2)], nextCursor: 'c1' }))
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.findAll('[aria-label="Canciones consultadas"] li')).toHaveLength(3)
    expect(buttonsWithText(wrapper, 'Cargar más')).toHaveLength(0)
  })

  it('al llegar al final (centinela visible) pide sola la página siguiente', async () => {
    mockApi('GET', '/api/songs/history', (event: { path: string }) => (event.path.includes('cursor=c1')
      ? { items: [item(3)], nextCursor: null }
      : { items: [item(1), item(2)], nextCursor: 'c1' }))
    const wrapper = await mountSuspended(SongHistoryList)
    await flush()
    expect(wrapper.findAll('[aria-label="Canciones consultadas"] li')).toHaveLength(2)
    sentinelVisible.value = true
    await vi.waitFor(() => expect(wrapper.findAll('[aria-label="Canciones consultadas"] li')).toHaveLength(3), { timeout: 5000 })
    expect(wrapper.findAll('[aria-label="Canciones consultadas"] li').map(li => li.text().match(/Canción \d/)![0])).toEqual(['Canción 1', 'Canción 2', 'Canción 3'])
    expect(buttonsWithText(wrapper, 'Cargar más')).toHaveLength(0)
    wrapper.unmount()
  })

  it('acciones por entrada: agregar a colección, generar y quitar con confirmación', async () => {
    mockApi('GET', '/api/songs/history', { items: [item(1)], nextCursor: null })
    mockApi('DELETE', `/api/songs/history/${item(1).id}`, null)
    const wrapper = await mountSuspended(SongHistoryList, { props: { selected: [item(1).id] }, attachTo: document.body })
    await flush()
    const open = async () => {
      await wrapper.get('button[aria-label="Acciones de Canción 1"]').trigger('click')
      await flush()
    }
    await open()
    expect(menuItems().map(i => i.text())).toEqual(['Abrir', 'Agregar a colección', 'Generar presentación', 'Quitar del historial'])
    await menuItems()[0]!.trigger('click')
    await flush()
    expect(navigateToMock).toHaveBeenCalledWith(`/canciones/${item(1).id}`)
    await open()
    await menuItems()[1]!.trigger('click')
    expect((wrapper.emitted('collection')?.[0]?.[0] as SongHistoryItem).id).toBe(item(1).id)
    await open()
    await menuItems()[2]!.trigger('click')
    expect((wrapper.emitted('generate')?.[0]?.[0] as SongHistoryItem[]).map(s => s.id)).toEqual([item(1).id])
    await open()
    await menuItems()[3]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Quitar «Canción 1» del historial? Seguirá en sus colecciones.')
    useConfirm().accept()
    await flush(10)
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/songs/history/${item(1).id}`)).toBe(true)
    expect(useToast().toasts.value.map(t => t.message)).toContain('Se quitó «Canción 1» del historial')
    expect(wrapper.findAll('[aria-label="Canciones consultadas"] li')).toHaveLength(0)
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[]])
    wrapper.unmount()
  })

  it('modo reciente: sin casillas, sin la canción actual y con su vacío propio', async () => {
    mockApi('GET', '/api/songs/history', (event: { path: string }) => ({ items: event.path.includes('exclude=') ? [] : [item(1)], nextCursor: null }))
    const wrapper = await mountSuspended(SongHistoryList, { props: { recent: true, exclude: item(9).id } })
    await flush()
    expect(calls.find(c => c.url === '/api/songs/history')).toBeTruthy()
    expect(wrapper.text()).toContain('Todavía no hay otras canciones')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })
})
