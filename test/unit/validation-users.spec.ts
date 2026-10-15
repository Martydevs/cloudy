import { describe, expect, it } from 'vitest'
import { USER_PAGE_SIZE, userPatchInput, usersQuery } from '../../shared/validation/users'

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

describe('usersQuery', () => {
  it('admite filtro por estado y paginación acotada', () => {
    expect(usersQuery({})).toEqual({ ok: true, data: { status: undefined, page: undefined, pageSize: undefined } })
    expect(usersQuery({ status: 'pending', page: '2', pageSize: '10' })).toEqual({ ok: true, data: { status: 'pending', page: 2, pageSize: 10 } })
    expect(usersQuery({ pageSize: USER_PAGE_SIZE + 1 }).ok).toBe(false)
    expect(usersQuery({ page: 0 }).ok).toBe(false)
    expect(usersQuery({ status: 'removed' }).ok).toBe(false)
  })
})
