// Feature 003 (US2) — cámara dentro de Cloudy: permiso, vista en vivo, revisar, usar, límite, errores y apagado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick } from 'vue'
import CameraCapture from '~/components/upload/CameraCapture.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, flush } from './helpers/api'

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!

interface FakeMedia {
  track: { stop: ReturnType<typeof vi.fn> }
  stream: MediaStream
  getUserMedia: ReturnType<typeof vi.fn>
  enumerateDevices: ReturnType<typeof vi.fn>
}

/** `navigator.mediaDevices` simulado; `fail` es el nombre del error de getUserMedia. */
function fakeMedia({ fail, facingMode = 'environment', devices = [{ kind: 'videoinput' }] }: { fail?: string, facingMode?: string, devices?: { kind: string }[] } = {}): FakeMedia {
  const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ width: 640, height: 480, facingMode }) }
  // happy-dom solo acepta un `MediaStream` en `video.srcObject`; las pistas son las simuladas.
  const stream = Object.setPrototypeOf({ active: true, getTracks: () => [track], getVideoTracks: () => [track] }, window.MediaStream.prototype)
  const getUserMedia = vi.fn(async () => {
    if (fail) throw Object.assign(new Error(fail), { name: fail })
    return stream
  })
  const enumerateDevices = vi.fn(async () => devices)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices } })
  return { track, stream, getUserMedia, enumerateDevices }
}

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  useToast().toasts.value = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  // happy-dom no dibuja: el canvas devuelve un contexto mínimo y un JPEG pequeño.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
    callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
  })
  // El `URL` de Node no acepta el `File` de happy-dom: la vista previa usa una URL simulada.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:foto')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function openCamera(props: { maxPhotos?: number } = {}) {
  const wrapper = await mountSuspended(CameraCapture, { props: { open: true, maxPhotos: 20, ...props }, attachTo: document.body })
  await flush()
  return wrapper
}

describe('CameraCapture', () => {
  it('abre la cámara trasera sin audio y muestra el video tras "Abriendo la cámara…"', async () => {
    const media = fakeMedia()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    media.getUserMedia.mockImplementation(async () => {
      await gate
      return media.stream
    })
    const wrapper = await mountSuspended(CameraCapture, { props: { open: true, maxPhotos: 20 }, attachTo: document.body })
    await nextTick()
    expect(wrapper.text()).toContain('Abriendo la cámara…')
    release()
    await flush()
    expect(media.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    const video = wrapper.get('video')
    expect(video.attributes()).toMatchObject({ autoplay: '', playsinline: '' })
    expect((video.element as HTMLVideoElement).muted).toBe(true)
    const shutter = wrapper.get('button[aria-label="Tomar foto"]')
    expect(document.activeElement).toBe(shutter.element)
    expect(wrapper.get('dialog').classes()).toContain('modal')
    wrapper.unmount()
  })

  it('no pide la cámara mientras está cerrada', async () => {
    const media = fakeMedia()
    const wrapper = await mountSuspended(CameraCapture, { props: { open: false, maxPhotos: 20 } })
    await flush()
    expect(media.getUserMedia).not.toHaveBeenCalled()
    await wrapper.setProps({ open: true })
    await flush()
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('"Tomar foto" pasa a revisión; "Repetir" vuelve sin emitir; "Usar foto" emite un JPEG y lo anuncia', async () => {
    fakeMedia()
    const wrapper = await openCamera()
    await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
    await flush()
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Foto lista para revisar')
    expect(wrapper.find('img').exists()).toBe(true)

    await button(wrapper, 'Repetir').trigger('click')
    await flush()
    expect(wrapper.emitted('photo')).toBeUndefined()
    expect(wrapper.find('button[aria-label="Tomar foto"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
    await flush()
    await button(wrapper, 'Usar foto').trigger('click')
    await flush()
    const [[file]] = wrapper.emitted('photo') as [[File]]
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^foto-\d{8}-\d{6}\.jpg$/)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Foto agregada')
    expect(wrapper.text()).toContain('1 foto agregada')
    // Sigue abierta para tomar más.
    expect(wrapper.find('button[aria-label="Tomar foto"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('al llegar a maxPhotos se cierra sola y avisa', async () => {
    const media = fakeMedia()
    const wrapper = await openCamera({ maxPhotos: 1 })
    await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
    await flush()
    await button(wrapper, 'Usar foto').trigger('click')
    await flush()
    expect(wrapper.emitted('photo')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(media.track.stop).toHaveBeenCalled()
    expect(useToast().toasts.value.at(-1)?.message).toBe('Llegaste al máximo de archivos de este envío')
    wrapper.unmount()
  })

  it('el límite se fija al abrir: aunque `maxPhotos` baje con cada foto agregada, no se cuenta dos veces', async () => {
    fakeMedia()
    const wrapper = await openCamera({ maxPhotos: 3 })
    for (let taken = 1; taken <= 2; taken++) {
      await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
      await flush()
      await button(wrapper, 'Usar foto').trigger('click')
      // El formulario descuenta la foto del espacio restante.
      await wrapper.setProps({ maxPhotos: 3 - taken })
      await flush()
    }
    expect(wrapper.emitted('photo')).toHaveLength(2)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('button[aria-label="Tomar foto"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['NotAllowedError','Cloudy no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador o usa «Elegir archivos»'],
    ['NotFoundError', 'No encontramos una cámara en este dispositivo'],
    ['NotReadableError', 'Otra app está usando la cámara'],
    ['TypeError', 'No pudimos abrir la cámara. Usa «Elegir archivos»'],
  ])('%s: lo explica en español con "Cerrar"', async (name, message) => {
    fakeMedia({ fail: name })
    const wrapper = await openCamera()
    expect(wrapper.get('[role="alert"]').text()).toBe(message)
    expect(wrapper.find('button[aria-label="Tomar foto"]').exists()).toBe(false)
    await button(wrapper, 'Cerrar').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('sin la API de cámara (contexto no seguro) dice que use "Elegir archivos"', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const wrapper = await openCamera()
    expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos abrir la cámara. Usa «Elegir archivos»')
    wrapper.unmount()
  })

  it('si el navegador no logra la foto lo explica y deja reintentar', async () => {
    fakeMedia()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    const wrapper = await openCamera()
    await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos abrir la cámara. Usa «Elegir archivos»')
    wrapper.unmount()
  })

  it('"Cerrar cámara", Esc, ocultar la pestaña y desmontar detienen todas las pistas', async () => {
    const media = fakeMedia()
    const closed = await openCamera()
    await closed.get('button[aria-label="Cerrar cámara"]').trigger('click')
    expect(media.track.stop).toHaveBeenCalledTimes(1)
    expect(closed.emitted('close')).toHaveLength(1)
    closed.unmount()

    const escaped = await openCamera()
    await escaped.get('dialog').trigger('cancel')
    expect(media.track.stop).toHaveBeenCalledTimes(2)
    expect(escaped.emitted('close')).toHaveLength(1)
    escaped.unmount()

    const hidden = await openCamera()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(media.track.stop).toHaveBeenCalledTimes(3)
    expect(hidden.emitted('close')).toHaveLength(1)
    hidden.unmount()
    visibility = 'visible'

    const unmounted = await openCamera()
    unmounted.unmount()
    expect(media.track.stop).toHaveBeenCalledTimes(4)
  })

  it('al cerrar, el foco vuelve al botón que la abrió', async () => {
    fakeMedia()
    const opener = document.createElement('button')
    opener.textContent = 'Abrir cámara'
    document.body.append(opener)
    opener.focus()
    const wrapper = await openCamera()
    expect(document.activeElement).not.toBe(opener)
    await wrapper.get('button[aria-label="Cerrar cámara"]').trigger('click')
    await flush()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })

  it('con solo cámara frontal se abre igual y toma la foto', async () => {
    fakeMedia({ facingMode: 'user' })
    const wrapper = await openCamera()
    await wrapper.get('button[aria-label="Tomar foto"]').trigger('click')
    await flush()
    await button(wrapper, 'Usar foto').trigger('click')
    expect(wrapper.emitted('photo')).toHaveLength(1)
    wrapper.unmount()
  })

  it('a 360 px: disparo de al menos 64 px y cierre de al menos 44 px', async () => {
    fakeMedia()
    const wrapper = await openCamera()
    expect(wrapper.get('button[aria-label="Tomar foto"]').classes()).toEqual(expect.arrayContaining(['size-16']))
    expect(wrapper.get('button[aria-label="Cerrar cámara"]').classes()).toEqual(expect.arrayContaining(['min-h-11']))
    expect(wrapper.get('.modal-box').classes()).toEqual(expect.arrayContaining(['h-dvh']))
    wrapper.unmount()
  })
})

describe('useCameraAvailability', () => {
  const Probe = defineComponent({
    setup() {
      const { available } = useCameraAvailability()
      return () => h('p', available.value ? 'sí' : 'no')
    },
  })

  function pointer(coarse: boolean) {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: coarse && query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList)
  }

  it('true solo con puntero táctil, getUserMedia y al menos un videoinput', async () => {
    pointer(true)
    fakeMedia()
    const wrapper = await mountSuspended(Probe)
    await flush()
    expect(wrapper.text()).toBe('sí')
  })

  it.each([
    ['puntero fino (computadora o iPad con trackpad)', () => { pointer(false); fakeMedia() }],
    ['sin cámara', () => { pointer(true); fakeMedia({ devices: [{ kind: 'audioinput' }] }) }],
    ['sin getUserMedia', () => { pointer(true); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }) }],
    ['enumerateDevices falla', () => { pointer(true); fakeMedia().enumerateDevices.mockRejectedValue(new Error('x')) }],
  ])('false con %s', async (_, arrange) => {
    arrange()
    const wrapper = await mountSuspended(Probe)
    await flush()
    expect(wrapper.text()).toBe('no')
  })
})
