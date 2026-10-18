// Fechas de la interfaz (T152): una sola configuración regional y textos estables entre el SSR y la hidratación.
import { describe, expect, it } from 'vitest'
import { formatDateTime, timeAgo } from '../../app/utils/dates'

const NOW = new Date('2026-10-14T12:00:00.000Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('timeAgo', () => {
  it('menos de un minuto es «hace un momento», igual en el servidor y al hidratar', () => {
    expect(timeAgo(ago(0), NOW)).toBe('hace un momento')
    expect(timeAgo(ago(59_999), NOW)).toBe('hace un momento')
    // El servidor y el navegador renderizan con unos cientos de ms de diferencia: el texto no cambia.
    expect(timeAgo(ago(18_400), NOW + 900)).toBe(timeAgo(ago(18_400), NOW))
    // Un reloj ligeramente adelantado tampoco muestra «dentro de…».
    expect(timeAgo(ago(-5_000), NOW)).toBe('hace un momento')
  })

  it('desde un minuto usa Intl en español', () => {
    expect(timeAgo(ago(60_000), NOW)).toBe('hace 1 minuto')
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('hace 5 minutos')
    expect(timeAgo(ago(2 * 3_600_000), NOW)).toBe('hace 2 horas')
    expect(timeAgo(ago(26 * 3_600_000), NOW)).toBe('ayer')
    expect(timeAgo(ago(40 * 86_400_000), NOW)).toBe('el mes pasado')
  })

  it('sin referencia usa la hora actual', () => {
    expect(timeAgo(new Date().toISOString())).toBe('hace un momento')
  })
})

describe('formatDateTime', () => {
  it('fecha media y hora corta en español, en la zona horaria local', () => {
    const date = new Date('2026-10-14T12:05:00.000Z')
    expect(formatDateTime(date.toISOString())).toBe(`14 oct 2026, ${date.getHours()}:05`)
  })
})
