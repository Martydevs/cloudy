// T021 — Campo del enlace de YouTube (feature 005, FR-004, FR-005): etiqueta, envío con Enter o con el botón, solo el
// ID del video y el mensaje de cada rechazo.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import YoutubeUrlInput from '~/components/youtube/YoutubeUrlInput.vue'
import { flush } from './helpers/api'

async function mount() {
  return mountSuspended(YoutubeUrlInput, { attachTo: document.body })
}

describe('YoutubeUrlInput', () => {
  it('tiene la etiqueta visible «Enlace de YouTube» asociada al campo', async () => {
    const wrapper = await mount()
    const input = wrapper.get('input')
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Enlace de YouTube')
    expect(input.attributes('placeholder')).toBe('Pega aquí el enlace de un video')
    expect(wrapper.get('button[type="submit"]').text()).toContain('Ver video')
    wrapper.unmount()
  })

  it('Enter (envío del formulario) emite solo el ID, sin el tiempo ni la lista', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('https://youtu.be/okShortVid1?t=30s&list=PL1')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toEqual([['okShortVid1']])
    wrapper.unmount()
  })

  it('el botón «Ver video» también envía', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')
    await wrapper.get('button[type="submit"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')?.[0]).toEqual(['dQw4w9WgXcQ'])
    wrapper.unmount()
  })

  it.each([
    ['hola', 'Pega un enlace completo, por ejemplo https://youtu.be/…'],
    ['https://www.youtube.com/playlist?list=PL1', 'Ese enlace es de una lista de YouTube. Pega el de un video.'],
    ['https://vimeo.com/123', 'Solo aceptamos enlaces de YouTube'],
    ['', 'Este campo es obligatorio'],
  ])('«%s» muestra su mensaje, no emite y devuelve el foco al campo', async (url, message) => {
    const wrapper = await mount()
    const input = wrapper.get('input')
    await input.setValue(url)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain(message)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('mientras la página navega, el botón queda deshabilitado (sin doble envío)', async () => {
    const wrapper = await mountSuspended(YoutubeUrlInput, { props: { busy: true } })
    await wrapper.get('input').setValue('https://youtu.be/okShortVid1')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
