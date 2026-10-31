// Feature 003 (US1) — página Subir (/upload): pedir acceso, estados en vivo, envío con permiso y sus errores.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createError, setResponseHeader, setResponseStatus } from 'h3'
import type { AccessState, GuestAccess } from '#shared/types/api'
import DropZone from '~/components/upload/DropZone.vue'
import UploadPage from '~/pages/upload.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { FakeXHR, resetXhr } from './helpers/xhr'

const CURRENT = '/api/public/access/current'
const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString()
const access = (state: AccessState, changes: Partial<GuestAccess> = {}): GuestAccess => ({
  state,
  senderName: state === 'none' ? null : 'Eva',
  expiresAt: state === 'waiting' ? inMinutes(8) : state === 'approved' ? inMinutes(30) : null,
  ...changes,
})
const photo = () => {
  const f = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 1000 })
  return f
}
const currentCalls = () => calls.filter(c => c.url === CURRENT).length

function mockTicket() {
  mockApi('POST', '/api/public/access/submissions', (event) => {
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
  useToast().toasts.value = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('/upload · pedir acceso', () => {
  it('cargando: muestra el esqueleto', async () => {
    mockApi('GET', CURRENT, () => new Promise(() => {}))
    const wrapper = await mountSuspended(UploadPage)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('muestra el enlace para volver a iniciar sesión', async () => {
    mockApi('GET', CURRENT, access('none'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('a[href="/login"]').text()).toBe('Volver a iniciar sesión')
  })

  it('none: campo con etiqueta y "Pedir acceso"; sin nombre no llama a la API', async () => {
    mockApi('GET', CURRENT, access('none'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('h1').text()).toBe('Envía tus archivos')
    const label = wrapper.findAll('label').find(l => l.text() === 'Tu nombre')!
    expect(wrapper.find(`#${label.attributes('for')}`).exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe('Este campo es obligatorio')
    expect(calls.some(c => c.url === '/api/public/access')).toBe(false)
  })

  it('pedir acceso pasa a "Esperando" con el nombre y la caducidad', async () => {
    mockApi('GET', CURRENT, access('none'))
    mockApi('POST', '/api/public/access', (event) => {
      setResponseStatus(event, 201)
      return access('waiting')
    })
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    await wrapper.get('input[type="text"]').setValue('  Eva ')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.find(c => c.url === '/api/public/access')?.body).toEqual({ senderName: 'Eva' })
    expect(wrapper.text()).toContain('Esperando a que alguien del equipo revise tu solicitud')
    expect(wrapper.text()).toContain('Eva')
    expect(wrapper.text()).toContain('Caduca en 8 min')
    expect(wrapper.get('[role="status"]').text()).toBe('Esperando a que alguien del equipo revise tu solicitud')
    // La animación de espera respeta "reducir movimiento".
    expect(wrapper.get('.loading-dots').classes()).toContain('motion-reduce:hidden')
  })

  it.each([
    ['device', 'Ya pediste acceso varias veces. Intenta de nuevo en 5 min'],
    ['network', 'Hay muchas solicitudes desde esta red. Intenta de nuevo en 5 min'],
  ])('429 (%s) explica cuánto esperar a partir de Retry-After', async (scope, text) => {
    mockApi('GET', CURRENT, access('none'))
    mockApi('POST', '/api/public/access', (event) => {
      setResponseHeader(event, 'Retry-After', 290)
      throw createError({ statusCode: 429, data: { scope, retryAfter: 290 } })
    })
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    await wrapper.get('input[type="text"]').setValue('Eva')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe(text)
  })

  it('un fallo de red al pedir acceso deja reintentar', async () => {
    mockApi('GET', CURRENT, access('none'))
    mockApi('POST', '/api/public/access', failWith(500))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    await wrapper.get('input[type="text"]').setValue('Eva')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo')
    expect(buttonsWithText(wrapper, 'Pedir acceso')).toHaveLength(1)
  })

  it('error de red al cargar: ErrorState con "Reintentar" que vuelve a consultar', async () => {
    mockApi('GET', CURRENT, failWith(500))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar')
    mockApi('GET', CURRENT, access('waiting'))
    await button(wrapper, 'Reintentar').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Esperando a que alguien del equipo revise tu solicitud')
  })
})

describe('/upload · estados', () => {
  it('approved: aviso, formulario con el nombre de solo lectura y la ventana para empezar', async () => {
    mockApi('GET', CURRENT, access('approved'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('.alert-success').text()).toContain('¡Listo! Ya puedes enviar tus archivos')
    expect(wrapper.text()).toContain('Tienes 30 min para empezar el envío')
    // `LazyGuestUploadForm`: el formulario llega en su propio chunk cuando se aprueba la solicitud.
    await vi.waitFor(() => expect(wrapper.findComponent(DropZone).exists()).toBe(true))
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Eva')
    expect(wrapper.get('[role="status"]').text()).toBe('¡Listo! Ya puedes enviar tus archivos')
  })

  it.each([
    ['rejected', 'El equipo no aceptó tu solicitud'],
    ['expired', 'Tu solicitud caducó sin que nadie la atendiera'],
    ['accessExpired', 'Tu acceso caducó antes de empezar el envío'],
  ] as const)('%s: lo explica y "Pedir acceso de nuevo" vuelve al formulario con el nombre', async (state, text) => {
    mockApi('GET', CURRENT, access(state))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('h2').text()).toBe(text)
    await button(wrapper, 'Pedir acceso de nuevo').trigger('click')
    await flush()
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('Eva')
    expect(buttonsWithText(wrapper, 'Pedir acceso')).toHaveLength(1)
  })

  it('used: confirma el envío y ofrece pedir acceso para otro', async () => {
    mockApi('GET', CURRENT, access('used'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.text()).toContain('¡Gracias! Recibimos tu envío')
    await button(wrapper, 'Pedir acceso para otro envío').trigger('click')
    await flush()
    expect(buttonsWithText(wrapper, 'Pedir acceso')).toHaveLength(1)
  })

  it('al vencer expiresAt pasa de waiting a expired sin esperar al sondeo', async () => {
    mockApi('GET', CURRENT, access('waiting', { expiresAt: new Date(Date.now() + 1200).toISOString() }))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.text()).toContain('Esperando')
    const before = currentCalls()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Tu solicitud caducó sin que nadie la atendiera'), { timeout: 4000 })
    expect(currentCalls()).toBe(before)
  })

  it('un teléfono con el reloj adelantado no marca la solicitud como caducada: manda la hora del servidor', async () => {
    useState<number | null>('guest-clock-skew').value = null
    const serverNow = Date.now()
    mockApi('GET', CURRENT, (event) => {
      setResponseHeader(event, 'date', new Date(serverNow).toUTCString())
      return access('waiting', { expiresAt: new Date(serverNow + 8 * 60_000).toISOString() })
    })
    // El reloj del dispositivo va 10 minutos por delante de la vigencia que dio el servidor.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(serverNow + 10 * 60_000)
    const wrapper = await mountSuspended(UploadPage)
    await flush(20)
    expect(wrapper.text()).toContain('Esperando')
    expect(wrapper.text()).not.toContain('Tu solicitud caducó')
    // El desfase aprendido es la diferencia entre ambos relojes.
    expect(Math.round(useState<number | null>('guest-clock-skew').value! / 60_000)).toBe(-10)
    wrapper.unmount()
  })

  it('al vencer expiresAt pasa de approved a accessExpired sin esperar al sondeo', async () => {
    mockApi('GET', CURRENT, access('approved', { expiresAt: new Date(Date.now() + 1200).toISOString() }))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.text()).toContain('¡Listo!')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Tu acceso caducó antes de empezar el envío'), { timeout: 4000 })
  })

  it('el sondeo cada 5 s pasa de waiting a approved y anuncia el cambio; se detiene en un estado terminal', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockApi('GET', CURRENT, access('waiting'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.get('[role="status"]').text()).toBe('Esperando a que alguien del equipo revise tu solicitud')

    mockApi('GET', CURRENT, access('approved'))
    vi.advanceTimersByTime(5000)
    await flush(10)
    expect(wrapper.get('[role="status"]').text()).toBe('¡Listo! Ya puedes enviar tus archivos')

    mockApi('GET', CURRENT, access('rejected'))
    vi.advanceTimersByTime(5000)
    await flush(10)
    expect(wrapper.text()).toContain('El equipo no aceptó tu solicitud')
    const stopped = currentCalls()
    vi.advanceTimersByTime(20_000)
    await flush(10)
    expect(currentCalls()).toBe(stopped)
  })

  it('un sondeo fallido conserva lo que se ve', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockApi('GET', CURRENT, access('waiting'))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    mockApi('GET', CURRENT, failWith(500))
    vi.advanceTimersByTime(5000)
    await flush(10)
    expect(wrapper.text()).toContain('Esperando')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('si el acceso deja de estar aprobado con la cámara abierta, la cámara se cierra (FR-016c)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ width: 640, height: 480 }) }
    const stream = Object.setPrototypeOf({ active: true, getTracks: () => [track], getVideoTracks: () => [track] }, window.MediaStream.prototype)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => [{ kind: 'videoinput' }]) },
    })
    const coarse = vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(pointer: coarse)', media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as MediaQueryList)
    try {
      mockApi('GET', CURRENT, access('approved'))
      const wrapper = await mountSuspended(UploadPage, { attachTo: document.body })
      await flush()
      await vi.waitFor(() => expect(buttonsWithText(wrapper, 'Abrir cámara')).toHaveLength(1))
      await button(wrapper, 'Abrir cámara').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('button[aria-label="Tomar foto"]').exists()).toBe(true))

      mockApi('GET', CURRENT, access('accessExpired'))
      vi.advanceTimersByTime(5000)
      await flush(10)
      expect(wrapper.text()).toContain('Tu acceso caducó antes de empezar el envío')
      expect(wrapper.find('dialog').exists()).toBe(false)
      expect(track.stop).toHaveBeenCalled()
      wrapper.unmount()
    }
    finally {
      coarse.mockRestore()
    }
  })

  it('nunca muestra quién del equipo decidió', async () => {
    mockApi('GET', CURRENT, { ...access('approved'), decidedBy: { name: 'Luis' } })
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    expect(wrapper.text()).not.toContain('Luis')
  })
})

describe('/upload · envío con permiso', () => {
  it('envía sin senderName en el cuerpo, termina y pasa a used', async () => {
    mockTicket()
    let state: GuestAccess = access('approved')
    mockApi('GET', CURRENT, () => state)
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('textarea').setValue('Fotos')
    state = access('used')
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(calls.find(c => c.url === '/api/public/access/submissions')?.body).toEqual({
      note: 'Fotos', files: [{ name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg', withTextSource: false }],
    })
    expect(wrapper.text()).toContain('¡Gracias! Recibimos tu envío')
    expect(wrapper.get('[role="status"]').text()).toBe('¡Gracias! Recibimos tu envío')
    await button(wrapper, 'Pedir acceso para otro envío').trigger('click')
    await flush()
    expect(buttonsWithText(wrapper, 'Pedir acceso')).toHaveLength(1)
  })

  it.each([
    [403, 'Forbidden', 'Tu acceso caducó. Pide acceso de nuevo'],
    [409, 'Conflict', 'Tu acceso ya se usó. Pide uno nuevo para enviar más archivos'],
  ])('un %i al enviar muestra el mensaje del servidor y "Pedir acceso de nuevo"', async (status, statusMessage, message) => {
    mockApi('GET', CURRENT, access('approved'))
    mockApi('POST', '/api/public/access/submissions', failFromServer(status, statusMessage, message, { state: 'accessExpired' }))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.get('[role="alert"]').text()).toBe(message)
    await button(wrapper, 'Pedir acceso de nuevo').trigger('click')
    await flush()
    expect(buttonsWithText(wrapper, 'Pedir acceso')).toHaveLength(1)
  })

  it('otro fallo al enviar se explica con el respaldo y deja reintentar en el formulario', async () => {
    mockApi('GET', CURRENT, access('approved'))
    mockApi('POST', '/api/public/access/submissions', failWith(500))
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await flush(20)
    expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos iniciar tu envío. Revisa tu conexión e inténtalo de nuevo')
    expect(buttonsWithText(wrapper, 'Enviar')).toHaveLength(1)
  })

  it('con un envío en curso, al vencer expiresAt el formulario sigue y la subida termina en used', async () => {
    let state: GuestAccess = access('approved', { expiresAt: new Date(Date.now() + 600).toISOString() })
    mockApi('GET', CURRENT, () => state)
    mockApi('POST', '/api/public/access/submissions', async (event) => {
      // La creación tarda más que lo que le queda al acceso.
      await new Promise(resolve => setTimeout(resolve, 1500))
      setResponseStatus(event, 201)
      return { submissionId: 'sub1', uploads: [{ fileId: 'g1', uploadUrl: 'https://s3.test/g1', headers: { 'content-type': 'image/jpeg' } }] }
    })
    mockApi('POST', '/api/public/submissions/sub1/complete', () => {
      state = access('used')
      return { status: 'pending', accepted: 1, rejected: 0 }
    })
    const wrapper = await mountSuspended(UploadPage)
    await flush()
    wrapper.findComponent(DropZone).vm.$emit('files', [photo()])
    await wrapper.get('form').trigger('submit')
    await new Promise(resolve => setTimeout(resolve, 1000))
    // Ya venció en el reloj del navegador, pero el envío está en curso: no se cambia a "caducó".
    expect(wrapper.text()).not.toContain('Tu acceso caducó')
    expect(wrapper.text()).toContain('Enviando…')
    await vi.waitFor(() => expect(wrapper.get('[role="status"]').text()).toBe('¡Gracias! Recibimos tu envío'), { timeout: 4000 })
    expect(wrapper.text()).toContain('¡Gracias! Recibimos tu envío')
  })
})
