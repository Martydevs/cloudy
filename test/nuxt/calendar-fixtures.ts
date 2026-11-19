// Datos de muestra y el doble de SVAR para las pruebas del calendario de días de trabajo.
import type { Me, WorkDay, WorkDayDetail } from '#shared/types/api'

export function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

export const workDay = (changes: Partial<WorkDay> = {}): WorkDay => ({
  id: 'd1',
  title: 'Servicio dominical',
  date: '2026-11-22',
  kind: 'normal',
  status: 'not_started',
  auditorium: 'Skykids Auditorium',
  slots: [{ id: 's1', start: '09:00', end: '11:00' }, { id: 's2', start: '18:00', end: '20:00' }],
  members: [{ userId: 'u1', name: 'Ana', active: true }, { userId: 'u7', name: 'Usuario', active: false }],
  materialCount: 2,
  ...changes,
})

export const workDayDetail = (changes: Partial<WorkDayDetail> = {}): WorkDayDetail => ({
  ...workDay(),
  materials: [
    { type: 'song_collection', refId: 'c1', name: 'Domingo', itemCount: 60, items: [{ id: 'song-1', title: 'De Buenas' }] },
    { type: 'youtube_playlist', refId: 'p1', name: 'Entrada', itemCount: 1, items: [{ id: 'okShortVid1', title: 'Cuenta regresiva' }] },
    { type: 'folder', refId: 'f1', name: 'Fotos del evento', itemCount: 4, items: [] },
  ],
  createdBy: { userId: 'u9', name: 'Pastor', active: true },
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...changes,
})

export const toasts = () => useToast().toasts.value.map(toast => toast.message)
