// Diálogo de generación de Peticiones (feature 007, enmienda de 2026-11-13): aquí se escribe el texto de cada petición
// elegida, agrupado por imagen. El texto no se guarda en ningún lado: viaja con la generación.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerComposeDialog from '~/components/prayers/PrayerComposeDialog.vue'
import { buttonsWithText } from './helpers/api'
import { chosen } from './prayer-fixtures'

const mount = (groups: ReturnType<typeof chosen>[][]) =>
  mountSuspended(PrayerComposeDialog, { props: { groups }, attachTo: document.body })

const generate = (wrapper: Awaited<ReturnType<typeof mount>>) => buttonsWithText(wrapper, 'Generar imágenes')[0]!

describe('PrayerComposeDialog', () => {
  it('cada campo lleva una etiqueta asociada con el nombre de quien envió, su foto y su nota', async () => {
    const wrapper = await mount([[chosen(1, ''), { ...chosen(2, ''), request: { ...chosen(2).request, note: 'para el domingo' } }]])
    const areas = wrapper.findAll('textarea')
    expect(areas).toHaveLength(2)
    for (const area of areas) {
      const id = area.attributes('id')!
      expect(wrapper.get(`label[for="${id}"]`).text()).toMatch(/Invitado \d/)
    }
    expect(wrapper.findAll('img').map(i => i.attributes('src'))).toEqual([chosen(1).request.previewUrl, chosen(2).request.previewUrl])
    expect(wrapper.text()).toContain('para el domingo')
    wrapper.unmount()
  })

  it('escribir emite text con el id y el valor; Quitar emite remove', async () => {
    const wrapper = await mount([[chosen(1, '')]])
    await wrapper.get('textarea').setValue('Oremos por Ana')
    expect(wrapper.emitted('text')).toEqual([[chosen(1).request.id, 'Oremos por Ana']])
    await wrapper.get('button[aria-label="Quitar la petición de Invitado 1"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[chosen(1).request.id]])
    wrapper.unmount()
  })

  it('el contador va de 0 al tope y avisa «Texto largo» pasando los 600 caracteres', async () => {
    const empty = await mount([[chosen(1, '')]])
    expect(empty.text()).toContain('0 / 10,000')
    expect(empty.text()).not.toContain('Texto largo')
    empty.unmount()

    const long = await mount([[chosen(1, 'a'.repeat(601))]])
    expect(long.text()).toContain('601 / 10,000')
    expect(long.text()).toContain('Texto largo: puede no caber')
    expect(generate(long).attributes('disabled')).toBeUndefined()
    long.unmount()
  })

  it('con todos los textos escritos Generar emite generate; en blanco no', async () => {
    const blank = await mount([[chosen(1, '   ')]])
    expect(blank.text()).toContain('Falta el texto de 1 petición')
    expect(generate(blank).attributes('disabled')).toBeDefined()
    blank.unmount()

    const ready = await mount([[chosen(1), chosen(2)], [chosen(3)]])
    expect(ready.text()).toContain('3 peticiones → 2 imágenes')
    expect(ready.text()).not.toContain('Falta el texto')
    await generate(ready).trigger('click')
    expect(ready.emitted('generate')).toHaveLength(1)
    expect(ready.emitted('close')).toHaveLength(1)
    ready.unmount()
  })

  it('ningún botón es btn-sm o btn-xs de base (objetivo táctil ≥ 44 px)', async () => {
    const wrapper = await mount([[chosen(1)]])
    for (const button of wrapper.findAll('button')) {
      expect(button.classes().some(c => /^btn-(sm|xs)$/.test(c)), button.text()).toBe(false)
    }
    wrapper.unmount()
  })
})
