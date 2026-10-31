// Paridad entre las reglas de Regle de los formularios (`app/utils/form-rules.ts`) y los validadores del
// servidor (`shared/validation/*`): mismas muestras, mismo veredicto y mismo mensaje en español. También
// comprueba que el `useRegle` auto-importado lleva la configuración global (`app/regle-config.ts`).
import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { maxLength, minLength, required, sameAs } from '@regle/rules'
import type { RegleComputedRules } from '@regle/core'
import { useNuxtApp, useRegle } from '#imports'
import type { Validator } from '#shared/validation/core'
import { changePasswordInput, forgotInput, loginInput, profileNameInput, registerInput, resetInput } from '#shared/validation/auth'
import { commentInput } from '#shared/validation/comments'
import { object } from '#shared/validation/core'
import { fileName, folderName } from '#shared/validation/files'
import { imageTextEditInput } from '#shared/validation/image-text'
import { note, senderName } from '#shared/validation/submissions'
import {
  changePasswordRules,
  commentRules,
  externalErrorsFrom,
  fileNameRules,
  folderNameRules,
  forgotRules,
  imageTextRules,
  loginRules,
  noteRules,
  profileNameRules,
  registerRules,
  resetRules,
  senderNameRules,
} from '~/utils/form-rules'
import { failWith, mockApi } from './helpers/api'

type State = Record<string, string>
type Errors = Record<string, string>

/** Primer error de cada campo según Regle, tras `$validate()` (marca todos los campos). */
async function regleErrors(state: State, rules: (state: State) => RegleComputedRules<State>): Promise<Errors> {
  const scope = effectScope()
  const { r$ } = useNuxtApp().vueApp.runWithContext(() => scope.run(() => useRegle(state, () => rules(state)))!)
  await r$.$validate()
  const errors = Object.fromEntries(Object.entries(r$.$errors as Record<string, string[]>)
    .filter(([, list]) => list.length > 0)
    .map(([field, list]) => [field, list[0]!]))
  scope.stop()
  return errors
}

function serverErrors(validator: Validator<unknown>, state: State): Errors {
  const res = validator(state)
  return res.ok ? {} : res.errors
}

const L = (n: number) => 'a'.repeat(n)
const pad = (s: string) => `  ${s}  `
const email = (length: number) => `${L(length - '@iglesia.org'.length)}@iglesia.org`

// La autoridad es el servidor; cada caso compara el resultado de Regle con el suyo.
interface Case {
  name: string
  validator: Validator<unknown>
  rules: (state: State) => RegleComputedRules<State>
  samples: State[]
}

const register = (changes: State = {}): State => ({ name: 'Ana', email: 'ana@iglesia.org', password: '12345678', confirm: '12345678', ...changes })
const change = (changes: State = {}): State => ({ currentPassword: 'vieja', password: '12345678', confirm: '12345678', ...changes })
const reset = (changes: State = {}): State => ({ password: '12345678', confirm: '12345678', ...changes })

const cases: Case[] = [
  {
    name: 'registro',
    validator: registerInput,
    rules: registerRules as Case['rules'],
    samples: [
      register(),
      { name: '', email: '', password: '', confirm: '' },
      register({ name: '   ' }),
      register({ name: pad(L(80)) }),
      register({ name: L(81) }),
      register({ email: 'ana@' }),
      register({ email: 'ana @iglesia.org' }),
      register({ email: pad(email(254)) }),
      register({ email: email(255) }),
      register({ password: L(7), confirm: L(7) }),
      register({ password: L(128), confirm: L(128) }),
      register({ password: L(129), confirm: L(129) }),
      register({ password: ` ${L(7)}`, confirm: ` ${L(7)}` }),
      register({ confirm: '12345679' }),
      register({ confirm: '' }),
      register({ password: '1234', confirm: '9999' }),
    ],
  },
  {
    name: 'inicio de sesión',
    validator: loginInput,
    rules: loginRules as Case['rules'],
    samples: [{ email: 'ana@iglesia.org', password: 'x' }, { email: '', password: '' }, { email: 'no-es-correo', password: 'x' }],
  },
  {
    name: 'recuperar contraseña',
    validator: forgotInput,
    rules: forgotRules as Case['rules'],
    samples: [{ email: 'ANA@iglesia.org' }, { email: '   ' }, { email: email(255) }],
  },
  {
    name: 'restablecer contraseña',
    validator: resetInput,
    rules: resetRules as Case['rules'],
    samples: [reset(), reset({ password: L(7) }), reset({ confirm: 'otra' }), reset({ password: '', confirm: '' })],
  },
  {
    name: 'cambiar contraseña',
    validator: changePasswordInput,
    rules: changePasswordRules as Case['rules'],
    samples: [change(), change({ currentPassword: '' }), change({ password: L(129), confirm: L(129) }), change({ confirm: '1234567' })],
  },
  {
    name: 'nombre visible',
    validator: profileNameInput,
    rules: profileNameRules as Case['rules'],
    samples: [{ name: 'Ana' }, { name: '' }, { name: pad(L(80)) }, { name: L(81) }],
  },
  {
    name: 'nombre de carpeta',
    validator: object({ name: folderName() }),
    rules: folderNameRules,
    samples: [{ name: 'Domingo' }, { name: ' ' }, { name: pad(L(120)) }, { name: L(121) }, { name: 'a/b' }, { name: 'a:b' }, { name: 'tab\there' }, { name: `${L(121)}/` }],
  },
  {
    name: 'nombre de archivo',
    validator: object({ name: fileName() }),
    rules: fileNameRules,
    samples: [{ name: 'foto' }, { name: '' }, { name: L(200) }, { name: L(201) }, { name: 'a*b?' }, { name: 'a"b<c>|' }],
  },
  {
    name: 'comentario',
    validator: commentInput,
    rules: commentRules,
    samples: [{ body: 'Hola' }, { body: '\n  ' }, { body: pad(L(2000)) }, { body: L(2001) }],
  },
  {
    name: 'texto de la imagen',
    validator: imageTextEditInput,
    rules: imageTextRules,
    samples: [{ text: 'Oremos' }, { text: '' }, { text: L(10_000) }, { text: L(10_001) }],
  },
  {
    name: 'nombre del invitado',
    validator: object({ name: senderName() }),
    rules: () => ({ name: senderNameRules() }),
    samples: [{ name: 'Eva' }, { name: '  ' }, { name: pad(L(80)) }, { name: L(81) }],
  },
  {
    name: 'nota del envío (opcional)',
    validator: object({ note: note() }),
    rules: () => ({ note: noteRules() }),
    samples: [{ note: '' }, { note: '   ' }, { note: pad(L(500)) }, { note: L(501) }],
  },
]

describe('paridad de reglas cliente/servidor', () => {
  for (const { name, validator, rules, samples } of cases) {
    it(name, async () => {
      for (const sample of samples) {
        expect(await regleErrors({ ...sample }, rules), JSON.stringify(sample).slice(0, 120)).toEqual(serverErrors(validator, sample))
      }
    })
  }

  it('diferencia conocida: una contraseña hecha solo de espacios la rechaza el cliente (el servidor no la recorta)', async () => {
    const sample = { email: 'ana@iglesia.org', password: '   ' }
    expect(serverErrors(loginInput, sample)).toEqual({})
    expect(await regleErrors(sample, loginRules as Case['rules'])).toEqual({ password: 'Este campo es obligatorio' })
  })
})

describe('configuración global de Regle', () => {
  it('el useRegle auto-importado usa los mensajes en español', async () => {
    const errors = await regleErrors({ a: '', b: 'abc', c: 'abcdef', d: 'x' }, () => ({
      a: { required },
      b: { minLength: minLength(5) },
      c: { maxLength: maxLength(5) },
      d: { sameAs: sameAs(() => 'y') },
    }))
    expect(errors).toEqual({
      a: 'Este campo es obligatorio',
      b: 'Debe tener al menos 5 caracteres',
      c: 'Debe tener como máximo 5 caracteres',
      d: 'Las contraseñas no coinciden',
    })
  })

  it('no marca errores mientras se escribe (autoDirty: false)', () => {
    const scope = effectScope()
    const { r$ } = useNuxtApp().vueApp.runWithContext(() => scope.run(() => useRegle({ name: '' }, { name: { required } }))!)
    r$.$value.name = 'a'
    r$.$value.name = ''
    expect(r$.name.$dirty).toBe(false)
    expect(r$.$errors.name).toEqual([])
    r$.name.$touch()
    expect(r$.$errors.name).toEqual(['Este campo es obligatorio'])
    scope.stop()
  })
})

describe('externalErrorsFrom', () => {
  const fail = async (statusCode: number, data?: Record<string, unknown>) => {
    mockApi('POST', '/api/test/external-errors', failWith(statusCode, data))
    return $fetch('/api/test/external-errors', { method: 'POST' }).catch((error: unknown) => error)
  }

  it('convierte los errores de campo de un 422 al formato de Regle', async () => {
    expect(externalErrorsFrom(await fail(422, { errors: { body: 'Texto no permitido', name: 'Repetido' } })))
      .toEqual({ body: ['Texto no permitido'], name: ['Repetido'] })
  })

  it('devuelve vacío sin errores de campo, con otro estado o si no es un error de la API', async () => {
    expect(externalErrorsFrom(await fail(422))).toEqual({})
    expect(externalErrorsFrom(await fail(409, { errors: { body: 'x' } }))).toEqual({})
    expect(externalErrorsFrom(new Error('red'))).toEqual({})
  })
})
