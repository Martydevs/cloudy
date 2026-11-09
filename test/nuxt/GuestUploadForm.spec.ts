// Formulario de envío de invitados en un solo paso (`/upload`): nombre, nota y archivos, directo a la cola del equipo.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import DropZone from '~/components/upload/DropZone.vue'
import GuestUploadForm from '~/components/guests/GuestUploadForm.vue'
import { calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { FakeXHR, resetXhr } from './helpers/xhr'

const photo = () => {
  const f = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 1000 })
  return f
}

function mockTicket(url: string) {
  mockApi('POST', url, (event) => {
    setResponseStatus(event, 201)
    return { submissionId: 'sub1', uploads: [{ fileId: 'g1', uploadUrl: 'https://s3.test/g1', headers: { 'content-type': 'image/jpeg' } }] }
  })
  mockApi('POST', '/api/public/submissions/sub1/complete', { status: 'pending', accepted: 1, rejected: 0 })
}

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  resetXhr()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})

describe('GuestUploadForm', () => {
  it('un solo paso: nombre, nota y archivos van juntos en el cuerpo y emite done', async () => {
    mockTicket('/api/public/submissions')
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions' } })
    await wrapper.get('input[type="text"]').setValue(' Eva ')
    await wrapper.get('textarea').setValue(' Fotos del culto ')
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    const post = calls.find(c => c.url === '/api/public/submissions')
    expect(post?.body).toEqual({ senderName: 'Eva', note: 'Fotos del culto', files: [{ name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg', withTextSource: false }] })
    expect(wrapper.emitted('done')).toEqual([[{ accepted: 1, rejected: 0 }]])
    // La confirmación ofrece otro envío con el mismo nombre (no hay que pedir acceso).
    expect(wrapper.text()).toContain('¡Gracias! Recibimos tu envío')
    await wrapper.get('button').trigger('click')
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe(' Eva ')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('el nombre es editable y obligatorio', async () => {
    mockTicket('/api/public/submissions')
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions' } })
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe('Este campo es obligatorio')
    expect(calls.some(c => c.url === '/api/public/submissions')).toBe(false)

    await wrapper.get('input[type="text"]').setValue(' Eva ')
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(calls.find(c => c.url === '/api/public/submissions')?.body).toMatchObject({ senderName: 'Eva' })
  })

  it('una nota demasiado larga se avisa sin enviar', async () => {
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions' } })
    await wrapper.get('input[type="text"]').setValue('Eva')
    // `maxlength` lo impide al escribir; el valor pegado por código igual se valida.
    ;(wrapper.get('textarea').element as HTMLTextAreaElement).value = 'a'.repeat(501)
    await wrapper.get('textarea').trigger('input')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('500')
    expect(calls.some(c => c.url === '/api/public/submissions')).toBe(false)
  })

  it('un fallo del servidor se muestra con su mensaje y no emite done', async () => {
    mockApi('POST', '/api/public/submissions', failFromServer(422, 'Unprocessable Entity', 'Revisa los archivos'))
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions' } })
    await wrapper.get('input[type="text"]').setValue('Eva')
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.get('[role="alert"]').text()).toBe('Revisa los archivos')
    expect(wrapper.emitted('done')).toBeUndefined()

    mockApi('POST', '/api/public/submissions', failWith(500))
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos enviar los archivos')
  })

  it('disabled bloquea el formulario y oculta el selector', async () => {
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions', disabled: true } })
    expect(wrapper.findComponent(DropZone).exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
})
