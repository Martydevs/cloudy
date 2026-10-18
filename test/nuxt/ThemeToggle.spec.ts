import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ThemeToggle from '~/components/app/ThemeToggle.vue'

describe('ThemeToggle', () => {
  it('parte del tema oscuro y alterna al claro y de vuelta', async () => {
    const wrapper = await mountSuspended(ThemeToggle)
    const button = wrapper.get('button')

    expect(useTheme().theme.value).toBe('cloudy')
    expect(button.attributes('aria-label')).toBe('Cambiar a tema claro')
    expect(button.attributes('aria-pressed')).toBe('false')

    await button.trigger('click')
    expect(useTheme().theme.value).toBe('cloudy-light')
    expect(useCookie('cloudy-theme').value).toBe('cloudy-light')
    expect(button.attributes('aria-label')).toBe('Cambiar a tema oscuro')
    expect(button.attributes('aria-pressed')).toBe('true')

    await button.trigger('click')
    expect(useTheme().theme.value).toBe('cloudy')
    expect(button.attributes('aria-label')).toBe('Cambiar a tema claro')
  })

  it('la variante con texto (menú de cuenta) muestra la etiqueta y también alterna', async () => {
    useTheme().set('cloudy')
    const wrapper = await mountSuspended(ThemeToggle, { props: { withLabel: true } })
    const button = wrapper.get('button')
    expect(button.text()).toBe('Cambiar a tema claro')
    expect(button.classes()).not.toContain('btn-square')
    await button.trigger('click')
    expect(useTheme().theme.value).toBe('cloudy-light')
    expect(button.text()).toBe('Cambiar a tema oscuro')
    expect(button.attributes('aria-pressed')).toBe('true')
    useTheme().set('cloudy')
  })

  it('una cookie con un valor desconocido vuelve al tema oscuro', () => {
    clearNuxtState('theme')
    useCookie<string>('cloudy-theme').value = 'rosa'
    expect(useTheme().theme.value).toBe('cloudy')
    useTheme().set('cloudy')
  })
})
