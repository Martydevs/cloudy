// Feature 002 · US3 — modo edición del texto de una imagen: el formulario solo, y el panel que lo alterna,
// guarda con PATCH, devuelve el foco a "Editar" y pide confirmación antes de reemplazar una corrección.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { ImageText } from '#shared/types/api'
import ImageTextEditor from '~/components/files/ImageTextEditor.vue'
import ImageTextPanel from '~/components/files/ImageTextPanel.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const ENDPOINT = '/api/files/9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b/text'
const text = (changes: Partial<ImageText> = {}): ImageText => ({
  status: 'ready', text: 'Oremos por Ana', error: null, readAt: null, editedAt: null, editedBy: null, ...changes,
})
const toasts = () => useToast().toasts.value.map(t => t.message)
const requests = (method: string) => calls.filter(c => c.method === method && c.url === ENDPOINT)

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
})

describe('ImageTextEditor', () => {
  it('textarea etiquetado con el texto, contador y foco al abrir', async () => {
    const wrapper = await mountSuspended(ImageTextEditor, { props: { modelValue: 'Hola' }, attachTo: document.body })
    const textarea = wrapper.get('textarea')
    expect(wrapper.get(`label[for="${textarea.attributes('id')}"]`).text()).toBe('Texto de la imagen')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('Hola')
    expect(wrapper.text()).toContain('4 / 10 000')
    expect(document.activeElement).toBe(textarea.element)
  })

  it('Guardar emite el texto recortado; vacío o de más de 10 000 caracteres no se puede guardar', async () => {
    const wrapper = await mountSuspended(ImageTextEditor, { props: { modelValue: 'Hola' } })
    await wrapper.get('textarea').setValue('  Oremos  ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toEqual([['Oremos']])

    await wrapper.get('textarea').setValue('   ')
    expect(buttonsWithText(wrapper, 'Guardar')[0]!.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('a'.repeat(10_001))
    expect(wrapper.text()).toContain('10 001 / 10 000')
    expect(wrapper.get('textarea').classes()).toContain('textarea-error')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('Cancelar y Escape emiten cancel', async () => {
    const wrapper = await mountSuspended(ImageTextEditor, { props: { modelValue: 'Hola' } })
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    await wrapper.get('form').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })
})

describe('ImageTextPanel · corrección manual', () => {
  const mount = (initial: ImageText) =>
    mountSuspended(ImageTextPanel, { props: { endpoint: ENDPOINT, initial, editable: true, autoRead: true }, attachTo: document.body })

  it('Editar → Guardar hace PATCH, avisa, muestra la insignia y devuelve el foco a Editar', async () => {
    mockApi('PATCH', ENDPOINT, text({ text: 'Oremos por Rosa', editedAt: '2026-10-21T11:00:00.000Z', editedBy: 'Ana' }))
    const wrapper = await mount(text())
    await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
    await flush()
    await wrapper.get('textarea').setValue('Oremos por Rosa')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(requests('PATCH').map(c => c.body)).toEqual([{ text: 'Oremos por Rosa' }])
    expect(toasts()).toContain(messages.imageText.saved)
    expect(wrapper.text()).toContain('Editado por Ana')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(document.activeElement?.textContent?.trim()).toBe('Editar')
  })

  it('Cancelar no guarda y devuelve el foco a Editar; un error al guardar deja el editor abierto', async () => {
    const wrapper = await mount(text())
    await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
    await flush()
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    await flush()
    expect(requests('PATCH')).toHaveLength(0)
    expect(document.activeElement?.textContent?.trim()).toBe('Editar')

    mockApi('PATCH', ENDPOINT, failWith(409))
    await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
    await flush()
    await wrapper.get('form').trigger('submit')
    await flush()
    // El endpoint simulado no transmite `message` (el servidor real sí): queda el texto de respaldo.
    expect(toasts()).toContain(messages.imageText.saveFailed)
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('sin texto reconocido se puede escribir a mano', async () => {
    mockApi('PATCH', ENDPOINT, text({ text: 'Escrito', editedAt: '2026-10-21T11:00:00.000Z', editedBy: null }))
    const wrapper = await mount(text({ status: 'empty', text: null }))
    await buttonsWithText(wrapper, 'Escribir el texto')[0]!.trigger('click')
    await flush()
    await wrapper.get('textarea').setValue('Escrito')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Escrito')
    expect(wrapper.text()).toContain('Editado')
  })

  it('Volver a leer con una corrección pide confirmación y solo lee al confirmar', async () => {
    mockApi('POST', ENDPOINT, text({ text: 'Leído otra vez' }))
    const wrapper = await mount(text({ editedAt: '2026-10-21T11:00:00.000Z', editedBy: 'Ana' }))
    const reread = async () => {
      await wrapper.get('button[aria-label="Más acciones del texto"]').trigger('click')
      await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
      await flush()
    }
    await reread()
    expect(useConfirm().options.value?.title).toBe(messages.imageText.confirmReread)
    useConfirm().cancel()
    await flush()
    expect(requests('POST')).toHaveLength(0)

    await reread()
    useConfirm().accept()
    await flush()
    expect(requests('POST').map(c => c.body)).toEqual([{ force: true }])
    expect(wrapper.text()).toContain('Leído otra vez')
  })

  it('sin corrección, Volver a leer no pide confirmación', async () => {
    mockApi('POST', ENDPOINT, text())
    const wrapper = await mount(text())
    await wrapper.get('button[aria-label="Más acciones del texto"]').trigger('click')
    await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value).toBeNull()
    expect(requests('POST')).toHaveLength(1)
  })
})
