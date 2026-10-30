// Feature 003 (US1) — formulario de envío de invitados extraído de /enviar: nombre editable u obtenido de la solicitud.
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
  it('con senderName muestra el nombre de solo lectura y no lo envía en el cuerpo', async () => {
    mockTicket('/api/public/access/submissions')
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/access/submissions', senderName: 'Eva' } })
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Tu nombre')
    expect(wrapper.text()).toContain('Eva')

    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    const post = calls.find(c => c.url === '/api/public/access/submissions')
    expect(post?.body).toEqual({ files: [{ name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg', withTextSource: false }] })
    expect(wrapper.emitted('submitting')).toEqual([[true], [false]])
    expect(wrapper.emitted('done')).toEqual([[{ accepted: 1, rejected: 0 }]])
  })

  it('sin senderName el nombre es editable y obligatorio, como en /enviar', async () => {
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
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/access/submissions', senderName: 'Eva' } })
    // `maxlength` lo impide al escribir; el valor pegado por código igual se valida.
    ;(wrapper.get('textarea').element as HTMLTextAreaElement).value = 'a'.repeat(501)
    await wrapper.get('textarea').trigger('input')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('500')
    expect(calls.some(c => c.url === '/api/public/access/submissions')).toBe(false)
  })

  it('un 403/409 emite denied con el mensaje del servidor; otro fallo no', async () => {
    mockApi('POST', '/api/public/access/submissions', failFromServer(403, 'Forbidden', 'Tu acceso ya se usó. Pide uno nuevo para enviar más archivos', { state: 'used' }))
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/access/submissions', senderName: 'Eva' } })
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.emitted('denied')).toEqual([['Tu acceso ya se usó. Pide uno nuevo para enviar más archivos']])

    mockApi('POST', '/api/public/access/submissions', failWith(500))
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.emitted('denied')).toHaveLength(1)
  })

  it('disabled bloquea el formulario y oculta el selector', async () => {
    const wrapper = await mountSuspended(GuestUploadForm, { props: { createUrl: '/api/public/submissions', disabled: true } })
    expect(wrapper.findComponent(DropZone).exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
})
