// Validadores puros y tipados compartidos por cliente y servidor (research R11). Mensajes en español.

export type Result<T> = { ok: true, data: T } | { ok: false, errors: Record<string, string> }
export type Validator<T> = (input: unknown) => Result<T>

export type FieldResult<T> = { ok: true, value: T } | { ok: false, error: string }
export type Field<T> = (input: unknown) => FieldResult<T>

// Textos y límites que también usan las reglas de Regle de los formularios (`app/regle-config.ts`).
export const REQUIRED_MESSAGE = 'Este campo es obligatorio'
export const minMessage = (n: number) => `Debe tener al menos ${n} caracteres`
export const maxMessage = (n: number) => `Debe tener como máximo ${n} caracteres`
export const EMAIL_MESSAGE = 'Escribe un correo electrónico válido'
export const PASSWORD_MISMATCH_MESSAGE = 'Las contraseñas no coinciden'
// Suficiente para la UI; Neon Auth hace la validación definitiva.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EMAIL_MAX = 254

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (error: string): FieldResult<never> => ({ ok: false, error })
const pass = <T>(value: T): FieldResult<T> => ({ ok: true, value })

export interface StrOptions {
  min?: number
  max?: number
  trim?: boolean
  pattern?: RegExp
  /** Mensaje si no cumple `pattern`. */
  message?: string
}

export function str({ min = 1, max, trim = true, pattern, message }: StrOptions = {}): Field<string> {
  return (input) => {
    if (typeof input !== 'string') return fail(REQUIRED_MESSAGE)
    const value = trim ? input.trim() : input
    if (value.length === 0 && min > 0) return fail(REQUIRED_MESSAGE)
    if (value.length < min) return fail(minMessage(min))
    if (max !== undefined && value.length > max) return fail(maxMessage(max))
    if (pattern && !pattern.test(value)) return fail(message ?? 'Formato no válido')
    return pass(value)
  }
}

/** Correo válido, normalizado a minúsculas. */
export function email(): Field<string> {
  return (input) => {
    if (typeof input !== 'string' || input.trim() === '') return fail(REQUIRED_MESSAGE)
    const value = input.trim().toLowerCase()
    if (value.length > EMAIL_MAX || !EMAIL_RE.test(value)) return fail(EMAIL_MESSAGE)
    return pass(value)
  }
}

export function oneOf<const T extends readonly string[]>(values: T, message = 'Valor no permitido'): Field<T[number]> {
  return input => (typeof input === 'string' && (values as readonly string[]).includes(input))
    ? pass(input as T[number])
    : fail(message)
}

export function uuid(message = 'Identificador no válido'): Field<string> {
  return input => (typeof input === 'string' && UUID_RE.test(input)) ? pass(input.toLowerCase()) : fail(message)
}

export function int({ min, max, message }: { min?: number, max?: number, message?: string } = {}): Field<number> {
  return (input) => {
    const value = typeof input === 'string' && input.trim() !== '' ? Number(input) : input
    if (typeof value !== 'number' || !Number.isInteger(value)) return fail(message ?? 'Debe ser un número entero')
    if (min !== undefined && value < min) return fail(message ?? `Debe ser al menos ${min}`)
    if (max !== undefined && value > max) return fail(message ?? `Debe ser como máximo ${max}`)
    return pass(value)
  }
}

export function bool(): Field<boolean> {
  return (input) => {
    if (typeof input === 'boolean') return pass(input)
    if (input === 'true' || input === '1') return pass(true)
    if (input === 'false' || input === '0') return pass(false)
    return fail('Debe ser verdadero o falso')
  }
}

/** `undefined`, `null` o '' pasan como `undefined`. */
export function optional<T>(field: Field<T>): Field<T | undefined> {
  return input => (input === undefined || input === null || input === '') ? pass(undefined) : field(input)
}

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/

/** Cursor `since` opcional de los sondeos: fecha ISO 8601 en UTC (`toISOString()`). */
export function isoSince(): Field<string | undefined> {
  const field = str({ max: 40, pattern: ISO_UTC_RE, message: 'Fecha no válida' })
  return optional((input) => {
    const res = field(input)
    return res.ok && Number.isNaN(Date.parse(res.value)) ? fail('Fecha no válida') : res
  })
}

/** `null` o `undefined` pasan como `null` (p. ej. la carpeta raíz). */
export function nullable<T>(field: Field<T>): Field<T | null> {
  return input => (input === undefined || input === null) ? pass(null) : field(input)
}

export function array<T>(field: Field<T>, { min = 0, max, label = 'elementos' }: { min?: number, max?: number, label?: string } = {}): Field<T[]> {
  return (input) => {
    if (!Array.isArray(input)) return fail(REQUIRED_MESSAGE)
    if (input.length < min) return fail(`Agrega al menos ${min} ${label}`)
    if (max !== undefined && input.length > max) return fail(`Puedes agregar como máximo ${max} ${label}`)
    const values: T[] = []
    for (const [index, item] of input.entries()) {
      const res = field(item)
      if (!res.ok) return fail(`${index + 1}: ${res.error}`)
      values.push(res.value)
    }
    return pass(values)
  }
}

type Schema = Record<string, Field<unknown>>
type Shape<S extends Schema> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never }

/**
 * Valida un objeto campo por campo. `refine` agrega reglas entre campos (p. ej. confirmar contraseña);
 * recibe la entrada cruda para poder avisar aunque otro campo sea inválido. Sus errores no
 * reemplazan los de cada campo.
 */
export function object<S extends Schema>(
  schema: S,
  refine?: (raw: Record<string, unknown>) => Record<string, string> | null,
): Validator<Shape<S>> {
  return (input) => {
    const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    const errors: Record<string, string> = {}
    for (const [name, field] of Object.entries(schema)) {
      const res = field(source[name])
      if (res.ok) data[name] = res.value
      else errors[name] = res.error
    }
    for (const [name, message] of Object.entries(refine?.(source) ?? {})) {
      errors[name] ??= message
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors }
    return { ok: true, data: data as Shape<S> }
  }
}

/** Regla `refine` para confirmar un campo (p. ej. contraseña) contra otro. */
export function sameAs(field: string, confirmField: string, message = PASSWORD_MISMATCH_MESSAGE) {
  return (raw: Record<string, unknown>) =>
    (raw[confirmField] ?? '') !== '' && raw[field] !== raw[confirmField] ? { [confirmField]: message } : null
}

