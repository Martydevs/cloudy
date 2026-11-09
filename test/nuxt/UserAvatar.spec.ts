// Avatar con la inicial de una persona: lo comparten el menú de cuenta del lateral y la tarjeta «Cuenta» de Mi perfil.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import UserAvatar from '~/components/users/UserAvatar.vue'

describe('UserAvatar', () => {
  it.each([
    ['Ana', 'A'],
    ['  luis pérez', 'L'],
    ['émile', 'É'],
    ['9 de la mañana', '9'],
  ])('«%s» muestra su inicial en mayúscula: %s', async (name, initial) => {
    const wrapper = await mountSuspended(UserAvatar, { props: { name } })
    expect(wrapper.text()).toBe(initial)
  })

  it.each([undefined, null, '', '   '])('sin nombre (%j) muestra «?»', async (name) => {
    const wrapper = await mountSuspended(UserAvatar, { props: { name } })
    expect(wrapper.text()).toBe('?')
  })

  it('es un círculo decorativo con los colores del tema: queda fuera del árbol de accesibilidad', async () => {
    const wrapper = await mountSuspended(UserAvatar, { props: { name: 'Ana' } })
    expect(wrapper.element.tagName).toBe('SPAN')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['rounded-full', 'bg-neutral', 'text-neutral-content']))
  })

  it.each([
    [undefined, ['size-9']],
    ['sm', ['size-9']],
    ['fill', ['size-full']],
    ['lg', ['size-20', 'text-3xl']],
  ] as const)('tamaño %s → %j', async (size, classes) => {
    const wrapper = await mountSuspended(UserAvatar, { props: { name: 'Ana', size } })
    expect(wrapper.classes()).toEqual(expect.arrayContaining([...classes]))
  })

  it('acepta clases de quien lo usa (p. ej. para centrarlo)', async () => {
    const wrapper = await mountSuspended(UserAvatar, { props: { name: 'Ana', size: 'lg' }, attrs: { class: 'self-center' } })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['self-center', 'size-20']))
  })
})
