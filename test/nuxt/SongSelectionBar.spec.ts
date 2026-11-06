// T066 — Barra de la selección del historial de Canciones (feature 006): conteo, archivos, Generar selección, Limpiar y que se
// apoye sobre las bandejas.
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
})
