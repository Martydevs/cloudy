// US3 — página pública /enviar, tarjeta de envío, cola /pendientes y aviso con enlace.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import { nextTick } from 'vue'
import type { Me, Submission } from '#shared/types/api'
import { MAX_GUEST_FILES } from '#shared/constants/files'
import AppToast from '~/components/app/AppToast.vue'
import DropZone from '~/components/upload/DropZone.vue'
import SubmissionCard from '~/components/guests/SubmissionCard.vue'
import EnviarPage from '~/pages/enviar.vue'
import PendientesPage from '~/pages/pendientes.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { FakeXHR, resetXhr, sent } from './helpers/xhr'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const me: Me = {
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
}
const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!
const file = (name: string, type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const submission = (changes: Partial<Submission> = {}): Submission => ({
  id: 's1', senderName: 'Eva', note: 'Fotos del domingo', status: 'pending', createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  files: [
    { id: 'f1', name: 'foto.jpg', category: 'image', size: 2048, previewUrl: '/api/submissions/s1/files/f1/content' },
    { id: 'f2', name: 'audio.mp3', category: 'audio', size: 4096, previewUrl: '/api/submissions/s1/files/f2/content' },
  ],
  ...changes,
})

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  resetXhr()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  navigateToMock.mockReset()
  useToast().toasts.value = []
  useMe().me.value = me
  mockApi('GET', '/api/me', me)
})

describe('/enviar', () => {
  function mockTicket() {
    mockApi('POST', '/api/public/submissions', (event) => {
      setResponseStatus(event, 201)
      return { submissionId: 'sub1', uploads: [{ fileId: 'g1', uploadUrl: 'https://s3.test/g1', headers: { 'content-type': 'image/jpeg' } }, { fileId: 'g2', uploadUrl: 'https://s3.test/g2', headers: { 'content-type': 'image/png' } }] }
    })
    mockApi('POST', '/api/public/submissions/sub1/complete', { status: 'pending', accepted: 2, rejected: 0 })
  }

  it('exige nombre y al menos un archivo válido', async () => {
    const wrapper = await mountSuspended(EnviarPage)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe('Este campo es obligatorio')

    await wrapper.get('input[type="text"]').setValue('Eva')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Agrega al menos un archivo válido')
    // Un archivo no admitido queda en la cola con su error y no cuenta.
    wrapper.findComponent(DropZone).vm.$emit('files', [file('virus.exe', '')])
    await flush()
    expect(wrapper.text()).toContain('formato no admitido')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.some(c => c.url === '/api/public/submissions')).toBe(false)
  })

  it('limita el envío a MAX_GUEST_FILES archivos y permite quitar uno de la cola', async () => {
    const wrapper = await mountSuspended(EnviarPage)
    const many = Array.from({ length: MAX_GUEST_FILES + 1 }, (_, i) => file(`foto${i}.jpg`))
    wrapper.findComponent(DropZone).vm.$emit('files', many)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe(`Puedes enviar como máximo ${MAX_GUEST_FILES} archivos`)
    expect(wrapper.findAll('button[aria-label^="Cancelar foto"]')).toHaveLength(MAX_GUEST_FILES)

    await wrapper.get('button[aria-label="Cancelar foto0.jpg"]').trigger('click')
    await flush()
    expect(wrapper.findAll('button[aria-label^="Cancelar foto"]')).toHaveLength(MAX_GUEST_FILES - 1)
    expect(wrapper.text()).not.toContain('foto0.jpg')
  })

  it('envía el lote (presign → PUT → complete) y muestra el agradecimiento', async () => {
    mockTicket()
    const wrapper = await mountSuspended(EnviarPage)
    await wrapper.get('input[type="text"]').setValue('  Eva ')
    await wrapper.get('textarea').setValue('Fotos')
    wrapper.findComponent(DropZone).vm.$emit('files', [file('foto.jpg'), file('imagen.png', 'image/png')])
    await flush()
    expect(wrapper.text()).toContain('foto.jpg')

    await wrapper.get('form').trigger('submit')
    await flush(20)
    const post = calls.find(c => c.url === '/api/public/submissions')
    expect(post?.body).toEqual({ senderName: 'Eva', note: 'Fotos', files: [{ name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg' }, { name: 'imagen.png', size: 1000, mimeType: 'image/png' }] })
    expect(sent).toEqual(['https://s3.test/g1', 'https://s3.test/g2'])
    expect(calls.some(c => c.url === '/api/public/submissions/sub1/complete')).toBe(true)
    expect(wrapper.text()).toContain('¡Gracias! Recibimos tu envío')

    await button(wrapper, 'Enviar más archivos').trigger('click')
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('avisa de los archivos descartados por el servidor', async () => {
    mockTicket()
    mockApi('POST', '/api/public/submissions/sub1/complete', { status: 'pending', accepted: 1, rejected: 1 })
    const wrapper = await mountSuspended(EnviarPage)
    await wrapper.get('input[type="text"]').setValue('Eva')
    wrapper.findComponent(DropZone).vm.$emit('files', [file('foto.jpg'), file('imagen.png', 'image/png')])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.text()).toContain('Un archivo no pasó la verificación')
  })

  it('un 429 explica el límite y otro error deja reintentar', async () => {
    mockApi('POST', '/api/public/submissions', failWith(429))
    const wrapper = await mountSuspended(EnviarPage)
    await wrapper.get('input[type="text"]').setValue('Eva')
    wrapper.findComponent(DropZone).vm.$emit('files', [file('foto.jpg')])
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toBe('Has enviado demasiados archivos; intenta en una hora')

    mockApi('POST', '/api/public/submissions', failWith(500))
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos enviar los archivos')
    expect(wrapper.text()).toContain('En espera')
  })

  it('un 5xx con texto en inglés del servidor se explica con el respaldo en español', async () => {
    // Lo que envía Nitro ante un error no controlado.
    mockApi('POST', '/api/public/submissions', (event) => {
      setResponseStatus(event, 500)
      return { statusCode: 500, statusMessage: 'Server Error', message: 'Server Error' }
    })
    const wrapper = await mountSuspended(EnviarPage)
    await wrapper.get('input[type="text"]').setValue('Eva')
    wrapper.findComponent(DropZone).vm.$emit('files', [file('foto.jpg')])
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos enviar los archivos. Revisa tu conexión e inténtalo de nuevo.')
  })
})

describe('SubmissionCard', () => {
  it('muestra remitente, nota, caducidad y archivos con vista previa', async () => {
    const wrapper = await mountSuspended(SubmissionCard, { props: { submission: submission() } })
    expect(wrapper.get('h2').text()).toBe('Eva')
    expect(wrapper.text()).toContain('caduca en 5 días')
    expect(wrapper.text()).toContain('2 archivos')
    expect(wrapper.text()).toContain('Fotos del domingo')
    expect(wrapper.get('img').attributes('src')).toBe('/api/submissions/s1/files/f1/content')
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.text()).toContain('4 KB')
  })

  it('aprobar abre el selector de carpetas y emite la carpeta; rechazar pide el motivo', async () => {
    mockApi('GET', '/api/folders/tree', [{ id: 'd1', name: 'Domingo', parentId: null }])
    const wrapper = await mountSuspended(SubmissionCard, { props: { submission: submission() } })
    await button(wrapper, 'Aprobar').trigger('click')
    // El selector de carpetas es un componente Lazy: se espera a que cargue.
    await vi.waitFor(() => expect(wrapper.text()).toContain('Aprobar hacia…'))
    await vi.waitFor(() => expect(wrapper.findAll('[role="radio"]').some(r => r.text().includes('Domingo'))).toBe(true))
    await wrapper.findAll('[role="radio"]').find(r => r.text().includes('Domingo'))!.trigger('click')
    await button(wrapper, 'Aprobar aquí').trigger('click')
    expect(wrapper.emitted('approve')).toEqual([['d1']])

    await button(wrapper, 'Rechazar').trigger('click')
    await nextTick()
    await wrapper.get('dialog textarea').setValue('Borrosa')
    await wrapper.get('dialog form').trigger('submit')
    expect(wrapper.emitted('reject')).toEqual([['Borrosa']])
  })

  it('un envío ya revisado no muestra acciones y uno caducado lo dice', async () => {
    const approved = await mountSuspended(SubmissionCard, { props: { submission: submission({ status: 'approved' }) } })
    expect(buttonsWithText(approved, 'Aprobar')).toHaveLength(0)
    expect(approved.text()).toContain('Aprobado')
    const today = await mountSuspended(SubmissionCard, { props: { submission: submission({ expiresAt: new Date(Date.now() - 1000).toISOString(), files: [submission().files[0]!] }) } })
    expect(today.text()).toContain('caduca hoy')
    expect(today.text()).toContain('1 archivo')
  })
})

describe('/pendientes', () => {
  beforeEach(() => {
    mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 1, newSubmissions: [], pendingUsers: 0 })
  })

  it('lista los pendientes, aprueba hacia la raíz con aviso enlazado y cambia de pestaña', async () => {
    mockApi('GET', '/api/submissions', (event) => {
      const status = new URL(event.path, 'http://x').searchParams.get('status')
      return status === 'approved' ? [submission({ id: 's9', senderName: 'Luis', status: 'approved' })] : [submission()]
    })
    mockApi('GET', '/api/folders/tree', [])
    mockApi('POST', '/api/submissions/s1/approve', { files: [{ name: 'foto.jpg' }, { name: 'audio.mp3' }] })
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    expect(wrapper.text()).toContain('Eva')

    await button(wrapper, 'Aprobar').trigger('click')
    await vi.waitFor(() => expect(buttonsWithText(wrapper, 'Aprobar aquí')).toHaveLength(1))
    await button(wrapper, 'Aprobar aquí').trigger('click')
    await flush()
    expect(calls.find(c => c.url === '/api/submissions/s1/approve')?.body).toEqual({ folderId: null })
    expect(useToast().toasts.value.at(-1)).toMatchObject({ message: 'Se aprobaron 2 archivos de Eva', action: { label: 'Ver', to: '/archivos' } })

    await wrapper.findAll('[role="tab"]').find(t => t.text().includes('Aprobados'))!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Luis')
    expect(wrapper.text()).toContain('Aprobado')
  })

  it('rechaza con motivo y un 409 avisa y refresca', async () => {
    mockApi('GET', '/api/submissions', [submission()])
    mockApi('POST', '/api/submissions/s1/reject', null)
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    await button(wrapper, 'Rechazar').trigger('click')
    await nextTick()
    await wrapper.get('dialog textarea').setValue('Borrosa')
    await wrapper.get('dialog form').trigger('submit')
    await flush()
    expect(calls.find(c => c.url === '/api/submissions/s1/reject')?.body).toEqual({ reason: 'Borrosa' })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Se rechazó el envío de Eva')

    const listCalls = calls.filter(c => c.url === '/api/submissions').length
    mockApi('POST', '/api/submissions/s1/reject', (event) => {
      setResponseStatus(event, 409)
      return { statusCode: 409, message: 'Este envío ya fue revisado por otra persona' }
    })
    await button(wrapper, 'Rechazar').trigger('click')
    await nextTick()
    await wrapper.get('dialog form').trigger('submit')
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'Este envío ya fue revisado por otra persona' })
    expect(calls.filter(c => c.url === '/api/submissions').length).toBeGreaterThan(listCalls)
  })

  it('aprobar hacia una carpeta enlaza a esa carpeta en el aviso', async () => {
    mockApi('GET', '/api/submissions', [submission({ files: [submission().files[0]!] })])
    mockApi('GET', '/api/folders/tree', [{ id: 'd1', name: 'Domingo', parentId: null }])
    mockApi('POST', '/api/submissions/s1/approve', { files: [{ name: 'foto.jpg' }] })
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    await button(wrapper, 'Aprobar').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[role="radio"]').some(r => r.text().includes('Domingo'))).toBe(true))
    await wrapper.findAll('[role="radio"]').find(r => r.text().includes('Domingo'))!.trigger('click')
    await button(wrapper, 'Aprobar aquí').trigger('click')
    await flush()
    expect(calls.find(c => c.url === '/api/submissions/s1/approve')?.body).toEqual({ folderId: 'd1' })
    expect(useToast().toasts.value.at(-1)).toMatchObject({ message: 'Se aprobó «foto.jpg»', action: { label: 'Ver', to: '/archivos/d1' } })
  })

  it('las pestañas de revisados vacías no ofrecen el enlace para invitados', async () => {
    mockApi('GET', '/api/submissions', [])
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    await wrapper.findAll('[role="tab"]').find(t => t.text().includes('Rechazados'))!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('No hay envíos rechazados')
    expect(buttonsWithText(wrapper, 'Copiar enlace para invitados')).toHaveLength(1)
  })

  it('cuando el pulso detecta un envío nuevo, la cola se recarga sola', async () => {
    let list: Submission[] = []
    mockApi('GET', '/api/submissions', () => list)
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    expect(wrapper.text()).toContain('No hay envíos pendientes')
    const before = calls.filter(c => c.url === '/api/submissions').length

    list = [submission({ senderName: 'Nueva' })]
    usePulse().pendingCount.value = 1
    await flush(10)
    // Las páginas montadas por pruebas anteriores siguen vivas y también reaccionan al pulso.
    expect(calls.filter(c => c.url === '/api/submissions').length).toBeGreaterThanOrEqual(before + 1)
    expect(wrapper.text()).toContain('Nueva')
  })

  it('un sondeo fallido conserva la lista cargada y solo avisa; la siguiente recarga lo recupera (T162, defecto 3)', async () => {
    let failing = false
    mockApi('GET', '/api/submissions', event => (failing ? failWith(500)(event) : [submission()]))
    const wrapper = await mountSuspended(PendientesPage)
    await flush()
    expect(wrapper.text()).toContain('Eva')

    failing = true
    usePulse().pendingCount.value += 1
    await flush(10)
    expect(wrapper.text()).toContain('Eva')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const notice = wrapper.get('[role="status"]')
    expect(notice.text()).toContain('No pudimos actualizar la cola')
    // El aviso trae un botón de tamaño normal (≥ 44 px) para no esperar al reintento automático.
    const retryButton = notice.get('button')
    expect(retryButton.text()).toBe('Reintentar')
    expect(retryButton.classes()).toContain('btn')
    expect(retryButton.classes().some(c => /^btn-(xs|sm)$/.test(c))).toBe(false)

    // Reintentar a mano recupera la lista y quita el aviso.
    failing = false
    const before = calls.filter(c => c.url === '/api/submissions').length
    await retryButton.trigger('click')
    await flush(10)
    expect(calls.filter(c => c.url === '/api/submissions').length).toBeGreaterThan(before)
    expect(wrapper.text()).toContain('Eva')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('tras un sondeo fallido, la cola se reintenta sola a los 5 s (T162, B)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let failing = false
      mockApi('GET', '/api/submissions', event => (failing ? failWith(500)(event) : [submission()]))
      const wrapper = await mountSuspended(PendientesPage)
      await vi.waitFor(() => expect(wrapper.text()).toContain('Eva'))

      failing = true
      usePulse().pendingCount.value += 1
      await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(true))
      const attempts = () => calls.filter(c => c.url === '/api/submissions').length

      // El primer reintento automático también falla: se vuelve a armar otro. Se mide crecimiento, no
      // una cuenta exacta: las páginas montadas por pruebas anteriores siguen vivas y también reintentan.
      const beforeFirst = attempts()
      await vi.advanceTimersByTimeAsync(5000)
      await vi.waitFor(() => expect(attempts()).toBeGreaterThan(beforeFirst))
      expect(wrapper.find('[role="status"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Eva')

      // Sin re-armado no habría más peticiones; el segundo reintento llega con el servidor recuperado.
      const afterFirst = attempts()
      failing = false
      await vi.advanceTimersByTimeAsync(5000)
      await vi.waitFor(() => expect(attempts()).toBeGreaterThan(afterFirst))
      await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(false))
      expect(wrapper.text()).toContain('Eva')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('estados de carga, error y vacío con el enlace para invitados', async () => {
    mockApi('GET', '/api/submissions', () => new Promise(() => {}))
    const loading = await mountSuspended(PendientesPage)
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/submissions', failWith(500))
    const error = await mountSuspended(PendientesPage)
    await flush()
    expect(error.get('[role="alert"]').text()).toContain('No pudimos cargar los envíos')

    clearNuxtData()
    mockApi('GET', '/api/submissions', [])
    const empty = await mountSuspended(PendientesPage)
    await flush()
    expect(empty.text()).toContain('No hay envíos pendientes')
    await buttonsWithText(empty, 'Copiar enlace para invitados')[1]!.trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('Enlace para invitados copiado')
    expect(await navigator.clipboard.readText()).toMatch(/\/enviar$/)
  })
})

describe('aviso con enlace', () => {
  it('AppToast muestra el enlace de la acción y el pulso avisa de cada envío nuevo', async () => {
    const toast = useToast()
    toast.info('Nuevo envío', { action: { label: 'Ver', to: '/pendientes' } })
    const wrapper = await mountSuspended(AppToast)
    expect(wrapper.get('a[href="/pendientes"]').text()).toBe('Ver')
    await wrapper.get('a[href="/pendientes"]').trigger('click')
    expect(toast.toasts.value).toHaveLength(0)

    mockApi('GET', '/api/realtime/pulse', {
      cursor: '2026-10-14T10:00:03.000Z', pendingCount: 1, pendingUsers: 0,
      newSubmissions: [{ id: 's1', senderName: 'Eva', fileCount: 2, createdAt: '' }, { id: 's2', senderName: 'Luis', fileCount: 1, createdAt: '' }],
    })
    const { poll } = usePulsePolling()
    await poll()
    expect(toast.toasts.value.map(t => t.message)).toEqual(['Nuevo envío de Eva (2 archivos)', 'Nuevo envío de Luis (1 archivo)'])
    expect(toast.toasts.value[0]?.action).toEqual({ label: 'Ver', to: '/pendientes' })
  })
})
