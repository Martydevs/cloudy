// T064 — Corregir la transcripción de una petición (feature 007, contracts/ui.md: `PrayerTextDialog`): foto grande y el
// `ImageTextPanel` editable de la feature 002 sobre `PATCH /api/files/:id/text`; reenvía `change`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { ImageText } from '#shared/types/api'
import PrayerTextDialog from '~/components/prayers/PrayerTextDialog.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { prayer, prayerText } from './prayer-fixtures'

const request = prayer(1, { senderName: 'Ana', text: prayerText({ text: 'Oremos por [ilegible]' }) })
const ENDPOINT = `/api/files/${request.id}/text`

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(PrayerTextDialog, { props: { request, ...props }, attachTo: document.body })

async function edit(wrapper: Awaited<ReturnType<typeof mount>>, text: string) {
  await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
  await flush()
  await wrapper.get('textarea').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flush()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
})

describe('PrayerTextDialog', () => {
  it('es un dialog.modal con el nombre, la foto grande y el texto inicial, sin pedir nada al abrir', async () => {
    const wrapper = await mount()
    const dialog = wrapper.get('dialog')
    expect(dialog.classes()).toContain('modal')
    const titleId = dialog.attributes('aria-labelledby')!
    expect(wrapper.get(`#${titleId}`).text()).toBe('Transcripción de Ana')
    const img = dialog.get('img')
    expect(img.attributes('src')).toBe(request.previewUrl)
    expect(img.attributes('alt')).toBe('Foto enviada por Ana')
    expect(dialog.text()).toContain('Oremos por [ilegible]')
    await flush()
    expect(calls).toHaveLength(0)
  })

  it('guardar hace PATCH al texto de ese archivo y reenvía change con el ImageText nuevo', async () => {
    const saved = prayerText({ text: 'Oremos por Rosa', editedAt: '2026-11-12T10:00:00.000Z', editedBy: 'Ana' })
    mockApi('PATCH', ENDPOINT, saved)
    const wrapper = await mount()
    await edit(wrapper, 'Oremos por Rosa')
    expect(calls.filter(c => c.method === 'PATCH').map(c => [c.url, c.body])).toEqual([[ENDPOINT, { text: 'Oremos por Rosa' }]])
    expect(wrapper.emitted('change')).toEqual([[saved]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('si el guardado falla, el diálogo sigue abierto con lo escrito y no emite change', async () => {
    mockApi('PATCH', ENDPOINT, failWith(500))
    const wrapper = await mount()
    await edit(wrapper, 'Texto que no se pierde')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Texto que no se pierde')
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('Guardar y Cancelar son botones alcanzables con teclado', async () => {
    const wrapper = await mount()
    await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
    await flush()
    for (const label of ['Guardar', 'Cancelar']) {
      const [button] = buttonsWithText(wrapper, label)
      expect(button, label).toBeDefined()
      expect(button!.attributes('tabindex'), label).not.toBe('-1')
    }
  })

  it('cierra con Escape y con Cerrar', async () => {
    const wrapper = await mount()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('sin texto ofrece escribirlo a mano', async () => {
    const written: ImageText = prayerText({ text: 'Escrito a mano', editedAt: '2026-11-12T10:00:00.000Z', editedBy: 'Ana' })
    mockApi('PATCH', ENDPOINT, written)
    const wrapper = await mount({ request: { ...request, text: prayerText({ status: 'empty', text: null }) } })
    await buttonsWithText(wrapper, 'Escribir el texto')[0]!.trigger('click')
    await flush()
    await wrapper.get('textarea').setValue('Escrito a mano')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('change')).toEqual([[written]])
  })
})
