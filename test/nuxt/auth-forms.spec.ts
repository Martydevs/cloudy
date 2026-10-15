import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import LoginPage from '~/pages/login.vue'
import RegistroPage from '~/pages/registro.vue'
import RestablecerPage from '~/pages/restablecer.vue'

function field(wrapper: VueWrapper, label: string) {
  const labelEl = wrapper.findAll('label').find(l => l.text().trim() === label)
  if (!labelEl) throw new Error(`No hay campo con la etiqueta "${label}"`)
  return wrapper.get(`#${labelEl.attributes('for')}`)
}

async function fillAndBlur(wrapper: VueWrapper, label: string, value: string) {
  const input = field(wrapper, label)
  await input.setValue(value)
  await input.trigger('blur')
}

function submitButton(wrapper: VueWrapper) {
  return wrapper.get('button[type="submit"]')
}

describe('formulario de registro', () => {
  it('muestra errores en línea y deshabilita el envío', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    await fillAndBlur(wrapper, 'Correo electrónico', 'ana@')
    await fillAndBlur(wrapper, 'Contraseña', '1234')
    await fillAndBlur(wrapper, 'Confirmar contraseña', '9999')

    expect(wrapper.text()).toContain('Escribe un correo electrónico válido')
    expect(wrapper.text()).toContain('Debe tener al menos 8 caracteres')
    expect(field(wrapper, 'Correo electrónico').attributes('aria-invalid')).toBe('true')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('confirmación distinta', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    await fillAndBlur(wrapper, 'Nombre', 'Ana')
    await fillAndBlur(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    await fillAndBlur(wrapper, 'Contraseña', '12345678')
    await fillAndBlur(wrapper, 'Confirmar contraseña', '12345679')
    expect(wrapper.text()).toContain('Las contraseñas no coinciden')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await fillAndBlur(wrapper, 'Confirmar contraseña', '12345678')
    expect(wrapper.text()).not.toContain('Las contraseñas no coinciden')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('no muestra errores antes de que el usuario toque los campos', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    expect(wrapper.text()).not.toContain('Este campo es obligatorio')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('al enviar vacío marca todos los campos', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(4)
  })
})

describe('regresión: envío antes de hidratar', () => {
  it('el formulario nunca se envía por GET (la contraseña no puede acabar en la URL)', async () => {
    for (const page of [RegistroPage, LoginPage]) {
      const wrapper = await mountSuspended(page)
      expect(wrapper.get('form').attributes('method')).toBe('post')
    }
  })

  it('el botón de envío se habilita al montarse la app', async () => {
    const wrapper = await mountSuspended(LoginPage)
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})

describe('formulario de inicio de sesión', () => {
  it('valida el correo en línea', async () => {
    const wrapper = await mountSuspended(LoginPage)
    await fillAndBlur(wrapper, 'Correo electrónico', 'no-es-correo')
    expect(wrapper.text()).toContain('Escribe un correo electrónico válido')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('formulario de restablecer contraseña', () => {
  it('exige mínimo 8 caracteres y confirmación igual', async () => {
    const wrapper = await mountSuspended(RestablecerPage, { route: '/restablecer?token=abc' })
    await fillAndBlur(wrapper, 'Nueva contraseña', '123')
    await fillAndBlur(wrapper, 'Confirmar contraseña', '456')
    expect(wrapper.text()).toContain('Debe tener al menos 8 caracteres')
    expect(wrapper.text()).toContain('Las contraseñas no coinciden')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })
})
