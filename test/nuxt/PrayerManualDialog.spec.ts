// Alta manual de una petición desde /peticiones: el diálogo reutiliza el formulario de `/upload` con el nombre de la sesión
// en solo lectura y solo imágenes, y no se cierra mientras sube.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import type { Me } from '#shared/types/api'
import DropZone from '~/components/upload/DropZone.vue'
import PrayerManualDialog from '~/components/prayers/PrayerManualDialog.vue'
import { calls, failFromServer, flush, mockApi, resetCalls } from './helpers/api'
import { FakeXHR, resetXhr } from './helpers/xhr'

enableAutoUnmount(afterEach)

const photo = () => {
  const f = new File(['x'], 'peticion.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 1000 })
  return f
}

const ticket = (event: Parameters<typeof setResponseStatus>[0]) => {
  setResponseStatus(event, 201)
  return { submissionId: 'sub7', uploads: [{ fileId: 'g1', uploadUrl: 'https://s3.test/g1', headers: { 'content-type': 'image/jpeg' } }] }
}

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  resetXhr()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana Ruiz', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
})

describe('PrayerManualDialog', () => {
  it('se abre como modal con título, el nombre de la sesión en solo lectura y un selector solo de imágenes', async () => {
    const wrapper = await mountSuspended(PrayerManualDialog, { attachTo: document.body })
    const dialog = wrapper.get('dialog')
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    expect(wrapper.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Agregar petición')
    expect(wrapper.get(`#${dialog.attributes('aria-describedby')}`).text()).toContain('Queda aprobada al instante')
    const name = wrapper.get('input[type="text"]')
    expect((name.element as HTMLInputElement).value).toBe('Ana Ruiz')
    expect(name.attributes('readonly')).toBeDefined()
    expect(wrapper.findComponent(DropZone).props()).toMatchObject({ imagesOnly: true, camera: true })
    expect(wrapper.get('button[type="submit"]').text()).toBe('Agregar petición')
  })

  it('sube por los endpoints del alta manual (sin nombre editable) y emite done al terminar', async () => {
    mockApi('POST', '/api/peticiones/manual', ticket)
    mockApi('POST', '/api/peticiones/manual/sub7/complete', { status: 'approved', accepted: 1, rejected: 0 })
    const wrapper = await mountSuspended(PrayerManualDialog, { attachTo: document.body })
    await wrapper.get('textarea').setValue('Entregada en papel')
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(calls.find(c => c.url === '/api/peticiones/manual')?.body).toMatchObject({ note: 'Entregada en papel', files: [{ name: 'peticion.jpg' }] })
    expect(calls.some(c => c.url === '/api/peticiones/manual/sub7/complete')).toBe(true)
    expect(wrapper.emitted('done')).toEqual([[{ accepted: 1, rejected: 0 }]])
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(false)
  })

  it('Cerrar, el fondo y Escape emiten close', async () => {
    const wrapper = await mountSuspended(PrayerManualDialog, { attachTo: document.body })
    await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('.modal-backdrop button').trigger('click')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(3)
  })

  it('mientras sube no se cierra (la petición se crearía sin que la página se entere) y lo anuncia', async () => {
    let release!: () => void
    mockApi('POST', '/api/peticiones/manual', async (event) => {
      await new Promise<void>((resolve) => { release = resolve })
      return ticket(event)
    })
    mockApi('POST', '/api/peticiones/manual/sub7/complete', { status: 'approved', accepted: 1, rejected: 0 })
    const wrapper = await mountSuspended(PrayerManualDialog, { attachTo: document.body })
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush()
    const close = wrapper.get('button[aria-label="Cerrar"]')
    expect(close.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toBe('Espera a que termine la subida para cerrar.')
    await wrapper.get('dialog').trigger('cancel')
    await wrapper.get('.modal-backdrop button').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(true)
    release()
    await flush(20)
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('si el servidor falla, el diálogo sigue abierto con el mensaje y se puede reintentar', async () => {
    mockApi('POST', '/api/peticiones/manual', failFromServer(415, 'Unsupported Media Type', '«hoja.pdf»: solo se aceptan imágenes'))
    const wrapper = await mountSuspended(PrayerManualDialog, { attachTo: document.body })
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.get('[role="alert"]').text()).toBe('«hoja.pdf»: solo se aceptan imágenes')
    expect(wrapper.emitted('done')).toBeUndefined()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(true)
    expect(wrapper.get('button[aria-label="Cerrar"]').attributes('disabled')).toBeUndefined()
  })
})
