import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

describe('ruta de Peticiones (feature 007)', () => {
  const meta = readFileSync(fileURLToPath(new URL('../../app/pages/peticiones.vue', import.meta.url)), 'utf8')

  it('peticiones.vue es privada para editor y admin', () => {
    expect(meta).toMatch(/definePageMeta\(\{[^}]*layout: 'dashboard'[^}]*access: 'private'[^}]*roles: \['editor', 'admin'\]/)
  })

  it('las reglas de acceso aplican como a las demás privadas', () => {
    const rule = { access: 'private' as const, roles: ['editor', 'admin'] as ('editor' | 'admin')[] }
    expect(resolveAccess(rule, none, '/peticiones')).toEqual({ redirect: '/login?redirect=%2Fpeticiones' })
    expect(resolveAccess(rule, pending, '/peticiones')).toEqual({ redirect: '/pendiente' })
    expect(resolveAccess(rule, editor, '/peticiones')).toEqual(allow)
    expect(resolveAccess(rule, admin, '/peticiones')).toEqual(allow)
  })
})

describe('rutas de Canciones (feature 006)', () => {
  const meta = (path: string) => readFileSync(fileURLToPath(new URL(`../../app/pages/${path}`, import.meta.url)), 'utf8')

  it.each(['canciones/index.vue', 'canciones/[id].vue'])('%s es privada para editor y admin', (path) => {
    expect(meta(path)).toMatch(/definePageMeta\(\{[^}]*layout: 'dashboard'[^}]*access: 'private'[^}]*roles: \['editor', 'admin'\]/)
  })

  it('las reglas de acceso aplican a esas rutas como a las demás privadas', () => {
    const rule = { access: 'private' as const, roles: ['editor', 'admin'] as ('editor' | 'admin')[] }
    expect(resolveAccess(rule, none, '/canciones')).toEqual({ redirect: '/login?redirect=%2Fcanciones' })
    expect(resolveAccess(rule, pending, '/canciones/x')).toEqual({ redirect: '/pendiente' })
    expect(resolveAccess(rule, editor, '/canciones/x')).toEqual(allow)
    expect(resolveAccess(rule, admin, '/canciones')).toEqual(allow)
  })
})
