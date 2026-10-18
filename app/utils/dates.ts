// Fechas de la interfaz: una sola configuración regional ('es') y un solo formato absoluto.
import { formatTimeAgoIntl } from '@vueuse/core'

const MINUTE = 60_000

/**
 * Tiempo relativo («hace 2 horas», «ayer»). Por debajo de un minuto devuelve siempre «hace un
 * momento»: el texto por segundos cambiaba entre el render del servidor y la hidratación y Vue
 * marcaba un desajuste. `now` permite refrescarlo en vivo (comentarios) y probarlo.
 */
export function timeAgo(iso: string, now: Date | number = Date.now()): string {
  const date = new Date(iso)
  if (Math.abs(date.getTime() - +now) < MINUTE) return 'hace un momento'
  return formatTimeAgoIntl(date, { locale: 'es' }, now)
}

const dateTimeFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

/** Fecha y hora exactas («14 oct 2026, 10:05») en la zona horaria de quien mira. */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}
