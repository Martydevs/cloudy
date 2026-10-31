import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import AuthForm from '~/components/auth/AuthForm.vue'
import { type FormRules, loginRules, registerRules } from '~/utils/form-rules'
import { flush } from './helpers/api'
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

// Fuera de una plantilla `mountSuspended` no infiere el genérico de AuthForm: se pasa como registro de textos.
const asFormRules = <S extends Record<string, string>>(rules: FormRules<S>) => rules as unknown as FormRules<Record<string, string>>

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

describe('AuthForm', () => {
  const loginFields = [
    { name: 'email', label: 'Correo electrónico', type: 'email' as const },
    { name: 'password', label: 'Contraseña', type: 'password' as const },
  ]

  it('no marca errores mientras se escribe, solo al salir del campo', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    const email = field(wrapper, 'Correo electrónico')
    await email.setValue('ana@')
    expect(wrapper.text()).not.toContain('Escribe un correo electrónico válido')
    expect(email.attributes('aria-invalid')).toBeUndefined()
    await email.trigger('blur')
    expect(wrapper.text()).toContain('Escribe un correo electrónico válido')
    expect(email.attributes('aria-describedby')).toBe(wrapper.get('p.text-error').attributes('id'))
  })

  it('al enviar con errores enfoca el primer campo inválido y no emite', async () => {
    const wrapper = await mountSuspended(AuthForm, {
      props: { legend: 'Crear cuenta', fields: [
        { name: 'name', label: 'Nombre' },
        { name: 'email', label: 'Correo electrónico', type: 'email' as const },
        { name: 'password', label: 'Contraseña', type: 'password' as const },
        { name: 'confirm', label: 'Confirmar contraseña', type: 'password' as const },
      ], rules: asFormRules(registerRules), submitLabel: 'Crear cuenta', initial: { name: 'Ana' } },
      attachTo: document.body,
    })
    await field(wrapper, 'Contraseña').setValue('12345678')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(document.activeElement).toBe(field(wrapper, 'Correo electrónico').element)
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('emite los datos como el servidor: recorta, correo en minúsculas y contraseña intacta', async () => {
    const wrapper = await mountSuspended(AuthForm, {
      props: { legend: 'Iniciar sesión', fields: loginFields, rules: asFormRules(loginRules), submitLabel: 'Entrar' },
    })
    await field(wrapper, 'Correo electrónico').setValue('  Ana@Iglesia.ORG ')
    await field(wrapper, 'Contraseña').setValue(' clave ')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.emitted('submit')).toEqual([[{ email: 'ana@iglesia.org', password: ' clave ' }]])
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
