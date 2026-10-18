// T153 — Mensajes de error de `/api/**` que ven las personas: solo se confía en el texto del
// servidor para los 4xx; el resto (5xx, red) usa el respaldo en español y el 429 el mensaje común.
import { createFetchError } from 'ofetch'
import type { FetchContext, FetchResponse } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { serverMessage } from '../../app/utils/api-error'
import { messages } from '../../app/utils/messages'

const FALLBACK = 'No pudimos guardar los cambios. Inténtalo de nuevo.'

// Lo que envía Nitro en producción: un `message` en inglés para los errores no controlados
// ("Server Error") y para los que solo traen `statusMessage` ("Too Many Requests").
function responseError(status: number, body: Record<string, unknown>) {
  const response = { status, statusText: String(body.statusMessage ?? ''), _data: body } as FetchResponse<unknown>
  return createFetchError({ request: '/api/x', options: {} as FetchContext['options'], response })
}

function networkError() {
  return createFetchError({ request: '/api/x', options: {} as FetchContext['options'], error: new TypeError('Failed to fetch') })
}

describe('serverMessage', () => {
  it('un 5xx devuelve el respaldo, nunca el texto en inglés del servidor', () => {
    expect(serverMessage(responseError(500, { statusCode: 500, statusMessage: 'Server Error', message: 'Server Error' }), FALLBACK)).toBe(FALLBACK)
    expect(serverMessage(responseError(503, { statusCode: 503, statusMessage: 'Service Unavailable', message: 'Service Unavailable' }), FALLBACK)).toBe(FALLBACK)
  })

  it('un 429 devuelve el mensaje compartido de límite de intentos', () => {
    const limited = responseError(429, { statusCode: 429, statusMessage: 'Too Many Requests', message: 'Too Many Requests', data: { retryAfter: 42 } })
    expect(serverMessage(limited, FALLBACK)).toBe(messages.common.rateLimited)
  })

  it('un 4xx devuelve el mensaje del servidor', () => {
    const conflict = responseError(409, { statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado por otra persona' })
    expect(serverMessage(conflict, FALLBACK)).toBe('Este envío ya fue revisado por otra persona')
  })

  it('un 4xx sin mensaje devuelve el respaldo', () => {
    // `createError({ statusCode: 404 })` sin `message` llega con una cadena vacía.
    expect(serverMessage(responseError(404, { statusCode: 404, statusMessage: '', message: '' }), FALLBACK)).toBe(FALLBACK)
  })

  it('el error de un campo tiene prioridad sobre el mensaje general', () => {
    const invalid = responseError(422, {
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: 'Datos inválidos',
      data: { errors: { name: 'No uses los caracteres / \\ : * ? " < > |' } },
    })
    expect(serverMessage(invalid, FALLBACK)).toBe('No uses los caracteres / \\ : * ? " < > |')
  })

  it('un error de red devuelve el respaldo', () => {
    expect(serverMessage(networkError(), FALLBACK)).toBe(FALLBACK)
  })

  it('lo que no es un error de fetch devuelve el respaldo', () => {
    expect(serverMessage(new Error('boom'), FALLBACK)).toBe(FALLBACK)
    expect(serverMessage(undefined, FALLBACK)).toBe(FALLBACK)
  })
})
