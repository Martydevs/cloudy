// Panel del texto de una imagen y `useImageText` (feature 002, contracts/ui): un estado por vista, la
// lectura de respaldo solo si está pendiente, la consulta cada 3 s mientras dura `reading`, copiar y reintentar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { ImageText } from '#shared/types/api'
import ImageTextPanel from '~/components/files/ImageTextPanel.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const env = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    visibility: ref<DocumentVisibilityState>('visible'),
    online: ref(true),
    clipboard: { copy: vi.fn(async (_text: string) => {}), isSupported: ref(true) },
  }
})
mockNuxtImport('useDocumentVisibility', () => () => env.visibility)
mockNuxtImport('useOnline', () => () => env.online)
mockNuxtImport('useClipboard', () => () => env.clipboard)

const F1 = '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const ENDPOINT = `/api/files/${F1}/text`

const text = (changes: Partial<ImageText> = {}): ImageText => ({
  status: 'ready', text: 'Oremos por Ana\nGracias', error: null, readAt: '2026-10-21T10:00:00.000Z', editedAt: null, editedBy: null, ...changes,
})

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(ImageTextPanel, { props: { endpoint: ENDPOINT, autoRead: true, ...props } })

const toasts = () => useToast().toasts.value.map(t => t.message)
const requests = (method: string) => calls.filter(c => c.method === method && c.url === ENDPOINT)

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
  env.visibility.value = 'visible'
  env.online.value = true
  env.clipboard.copy.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ImageTextPanel · estados', () => {
  it('reading: skeleton y "Leyendo texto…" en una región aria-live', async () => {
    const wrapper = await mount({ initial: text({ status: 'reading', text: null }) })
    const live = wrapper.get('[aria-live="polite"]')
    expect(live.text()).toContain('Leyendo texto…')
    expect(wrapper.find('.skeleton').exists()).toBe(true)
    expect(wrapper.get('h2').text()).toBe('Texto de la imagen')
  })

  it('ready: el texto conserva los saltos de línea; Copiar texto copia y avisa', async () => {
    env.clipboard.copy.mockResolvedValue(undefined)
    const wrapper = await mount({ initial: text() })
    const paragraph = wrapper.get('p.whitespace-pre-line')
    expect(paragraph.text()).toContain('Oremos por Ana')
    expect(paragraph.element.textContent).toBe('Oremos por Ana\nGracias')
    await buttonsWithText(wrapper, 'Copiar texto')[0]!.trigger('click')
    await flush()
    expect(env.clipboard.copy).toHaveBeenCalledWith('Oremos por Ana\nGracias')
    expect(toasts()).toContain(messages.imageText.copied)
  })

  it('si copiar falla, avisa cómo hacerlo a mano', async () => {
    env.clipboard.copy.mockRejectedValue(new Error('denegado'))
    const wrapper = await mount({ initial: text() })
    await buttonsWithText(wrapper, 'Copiar texto')[0]!.trigger('click')
    await flush()
    expect(toasts()).toContain(messages.imageText.copyFailed)
  })

  it('empty: EmptyState y Volver a leer con force', async () => {
    mockApi('POST', ENDPOINT, text({ text: 'Nueva lectura' }))
    const wrapper = await mount({ initial: text({ status: 'empty', text: null }) })
    expect(wrapper.text()).toContain(messages.imageText.empty)
    await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
    await flush()
    expect(requests('POST').map(c => c.body)).toEqual([{ force: true }])
    expect(wrapper.text()).toContain('Nueva lectura')
  })

  it.each([
    ['timeout', messages.imageText.failedRetryable],
    ['provider', messages.imageText.failedRetryable],
    ['rate_limited', messages.imageText.failedRetryable],
    ['invalid_output', messages.imageText.failedRetryable],
    ['quota_exceeded', messages.imageText.failedQuota],
  ] as const)('failed/%s: su mensaje y Reintentar con force', async (error, message) => {
    mockApi('POST', ENDPOINT, text())
    const wrapper = await mount({ initial: text({ status: 'failed', text: null, error }) })
    expect(wrapper.get('[role="alert"]').text()).toContain(message)
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(requests('POST').map(c => c.body)).toEqual([{ force: true }])
    expect(wrapper.find('p.whitespace-pre-line').exists()).toBe(true)
  })

  it('failed/invalid_input: indica descargar y volver a subir, sin Reintentar', async () => {
    const wrapper = await mount({ initial: text({ status: 'failed', text: null, error: 'invalid_input' }) })
    expect(wrapper.text()).toContain(messages.imageText.failedPermanent)
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
  })

  it('un Reintentar que falla por red avisa con un toast', async () => {
    mockApi('POST', ENDPOINT, failWith(500))
    const wrapper = await mount({ initial: text({ status: 'failed', text: null, error: 'provider' }) })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(toasts()).toContain(messages.imageText.failedRetryable)
  })

  it('unavailable: texto de ayuda, sin botones; variante HEIC', async () => {
    const wrapper = await mount({ initial: text({ status: 'unavailable', text: null }) })
    expect(wrapper.text()).toContain(messages.imageText.unavailable)
    expect(wrapper.findAll('button')).toHaveLength(0)
    const heic = await mount({ initial: text({ status: 'unavailable', text: null }), heic: true })
    expect(heic.text()).toContain(messages.imageText.unavailableHeic)
  })

  it('error de red del panel: ErrorState con reintento de la petición', async () => {
    mockApi('GET', ENDPOINT, failWith(500))
    const wrapper = await mount()
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain(messages.imageText.loadFailed)
    mockApi('GET', ENDPOINT, text())
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Oremos por Ana')
  })

  it('editable: menú ⋯ visible con Volver a leer', async () => {
    mockApi('POST', ENDPOINT, text({ text: 'Otra' }))
    const wrapper = await mount({ initial: text(), editable: true })
    await wrapper.get('button[aria-label="Más acciones del texto"]').trigger('click')
    await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
    await flush()
    expect(requests('POST').map(c => c.body)).toEqual([{ force: true }])
    const readOnly = await mount({ initial: text() })
    expect(readOnly.find('button[aria-label="Más acciones del texto"]').exists()).toBe(false)
  })

  it('compact: trunca a 6 líneas con Ver todo', async () => {
    const long = Array.from({ length: 9 }, (_, i) => `Línea ${i + 1}`).join('\n')
    const wrapper = await mount({ initial: text({ text: long }), compact: true })
    expect(wrapper.get('p.whitespace-pre-line').classes()).toContain('line-clamp-6')
    await buttonsWithText(wrapper, 'Ver todo')[0]!.trigger('click')
    expect(wrapper.get('p.whitespace-pre-line').classes()).not.toContain('line-clamp-6')
    expect(buttonsWithText(wrapper, 'Ver menos')).toHaveLength(1)
    const short = await mount({ initial: text(), compact: true })
    expect(buttonsWithText(short, 'Ver todo')).toHaveLength(0)
  })
})

describe('useImageText · peticiones al montar', () => {
  it('sin initial hace GET y, si está pendiente, la lectura de respaldo sin force', async () => {
    mockApi('GET', ENDPOINT, text({ status: 'pending', text: null }))
    mockApi('POST', ENDPOINT, text())
    const wrapper = await mount()
    await flush()
    expect(requests('GET')).toHaveLength(1)
    expect(requests('POST').map(c => c.body)).toEqual([{ force: false }])
    expect(wrapper.text()).toContain('Oremos por Ana')
  })

  it.each(['reading', 'ready', 'empty', 'failed', 'unavailable'] as const)('con %s no hace POST', async (status) => {
    mockApi('GET', ENDPOINT, text({ status }))
    await mount()
    await flush()
    expect(requests('POST')).toHaveLength(0)
  })

  it('sin autoRead no lee aunque esté pendiente', async () => {
    mockApi('GET', ENDPOINT, text({ status: 'pending', text: null }))
    await mount({ autoRead: false })
    await flush()
    expect(requests('POST')).toHaveLength(0)
  })

  it('con initial terminal no hace ninguna petición; pendiente hace POST', async () => {
    await mount({ initial: text({ status: 'failed', error: 'timeout', text: null }) })
    await flush()
    expect(calls).toHaveLength(0)

    mockApi('POST', ENDPOINT, text())
    await mount({ initial: text({ status: 'pending', text: null }) })
    await flush()
    expect(requests('GET')).toHaveLength(0)
    expect(requests('POST')).toHaveLength(1)
  })

  it('un POST de respaldo que falla muestra el error del panel', async () => {
    mockApi('POST', ENDPOINT, failWith(500))
    const wrapper = await mount({ initial: text({ status: 'pending', text: null }) })
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain(messages.imageText.loadFailed)
  })
})

describe('useImageText · consulta mientras dura reading', () => {
  it('con initial reading consulta GET cada 3 s y se detiene en un estado terminal', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let next = text({ status: 'reading', text: null })
    mockApi('GET', ENDPOINT, () => next)
    const wrapper = await mount({ initial: text({ status: 'reading', text: null }) })
    await flush()
    expect(requests('GET')).toHaveLength(0)

    vi.advanceTimersByTime(3000)
    await flush()
    expect(requests('GET')).toHaveLength(1)
    expect(wrapper.text()).toContain('Leyendo texto…')

    next = text()
    vi.advanceTimersByTime(3000)
    await flush()
    expect(wrapper.text()).toContain('Oremos por Ana')

    vi.advanceTimersByTime(9000)
    await flush()
    expect(requests('GET')).toHaveLength(2)
    expect(requests('POST')).toHaveLength(0)
  })

  it('se detiene cuando el servidor da la lectura por vencida y ofrece Reintentar', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockApi('GET', ENDPOINT, text({ status: 'failed', error: 'timeout', text: null }))
    const wrapper = await mount({ initial: text({ status: 'reading', text: null }) })
    vi.advanceTimersByTime(3000)
    await flush()
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(1)
    vi.advanceTimersByTime(9000)
    await flush()
    expect(requests('GET')).toHaveLength(1)
  })

  it('pausa con la pestaña oculta o sin conexión y consulta al volver', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockApi('GET', ENDPOINT, text({ status: 'reading', text: null }))
    await mount({ initial: text({ status: 'reading', text: null }) })
    env.visibility.value = 'hidden'
    await flush()
    vi.advanceTimersByTime(9000)
    await flush()
    expect(requests('GET')).toHaveLength(0)

    env.visibility.value = 'visible'
    await flush()
    expect(requests('GET')).toHaveLength(1)

    env.online.value = false
    await flush()
    vi.advanceTimersByTime(6000)
    await flush()
    expect(requests('GET')).toHaveLength(1)
  })

  it('una consulta fallida no cambia lo que se ve', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockApi('GET', ENDPOINT, failWith(500))
    const wrapper = await mount({ initial: text({ status: 'reading', text: null }) })
    vi.advanceTimersByTime(3000)
    await flush()
    expect(wrapper.text()).toContain('Leyendo texto…')
  })
})

describe('ImageTextPanel · pendiente sin lectura automática', () => {
  it('no finge una lectura en curso: dice que aún no se ha leído', async () => {
    const wrapper = await mount({ initial: text({ status: 'pending', text: null }), autoRead: false })
    await flush()
    expect(wrapper.text()).toContain(messages.imageText.notRead)
    expect(wrapper.text()).not.toContain('Leyendo texto…')
    expect(requests('POST')).toHaveLength(0)
  })
})
