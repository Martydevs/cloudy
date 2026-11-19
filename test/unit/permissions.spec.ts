import { describe, expect, it } from 'vitest'
import type { Action } from '../../shared/permissions'
import { can } from '../../shared/permissions'

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

  it('calendar.manage (agendar, editar, cambiar el estado y borrar días de trabajo) es solo del admin', () => {
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
