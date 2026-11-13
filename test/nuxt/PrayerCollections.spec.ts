// Colecciones de imágenes de Peticiones (feature 007, enmienda de historial): la fila con sus cuatro estados, la tarjeta
// (abrir por teclado y menú según permisos) y el diálogo en sus tres modos (crear vacía, guardar una imagen nueva o en una
// existente, ver con ampliar/descargar/quitar y renombrar/eliminar solo para la autora o un admin).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import type { Me } from '#shared/types/api'
import PrayerCollectionCard from '~/components/prayers/PrayerCollectionCard.vue'
import PrayerCollectionDialog from '~/components/prayers/PrayerCollectionDialog.vue'
import PrayerCollectionRow from '~/components/prayers/PrayerCollectionRow.vue'
import { buttonsWithText, calls, failFromServer, flush, mockApi, resetCalls } from './helpers/api'
import { collectionItem, generated, imageCollection } from './prayer-fixtures'

const C1 = imageCollection(1)
const IMAGE = generated(1)
const toasts = () => useToast().toasts.value.map(t => t.message)
const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))

function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/peticiones/colecciones', { items: [C1] })
  mockApi('GET', `/api/peticiones/colecciones/${C1.id}`, { ...C1, items: [collectionItem(1), collectionItem(2, { addedBy: { userId: 'u3', name: 'Eva', active: false } })] })
  mockApi('POST', '/api/peticiones/colecciones', imageCollection(2, { name: 'Ensayo', itemCount: 0 }))
})

describe('PrayerCollectionCard', () => {
  it('nombre, conteo y autor; toda la tarjeta abre por teclado y el autor la describe', async () => {
    const wrapper = await mountSuspended(PrayerCollectionCard, { props: { collection: C1 } })
    expect(wrapper.text()).toContain('Colección 1')
    expect(wrapper.text()).toContain('2 imágenes')
    const open = wrapper.get('button[aria-label="Abrir la colección Colección 1, 2 imágenes"]')
    expect(wrapper.get(`[id="${open.attributes('aria-describedby')}"]`).text()).toBe('Creada por Ana')
    await open.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('un autor inactivo se muestra como tal y 1 imagen va en singular', async () => {
    const wrapper = await mountSuspended(PrayerCollectionCard, { props: { collection: imageCollection(1, { itemCount: 1, author: { userId: 'u2', name: 'Luis', active: false } }) } })
    expect(wrapper.text()).toContain('1 imagen')
    expect(wrapper.text()).toContain('Usuario que ya no está activo')
  })

  it('el menú siempre está a la vista; renombrar y eliminar solo si puede gestionarla', async () => {
    const reader = await mountSuspended(PrayerCollectionCard, { props: { collection: C1 }, attachTo: document.body })
    const trigger = reader.get('button[aria-label="Opciones de Colección 1"]')
    expect(trigger.element.closest('[class*="opacity-0"]')).toBeNull()
    await trigger.trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Ver imágenes'])
    await menuItems()[0]!.trigger('click')
    expect(reader.emitted('open')).toHaveLength(1)
    reader.unmount()

    const owner = await mountSuspended(PrayerCollectionCard, { props: { collection: C1, canManage: true }, attachTo: document.body })
    await owner.get('button[aria-label="Opciones de Colección 1"]').trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Ver imágenes', 'Renombrar', 'Eliminar colección'])
    await menuItems()[1]!.trigger('click')
    expect(owner.emitted('rename')).toHaveLength(1)
    await owner.get('button[aria-label="Opciones de Colección 1"]').trigger('click')
    await flush()
    await menuItems()[2]!.trigger('click')
    expect(owner.emitted('remove')).toHaveLength(1)
    owner.unmount()
  })
})

describe('PrayerCollectionRow', () => {
  const props = { collections: null, pending: false, error: null }

  it('cargando: esqueletos con aria-busy dentro de un alto mínimo fijo', async () => {
    const wrapper = await mountSuspended(PrayerCollectionRow, { props: { ...props, pending: true } })
    expect(wrapper.get('[aria-busy="true"]').findAll('.skeleton')).toHaveLength(4)
    expect(wrapper.get('[aria-busy="true"]').element.parentElement!.className).toContain('min-h-56')
  })

  it('error: ErrorState con Reintentar', async () => {
    const wrapper = await mountSuspended(PrayerCollectionRow, { props: { ...props, error: new Error('x') } })
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar las colecciones')
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('vacío: EmptyState con Nueva colección; sin el botón de la cabecera', async () => {
    const wrapper = await mountSuspended(PrayerCollectionRow, { props: { ...props, collections: [] } })
    expect(wrapper.text()).toContain('Aún no hay colecciones')
    const buttons = buttonsWithText(wrapper, 'Nueva colección')
    expect(buttons).toHaveLength(1)
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('contenido: una lista desplazable de tarjetas, Nueva colección en la cabecera y permisos por tarjeta', async () => {
    const canManage = vi.fn((c: { id: string }) => c.id === C1.id)
    const wrapper = await mountSuspended(PrayerCollectionRow, { props: { ...props, collections: [C1, imageCollection(2)], canManage } })
    expect(wrapper.get('ul[aria-label="Colecciones de imágenes del equipo"]').classes()).toContain('overflow-x-auto')
    expect(wrapper.findAll('article')).toHaveLength(2)
    expect(canManage).toHaveBeenCalledTimes(2)
    await buttonsWithText(wrapper, 'Nueva colección')[0]!.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
    await wrapper.get('button[aria-label^="Abrir la colección Colección 2"]').trigger('click')
    expect(wrapper.emitted('open')![0]).toEqual([imageCollection(2)])
  })
})

describe('PrayerCollectionDialog', () => {
  it('crear vacía: valida el nombre y crea la colección', async () => {
    const wrapper = await mountSuspended(PrayerCollectionDialog, { attachTo: document.body })
    expect(wrapper.get('h2').text()).toBe('Nueva colección')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    await wrapper.get('input').setValue('  Ensayo  ')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/peticiones/colecciones')?.body).toEqual({ name: 'Ensayo' })
    expect(toasts()).toContain('Colección «Ensayo» creada')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('crear con un fallo del servidor avisa y no cierra', async () => {
    mockApi('POST', '/api/peticiones/colecciones', failFromServer(404, 'No encontrado', 'Esa imagen ya no está guardada.'))
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { imageId: IMAGE.id }, attachTo: document.body })
    await wrapper.get('input').setValue('Domingo')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(toasts()).toContain('Esa imagen ya no está guardada.')
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('guardar una imagen: crear con ella', async () => {
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { imageId: IMAGE.id }, attachTo: document.body })
    expect(wrapper.get('h2').text()).toBe('Guardar en una colección')
    await wrapper.get('input').setValue('Domingo')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/peticiones/colecciones')?.body).toEqual({ name: 'Domingo', imageId: IMAGE.id })
    wrapper.unmount()
  })

  it('guardar una imagen en una existente, y «ya estaba» sin duplicar', async () => {
    mockApi('POST', `/api/peticiones/colecciones/${C1.id}/items`, { added: true })
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { imageId: IMAGE.id }, attachTo: document.body })
    await buttonsWithText(wrapper, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    const option = wrapper.findAll('[aria-label="Colecciones de imágenes del equipo"] button')[0]!
    expect(option.text()).toContain('Colección 1')
    expect(option.text()).toContain('2 imágenes')
    await option.trigger('click')
    await flush(10)
    expect(calls.find(c => c.url === `/api/peticiones/colecciones/${C1.id}/items`)?.body).toEqual({ imageId: IMAGE.id })
    expect(toasts()).toContain('Imagen guardada en «Colección 1»')
    wrapper.unmount()

    mockApi('POST', `/api/peticiones/colecciones/${C1.id}/items`, { added: false })
    const again = await mountSuspended(PrayerCollectionDialog, { props: { imageId: IMAGE.id }, attachTo: document.body })
    await buttonsWithText(again, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    await again.findAll('[aria-label="Colecciones de imágenes del equipo"] button')[0]!.trigger('click')
    await flush(10)
    expect(toasts()).toContain('Ya estaba en «Colección 1»')
    again.unmount()
  })

  it('existente sin colecciones: EmptyState que remite a la otra pestaña', async () => {
    mockApi('GET', '/api/peticiones/colecciones', { items: [] })
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { imageId: IMAGE.id }, attachTo: document.body })
    await buttonsWithText(wrapper, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).toContain('Crea la primera en la pestaña «Nueva colección».')
    wrapper.unmount()
  })

  it('ver: sus imágenes con quién las agregó, descargar como enlace, ampliar y quitar con confirmación', async () => {
    mockApi('DELETE', `/api/peticiones/colecciones/${C1.id}/items/${IMAGE.id}`, null)
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    expect(wrapper.get('h2').text()).toBe('Colección 1')
    const rows = wrapper.findAll('[aria-label="Imágenes de Colección 1"] li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('2 peticiones · Agregada por Luis')
    expect(rows[1]!.text()).toContain('Agregada por Usuario que ya no está activo')
    expect(rows[0]!.get('a[download]').attributes('href')).toBe(IMAGE.downloadUrl)
    expect(rows[0]!.get('img').attributes('src')).toBe(IMAGE.previewUrl)

    await rows[0]!.get('button[aria-label^="Ver en grande"]').trigger('click')
    await vi.waitFor(() => expect(document.body.querySelectorAll('dialog').length).toBe(2), { timeout: 5000 })

    await rows[0]!.get('button[aria-label^="Quitar de la colección"]').trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Quitar esta imagen de la colección?')
    useConfirm().accept()
    await flush(10)
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/peticiones/colecciones/${C1.id}/items/${IMAGE.id}`)).toBe(true)
    expect(toasts()).toContain('Se quitó la imagen de la colección')
    wrapper.unmount()
  })

  it('ver una colección vacía o que ya no existe', async () => {
    mockApi('GET', `/api/peticiones/colecciones/${C1.id}`, { ...C1, itemCount: 0, items: [] })
    const empty = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    expect(empty.text()).toContain('Esta colección no tiene imágenes todavía.')
    empty.unmount()

    clearNuxtData()
    mockApi('GET', `/api/peticiones/colecciones/${C1.id}`, failFromServer(404, 'No encontrado', 'Esa colección ya no existe.'))
    const gone = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    expect(gone.get('[role="alert"]').text()).toContain('No pudimos cargar la colección')
    gone.unmount()
  })

  it('renombrar y eliminar solo para la autora o un admin; eliminar avisa que las imágenes siguen', async () => {
    setMe('editor', 'u2')
    const other = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    expect(buttonsWithText(other, 'Renombrar')).toHaveLength(0)
    expect(buttonsWithText(other, 'Eliminar colección')).toHaveLength(0)
    other.unmount()

    setMe('admin', 'u9')
    mockApi('PATCH', `/api/peticiones/colecciones/${C1.id}`, imageCollection(1, { name: 'Ensayo' }))
    const admin = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    await buttonsWithText(admin, 'Renombrar')[0]!.trigger('click')
    await flush()
    await admin.get('form').trigger('submit')
    await flush(10)
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: 'Colección 1' })
    expect(toasts()).toContain('Ahora se llama «Ensayo»')

    mockApi('DELETE', `/api/peticiones/colecciones/${C1.id}`, null)
    await buttonsWithText(admin, 'Eliminar colección')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar la colección «Colección 1»?')
    expect(useConfirm().options.value?.message).toContain('siguen en el historial')
    useConfirm().accept()
    await flush(10)
    expect(toasts()).toContain('Se eliminó la colección «Colección 1»')
    expect(admin.emitted('close')).toHaveLength(1)
    admin.unmount()
  })

  it('un renombrado que falla o un nombre vacío no cierra el formulario', async () => {
    mockApi('PATCH', `/api/peticiones/colecciones/${C1.id}`, failFromServer(403, 'Forbidden', 'Solo quien la creó o un administrador puede cambiar esta colección.'))
    const wrapper = await mountSuspended(PrayerCollectionDialog, { props: { collectionId: C1.id }, attachTo: document.body })
    await flush(10)
    await buttonsWithText(wrapper, 'Renombrar')[0]!.trigger('click')
    await flush()
    await wrapper.get('form input').setValue('   ')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    await wrapper.get('form input').setValue('Otra')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(toasts()).toContain('Solo quien la creó o un administrador puede cambiar esta colección.')
    expect(wrapper.find('form').exists()).toBe(true)
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.find('form').exists()).toBe(false)
    wrapper.unmount()
  })
})
