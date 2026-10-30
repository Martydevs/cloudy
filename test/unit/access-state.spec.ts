// Feature 003 — estado visible de una solicitud de acceso (data-model, "Estado visible") y constantes compartidas.
import { describe, expect, it } from 'vitest'
import {
  ACCESS_COOKIE,
  ACCESS_DEVICE_COOKIE,
  ACCESS_NETWORK_LIMIT,
  ACCESS_REQUEST_LIMIT,
  ACCESS_SUBMIT_LIMIT,
  ACCESS_WAIT_MINUTES,
  ACCESS_WINDOW_MINUTES,
  accessStateOf,
  TERMINAL_ACCESS_STATES,
} from '../../shared/constants/access'

const now = new Date('2026-10-29T12:00:00.000Z')
const before = new Date('2026-10-29T11:59:59.000Z')
const after = new Date('2026-10-29T12:00:01.000Z')

const row = (status: 'open' | 'approved' | 'rejected' | 'used', expiresAt: Date, accessExpiresAt: Date | null = null) =>
  ({ status, expiresAt, accessExpiresAt })

describe('accessStateOf', () => {
  it('sin fila es none', () => {
    expect(accessStateOf(null, now)).toBe('none')
  })

  it('open: waiting hasta expires_at (incluido) y expired después', () => {
    expect(accessStateOf(row('open', after), now)).toBe('waiting')
    expect(accessStateOf(row('open', now), now)).toBe('waiting')
    expect(accessStateOf(row('open', before), now)).toBe('expired')
  })

  it('approved: approved hasta access_expires_at (incluido) y accessExpired después', () => {
    expect(accessStateOf(row('approved', before, after), now)).toBe('approved')
    expect(accessStateOf(row('approved', before, now), now)).toBe('approved')
    expect(accessStateOf(row('approved', before, before), now)).toBe('accessExpired')
    // Una fila aprobada sin ventana no habilita nada (el CHECK lo impide; defensa en profundidad).
    expect(accessStateOf(row('approved', before, null), now)).toBe('accessExpired')
  })

  it('rejected y used no dependen del reloj', () => {
    expect(accessStateOf(row('rejected', after), now)).toBe('rejected')
    expect(accessStateOf(row('rejected', before), now)).toBe('rejected')
    expect(accessStateOf(row('used', before, before), now)).toBe('used')
  })

  it('acepta fechas como texto ISO (respuesta JSON)', () => {
    expect(accessStateOf({ status: 'open', expiresAt: after.toISOString(), accessExpiresAt: null }, now)).toBe('waiting')
  })
})

describe('constantes de acceso', () => {
  it('tienen los valores de la spec', () => {
    expect(ACCESS_WAIT_MINUTES).toBe(8)
    expect(ACCESS_WINDOW_MINUTES).toBe(30)
    expect(ACCESS_REQUEST_LIMIT).toEqual({ limit: 3, windowSec: 1800 })
    expect(ACCESS_NETWORK_LIMIT).toEqual({ limit: 30, windowSec: 1800 })
    expect(ACCESS_SUBMIT_LIMIT).toEqual({ limit: 5, windowSec: 1800 })
    expect(ACCESS_COOKIE).toBe('cloudy-guest-access')
    expect(ACCESS_DEVICE_COOKIE).toBe('cloudy-guest-device')
  })

  it('los estados terminales detienen el sondeo del invitado', () => {
    expect([...TERMINAL_ACCESS_STATES].sort()).toEqual(['accessExpired', 'expired', 'none', 'rejected', 'used'])
  })
})
