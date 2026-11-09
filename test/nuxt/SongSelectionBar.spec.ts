// T066 — Barra de la selección del historial de Canciones (feature 006): conteo, archivos, Generar selección, Limpiar y que se
// apoye sobre las bandejas; con 2 o 3 canciones, «Descargar en un .zip».
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SongSelectionBar from '~/components/songs/SongSelectionBar.vue'
import { buttonsWithText } from './helpers/api'

describe('SongSelectionBar', () => {
  it('muestra el conteo y los archivos; emite generate y clear', async () => {
    const wrapper = await mountSuspended(SongSelectionBar, { props: { count: 3 } })
    expect(wrapper.get('[role="status"]').text()).toContain('3 seleccionadas')
    expect(wrapper.text()).toContain('Recibirás 3 archivos, uno por canción.')
    await buttonsWithText(wrapper, 'Generar selección')[0]!.trigger('click')
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    expect(wrapper.emitted('generate')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('una sola canción en singular', async () => {
    const wrapper = await mountSuspended(SongSelectionBar, { props: { count: 1 } })
    expect(wrapper.text()).toContain('1 seleccionada')
    expect(wrapper.text()).toContain('Recibirás 1 archivo.')
  })

  it('se apoya sobre las bandejas de YouTube y de Canciones', async () => {
    const wrapper = await mountSuspended(SongSelectionBar, { props: { count: 2 } })
    expect(wrapper.get('[role="region"]').classes().join(' ')).toContain('bottom-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,0px))]')
  })

  it.each([[1, false], [2, true], [3, true], [4, false]])('con %i seleccionadas, «Descargar en un .zip» visible: %s', async (count, visible) => {
    const wrapper = await mountSuspended(SongSelectionBar, { props: { count } })
    expect(buttonsWithText(wrapper, 'Descargar en un .zip')).toHaveLength(visible ? 1 : 0)
  })

  it('«Descargar en un .zip» emite zip; con un lote en curso se deshabilita y «Generar selección» sigue', async () => {
    const wrapper = await mountSuspended(SongSelectionBar, { props: { count: 2 } })
    await buttonsWithText(wrapper, 'Descargar en un .zip')[0]!.trigger('click')
    expect(wrapper.emitted('zip')).toHaveLength(1)
    await wrapper.setProps({ busy: true })
    const zip = buttonsWithText(wrapper, 'Descargar en un .zip')[0]!
    expect(zip.attributes('disabled')).toBeDefined()
    expect(zip.find('.loading').exists()).toBe(true)
    await buttonsWithText(wrapper, 'Generar selección')[0]!.trigger('click')
    expect(wrapper.emitted('generate')).toHaveLength(1)
  })
})
