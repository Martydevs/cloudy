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
