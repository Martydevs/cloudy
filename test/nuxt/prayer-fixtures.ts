// Peticiones de prueba para las pruebas de componente de la feature 007.
import type { ImageText, PrayerRequest } from '#shared/types/api'

export const prayerText = (changes: Partial<ImageText> = {}): ImageText =>
  ({ status: 'ready', text: 'Oremos por la salud de mi mamá', error: null, readAt: '2026-11-07T10:00:00.000Z', editedAt: null, editedBy: null, ...changes })

/** `n` da un id estable y una aprobación más antigua cuanto mayor es. */
export const prayer = (n: number, changes: Partial<PrayerRequest> = {}): PrayerRequest => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `tarjeta-${n}.jpg`,
  senderName: `Invitado ${n}`,
  note: null,
  sentAt: new Date(Date.UTC(2026, 10, 6, 12) - n * 60_000).toISOString(),
  approvedAt: new Date(Date.UTC(2026, 10, 7, 12) - n * 60_000).toISOString(),
  previewUrl: `/api/files/00000000-0000-4000-8000-${String(n).padStart(12, '0')}/content`,
  text: prayerText({ text: `Petición número ${n}` }),
  ...changes,
})
