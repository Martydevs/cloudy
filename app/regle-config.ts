// Configuración global de Regle (setupFile del módulo): mensajes en español, reglas propias y modificadores.
// Los textos y límites salen de `shared/validation`, los mismos que usan los validadores del servidor.
import { createRule, defineRegleConfig, type Maybe } from '@regle/core'
import { defineRegleNuxtPlugin } from '@regle/nuxt/setup'
import { isFilled, maxLength, minLength, required, sameAs, withMessage } from '@regle/rules'
import {
  EMAIL_MAX,
  EMAIL_MESSAGE,
  EMAIL_RE,
  PASSWORD_MISMATCH_MESSAGE,
  REQUIRED_MESSAGE,
  maxMessage,
  minMessage,
} from '#shared/validation/core'
import { FORBIDDEN_MESSAGE, NAME_PATTERN } from '#shared/validation/files'

/** Máximo de caracteres tras `trim`, como `str()` del servidor (`maxLength` no recorta). */
export const maxChars = createRule({
  type: 'maxChars',
  validator(value: Maybe<string>, max: number) {
    if (!isFilled(value)) return true
    return value.trim().length <= max
  },
  message: ({ $params: [max] }) => maxMessage(max),
})

/** Nombres de carpetas y archivos sin / \ : * ? " < > | ni caracteres de control. */
export const safeName = createRule({
  type: 'safeName',
  validator(value: Maybe<string>) {
    if (!isFilled(value)) return true
    return NAME_PATTERN.test(value.trim())
  },
  message: FORBIDDEN_MESSAGE,
})

/** Mismo criterio que `email()` del servidor (no el `email` de Regle, que usa otra expresión). */
export const validEmail = createRule({
  type: 'validEmail',
  validator(value: Maybe<string>) {
    if (!isFilled(value)) return true
    const email = value.trim()
    return email.length <= EMAIL_MAX && EMAIL_RE.test(email)
  },
  message: EMAIL_MESSAGE,
})

export default defineRegleNuxtPlugin(() => defineRegleConfig({
  rules: () => ({
    required: withMessage(required, REQUIRED_MESSAGE),
    minLength: withMessage(minLength, ({ $params: [min] }) => minMessage(min)),
    maxLength: withMessage(maxLength, ({ $params: [max] }) => maxMessage(max)),
    sameAs: withMessage(sameAs, PASSWORD_MISMATCH_MESSAGE),
    maxChars,
    safeName,
    validEmail,
  }),
  // Los errores aparecen al salir del campo ($touch) o al enviar ($validate), nunca mientras se escribe.
  modifiers: { autoDirty: false },
}))
