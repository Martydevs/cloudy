import { describe, expect, it } from 'vitest'
import { USER_BATCH_ACTIONS, USER_BATCH_MAX, USER_PAGE_SIZE, userBatchInput, userPatchInput, usersQuery } from '../../shared/validation/users'

describe('userPatchInput', () => {
  it('acepta estado, rol o ambos', () => {
    expect(userPatchInput({ status: 'active', role: 'editor' })).toEqual({ ok: true, data: { status: 'active', role: 'editor' } })
    expect(userPatchInput({ status: 'disabled' })).toEqual({ ok: true, data: { status: 'disabled', role: undefined } })
    expect(userPatchInput({ role: 'admin' })).toEqual({ ok: true, data: { status: undefined, role: 'admin' } })
  })

  it('exige al menos un cambio', () => {
    expect(userPatchInput({})).toEqual({ ok: false, errors: { status: 'Indica un estado o un rol' } })
    expect(userPatchInput({ status: '', role: null })).toEqual({ ok: false, errors: { status: 'Indica un estado o un rol' } })
  })

  it('rechaza estados y roles fuera del enum (pending y removed no se asignan a mano)', () => {
    expect(userPatchInput({ status: 'removed' }).ok).toBe(false)
    expect(userPatchInput({ status: 'pending' }).ok).toBe(false)
    expect(userPatchInput({ role: 'owner' }).ok).toBe(false)
  })
})

describe('userBatchInput (selección múltiple)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`)

  it('acepta desactivar, eliminar y cambiar rol', () => {
    expect(USER_BATCH_ACTIONS).toEqual(['disable', 'remove', 'role'])
    expect(userBatchInput({ ids: ['u2'], action: 'disable' })).toEqual({ ok: true, data: { ids: ['u2'], action: 'disable', role: undefined } })
    expect(userBatchInput({ ids: ['u2', 'u3'], action: 'remove' })).toMatchObject({ ok: true, data: { ids: ['u2', 'u3'], action: 'remove' } })
    expect(userBatchInput({ ids: ['u2'], action: 'role', role: 'admin' })).toEqual({ ok: true, data: { ids: ['u2'], action: 'role', role: 'admin' } })
  })

  it('cambiar rol exige un rol válido', () => {
    expect(userBatchInput({ ids: ['u2'], action: 'role' })).toEqual({ ok: false, errors: { role: 'Elige un rol' } })
    expect(userBatchInput({ ids: ['u2'], action: 'role', role: '' })).toEqual({ ok: false, errors: { role: 'Elige un rol' } })
    expect(userBatchInput({ ids: ['u2'], action: 'role', role: 'owner' })).toEqual({ ok: false, errors: { role: 'Rol no válido' } })
  })

  it(`pide entre 1 y ${USER_BATCH_MAX} cuentas (una página)`, () => {
    expect(USER_BATCH_MAX).toBe(20)
    expect(userBatchInput({ ids: ids(20), action: 'disable' }).ok).toBe(true)
    expect(userBatchInput({ ids: ids(21), action: 'disable' })).toEqual({ ok: false, errors: { ids: 'Puedes cambiar como máximo 20 cuentas a la vez' } })
    for (const empty of [[], undefined, null, 'u2']) {
      expect(userBatchInput({ ids: empty, action: 'disable' })).toEqual({ ok: false, errors: { ids: 'Elige al menos una cuenta' } })
    }
    expect(userBatchInput({ ids: ['u2', 7], action: 'disable' })).toEqual({ ok: false, errors: { ids: 'Cuenta no válida' } })
    expect(userBatchInput({ ids: ['u2', ''], action: 'disable' })).toEqual({ ok: false, errors: { ids: 'Cuenta no válida' } })
  })

  it('rechaza acciones fuera de la lista (activar y reactivar siguen siendo de una en una)', () => {
    for (const action of ['activate', 'reactivate', 'enable', '', undefined]) {
      expect(userBatchInput({ ids: ['u2'], action })).toMatchObject({ ok: false, errors: { action: 'Acción no válida' } })
    }
  })
})

describe('usersQuery', () => {
  it('admite filtro por estado y paginación acotada', () => {
    expect(usersQuery({})).toEqual({ ok: true, data: { status: undefined, page: undefined, pageSize: undefined } })
    expect(usersQuery({ status: 'pending', page: '2', pageSize: '10' })).toEqual({ ok: true, data: { status: 'pending', page: 2, pageSize: 10 } })
    expect(usersQuery({ pageSize: USER_PAGE_SIZE + 1 }).ok).toBe(false)
    expect(usersQuery({ page: 0 }).ok).toBe(false)
    expect(usersQuery({ status: 'removed' }).ok).toBe(false)
  })
})
