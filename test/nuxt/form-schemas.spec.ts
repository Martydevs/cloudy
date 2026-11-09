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
import { parseYoutubeUrl, playlistName, YOUTUBE_URL_MESSAGES } from '#shared/validation/youtube'
import { SONG_URL_MESSAGES } from '#shared/constants/songs'
import { parseLetrasUrl, songCollectionName } from '#shared/validation/songs'
import { useFormSchema } from '~/utils/form-schema'
import {
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
  songCollectionSchema,
  songUrlSchema,
  youtubePlaylistSchema,
  youtubeUrlSchema,
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
      // Un campo vacío no debe ocultar que la confirmación no coincide.
      register({ name: '', confirm: '12345679' }),
      register({ email: '', confirm: '12345679' }),
      register({ name: '', email: 'ana@', confirm: '12345679' }),
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
    samples: [reset(), reset({ password: L(7) }), reset({ confirm: 'otra' }), reset({ password: '', confirm: '' }), reset({ password: '', confirm: 'otra' })],
  },
  {
    name: 'cambiar contraseña',
    validator: changePasswordInput,
    schema: changePasswordSchema,
    samples: [change(), change({ currentPassword: '' }), change({ password: L(129), confirm: L(129) }), change({ confirm: '1234567' }), change({ currentPassword: '', confirm: '1234567' })],
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
    name: 'envío del invitado',
    validator: object({ name: senderName(), note: note() }),
    schema: guestSubmissionSchema,
    samples: [
      { name: 'Eva', note: '' }, { name: '  ', note: '' }, { name: pad(L(80)), note: L(500) }, { name: L(81), note: '' },
      { name: 'Eva', note: L(501) },
    ],
  },
  {
    name: 'nombre de lista de YouTube',
    validator: object({ name: playlistName() }),
    schema: youtubePlaylistSchema,
    samples: [{ name: 'Domingo' }, { name: '' }, { name: '   ' }, { name: pad(L(80)) }, { name: L(81) }],
  },
  {
    name: 'nombre de colección de canciones',
    validator: object({ name: songCollectionName() }),
    schema: songCollectionSchema,
    samples: [{ name: 'Domingo' }, { name: '' }, { name: '   ' }, { name: pad(L(80)) }, { name: L(81) }],
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

describe('enlace de YouTube (youtubeUrlSchema ↔ parseYoutubeUrl)', () => {
  const ID = 'dQw4w9WgXcQ'
  const samples = [
    `https://www.youtube.com/watch?v=${ID}&t=30s&list=PL1`,
    `https://youtu.be/${ID}?t=5`,
    `youtube.com/shorts/${ID}`,
    `  https://www.youtube-nocookie.com/embed/${ID}  `,
    '',
    '   ',
    'hola',
    ID,
    'https://vimeo.com/123',
    'https://evil-youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/@canal',
    'https://www.youtube.com/watch',
    'https://youtu.be/abc',
  ]

  it('acepta y rechaza lo mismo que la regla compartida, con el mensaje de cada motivo', async () => {
    for (const url of samples) {
      const res = parseYoutubeUrl(url)
      const expected = url.trim() === ''
        ? { url: 'Este campo es obligatorio' }
        : res.ok ? {} : { url: YOUTUBE_URL_MESSAGES[res.reason] }
      expect(await schemaErrors({ url }, youtubeUrlSchema), url).toEqual(expected)
    }
  })

  it('los mensajes dicen qué hacer', async () => {
    expect(await schemaErrors({ url: 'hola' }, youtubeUrlSchema)).toEqual({ url: 'Pega un enlace completo, por ejemplo https://youtu.be/…' })
    expect(await schemaErrors({ url: 'https://www.youtube.com/playlist?list=PL1' }, youtubeUrlSchema)).toEqual({ url: 'Ese enlace es de una lista de YouTube. Pega el de un video.' })
    expect(await schemaErrors({ url: 'https://vimeo.com/1' }, youtubeUrlSchema)).toEqual({ url: 'Solo aceptamos enlaces de YouTube' })
  })
})

describe('enlace de Letras.com (songUrlSchema ↔ parseLetrasUrl)', () => {
  const samples = [
    'https://www.letras.com/musiko/de-buenas-part-josh-gamez/',
    'https://letras.com/musiko/de-buenas-part-josh-gamez?utm_source=x',
    '  https://www.letras.com/musiko/de-buenas-part-josh-gamez/#letra  ',
    '',
    '   ',
    'hola',
    'http://www.letras.com/a/b/',
    'www.letras.com/a/b/',
    'https://example.com/a/b',
    'https://letras.com.otro.test/a/b/',
    'https://letras.com@otro.test/a/b/',
    'https://user:pass@letras.com/a/b/',
    'https://letras.com:8443/a/b/',
    'https://www.letras.com/musiko/',
    'https://www.letras.com/a/b/c/',
  ]

  it('acepta y rechaza lo mismo que la regla compartida, con el mensaje de cada motivo', async () => {
    for (const url of samples) {
      const res = parseLetrasUrl(url)
      const expected = url.trim() === ''
        ? { url: 'Este campo es obligatorio' }
        : res.ok ? {} : { url: SONG_URL_MESSAGES[res.reason] }
      expect(await schemaErrors({ url }, songUrlSchema), url).toEqual(expected)
    }
  })

  it('los mensajes dicen qué hacer', async () => {
    expect(await schemaErrors({ url: 'https://www.letras.com/musiko/' }, songUrlSchema)).toEqual({ url: 'Ese enlace no es de una canción. Abre la canción en Letras.com y copia su enlace.' })
    expect(await schemaErrors({ url: 'https://example.com/a/b' }, songUrlSchema)).toEqual({ url: 'Solo aceptamos enlaces de Letras.com (letras.com o www.letras.com).' })
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

  it('el nombre del invitado siempre es obligatorio y la nota opcional (envío de un solo paso)', async () => {
    expect(await schemaErrors({ name: '', note: '' }, guestSubmissionSchema)).toEqual({ name: 'Este campo es obligatorio' })
    expect(await schemaErrors({ name: 'Eva', note: '' }, guestSubmissionSchema)).toEqual({})
    expect(await schemaErrors({ name: 'Eva', note: 'x'.repeat(501) }, guestSubmissionSchema)).toEqual({ note: 'Debe tener como máximo 500 caracteres' })
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
