import { describe, expect, it } from 'vitest'
import { resolveAccess } from '../../app/utils/route-access'

const none = null
const pending = { profile: { status: 'pending' as const, role: null } }
const disabled = { profile: { status: 'disabled' as const, role: 'editor' as const } }
const removed = { profile: { status: 'removed' as const, role: null } }
const editor = { profile: { status: 'active' as const, role: 'editor' as const } }
const admin = { profile: { status: 'active' as const, role: 'admin' as const } }
const allow = { allow: true }

describe('resolveAccess', () => {
  it('public deja pasar a todos', () => {
    for (const me of [none, pending, disabled, editor, admin]) {
      expect(resolveAccess({ access: 'public' }, me, '/x')).toEqual(allow)
    }
  })

  it('guest-only', () => {
    expect(resolveAccess({ access: 'guest-only' }, none, '/login')).toEqual(allow)
    expect(resolveAccess({ access: 'guest-only' }, pending, '/login')).toEqual({ redirect: '/pendiente' })
    expect(resolveAccess({ access: 'guest-only' }, disabled, '/login')).toEqual({ redirect: '/pendiente' })
    expect(resolveAccess({ access: 'guest-only' }, editor, '/login')).toEqual({ redirect: '/' })
    expect(resolveAccess({ access: 'guest-only' }, admin, '/registro')).toEqual({ redirect: '/' })
  })

  it('pending', () => {
    expect(resolveAccess({ access: 'pending' }, none, '/pendiente')).toEqual({ redirect: '/login' })
    expect(resolveAccess({ access: 'pending' }, pending, '/pendiente')).toEqual(allow)
    expect(resolveAccess({ access: 'pending' }, disabled, '/pendiente')).toEqual(allow)
    expect(resolveAccess({ access: 'pending' }, removed, '/pendiente')).toEqual(allow)
    expect(resolveAccess({ access: 'pending' }, editor, '/pendiente')).toEqual({ redirect: '/' })
  })

  it('private sin sesión redirige a login con la ruta codificada', () => {
    expect(resolveAccess({ access: 'private' }, none, '/archivos/abc?q=a b'))
      .toEqual({ redirect: '/login?redirect=%2Farchivos%2Fabc%3Fq%3Da%20b' })
  })

  it('private con cuenta no activa va a /pendiente', () => {
    expect(resolveAccess({ access: 'private' }, pending, '/')).toEqual({ redirect: '/pendiente' })
    expect(resolveAccess({ access: 'private' }, disabled, '/')).toEqual({ redirect: '/pendiente' })
  })

  it('private sin roles explícitos admite editor y admin', () => {
    expect(resolveAccess({ access: 'private' }, editor, '/')).toEqual(allow)
    expect(resolveAccess({ access: 'private' }, admin, '/')).toEqual(allow)
  })

  it('private con roles', () => {
    expect(resolveAccess({ access: 'private', roles: ['admin'] }, editor, '/usuarios')).toEqual({ redirect: '/acceso-denegado' })
    expect(resolveAccess({ access: 'private', roles: ['admin'] }, admin, '/usuarios')).toEqual(allow)
  })

  it('sin access se trata como private', () => {
    expect(resolveAccess({}, none, '/')).toEqual({ redirect: '/login?redirect=%2F' })
    expect(resolveAccess({}, editor, '/')).toEqual(allow)
  })
})
