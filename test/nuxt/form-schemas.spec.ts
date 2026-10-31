// Paridad entre los esquemas zod de los formularios (`app/utils/form-schemas.ts`) y los validadores del
// servidor (`shared/validation/*`): mismas muestras, mismo veredicto y mismo mensaje en español. También
// comprueba la configuración de `useFormSchema` (errores solo al salir del campo o al enviar).
import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import * as z from 'zod/mini'
import { useNuxtApp } from '#imports'
import type { Validator } from '#shared/validation/core'
import { changePasswordInput, forgotInput, loginInput, profileNameInput, registerInput, resetInput } from '#shared/validation/auth'
import { commentInput } from '#shared/validation/comments'
import { object } from '#shared/validation/core'
import { fileName, folderName } from '#shared/validation/files'
import { imageTextEditInput } from '#shared/validation/image-text'
import { note, senderName } from '#shared/validation/submissions'
import { useFormSchema } from '~/utils/form-schema'
import {
  accessRequestSchema,
  changePasswordSchema,
  commentSchema,
  externalErrorsFrom,
  fileNameSchema,
  folderNameSchema,
  forgotSchema,
  guestSubmissionSchema,
  imageTextSchema,
  loginSchema,
  noteSchema,
  profileNameSchema,
  registerSchema,
  resetSchema,
} from '~/utils/form-schemas'
import { failWith, mockApi } from './helpers/api'

type State = Record<string, string>
type Errors = Record<string, string>

/** Primer error de cada campo según Regle sobre el esquema, tras `$validate()` (marca todos los campos). */
async function schemaErrors(state: State, schema: z.ZodMiniType<unknown, unknown>): Promise<Errors> {
  const scope = effectScope()
  const { r$ } = useNuxtApp().vueApp.runWithContext(() => scope.run(() => useFormSchema(state as never, schema as never))!)
  await r$.$validate()
  const errors = Object.fromEntries(Object.entries(r$.$errors as unknown as Record<string, string[]>)
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

// La autoridad es el servidor; cada caso compara el resultado del esquema con el suyo.
interface Case {
  name: string
  validator: Validator<unknown>
  schema: z.ZodMiniType<unknown, unknown>
  samples: State[]
}

const register = (changes: State = {}): State => ({ name: 'Ana', email: 'ana@iglesia.org', password: '12345678', confirm: '12345678', ...changes })
const change = (changes: State = {}): State => ({ currentPassword: 'vieja', password: '12345678', confirm: '12345678', ...changes })
const reset = (changes: State = {}): State => ({ password: '12345678', confirm: '12345678', ...changes })

const cases: Case[] = [
  {
    name: 'registro',
    validator: registerInput,
    schema: registerSchema,
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
    schema: loginSchema,
    samples: [{ email: 'ana@iglesia.org', password: 'x' }, { email: '', password: '' }, { email: 'no-es-correo', password: 'x' }],
  },
  {
    name: 'recuperar contraseña',
    validator: forgotInput,
    schema: forgotSchema,
    samples: [{ email: 'ANA@iglesia.org' }, { email: '   ' }, { email: email(255) }],
  },
  {
    name: 'restablecer contraseña',
    validator: resetInput,
    schema: resetSchema,
    samples: [reset(), reset({ password: L(7) }), reset({ confirm: 'otra' }), reset({ password: '', confirm: '' })],
  },
  {
    name: 'cambiar contraseña',
    validator: changePasswordInput,
    schema: changePasswordSchema,
    samples: [change(), change({ currentPassword: '' }), change({ password: L(129), confirm: L(129) }), change({ confirm: '1234567' })],
  },
  {
    name: 'nombre visible',
    validator: profileNameInput,
    schema: profileNameSchema,
    samples: [{ name: 'Ana' }, { name: '' }, { name: pad(L(80)) }, { name: L(81) }],
  },
  {
    name: 'nombre de carpeta',
    validator: object({ name: folderName() }),
    schema: folderNameSchema,
    samples: [{ name: 'Domingo' }, { name: ' ' }, { name: pad(L(120)) }, { name: L(121) }, { name: 'a/b' }, { name: 'a:b' }, { name: 'tab\there' }, { name: `${L(121)}/` }],
  },
  {
    name: 'nombre de archivo',
    validator: object({ name: fileName() }),
    schema: fileNameSchema,
    samples: [{ name: 'foto' }, { name: '' }, { name: L(200) }, { name: L(201) }, { name: 'a*b?' }, { name: 'a"b<c>|' }],
  },
  {
    name: 'comentario',
    validator: commentInput,
    schema: commentSchema,
    samples: [{ body: 'Hola' }, { body: '\n  ' }, { body: pad(L(2000)) }, { body: L(2001) }],
  },
  {
    name: 'texto de la imagen',
    validator: imageTextEditInput,
    schema: imageTextSchema,
    samples: [{ text: 'Oremos' }, { text: '' }, { text: L(10_000) }, { text: L(10_001) }],
  },
  {
    name: 'nombre del invitado',
    validator: object({ name: senderName() }),
    schema: accessRequestSchema,
    samples: [{ name: 'Eva' }, { name: '  ' }, { name: pad(L(80)) }, { name: L(81) }],
  },
  {
    name: 'nota del envío (opcional)',
    validator: object({ note: note() }),
    schema: z.object({ note: noteSchema }),
    samples: [{ note: '' }, { note: '   ' }, { note: pad(L(500)) }, { note: L(501) }],
  },
]

describe('paridad de esquemas cliente/servidor', () => {
  for (const { name, validator, schema, samples } of cases) {
    it(name, async () => {
      for (const sample of samples) {
        expect(await schemaErrors({ ...sample }, schema), JSON.stringify(sample).slice(0, 120)).toEqual(serverErrors(validator, sample))
      }
    })
  }

  it('diferencia conocida: una contraseña hecha solo de espacios la rechaza el cliente (el servidor no la recorta)', async () => {
    const sample = { email: 'ana@iglesia.org', password: '   ' }
    expect(serverErrors(loginInput, sample)).toEqual({})
    expect(await schemaErrors(sample, loginSchema)).toEqual({ password: 'Este campo es obligatorio' })
  })
})

describe('useFormSchema', () => {
  const field = z.object({ name: z.string().check(z.refine(value => value.length > 0, { error: 'Este campo es obligatorio' })) })

  it('no marca errores mientras se escribe (autoDirty: false) y sí al salir del campo', () => {
    const scope = effectScope()
    const { r$ } = useNuxtApp().vueApp.runWithContext(() => scope.run(() => useFormSchema({ name: '' }, field))!)
    r$.$value.name = 'a'
    r$.$value.name = ''
    expect(r$.name.$dirty).toBe(false)
    expect(r$.$errors.name).toEqual([])
    r$.name.$touch()
    expect(r$.$errors.name).toEqual(['Este campo es obligatorio'])
    scope.stop()
  })

  it('el nombre del invitado solo es obligatorio cuando no viene fijo de la solicitud aprobada', async () => {
    expect(await schemaErrors({ name: '', note: '' }, guestSubmissionSchema(false))).toEqual({ name: 'Este campo es obligatorio' })
    expect(await schemaErrors({ name: '', note: '' }, guestSubmissionSchema(true))).toEqual({})
    expect(await schemaErrors({ name: 'Eva', note: 'x'.repeat(501) }, guestSubmissionSchema(true))).toEqual({ note: 'Debe tener como máximo 500 caracteres' })
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
