import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { FileItem, FolderItem } from '#shared/types/api'
import ActionMenu from '~/components/ui/ActionMenu.vue'
import AppLogo from '~/components/app/AppLogo.vue'
import AppToast from '~/components/app/AppToast.vue'
import Breadcrumbs from '~/components/files/Breadcrumbs.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import FileCard from '~/components/files/FileCard.vue'
import FileGrid from '~/components/files/FileGrid.vue'
import FileList from '~/components/files/FileList.vue'
import FilePreview from '~/components/files/FilePreview.vue'
import FolderCard from '~/components/files/FolderCard.vue'
import SkeletonList from '~/components/ui/SkeletonList.vue'

const file = (changes: Partial<FileItem> = {}): FileItem => ({
  id: 'f1',
  folderId: null,
  name: 'foto.jpg',
  extension: 'jpg',
  mimeType: 'image/jpeg',
  category: 'image',
  sizeBytes: 2048,
  hasThumbnail: true,
  origin: 'team',
  uploadedBy: { id: 'u1', name: 'Ana' },
  guestName: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...changes,
})

const folder: FolderItem = { id: 'd1', name: 'Domingo', parentId: null, createdAt: '', updatedAt: '', itemCount: 1 }

describe('estados de las vistas', () => {
  it('EmptyState muestra ícono, título, descripción y acción', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'Carpeta vacía', description: 'Sube algo' },
      slots: { default: () => 'Subir' },
    })
    expect(wrapper.get('h2').text()).toBe('Carpeta vacía')
    expect(wrapper.text()).toContain('Sube algo')
    expect(wrapper.text()).toContain('Subir')
    const bare = await mountSuspended(EmptyState, { props: { title: 'Nada' } })
    expect(bare.findAll('p')).toHaveLength(0)
  })

  it('ErrorState anuncia el error y emite retry', async () => {
    const wrapper = await mountSuspended(ErrorState, { props: { message: 'Falló la carga' } })
    expect(wrapper.get('[role="alert"]').text()).toContain('Falló la carga')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    const generic = await mountSuspended(ErrorState)
    expect(generic.text()).toContain('Revisa tu conexión')
  })

  it('SkeletonList en lista y cuadrícula marca la región como ocupada', async () => {
    const list = await mountSuspended(SkeletonList, { props: { rows: 3 } })
    expect(list.get('[aria-busy="true"]').text()).toContain('Cargando')
    expect(list.findAll('.skeleton.size-11')).toHaveLength(3)
    const grid = await mountSuspended(SkeletonList, { props: { rows: 2, variant: 'grid' } })
    expect(grid.findAll('.aspect-square')).toHaveLength(2)
  })
})

describe('AppToast', () => {
  it('muestra los avisos y permite cerrarlos', async () => {
    const wrapper = await mountSuspended(AppToast)
    const toast = useToast()
    toast.success('Guardado')
    toast.error('Falló')
    toast.info('Ojo')
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('Guardado')
    expect(wrapper.findAll('.alert')).toHaveLength(3)
    expect(wrapper.find('.alert-error').text()).toContain('Falló')
    await wrapper.findAll('button[aria-label="Cerrar aviso"]')[0]!.trigger('click')
    expect(wrapper.findAll('.alert')).toHaveLength(2)
    toast.toasts.value = []
  })

  it('va pegado bajo la barra superior, centrado sobre el contenido y compacto; no abajo donde tapaba los botones de acción', async () => {
    const wrapper = await mountSuspended(AppToast)
    // La región viva es un envoltorio sin alto, pegajoso dentro de la columna de contenido (`h-16` de AppTopbar + 1rem).
    const region = wrapper.get('[role="status"]')
    expect(region.classes()).toEqual(expect.arrayContaining(['sticky', 'top-20', 'h-0']))
    // La pila se centra respecto a ese envoltorio (no al viewport) y desde `sm` es compacta.
    const stack = region.get('.toast')
    expect(stack.classes()).toEqual(expect.arrayContaining(['toast-top', 'toast-center', 'absolute', 'sm:max-w-md']))
    expect(stack.classes()).not.toEqual(expect.arrayContaining(['toast-bottom']))
    expect(stack.classes()).not.toEqual(expect.arrayContaining(['toast-end']))

    useToast().success('Guardado')
    await nextTick()
    expect(wrapper.get('.alert').classes()).toContain('min-h-12')
    // El botón de cerrar conserva su área táctil y toma el color del texto del aviso, también en el
    // anillo de foco y el fondo de hover/foco (contraste en ambos temas y en todos los tipos).
    const close = wrapper.get('button[aria-label="Cerrar aviso"]')
    expect(close.classes()).toEqual(expect.arrayContaining(['btn', 'btn-square', 'text-current', 'focus-visible:outline-current', 'hover:bg-current/15']))
    useToast().toasts.value = []
  })

  it('se oculta solo a los 4 s y conserva como máximo 4 avisos', async () => {
    vi.useFakeTimers()
    const toast = useToast()
    for (let i = 0; i < 6; i++) toast.show(`Aviso ${i}`)
    expect(toast.toasts.value.map(t => t.message)).toEqual(['Aviso 2', 'Aviso 3', 'Aviso 4', 'Aviso 5'])
    vi.advanceTimersByTime(4000)
    expect(toast.toasts.value).toHaveLength(0)
    vi.useRealTimers()
  })
})

describe('ActionMenu', () => {
  const items = [
    { key: 'rename', label: 'Renombrar', icon: 'lucide:pencil' },
    { key: 'download', label: 'Descargar', icon: 'lucide:download', href: '/api/files/f1/content?download=1' },
    { key: 'trash', label: 'Eliminar', icon: 'lucide:trash-2', danger: true },
  ]

  it('abre con su botón visible, emite la opción y se cierra', async () => {
    const wrapper = await mountSuspended(ActionMenu, { props: { label: 'Acciones de foto.jpg', items }, attachTo: document.body })
    const button = wrapper.get('button[aria-label="Acciones de foto.jpg"]')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    const options = wrapper.findAll('[role="menuitem"]')
    expect(options.map(o => o.text())).toEqual(['Renombrar', 'Descargar', 'Eliminar'])
    expect(options[1]!.attributes('href')).toBe('/api/files/f1/content?download=1')
    expect(options[2]!.classes()).toContain('text-error')

    await options[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['rename']])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)

    // Esc y la descarga también lo cierran.
    await button.trigger('click')
    await wrapper.get('.dropdown').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    await button.trigger('click')
    await wrapper.findAll('[role="menuitem"]')[1]!.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('flotante: el menú va en body con posición fija junto al botón, se desactiva si no hay opciones y se cierra al desplazar o con Esc', async () => {
    const wrapper = await mountSuspended(ActionMenu, { props: { label: 'Opciones de lista', items, floating: true }, attachTo: document.body })
    const button = wrapper.get('button[aria-label="Opciones de lista"]')
    vi.spyOn(wrapper.get('.dropdown').element, 'getBoundingClientRect')
      .mockReturnValue({ top: 10, bottom: 55, left: 200, right: 245, width: 45, height: 45, x: 200, y: 10, toJSON: () => ({}) })

    await button.trigger('click')
    // Fuera de la tarjeta (y de cualquier contenedor con desplazamiento): en `body`, fijo y anclado al botón.
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.parentElement).toBe(document.body)
    expect(menu.className).toContain('fixed')
    expect(menu.style.top).toBe('59px')
    expect(menu.style.right).toBe(`${window.innerWidth - 245}px`)
    expect(button.attributes('aria-controls')).toBe(menu.id)

    // Elegir una opción emite y cierra.
    menu.querySelector<HTMLElement>('[role="menuitem"]')!.click()
    await nextTick()
    expect(wrapper.emitted('select')).toEqual([['rename']])
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    // Desplazar la página lo cierra (no sigue a su tarjeta); Esc dentro del menú también.
    await button.trigger('click')
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    await button.trigger('click')
    document.body.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    await wrapper.setProps({ disabled: true })
    expect(button.attributes('disabled')).toBeDefined()
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('abre hacia arriba cuando abajo no cabe y hacia abajo cuando sí', async () => {
    const wrapper = await mountSuspended(ActionMenu, { props: { label: 'Acciones de foto.jpg', items }, attachTo: document.body })
    const button = wrapper.get('button[aria-label="Acciones de foto.jpg"]')
    const rectAt = (top: number) => vi.spyOn(wrapper.get('.dropdown').element, 'getBoundingClientRect')
      .mockReturnValue({ top, bottom: top + 45, left: 0, right: 45, width: 45, height: 45, x: 0, y: top, toJSON: () => ({}) })

    // Pegado al borde inferior: no caben las 3 opciones debajo.
    rectAt(window.innerHeight - 60)
    await button.trigger('click')
    expect(wrapper.get('.dropdown').classes()).toContain('dropdown-top')
    await button.trigger('click')

    // Arriba de la pantalla: hay espacio debajo.
    rectAt(10)
    await button.trigger('click')
    expect(wrapper.get('.dropdown').classes()).not.toContain('dropdown-top')
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('mide el menú ya dibujado: si las etiquetas de dos líneas lo hacen más alto que la estimación, lo voltea hacia arriba', async () => {
    // Regresión: 7 opciones se estimaban en 336 px, pero dos ocupaban 54 px (346) y el menú se salía 3 px por abajo a 360×740.
    const wrapper = await mountSuspended(ActionMenu, { props: { label: 'Acciones de video', items }, attachTo: document.body })
    const button = wrapper.get('button[aria-label="Acciones de video"]')
    const top = window.innerHeight - 45 - 3 * 44 - 28 - 5 // la estimación (160 px) cabe debajo, por 5 px
    vi.spyOn(wrapper.get('.dropdown').element, 'getBoundingClientRect')
      .mockReturnValue({ top, bottom: top + 45, left: 0, right: 45, width: 45, height: 45, x: 0, y: top, toJSON: () => ({}) })
    const menuHeight = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const real = (height: number) => menuHeight.mockImplementation(function (this: HTMLElement) {
      return { top: 0, bottom: height, left: 0, right: 0, width: 0, height, x: 0, y: 0, toJSON: () => ({}) }
    })

    // Más alto de lo estimado: no cabe debajo y arriba sí.
    real(170)
    await button.trigger('click')
    await nextTick()
    expect(wrapper.get('.dropdown').classes()).toContain('dropdown-top')
    await button.trigger('click')

    // Tampoco cabe arriba: voltearlo solo movería el recorte, se queda debajo.
    real(window.innerHeight)
    await button.trigger('click')
    await nextTick()
    expect(wrapper.get('.dropdown').classes()).not.toContain('dropdown-top')
    await button.trigger('click')

    // Mide lo que estimó: se queda debajo.
    real(160)
    await button.trigger('click')
    await nextTick()
    expect(wrapper.get('.dropdown').classes()).not.toContain('dropdown-top')
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})

describe('tarjetas y listas de archivos', () => {
  it('FileCard: miniatura diferida, datos y menú de acciones', async () => {
    const wrapper = await mountSuspended(FileCard, { props: { file: file({ origin: 'guest', uploadedBy: null, guestName: 'Luis' }) } })
    const img = wrapper.get('img')
    expect(img.attributes()).toMatchObject({ src: '/api/files/f1/thumbnail', alt: 'foto.jpg', loading: 'lazy' })
    expect(wrapper.get('a').attributes('aria-label')).toBe('Abrir foto.jpg')
    expect(wrapper.text()).toContain('2 KB')
    expect(wrapper.text()).toContain('invitado')

    await wrapper.get('button[aria-label="Acciones de foto.jpg"]').trigger('click')
    const rename = wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!
    await rename.trigger('click')
    expect(wrapper.emitted('action')![0]).toEqual(['rename', expect.objectContaining({ id: 'f1' })])
  })

  it('FileCard muestra la fecha en su propio elemento, fuera de la línea recortable del tamaño', async () => {
    // Regresión de la fase 10: «2 KB · hace 3 días» en una sola línea `truncate` dejaba «antea…».
    const createdAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const wrapper = await mountSuspended(FileCard, { props: { file: file({ createdAt }) } })
    const date = timeAgo(createdAt)
    const dateEl = wrapper.findAll('*').find(el => el.text().trim() === date)
    expect(dateEl, `un elemento cuyo texto es solo «${date}»`).toBeDefined()
    expect(dateEl!.classes()).not.toContain('truncate')
    expect(wrapper.findAll('*').some(el => el.text().trim() === '2 KB')).toBe(true)
  })

  it('mientras hidrata, la fecha relativa usa la hora del render del servidor aunque ya haya pasado un minuto', async () => {
    // Intl redondea al minuto más cercano: el servidor renderizó a los 36 min 29 s («hace 36 minutos») y el
    // navegador hidrata dos segundos después, ya en «37». Sin una referencia común, Vue marcaría un desajuste.
    const createdAt = '2026-10-18T12:00:00.000Z'
    const nuxtApp = useNuxtApp()
    useState<number>('rendered-at').value = Date.parse('2026-10-18T12:36:29.000Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T12:36:31.000Z'))
    nuxtApp.isHydrating = true
    try {
      const hydrating = await mountSuspended(FileCard, { props: { file: file({ createdAt }) } })
      expect(hydrating.get('time').text()).toBe('hace 36 minutos')
    }
    finally {
      nuxtApp.isHydrating = false
    }
    // Ya hidratada (navegación en cliente), manda el reloj real.
    const fresh = await mountSuspended(FileCard, { props: { file: file({ createdAt }) } })
    expect(fresh.get('time').text()).toBe('hace 37 minutos')
    clock.mockRestore()
  })

  it('FileCard compacto sin miniatura muestra el ícono y no tiene menú', async () => {
    const wrapper = await mountSuspended(FileCard, { props: { file: file({ hasThumbnail: false, category: 'audio', name: 'a.mp3' }), compact: true } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Acciones"]').exists()).toBe(false)
  })

  it('FolderCard: enlace, conteo, ruta y acciones', async () => {
    const wrapper = await mountSuspended(FolderCard, { props: { folder } })
    expect(wrapper.get('a').attributes('aria-label')).toBe('Abrir carpeta Domingo')
    expect(wrapper.text()).toContain('1 elemento')
    await wrapper.get('button[aria-label="Acciones de la carpeta Domingo"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Eliminar')!.trigger('click')
    expect(wrapper.emitted('action')![0]![0]).toBe('trash')

    const many = await mountSuspended(FolderCard, { props: { folder: { ...folder, itemCount: 3 } } })
    expect(many.text()).toContain('3 elementos')
    const withPath = await mountSuspended(FolderCard, { props: { folder: { ...folder, path: ['Música', 'Coro'] } } })
    expect(withPath.text()).toContain('Música / Coro')
  })

  it('FileGrid separa carpetas y archivos y reenvía las acciones', async () => {
    const wrapper = await mountSuspended(FileGrid, { props: { folders: [folder], items: [file()] } })
    expect(wrapper.get('ul[aria-label="Carpetas"]').findAll('li')).toHaveLength(1)
    expect(wrapper.get('ul[aria-label="Archivos"]').findAll('li')).toHaveLength(1)
    await wrapper.getComponent(FileCard).vm.$emit('action', 'move', file())
    await wrapper.getComponent(FolderCard).vm.$emit('action', 'rename', folder)
    expect(wrapper.emitted('fileAction')![0]![0]).toBe('move')
    expect(wrapper.emitted('folderAction')![0]![0]).toBe('rename')
    const empty = await mountSuspended(FileGrid, { props: { folders: [], items: [] } })
    expect(empty.findAll('ul')).toHaveLength(0)
  })

  it('FileList muestra ruta, autor, fecha y tamaño y emite acciones', async () => {
    const wrapper = await mountSuspended(FileList, {
      props: {
        folders: [{ ...folder, path: ['Música'] }, { ...folder, id: 'd2', name: 'Sin ruta' }],
        items: [file({ path: ['Domingo'] }), file({ id: 'f2', name: 'b.mp3', hasThumbnail: false, category: 'audio', uploadedBy: null, origin: 'guest', guestName: null })],
      },
    })
    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(4)
    expect(rows[0]!.text()).toContain('Música')
    expect(rows[1]!.text()).toContain('Carpeta')
    expect(rows[2]!.text()).toMatch(/Domingo ·\s+Ana · .+ · 2 KB/)
    expect(rows[3]!.text()).toContain('Invitado')

    await rows[2]!.get('button[aria-label="Acciones de foto.jpg"]').trigger('click')
    await rows[2]!.findAll('[role="menuitem"]').find(o => o.text() === 'Mover')!.trigger('click')
    await rows[0]!.get('button[aria-label="Acciones de la carpeta Domingo"]').trigger('click')
    await rows[0]!.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!.trigger('click')
    expect(wrapper.emitted('fileAction')![0]![0]).toBe('move')
    expect(wrapper.emitted('folderAction')![0]![0]).toBe('rename')
  })

  it('Breadcrumbs enlaza los ancestros y marca la carpeta actual', async () => {
    const wrapper = await mountSuspended(Breadcrumbs, {
      props: { items: [{ id: null, name: 'Archivos' }, { id: 'd1', name: 'Domingo' }, { id: 'd2', name: 'Fotos' }] },
    })
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Ruta de la carpeta')
    expect(wrapper.findAll('a').map(a => a.attributes('href'))).toEqual(['/archivos', '/archivos/d1'])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Fotos')
  })

  it('AppLogo compacto oculta el texto visualmente', async () => {
    expect((await mountSuspended(AppLogo, { props: { compact: true } })).get('.sr-only').text()).toBe('Cloudy')
    expect((await mountSuspended(AppLogo)).find('.sr-only').exists()).toBe(false)
  })
})

describe('FilePreview', () => {
  it.each([
    [{ category: 'image' as const }, 'img'],
    [{ category: 'audio' as const, extension: 'mp3', name: 'a.mp3' }, 'audio[controls]'],
    [{ category: 'video' as const, extension: 'mp4', name: 'v.mp4' }, 'video[controls]'],
    [{ category: 'presentation' as const, extension: 'pdf', name: 's.pdf' }, 'iframe[title="Vista previa de s.pdf"]'],
  ])('elige el visor según el tipo (%o)', async (changes, selector) => {
    const wrapper = await mountSuspended(FilePreview, { props: { file: file(changes) } })
    expect(wrapper.find(selector).exists()).toBe(true)
    expect(wrapper.find(selector).attributes('src')).toBe('/api/files/f1/content')
  })

  it('otros formatos y HEIC ofrecen descargar; una imagen que falla también', async () => {
    const pptx = await mountSuspended(FilePreview, { props: { file: file({ category: 'presentation', extension: 'pptx', name: 'd.pptx' }) } })
    expect(pptx.get('a[download]').attributes('href')).toBe('/api/files/f1/content?download=1')
    expect(pptx.text()).toContain('no tiene vista previa')
    const heic = await mountSuspended(FilePreview, { props: { file: file({ extension: 'heic' }) } })
    expect(heic.find('img').exists()).toBe(false)

    const broken = await mountSuspended(FilePreview, { props: { file: file() } })
    await broken.get('img').trigger('error')
    expect(broken.find('img').exists()).toBe(false)
    expect(broken.find('a[download]').exists()).toBe(true)
  })
})
