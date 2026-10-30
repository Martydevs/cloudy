import { describe, expect, it } from 'vitest'
import { array, bool, email, int, nullable, object, oneOf, optional, sameAs, str, uuid } from '../../shared/validation/core'

describe('str', () => {
  it('recorta y valida los límites', () => {
    expect(str({ max: 5 })('  hola ')).toEqual({ ok: true, value: 'hola' })
    expect(str()('   ')).toEqual({ ok: false, error: 'Este campo es obligatorio' })
    expect(str({ min: 3 })('ab')).toEqual({ ok: false, error: 'Debe tener al menos 3 caracteres' })
    expect(str({ max: 3 })('abcd')).toEqual({ ok: false, error: 'Debe tener como máximo 3 caracteres' })
  })

  it('respeta trim: false y el patrón con mensaje propio', () => {
    expect(str({ trim: false })(' a ')).toEqual({ ok: true, value: ' a ' })
    expect(str({ pattern: /^\d+$/, message: 'Solo números' })('a1')).toEqual({ ok: false, error: 'Solo números' })
    expect(str({ pattern: /^\d+$/ })('a1')).toEqual({ ok: false, error: 'Formato no válido' })
  })

  it('rechaza lo que no es texto', () => {
    expect(str()(42).ok).toBe(false)
  })

  it('min: 0 permite vacío', () => {
    expect(str({ min: 0 })('')).toEqual({ ok: true, value: '' })
  })
})

describe('email', () => {
  it('normaliza a minúsculas', () => {
    expect(email()('  Ana@Iglesia.ORG ')).toEqual({ ok: true, value: 'ana@iglesia.org' })
  })
  it('rechaza formatos inválidos con mensaje en español', () => {
    expect(email()('ana@')).toEqual({ ok: false, error: 'Escribe un correo electrónico válido' })
    expect(email()('')).toEqual({ ok: false, error: 'Este campo es obligatorio' })
  })
})

describe('oneOf, uuid, int, bool', () => {
  it('oneOf', () => {
    expect(oneOf(['a', 'b'] as const)('a')).toEqual({ ok: true, value: 'a' })
    expect(oneOf(['a'] as const)('c').ok).toBe(false)
  })
  it('uuid', () => {
    expect(uuid()('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toEqual({ ok: true, value: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
    expect(uuid()('root')).toEqual({ ok: false, error: 'Identificador no válido' })
  })
  it('int acepta texto numérico y valida rangos', () => {
    expect(int({ min: 1 })('5')).toEqual({ ok: true, value: 5 })
    expect(int({ min: 1 })(0).ok).toBe(false)
    expect(int({ max: 3 })(4).ok).toBe(false)
    expect(int()(1.5).ok).toBe(false)
  })
  it('bool', () => {
    expect(bool()(true)).toEqual({ ok: true, value: true })
    expect(bool()('false')).toEqual({ ok: true, value: false })
    expect(bool()('x').ok).toBe(false)
  })
})

describe('optional, nullable, array, check', () => {
  it('optional deja pasar vacíos como undefined', () => {
    expect(optional(str())(undefined)).toEqual({ ok: true, value: undefined })
    expect(optional(str())('')).toEqual({ ok: true, value: undefined })
    expect(optional(str({ max: 2 }))('abc').ok).toBe(false)
  })
  it('nullable deja pasar null', () => {
    expect(nullable(uuid())(null)).toEqual({ ok: true, value: null })
    expect(nullable(uuid())('x').ok).toBe(false)
  })
  it('array valida cantidad y cada elemento', () => {
    expect(array(int(), { min: 1 })([1, 2])).toEqual({ ok: true, value: [1, 2] })
    expect(array(int(), { min: 1, label: 'archivos' })([])).toEqual({ ok: false, error: 'Agrega al menos 1 archivos' })
    expect(array(int(), { max: 1 })([1, 2]).ok).toBe(false)
    expect(array(int())([1, 'x'])).toEqual({ ok: false, error: '2: Debe ser un número entero' })
    expect(array(int())('x').ok).toBe(false)
  })
})

describe('object', () => {
  const validator = object(
    { name: str({ max: 10 }), pass: str({ min: 8, trim: false }), confirm: str({ trim: false }) },
    sameAs('pass', 'confirm'),
  )

  it('devuelve los datos limpios', () => {
    expect(validator({ name: ' Ana ', pass: '12345678', confirm: '12345678' }))
      .toEqual({ ok: true, data: { name: 'Ana', pass: '12345678', confirm: '12345678' } })
  })

  it('acumula los errores por campo', () => {
    expect(validator({ name: '', pass: '1' })).toEqual({
      ok: false,
      errors: {
        name: 'Este campo es obligatorio',
        pass: 'Debe tener al menos 8 caracteres',
        confirm: 'Este campo es obligatorio',
      },
    })
  })

  it('aplica la regla entre campos', () => {
    expect(validator({ name: 'Ana', pass: '12345678', confirm: '12345679' }))
      .toEqual({ ok: false, errors: { confirm: 'Las contraseñas no coinciden' } })
  })

  it('avisa la confirmación aunque otro campo sea inválido', () => {
    expect(validator({ name: 'Ana', pass: '123', confirm: '456' })).toEqual({
      ok: false,
      errors: { pass: 'Debe tener al menos 8 caracteres', confirm: 'Las contraseñas no coinciden' },
    })
  })

  it('tolera entradas que no son objetos', () => {
    expect(validator(null).ok).toBe(false)
  })
})
