// T031 — Página Peticiones (feature 007, contracts/ui.md): encabezado, cuatro estados, desplazamiento infinito y selección.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { getQuery, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { Me, Paginated, PrayerRequest } from '#shared/types/api'
import PeticionesPage from '~/pages/peticiones.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { prayer, prayerText } from './prayer-fixtures'

const { visible, copyGuestLink } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { visible: ref(false), copyGuestLink: vi.fn() }
})
mockNuxtImport('useElementVisibility', () => () => visible)
mockNuxtImport('useGuestLink', () => () => ({ link: { value: 'http://localhost/upload' }, copyGuestLink }))

const page = (from: number, to: number, nextCursor: string | null): Paginated<PrayerRequest> =>
  ({ items: Array.from({ length: to - from + 1 }, (_, i) => prayer(from + i)), nextCursor })

const list = () => calls.filter(c => c.url === '/api/peticiones')

// `useFetch` comparte la clave `prayer-requests` y un `refresh` corre con las opciones de la *primera* instancia viva: cada
// prueba desmonta su página para que la siguiente no herede la query de una página anterior.
enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  visible.value = false
  copyGuestLink.mockClear()
  usePrayerSelection().clear()
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/peticiones', (event) => {
    return getQuery(event).cursor ? page(13, 14, null) : page(1, 12, 'c1')
  })
})

describe('/peticiones', () => {
  it('encabezado, descripción y Copiar enlace para invitados', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    expect(wrapper.get('h1').text()).toBe('Peticiones')
    expect(wrapper.text()).toContain('ya se aprobaron')
    await buttonsWithText(wrapper, 'Copiar enlace para invitados')[0]!.trigger('click')
    expect(copyGuestLink).toHaveBeenCalledOnce()
  })

  it('cargando: seis esqueletos con aria-busy', async () => {
    mockApi('GET', '/api/peticiones', () => new Promise(() => {}))
    const wrapper = await mountSuspended(PeticionesPage)
    await nextTick()
    const busy = wrapper.get('[aria-busy="true"]')
    expect(busy.findAll('.card')).toHaveLength(6)
    expect(busy.text()).toContain('Cargando peticiones…')
  })

  it('vacío: EmptyState con Ir a Solicitudes y Copiar enlace', async () => {
    mockApi('GET', '/api/peticiones', { items: [], nextCursor: null })
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    expect(wrapper.text()).toContain('Todavía no hay peticiones aprobadas')
    expect(wrapper.findAll('a').find(a => a.text().includes('Ir a Solicitudes'))!.attributes('href')).toBe('/solicitudes')
    const copy = buttonsWithText(wrapper, 'Copiar enlace para invitados')
    expect(copy).toHaveLength(2)
    await copy[1]!.trigger('click')
    expect(copyGuestLink).toHaveBeenCalledOnce()
  })

  it('error: ErrorState con Reintentar que vuelve a pedir', async () => {
    mockApi('GET', '/api/peticiones', failWith(500))
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar las peticiones')
    mockApi('GET', '/api/peticiones', page(1, 2, null))
    const before = list().length
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(list().length).toBe(before + 1)
    expect(wrapper.findAll('article')).toHaveLength(2)
  })

  it('contenido: una lista de tarjetas y la siguiente página por cursor al acercarse al final', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    expect(wrapper.get('ul[aria-label="Peticiones aprobadas"]').findAll('li > article')).toHaveLength(12)
    visible.value = true
    await flush(10)
    const requests = list()
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(wrapper.findAll('article')).toHaveLength(14)
    expect(wrapper.text()).toContain('Ya viste todas las peticiones')
  })

  it('Cargar más (teclado) muestra tres esqueletos mientras llega la página', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    mockApi('GET', '/api/peticiones', event => (getQuery(event).cursor ? new Promise(() => {}) : page(1, 12, 'c1')))
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await nextTick()
    expect(wrapper.get('[aria-label="Cargando más peticiones…"]').findAll('.card')).toHaveLength(3)
  })

  it('un fallo de una página posterior muestra el error compacto sin perder lo cargado, y Reintentar sigue', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    mockApi('GET', '/api/peticiones', event => (getQuery(event).cursor ? failWith(500)(event) : page(1, 12, 'c1')))
    await buttonsWithText(wrapper, 'Cargar más')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar más peticiones.')
    expect(wrapper.findAll('article')).toHaveLength(12)
    mockApi('GET', '/api/peticiones', event => (getQuery(event).cursor ? page(13, 14, null) : page(1, 12, 'c1')))
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.findAll('article')).toHaveLength(14)
    expect(list().filter(c => c.url === '/api/peticiones').length).toBeGreaterThanOrEqual(3)
  })

  it('elegir muestra la barra «N peticiones → M imágenes» y la selección se conserva al cargar más', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    for (const box of boxes.slice(0, 5)) await box.trigger('change')
    expect(wrapper.get('[aria-label="Selección de peticiones"]').text()).toContain('5 peticiones → 2 imágenes')
    await boxes[0]!.trigger('change')
    expect(wrapper.get('[aria-label="Selección de peticiones"]').text()).toContain('4 peticiones → 1 imagen')
    visible.value = true
    await flush(10)
    expect(wrapper.findAll('article')).toHaveLength(14)
    expect(wrapper.get('[aria-label="Selección de peticiones"]').text()).toContain('4 peticiones → 1 imagen')
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    expect(wrapper.find('[aria-label="Selección de peticiones"]').exists()).toBe(false)
  })

  it('una tarjeta sin texto no se puede elegir y dice por qué', async () => {
    mockApi('GET', '/api/peticiones', { items: [prayer(1, { text: prayerText({ status: 'empty', text: null }) })], nextCursor: null })
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Sin texto: escríbelo primero')
  })

  it('Ver elegidas abre el diálogo con las elegidas', async () => {
    const wrapper = await mountSuspended(PeticionesPage, { attachTo: document.body })
    await flush()
    await wrapper.findAll('input[type="checkbox"]')[0]!.trigger('change')
    await buttonsWithText(wrapper, 'Ver elegidas')[0]!.trigger('click')
    // `LazyPrayerSelectionDialog` es un `import()`: con la suite completa su chunk puede tardar más que unos ticks.
    await vi.waitFor(() => expect(document.body.querySelector('dialog')?.textContent).toContain('Invitado 1'), { timeout: 5000 })
    // **Quitar** saca a esa de la selección; **Cerrar** cierra el diálogo.
    await wrapper.get('dialog button[aria-label="Quitar la petición de Invitado 1"]').trigger('click')
    expect(usePrayerSelection().count.value).toBe(0)
    await buttonsWithText(wrapper.get('dialog'), 'Cerrar')[0]!.trigger('click')
    await flush()
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  describe('US2 · generar', () => {
    const png = (event: H3Event) => {
      setResponseHeader(event, 'content-type', 'image/png')
      return Buffer.from([0x89, 0x50, 0x4E, 0x47])
    }

    beforeEach(() => {
      usePrayerImages().reset()
      useToast().toasts.value = []
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      mockApi('POST', '/api/peticiones/imagenes', png)
    })

    async function choose(n: number, list: PrayerRequest[] = []) {
      if (list.length) mockApi('GET', '/api/peticiones', { items: list, nextCursor: null })
      const wrapper = await mountSuspended(PeticionesPage, { attachTo: document.body })
      await flush()
      for (const box of wrapper.findAll('input[type="checkbox"]').slice(0, n)) await box.trigger('change')
      return wrapper
    }

    const posts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')

    it('Generar imágenes pide confirmación con «N → M» y el aviso de crédito; Cancelar no encola nada', async () => {
      const wrapper = await choose(5)
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      const options = useConfirm().options.value!
      expect(options.title).toBe('Generar imágenes')
      expect(options.message).toContain('5 peticiones → 2 imágenes')
      expect(options.message).toContain('crédito')
      expect(options.confirmLabel).toBe('Generar')
      useConfirm().cancel()
      await flush()
      expect(posts()).toHaveLength(0)
      expect(wrapper.text()).not.toContain('Imágenes generadas')
      wrapper.unmount()
    })

    it('al confirmar encola los grupos, muestra los resultados arriba y conserva la selección', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      const wrapper = await choose(5)
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      useConfirm().accept()
      await flush(15)
      expect(posts().map(c => (c.body as { fileIds: string[] }).fileIds.length)).toEqual([4, 1])
      // `LazyPrayerResults` es un `import()`: con la suite completa su chunk puede tardar más que unos ticks.
      await vi.waitFor(() => expect(wrapper.findAll('img[alt^="Imagen de peticiones"]')).toHaveLength(2), { timeout: 5000 })
      expect(wrapper.text()).toContain('Imágenes generadas')
      expect(usePrayerSelection().count.value).toBe(5)
      expect(scroll).toHaveBeenCalled()
      // Los resultados van antes de la rejilla.
      const html = wrapper.html()
      expect(html.indexOf('Imágenes generadas')).toBeLessThan(html.indexOf('aria-label="Peticiones aprobadas"'))
      wrapper.unmount()
    })

    it('con texto ilegible la confirmación avisa y ofrece «Generar de todos modos»', async () => {
      const wrapper = await choose(2, [prayer(1, { text: prayerText({ text: 'Por [ilegible]' }) }), prayer(2)])
      expect(wrapper.text()).toContain('1 petición todavía tiene texto ilegible')
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      expect(useConfirm().options.value!.message).toContain('1 petición todavía tiene texto ilegible')
      expect(useConfirm().options.value!.confirmLabel).toBe('Generar de todos modos')
      useConfirm().cancel()
      wrapper.unmount()
    })

    it('un 409 retira de la selección las peticiones no disponibles y avisa', async () => {
      mockApi('POST', '/api/peticiones/imagenes', (event: H3Event) => {
        setResponseStatus(event, 409)
        return { statusCode: 409, message: 'x', data: { code: 'request_unavailable', ids: [prayer(2).id] } }
      })
      const wrapper = await choose(2)
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      useConfirm().accept()
      await flush(15)
      expect(usePrayerSelection().isSelected(prayer(2).id)).toBe(false)
      expect(usePrayerSelection().count.value).toBe(1)
      expect(useToast().toasts.value.map(t => t.message)).toContain('Quitamos 1 petición que ya no está disponible')
      wrapper.unmount()
    })

    it('con imágenes sin descargar, salir pide confirmación; aceptarla libera todo', async () => {
      const wrapper = await choose(1)
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      useConfirm().accept()
      await flush(15)
      expect(usePrayerImages().needsLeaveGuard.value).toBe(true)
      const router = useRouter()
      const leaving = router.push('/archivos')
      await flush()
      expect(useConfirm().options.value?.title).toBe('¿Salir de Peticiones?')
      useConfirm().cancel()
      await leaving
      expect(usePrayerImages().items.value).toHaveLength(1)
      const leavingAgain = router.push('/archivos')
      await flush()
      useConfirm().accept()
      await leavingAgain
      expect(usePrayerImages().items.value).toEqual([])
      expect(usePrayerSelection().count.value).toBe(0)
      wrapper.unmount()
    })

    it('registra beforeunload, que solo avisa con trabajo pendiente', async () => {
      const wrapper = await choose(1)
      const idle = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(idle)
      expect(idle.defaultPrevented).toBe(false)
      await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
      await flush()
      useConfirm().accept()
      await flush(15)
      const busy = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(busy)
      expect(busy.defaultPrevented).toBe(true)
      wrapper.unmount()
    })
  })

  describe('US3 · corregir la transcripción', () => {
    const endpoint = (n: number) => `/api/files/${prayer(n).id}/text`
    type Page = Awaited<ReturnType<typeof mountSuspended<typeof PeticionesPage>>>
    const card = (wrapper: Page, n: number) =>
      wrapper.findAll('article').find(a => a.attributes('aria-label') === `Petición de Invitado ${n}`)!

    async function correct(wrapper: Page, n: number, text: string) {
      mockApi('PATCH', endpoint(n), prayerText({ text, editedAt: '2026-11-12T10:00:00.000Z', editedBy: 'Ana' }))
      await buttonsWithText(card(wrapper, n), 'Corregir texto')[0]!.trigger('click')
      // `LazyPrayerTextDialog` es un `import()`: con la suite completa su chunk puede tardar más que unos ticks.
      await vi.waitFor(() => expect(document.body.querySelector('dialog textarea, dialog button')).not.toBeNull(), { timeout: 5000 })
      const dialog = wrapper.findAll('dialog').at(-1)!
      await buttonsWithText(dialog, 'Editar')[0]!.trigger('click')
      await flush()
      await dialog.get('textarea').setValue(text)
      await dialog.get('form').trigger('submit')
      await flush()
    }

    it('Corregir texto abre el diálogo de esa petición y no cambia la selección', async () => {
      const wrapper = await mountSuspended(PeticionesPage, { attachTo: document.body })
      await flush()
      await buttonsWithText(card(wrapper, 2), 'Corregir texto')[0]!.trigger('click')
      await vi.waitFor(() => expect(document.body.querySelector('dialog')?.textContent).toContain('Transcripción de Invitado 2'), { timeout: 5000 })
      expect(usePrayerSelection().count.value).toBe(0)
      await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
      await flush()
      expect(wrapper.find('dialog').exists()).toBe(false)
      wrapper.unmount()
    })

    it('al guardar, la tarjeta y la copia elegida toman el texto nuevo con «Editada», sin recargar la lista', async () => {
      const wrapper = await mountSuspended(PeticionesPage, { attachTo: document.body })
      await flush()
      await card(wrapper, 1).get('input[type="checkbox"]').trigger('change')
      useToast().toasts.value = []
      const before = list().length
      await correct(wrapper, 1, 'Oremos por Rosa')
      expect(calls.filter(c => c.method === 'PATCH').map(c => c.url)).toEqual([endpoint(1)])
      expect(card(wrapper, 1).text()).toContain('Oremos por Rosa')
      expect(card(wrapper, 1).text()).toContain('Editada')
      expect(usePrayerSelection().ordered.value[0]!.text.text).toBe('Oremos por Rosa')
      expect(list().length).toBe(before)
      expect(useToast().toasts.value.map(t => t.message)).toEqual(['Texto guardado'])
      wrapper.unmount()
    })

    it('corregir una tarjeta de una página posterior conserva todas las cargadas', async () => {
      const wrapper = await mountSuspended(PeticionesPage, { attachTo: document.body })
      await flush()
      visible.value = true
      await flush(10)
      expect(wrapper.findAll('article')).toHaveLength(14)
      await correct(wrapper, 13, 'Corregida en la página dos')
      expect(wrapper.findAll('article')).toHaveLength(14)
      expect(card(wrapper, 13).text()).toContain('Corregida en la página dos')
      expect(wrapper.text()).toContain('Ya viste todas las peticiones')
      wrapper.unmount()
    })
  })

  describe('US4 · buscar, filtrar y ordenar', () => {
    /** Queries con las que se pidió la primera página (sin cursor), en orden. */
    let firstPages: Record<string, unknown>[] = []

    beforeEach(() => {
      firstPages = []
      mockApi('GET', '/api/peticiones', (event) => {
        const query = getQuery(event)
        if (query.cursor) return page(13, 14, null)
        firstPages.push(query)
        return query.q === 'nadie' ? { items: [], nextCursor: null } : page(1, 12, 'c1')
      })
    })

    const bar = (wrapper: Awaited<ReturnType<typeof mountSuspended<typeof PeticionesPage>>>) => wrapper.get('[aria-label="Selección de peticiones"]')

    it('la barra de filtros va entre los resultados y la rejilla', async () => {
      const wrapper = await mountSuspended(PeticionesPage)
      await flush()
      const html = wrapper.html()
      expect(html.indexOf('role="search"')).toBeGreaterThan(-1)
      expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf('aria-label="Peticiones aprobadas"'))
    })

    it('cambiar búsqueda, fecha u orden pide la primera página con la query nueva y no cambia la selección', async () => {
      const wrapper = await mountSuspended(PeticionesPage)
      await flush()
      for (const box of wrapper.findAll('input[type="checkbox"]').slice(0, 5)) await box.trigger('change')
      expect(bar(wrapper).text()).toContain('5 peticiones → 2 imágenes')
      expect(firstPages.at(-1)).toEqual({ dir: 'desc' })

      await wrapper.get('input[type="search"]').setValue('Ana')
      await vi.waitFor(() => expect(firstPages.at(-1)).toEqual({ q: 'Ana', dir: 'desc' }), { timeout: 2000 })

      await buttonsWithText(wrapper.get('[role="group"][aria-label="Fecha de aprobación"]'), 'Hoy')[0]!.trigger('click')
      await vi.waitFor(() => expect(firstPages.at(-1)).toMatchObject({ q: 'Ana', from: expect.any(String), to: expect.any(String) }))

      await wrapper.get('select').setValue('asc')
      await vi.waitFor(() => expect(firstPages.at(-1)).toMatchObject({ dir: 'asc' }))
      await flush()

      expect(usePrayerSelection().count.value).toBe(5)
      expect(bar(wrapper).text()).toContain('5 peticiones → 2 imágenes')
      expect(wrapper.get('[role="search"] [role="status"]').text()).toBe('Buscando «Ana» · Aprobadas hoy')

      // **Quitar filtros** del resumen vuelve a la query por defecto (orden incluido) sin tocar la selección.
      await buttonsWithText(wrapper.get('[role="search"]'), 'Quitar filtros')[0]!.trigger('click')
      await vi.waitFor(() => expect(firstPages.at(-1)).toEqual({ dir: 'desc' }))
      expect(wrapper.find('[role="search"] [role="status"]').exists()).toBe(false)
      expect(usePrayerSelection().count.value).toBe(5)
    })

    it('sin coincidencias: vacío propio con Quitar filtros, que vuelve a la lista completa', async () => {
      const wrapper = await mountSuspended(PeticionesPage)
      await flush()
      await wrapper.get('input[type="search"]').setValue('nadie')
      await vi.waitFor(() => expect(wrapper.text()).toContain('No hay peticiones con esos filtros'), { timeout: 2000 })
      expect(wrapper.text()).not.toContain('Todavía no hay peticiones aprobadas')
      expect(buttonsWithText(wrapper, 'Ir a Solicitudes')).toHaveLength(0)

      // Hay dos «Quitar filtros» (el resumen y el estado vacío): se usa el del estado vacío.
      const reset = buttonsWithText(wrapper, 'Quitar filtros')
      expect(reset).toHaveLength(2)
      await reset.at(-1)!.trigger('click')
      await vi.waitFor(() => expect(wrapper.findAll('article')).toHaveLength(12))
      expect(firstPages.at(-1)).toEqual({ dir: 'desc' })
      expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('')
    })

    it('sin filtros y sin peticiones sigue el vacío de «aún no hay»', async () => {
      mockApi('GET', '/api/peticiones', { items: [], nextCursor: null })
      const wrapper = await mountSuspended(PeticionesPage)
      await flush()
      expect(wrapper.text()).toContain('Todavía no hay peticiones aprobadas')
      expect(wrapper.text()).not.toContain('No hay peticiones con esos filtros')
    })
  })

  it('al salir de la página se vacía la selección', async () => {
    const wrapper = await mountSuspended(PeticionesPage)
    await flush()
    await wrapper.findAll('input[type="checkbox"]')[0]!.trigger('change')
    expect(usePrayerSelection().count.value).toBe(1)
    wrapper.unmount()
    expect(usePrayerSelection().count.value).toBe(0)
  })
})
