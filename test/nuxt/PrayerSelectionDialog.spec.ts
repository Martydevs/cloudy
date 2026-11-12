// T030 — «Ver elegidas» de Peticiones (feature 007).
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerSelectionDialog from '~/components/prayers/PrayerSelectionDialog.vue'
import { buttonsWithText } from './helpers/api'
import { prayer } from './prayer-fixtures'

describe('PrayerSelectionDialog', () => {
  const items = [prayer(1, { senderName: 'Ana' }), prayer(2, { senderName: 'Luis' })]

  it('es un modal abajo en móvil y al centro desde sm, con las elegidas', async () => {
    const wrapper = await mountSuspended(PrayerSelectionDialog, { props: { items }, attachTo: document.body })
    const dialog = wrapper.get('dialog')
    expect(dialog.classes()).toEqual(expect.arrayContaining(['modal', 'modal-bottom', 'sm:modal-middle']))
    expect(dialog.text()).toContain('2 peticiones elegidas')
    expect(dialog.text()).toContain('Ana')
    expect(dialog.text()).toContain('Luis')
    wrapper.unmount()
  })

  it('Quitar emite remove con el id', async () => {
    const wrapper = await mountSuspended(PrayerSelectionDialog, { props: { items }, attachTo: document.body })
    await wrapper.get('button[aria-label="Quitar la petición de Luis"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[prayer(2).id]])
    wrapper.unmount()
  })

  it('cierra con Escape y con su botón', async () => {
    const wrapper = await mountSuspended(PrayerSelectionDialog, { props: { items }, attachTo: document.body })
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await buttonsWithText(wrapper, 'Cerrar')[0]!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
