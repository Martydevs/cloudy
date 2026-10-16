import { describe, expect, it } from 'vitest'
import { addDays, daysLeft, submissionExpiresAt, trashPurgeAt } from '../../shared/retention'

describe('retention', () => {
  it('un envío caduca a los 7 días y la papelera a los 30', () => {
    expect(submissionExpiresAt('2026-10-01T10:00:00.000Z').toISOString()).toBe('2026-10-08T10:00:00.000Z')
    expect(trashPurgeAt(new Date('2026-10-01T10:00:00.000Z')).toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(addDays(new Date('2026-10-01T00:00:00.000Z'), 1).toISOString()).toBe('2026-10-02T00:00:00.000Z')
  })

  it('daysLeft redondea hacia arriba y nunca es negativo', () => {
    const now = new Date('2026-10-05T12:00:00.000Z')
    expect(daysLeft('2026-10-08T10:00:00.000Z', now)).toBe(3)
    expect(daysLeft('2026-10-05T13:00:00.000Z', now)).toBe(1)
    expect(daysLeft('2026-10-01T00:00:00.000Z', now)).toBe(0)
  })

  it('en la papelera: el mismo día quedan 30, a los 29 días 1 y a los 30 días 0', () => {
    const deletedAt = new Date('2026-10-01T10:00:00.000Z')
    const purgeAt = trashPurgeAt(deletedAt)
    expect(daysLeft(purgeAt, deletedAt)).toBe(30)
    expect(daysLeft(purgeAt, addDays(deletedAt, 29))).toBe(1)
    expect(daysLeft(purgeAt, addDays(deletedAt, 30))).toBe(0)
    expect(daysLeft(purgeAt, addDays(deletedAt, 45))).toBe(0)
  })
})
