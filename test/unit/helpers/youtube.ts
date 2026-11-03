// Filas de prueba de la página YouTube (feature 005).
import { created, UUID } from './nitro'

/** Fila de `playlistColumns` (lista con autor, conteo y miniaturas). */
export const playlistRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID,
  name: 'Domingo',
  createdBy: 'u1',
  createdAt: created,
  updatedAt: created,
  authorName: 'Ana',
  authorStatus: 'active',
  itemCount: 3,
  covers: ['https://i.ytimg.com/a.jpg', 'https://i.ytimg.com/b.jpg'],
  ...changes,
})
