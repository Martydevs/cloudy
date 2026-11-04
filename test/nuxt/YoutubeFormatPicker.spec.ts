// T033 — Menú de formato (feature 005, FR-007): opciones tipo radio, un solo gesto para elegir, aviso de 1080p,
// variantes de botón (con texto, solo icono, en línea) y teclado.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import YoutubeFormatPicker from '~/components/youtube/YoutubeFormatPicker.vue'
import { flush } from './helpers/api'

describe('YoutubeFormatPicker', () => {
  it('abre el menú con el elegido enfocado, marca la opción y emite select; Escape lo cierra', async () => {
    const wrapper = await mountSuspended(YoutubeFormatPicker, { props: { modelValue: 'mp3' }, attachTo: document.body })
    const trigger = wrapper.get('button[aria-haspopup="menu"]')
    expect(trigger.text()).toContain('Descargar')
    await trigger.trigger('click')
    await flush()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const options = wrapper.findAll('[role="menuitemradio"]')
    expect(options.map(o => o.text().trim())).toEqual(['Video 720p', 'Video 1080p', 'Audio MP3'])
    expect(options[2]!.attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(options[2]!.element)
    await options[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['mp4_720']])
    expect(wrapper.emitted('update:modelValue')).toEqual([['mp4_720']])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)

    await trigger.trigger('click')
    await wrapper.get('.dropdown').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con `formats` solo ofrece esas opciones (Guardar en el drive: audio o video 720p)', async () => {
    const wrapper = await mountSuspended(YoutubeFormatPicker, { props: { label: 'Guardar en el drive', formats: ['mp4_720', 'mp3'] } })
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')
    expect(wrapper.findAll('[role="menuitemradio"]').map(o => o.text().trim())).toEqual(['Video 720p', 'Audio MP3'])
  })

  it('solo icono: nombre accesible del label, menú alineado a la derecha; con alturas < 1080 avisa en esa opción', async () => {
    const wrapper = await mountSuspended(YoutubeFormatPicker, { props: { label: 'Descargar Domingo', iconOnly: true, heights: [240, 480] } })
    const trigger = wrapper.get('button[aria-label="Descargar Domingo"]')
    expect(trigger.classes()).toContain('btn-circle')
    expect(wrapper.get('.dropdown').classes()).toContain('dropdown-end')
    await trigger.trigger('click')
    const hd = wrapper.findAll('[role="menuitemradio"]')[1]!
    expect(hd.attributes('aria-describedby')).toBeTruthy()
    expect(hd.text()).toContain('se entregará la mayor calidad disponible')
    expect(wrapper.get('[role="menu"]').classes()).toContain('w-56')
  })

  it('en línea (dentro de listas con desplazamiento) y hacia arriba; deshabilitado no abre', async () => {
    const inline = await mountSuspended(YoutubeFormatPicker, { props: { inline: true, primary: false } })
    await inline.get('button').trigger('click')
    expect(inline.get('[role="menu"]').classes()).toContain('static!')
    expect(inline.get('.dropdown').classes()).toContain('w-full')
    expect(inline.get('button').classes()).not.toContain('btn-primary')

    const top = await mountSuspended(YoutubeFormatPicker, { props: { top: true, block: true } })
    expect(top.get('.dropdown').classes()).toEqual(expect.arrayContaining(['dropdown-top', 'dropdown-end']))

    const disabled = await mountSuspended(YoutubeFormatPicker, { props: { disabled: true } })
    expect(disabled.get('button').attributes('disabled')).toBeDefined()
  })
})
