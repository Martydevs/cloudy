// Peticiones de prueba para las pruebas de componente de la feature 007.
import type { PrayerGeneratedImage, PrayerImageCollection, PrayerImageCollectionItem, PrayerRequest } from '#shared/types/api'

/** `n` da un id estable y una aprobación más antigua cuanto mayor es. */
export const prayer = (n: number, changes: Partial<PrayerRequest> = {}): PrayerRequest => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `tarjeta-${n}.jpg`,
  senderName: `Invitado ${n}`,
  note: null,
  sentAt: new Date(Date.UTC(2026, 10, 6, 12) - n * 60_000).toISOString(),
  approvedAt: new Date(Date.UTC(2026, 10, 7, 12) - n * 60_000).toISOString(),
  previewUrl: `/api/files/00000000-0000-4000-8000-${String(n).padStart(12, '0')}/content`,
  ...changes,
})

/** Una petición elegida con el texto que el equipo escribió en el diálogo de generación. */
export const chosen = (n: number, text = `Petición número ${n}`) => ({ request: prayer(n), text })

const imageId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Imagen guardada del historial: `n` da un id estable y una fecha más antigua cuanto mayor es. */
export const generated = (n: number, changes: Partial<PrayerGeneratedImage> = {}): PrayerGeneratedImage => ({
  id: imageId(n),
  previewUrl: `/api/peticiones/imagenes/${imageId(n)}/content`,
  downloadUrl: `/api/peticiones/imagenes/${imageId(n)}/content?download=1`,
  fileIds: [prayer(n).id, prayer(n + 1).id],
  requestCount: 2,
  author: { userId: 'u1', name: 'Ana', active: true },
  createdAt: new Date(Date.UTC(2026, 10, 12, 12) - n * 60_000).toISOString(),
  ...changes,
})

export const imageCollection = (n: number, changes: Partial<PrayerImageCollection> = {}): PrayerImageCollection => ({
  id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Colección ${n}`,
  author: { userId: 'u1', name: 'Ana', active: true },
  itemCount: 2,
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-11T10:00:00.000Z',
  ...changes,
})

export const collectionItem = (n: number, changes: Partial<PrayerImageCollectionItem> = {}): PrayerImageCollectionItem => ({
  ...generated(n),
  addedAt: '2026-11-12T10:00:00.000Z',
  addedBy: { userId: 'u2', name: 'Luis', active: true },
  ...changes,
})
