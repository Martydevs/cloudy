import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { FileItem, FolderItem } from '#shared/types/api'
import { folderName } from '#shared/validation/files'
import DropZone from '~/components/upload/DropZone.vue'
import FolderPicker from '~/components/files/FolderPicker.vue'
import ItemDialogs from '~/components/files/ItemDialogs.vue'
import NameDialog from '~/components/files/NameDialog.vue'
import UploadDialog from '~/components/upload/UploadDialog.vue'
import { failWith, flush, mockApi } from './helpers/api'

const tree = [
  { id: 'd1', name: 'Domingo', parentId: null },
  { id: 'd2', name: 'Fotos', parentId: 'd1' },
  { id: 'd3', name: 'Ensayos', parentId: null },
]

function radios(wrapper: VueWrapper) {
  return wrapper.findAll('[role="radio"]')
}

beforeEach(() => {
  mockApi('GET', '/api/folders/tree', tree)
})

describe('NameDialog', () => {
  it('valida en línea, deshabilita el envío con errores y emite el nombre limpio', async () => {
    const wrapper = await mountSuspended(NameDialog, {
      props: { title: 'Nueva carpeta', label: 'Nombre de la carpeta', field: folderName(), confirmLabel: 'Crear carpeta' },
      attachTo: document.body,
    })
    const input = wrapper.get('input')
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Nombre de la carpeta')

    await input.setValue('a/b')
    await input.trigger('blur')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('No uses los caracteres')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    await input.setValue('  Domingo ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([['Domingo']])
    wrapper.unmount()
  })

  it('al enviar vacío marca el error; muestra sufijo y error del servidor; Cancelar emite close', async () => {
    const wrapper = await mountSuspended(NameDialog, {
      props: { title: 'Renombrar', label: 'Nombre nuevo', field: folderName(), suffix: '.jpg', serverError: 'Ya existe' },
    })
    await wrapper.get('input').setValue('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    expect(wrapper.text()).toContain('.jpg')
    expect(wrapper.get('[role="alert"]').text()).toContain('Ya existe')
    await wrapper.findAll('button').find(b => b.text() === 'Cancelar')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})

describe('FolderPicker', () => {
  it('muestra el árbol sin la carpeta excluida ni sus descendientes y emite la elegida', async () => {
    const wrapper = await mountSuspended(FolderPicker, { props: { excludeId: 'd1', currentId: null } })
    await flush()
    expect(radios(wrapper).map(r => r.text())).toEqual(['Archivos (raíz)', 'Ensayos'])
    expect(radios(wrapper)[0]!.attributes('aria-checked')).toBe('true')
    await radios(wrapper)[1]!.trigger('click')
    expect(radios(wrapper)[1]!.attributes('aria-checked')).toBe('true')
    await wrapper.findAll('button').find(b => b.text() === 'Mover aquí')!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['d3']])
  })

  it('indenta subcarpetas, permite volver a la raíz y Cancelar cierra', async () => {
    const wrapper = await mountSuspended(FolderPicker, { props: { currentId: 'd2', title: 'Aprobar en…', confirmLabel: 'Aprobar' } })
    await flush()
    expect(radios(wrapper).map(r => r.text())).toEqual(['Archivos (raíz)', 'Domingo', 'Fotos', 'Ensayos'])
    expect(radios(wrapper)[2]!.attributes('style')).toContain('padding-inline-start: 2.25rem')
    await radios(wrapper)[0]!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Aprobar')!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[null]])
    await wrapper.findAll('button').find(b => b.text() === 'Cancelar')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('si falla la carga muestra el error con reintento', async () => {
    mockApi('GET', '/api/folders/tree', failWith(500))
    clearNuxtData()
    const wrapper = await mountSuspended(FolderPicker)
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar las carpetas.')
    mockApi('GET', '/api/folders/tree', tree)
    await wrapper.findAll('button').find(b => b.text().includes('Reintentar'))!.trigger('click')
    await flush()
    expect(radios(wrapper)).toHaveLength(4)
  })
})

describe('ItemDialogs', () => {
  const file: FileItem = {
    id: 'f1', folderId: 'd1', name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 1,
    hasThumbnail: false, origin: 'team', uploadedBy: null, guestName: null, createdAt: '', updatedAt: '',
  }
  const folder: FolderItem = { id: 'd2', name: 'Fotos', parentId: 'd1', createdAt: '', updatedAt: '' }

  it('elige el diálogo según la acción en curso', async () => {
    const actions = useItemActions(vi.fn())
    const wrapper = await mountSuspended(ItemDialogs, { props: { actions } })
    expect(wrapper.find('dialog').exists()).toBe(false)

    actions.open({ type: 'create', parentId: null })
    await nextTick()
    expect(wrapper.get('h2').text()).toBe('Nueva carpeta')

    actions.open({ type: 'rename', kind: 'file', item: file })
    await nextTick()
    expect(wrapper.get('h2').text()).toBe('Renombrar archivo')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('foto')
    expect(wrapper.text()).toContain('.jpg')

    actions.open({ type: 'rename', kind: 'folder', item: folder })
    await nextTick()
    expect(wrapper.get('h2').text()).toBe('Renombrar carpeta')

    actions.open({ type: 'move', kind: 'folder', item: folder })
    await flush()
    expect(wrapper.get('h2').text()).toBe('Mover «Fotos» a…')
    // La carpeta que se mueve no puede ser su propio destino.
    expect(wrapper.findAll('[role="radio"]').map(r => r.text())).not.toContain('Fotos')

    actions.open({ type: 'move', kind: 'file', item: file })
    await flush()
    expect(wrapper.findAll('[role="radio"]').find(r => r.attributes('aria-checked') === 'true')!.text()).toBe('Domingo')
  })
})

describe('DropZone', () => {
  it('es un botón accesible con los formatos descritos y emite los archivos elegidos', async () => {
    const wrapper = await mountSuspended(DropZone)
    // Un botón real cuyo nombre es solo su texto visible (Lighthouse: label-content-name-mismatch).
    const button = wrapper.get('button[type="button"]')
    expect(button.text()).toContain('elige archivos')
    expect(button.text()).not.toContain('Máximo 100 MB')
    expect(wrapper.get(`#${button.attributes('aria-describedby')}`).text()).toContain('Máximo 100 MB')

    const input = wrapper.get('input[type="file"]')
    expect(input.attributes('accept')).toContain('.mp3')
    const click = vi.spyOn(input.element as HTMLInputElement, 'click')
    await button.trigger('click')
    // Toda la zona (no solo el botón) abre el selector al hacer clic.
    await wrapper.get('p').trigger('click')
    expect(click).toHaveBeenCalledTimes(2)

    const chosen = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [chosen], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('files')).toEqual([[[chosen]]])
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('files')).toHaveLength(1)
  })
})

describe('UploadDialog', () => {
  it('indica el destino y cierra al instante si no hay subidas en curso', async () => {
    const wrapper = await mountSuspended(UploadDialog, { props: { folderId: 'd1' } })
    expect(wrapper.text()).toContain('Se guardarán en la carpeta actual.')
    await wrapper.findAll('button').find(b => b.text() === 'Listo')!.trigger('click')
    await flush()
    expect(wrapper.emitted('close')).toHaveLength(1)

    const root = await mountSuspended(UploadDialog, { props: { folderId: null } })
    expect(root.text()).toContain('Archivos (raíz)')
  })

  it('con subidas en curso pide confirmación antes de cancelarlas', async () => {
    mockApi('POST', '/api/uploads', () => new Promise(() => {}))
    const wrapper = await mountSuspended(UploadDialog, { props: { folderId: null } })
    await wrapper.getComponent(DropZone).vm.$emit('files', [new File(['x'], 'a.jpg', { type: 'image/jpeg' })])
    await flush()
    expect(wrapper.text()).toContain('a.jpg')
    expect(wrapper.findAll('button').some(b => b.text() === 'Cancelar')).toBe(true)

    const confirm = useConfirm()
    await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
    await flush()
    expect(confirm.options.value?.title).toBe('¿Cancelar las subidas en curso?')
    confirm.cancel()
    await flush()
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
    await flush()
    confirm.accept()
    await flush()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('a.jpg')
  })
})
