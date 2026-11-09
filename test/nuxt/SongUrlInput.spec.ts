// T025 — Campo del enlace de Letras.com (feature 006, FR-004–FR-006): etiqueta, envío con Enter o con el botón, el enlace
// normalizado, el mensaje de cada rechazo, la espera del rastreo, el error del servidor junto al campo y el interruptor del modo
// cola («Agregar a la cola»).
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SongUrlInput from '~/components/songs/SongUrlInput.vue'
import { flush } from './helpers/api'

const mount = (props: Record<string, unknown> = {}) => mountSuspended(SongUrlInput, { props, attachTo: document.body })

describe('SongUrlInput', () => {
  it('tiene la etiqueta visible asociada al campo', async () => {
    const wrapper = await mount()
    const input = wrapper.get('input')
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Enlace de Letras.com')
    expect(wrapper.get('button[type="submit"]').text()).toContain('Ver letra')
    wrapper.unmount()
  })

  it('Enter emite el enlace normalizado (sin www., parámetros ni barra final)', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue(' https://www.letras.com/musiko/de-buenas-part-josh-gamez/?utm_source=x ')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toEqual([['https://letras.com/musiko/de-buenas-part-josh-gamez']])
    wrapper.unmount()
  })

  it('el botón también envía', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('https://letras.com/a/b')
    await wrapper.get('button[type="submit"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')?.[0]).toEqual(['https://letras.com/a/b'])
    wrapper.unmount()
  })

  it.each([
    ['', 'Este campo es obligatorio'],
    ['hola', 'Pega el enlace completo de la canción'],
    ['http://www.letras.com/a/b/', 'Pega un enlace que empiece con https://'],
    ['https://letras.com.otro.test/a/b/', 'Solo aceptamos enlaces de Letras.com'],
    ['https://letras.com@otro.test/a/b/', 'Solo aceptamos enlaces de Letras.com'],
    ['https://user:pass@letras.com/a/b/', 'Ese enlace no es válido'],
    ['https://www.letras.com/musiko/', 'Ese enlace no es de una canción'],
  ])('«%s» muestra su mensaje con role="alert", no emite y devuelve el foco', async (url, message) => {
    const wrapper = await mount()
    const input = wrapper.get('input')
    await input.setValue(url)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain(message)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(wrapper.get('[role="alert"]').attributes('id'))
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('salir del campo vacío muestra «obligatorio» sin esperar al envío', async () => {
    const wrapper = await mount()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('input').trigger('blur')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Este campo es obligatorio')
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('la región de estado existe siempre (vacía y oculta) para que la espera se anuncie al aparecer', async () => {
    const wrapper = await mount()
    const status = wrapper.get('[role="status"]')
    expect(status.text()).toBe('')
    expect(status.classes()).toContain('empty:hidden')
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('[role="status"]').text()).toContain('Buscando la letra')
    wrapper.unmount()
  })

  it('mientras busca muestra la espera, marca aria-busy y deshabilita el envío', async () => {
    const wrapper = await mount({ busy: true })
    await wrapper.get('input').setValue('https://letras.com/a/b')
    expect(wrapper.get('[role="status"]').text()).toBe('Buscando la letra… puede tardar unos segundos')
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('el error del servidor aparece junto al campo y el texto pegado se conserva', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('https://letras.com/a/b')
    await wrapper.setProps({ error: 'No encontramos una letra en ese enlace.' })
    expect(wrapper.get('[role="alert"]').text()).toBe('No encontramos una letra en ese enlace.')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('https://letras.com/a/b')
    wrapper.unmount()
  })

  it('el interruptor «Agregar a la cola» va entre el campo y el envío, sin presionar', async () => {
    const wrapper = await mount()
    const controls = wrapper.findAll('input, button')
    expect(controls.map(c => c.element.tagName === 'INPUT' ? 'input' : c.attributes('type'))).toEqual(['input', 'button', 'submit'])
    const toggle = controls[1]!
    expect(toggle.text()).toBe('Agregar a la cola')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.classes()).not.toContain('btn-active')
    expect(wrapper.text()).not.toContain('Modo cola')
    wrapper.unmount()
  })

  it('pulsarlo emite update:batchMode sin enviar el formulario', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('https://letras.com/a/b')
    await wrapper.get('button[type="button"]').trigger('click')
    await flush()
    expect(wrapper.emitted('update:batchMode')).toEqual([[true]])
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('en modo cola: presionado, el envío dice «Agregar», la pista aparece y el envío sigue emitiendo el enlace', async () => {
    const wrapper = await mount({ batchMode: true })
    const toggle = wrapper.get('button[type="button"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.classes()).toContain('btn-active')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Agregar')
    expect(wrapper.text()).toContain('Modo cola: cada enlace que pegues se agrega a la cola (hasta 3 canciones) para descargarlas en un solo .zip.')
    await wrapper.get('input').setValue('https://www.letras.com/a/b/')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toEqual([['https://letras.com/a/b']])
    await toggle.trigger('click')
    expect(wrapper.emitted('update:batchMode')).toEqual([[false]])
    wrapper.unmount()
  })

  it('mientras busca solo se deshabilita el envío, no el interruptor', async () => {
    const wrapper = await mount({ busy: true, batchMode: true })
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[type="button"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})
