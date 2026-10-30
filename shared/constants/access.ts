// Solicitud de acceso de invitados (feature 003, data-model "Constantes"): tiempos, límites, cookies y estado visible.
import type { AccessState } from '../types/api'

/** Espera de aprobación (FR-005). */
export const ACCESS_WAIT_MINUTES = 8
/** Ventana para empezar el envío una vez aprobado (FR-015). */
export const ACCESS_WINDOW_MINUTES = 30
/** Solicitudes nuevas por navegador (FR-006, research B2). */
export const ACCESS_REQUEST_LIMIT = { limit: 3, windowSec: 1800 }
/** Tope por red contra el spam (research B2). */
export const ACCESS_NETWORK_LIMIT = { limit: 30, windowSec: 1800 }
/** Creaciones de envío por solicitud aprobada (research B2). */
export const ACCESS_SUBMIT_LIMIT = { limit: 5, windowSec: 1800 }
export const ACCESS_COOKIE = 'cloudy-guest-access'
export const ACCESS_DEVICE_COOKIE = 'cloudy-guest-device'

/** El sondeo del invitado se detiene en estos estados. */
export const TERMINAL_ACCESS_STATES: readonly AccessState[] = ['none', 'rejected', 'expired', 'accessExpired', 'used']

export interface AccessStateRow {
  status: 'open' | 'approved' | 'rejected' | 'used'
  expiresAt: Date | string
  accessExpiresAt: Date | string | null
}

/** Estado visible derivado de la fila y el reloj (data-model, "Estado visible"); la caducidad no se escribe (research B3). */
export function accessStateOf(row: AccessStateRow | null, now: Date): AccessState {
  if (!row) return 'none'
  switch (row.status) {
    case 'open':
      return now.getTime() <= new Date(row.expiresAt).getTime() ? 'waiting' : 'expired'
    case 'approved':
      return row.accessExpiresAt && now.getTime() <= new Date(row.accessExpiresAt).getTime() ? 'approved' : 'accessExpired'
    default:
      return row.status
  }
}
