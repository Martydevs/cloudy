// Páginas del formulario de un día de trabajo: /calendario/nuevo (con la fecha de `?fecha=`) y /calendario/[id]/editar
// (carga, error con reintento, día que ya no existe y contenido). El formulario en sí se prueba en `WorkDayForm.spec.ts`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import NuevoPage from '~/pages/calendario/nuevo.vue'
import EditarPage from '~/pages/calendario/[id]/editar.vue'
import { buttonsWithText, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { setMe, workDayDetail } from './calendar-fixtures'

const dateValue = (wrapper: { get: (selector: string) => { element: Element } }) => (wrapper.get('input[type="date"]').element as HTMLInputElement).value

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('work-calendar-months').value = {}
  setMe('admin', 'u9')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/calendario', { items: [] })
  mockApi('GET', '/api/calendario/miembros', { items: [] })
  mockApi('GET', '/api/calendario/d1', workDayDetail())
})

describe('/calendario/nuevo', () => {
  it('abre el formulario de agendar con la fecha que mostraba el calendario', async () => {
    const wrapper = await mountSuspended(NuevoPage, { attachTo: document.body, route: '/calendario/nuevo?fecha=2026-12-05' })
    await flush(10)
    expect(wrapper.get('h1').text()).toBe('Agendar día')
    expect(dateValue(wrapper)).toBe('2026-12-05')
    // Volver regresa al mismo mes.
    expect(wrapper.get('a').attributes('href')).toBe('/calendario?fecha=2026-12-05')
    wrapper.unmount()
  })

  it('sin fecha, o con una que no lo es, el campo empieza vacío', async () => {
    for (const route of ['/calendario/nuevo', '/calendario/nuevo?fecha=2026-02-31', '/calendario/nuevo?fecha=hoy']) {
      const wrapper = await mountSuspended(NuevoPage, { attachTo: document.body, route })
      await flush(10)
      expect(dateValue(wrapper)).toBe('')
      expect(wrapper.get('a').attributes('href')).toBe('/calendario')
      wrapper.unmount()
    }
  })
})

describe('/calendario/[id]/editar', () => {
  const mount = async () => {
    const wrapper = await mountSuspended(EditarPage, { attachTo: document.body, route: '/calendario/d1/editar' })
    await flush(15)
    return wrapper
  }

  it('mientras llega el día muestra el esqueleto; luego, el formulario con sus datos', async () => {
    let release: (() => void) | undefined
    mockApi('GET', '/api/calendario/d1', () => new Promise(resolve => (release = () => resolve(workDayDetail()))))
    const wrapper = await mount()
    expect(wrapper.get('h1').text()).toBe('Editar día')
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
    release!()
    await vi.waitUntil(() => wrapper.find('form').exists(), { timeout: 5000 })
    expect(wrapper.get('h1').text()).toBe('Editar día')
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('Servicio dominical')
    expect(dateValue(wrapper)).toBe('2026-11-22')
    expect(buttonsWithText(wrapper, 'Guardar cambios')).toHaveLength(1)
    wrapper.unmount()
  })

  it('si el día ya no existe lo dice y ofrece volver al calendario', async () => {
    mockApi('GET', '/api/calendario/d1', failWith(404))
    const wrapper = await mount()
    expect(wrapper.text()).toContain('Ese día ya no está en el calendario.')
    const back = wrapper.findAll('a').find(a => a.text().trim() === 'Volver al calendario')!
    expect(back.attributes('href')).toBe('/calendario')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
    wrapper.unmount()
  })

  it('si no se pudo cargar, ofrece reintentar y al lograrlo muestra el formulario', async () => {
    mockApi('GET', '/api/calendario/d1', failWith(500))
    const wrapper = await mount()
    expect(wrapper.text()).toContain('No pudimos cargar el día')
    expect(wrapper.find('form').exists()).toBe(false)
    mockApi('GET', '/api/calendario/d1', workDayDetail())
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await vi.waitUntil(() => wrapper.find('form').exists(), { timeout: 5000 })
    wrapper.unmount()
  })
})
