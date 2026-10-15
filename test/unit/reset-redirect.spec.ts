import { describe, expect, it } from 'vitest'
import { buildResetRedirect, loginInput, registerInput, resetInput } from '../../shared/validation/auth'

describe('buildResetRedirect', () => {
  it('agrega /restablecer al origen', () => {
    expect(buildResetRedirect('https://cloudy.example.org')).toBe('https://cloudy.example.org/restablecer')
  })
  it('no duplica barras', () => {
    expect(buildResetRedirect('https://cloudy.example.org/')).toBe('https://cloudy.example.org/restablecer')
    expect(buildResetRedirect('http://localhost:3000//')).toBe('http://localhost:3000/restablecer')
  })
})

describe('validadores de autenticación', () => {
  it('registro: nombre, correo, contraseña ≥ 8 y confirmación', () => {
    expect(registerInput({ name: 'Ana', email: 'ANA@x.org', password: '12345678', confirm: '12345678' }))
      .toEqual({ ok: true, data: { name: 'Ana', email: 'ana@x.org', password: '12345678', confirm: '12345678' } })
    const res = registerInput({ name: '', email: 'x', password: '123', confirm: '' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(['confirm', 'email', 'name', 'password'])
  })

  it('registro: confirmación distinta', () => {
    expect(registerInput({ name: 'Ana', email: 'a@x.org', password: '12345678', confirm: '87654321' }))
      .toEqual({ ok: false, errors: { confirm: 'Las contraseñas no coinciden' } })
  })

  it('registro: nombre de más de 80 caracteres', () => {
    const res = registerInput({ name: 'a'.repeat(81), email: 'a@x.org', password: '12345678', confirm: '12345678' })
    expect(res).toEqual({ ok: false, errors: { name: 'Debe tener como máximo 80 caracteres' } })
  })

  it('login solo exige correo y contraseña', () => {
    expect(loginInput({ email: 'a@x.org', password: 'x' }).ok).toBe(true)
    expect(loginInput({ email: 'a@x.org', password: '' }).ok).toBe(false)
  })

  it('restablecer exige mínimo 8 y confirmación', () => {
    expect(resetInput({ password: '1234567', confirm: '1234567' }))
      .toEqual({ ok: false, errors: { password: 'Debe tener al menos 8 caracteres' } })
    expect(resetInput({ password: '12345678', confirm: '12345678' }).ok).toBe(true)
  })
})
