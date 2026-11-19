import { describe, expect, it } from 'vitest'
import type { Action } from '../../shared/permissions'
import { can, canSetWorkDayStatus } from '../../shared/permissions'

const ACTIONS: Action[] = [
  'content.read', 'content.write', 'submissions.review', 'trash.empty',
  'users.manage', 'activity.read', 'comments.moderate', 'youtube.moderate', 'songs.moderate', 'prayers.moderate', 'calendar.manage',
]
const ADMIN_ONLY = new Set<Action>(['trash.empty', 'users.manage', 'activity.read', 'comments.moderate', 'youtube.moderate', 'songs.moderate', 'prayers.moderate', 'calendar.manage'])

describe('can(role, action)', () => {
  it.each(ACTIONS)('admin puede %s', (action) => {
    expect(can('admin', action)).toBe(true)
  })

  it.each(ACTIONS)('editor y %s', (action) => {
    expect(can('editor', action)).toBe(!ADMIN_ONLY.has(action))
  })

  it('youtube.moderate (renombrar o eliminar una lista ajena) es solo del admin', () => {
    expect(can('admin', 'youtube.moderate')).toBe(true)
    expect(can('editor', 'youtube.moderate')).toBe(false)
    expect(can(null, 'youtube.moderate')).toBe(false)
    expect(can(undefined, 'youtube.moderate')).toBe(false)
  })

  it('prayers.moderate (eliminar una imagen ajena o cambiar una colección de imágenes ajena) es solo del admin (feature 007)', () => {
    expect(can('admin', 'prayers.moderate')).toBe(true)
    expect(can('editor', 'prayers.moderate')).toBe(false)
    expect(can(null, 'prayers.moderate')).toBe(false)
  })

  it('songs.moderate (renombrar o eliminar una colección ajena) es solo del admin (feature 006)', () => {
    expect(can('admin', 'songs.moderate')).toBe(true)
    expect(can('editor', 'songs.moderate')).toBe(false)
    expect(can(null, 'songs.moderate')).toBe(false)
    expect(can(undefined, 'songs.moderate')).toBe(false)
  })

  it('calendar.manage (agendar, editar y borrar días de trabajo, y el estado de cualquiera) es solo del admin', () => {
    expect(can('admin', 'calendar.manage')).toBe(true)
    expect(can('editor', 'calendar.manage')).toBe(false)
    expect(can(null, 'calendar.manage')).toBe(false)
    expect(can(undefined, 'calendar.manage')).toBe(false)
  })

  it.each(ACTIONS)('sin rol no puede %s', (action) => {
    expect(can(null, action)).toBe(false)
    expect(can(undefined, action)).toBe(false)
  })
})

describe('canSetWorkDayStatus(role, userId, members)', () => {
  const members = [{ userId: 'u1' }, { userId: 'u2' }]

  it('quien administra cambia el estado de cualquier día, esté o no asignado', () => {
    expect(canSetWorkDayStatus('admin', 'u9', members)).toBe(true)
    expect(canSetWorkDayStatus('admin', 'u9', [])).toBe(true)
  })

  it('un editor solo el de los días en los que está asignado', () => {
    expect(canSetWorkDayStatus('editor', 'u1', members)).toBe(true)
    expect(canSetWorkDayStatus('editor', 'u2', members)).toBe(true)
    expect(canSetWorkDayStatus('editor', 'u5', members)).toBe(false)
    expect(canSetWorkDayStatus('editor', 'u1', [])).toBe(false)
  })

  it('sin rol o sin usuario, nunca', () => {
    expect(canSetWorkDayStatus(null, 'u1', members)).toBe(false)
    expect(canSetWorkDayStatus(undefined, 'u1', members)).toBe(false)
    expect(canSetWorkDayStatus('editor', null, members)).toBe(false)
    expect(canSetWorkDayStatus('editor', undefined, members)).toBe(false)
    expect(canSetWorkDayStatus('editor', '', [{ userId: '' }])).toBe(false)
  })
})
