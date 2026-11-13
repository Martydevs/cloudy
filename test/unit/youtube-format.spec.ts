// Formatos y textos de la página YouTube (feature 005): duración visible y hablada, y la causa cuando el servicio no puede con un video.
import { describe, expect, it } from 'vitest'
import { messages } from '../../app/utils/messages'
import { formatDuration, serviceFailureMessage, spokenDuration } from '../../app/utils/youtube'
import { YOUTUBE_SERVICE_MESSAGES } from '../../shared/constants/youtube'

describe('formatDuration', () => {
  it('m:ss y h:mm:ss; vacío si no se conoce', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(185)).toBe('3:05')
    expect(formatDuration(3725.9)).toBe('1:02:05')
    for (const value of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatDuration(value)).toBe('')
  })
})

describe('spokenDuration', () => {
  it('horas, minutos y segundos sin partes vacías', () => {
    expect(spokenDuration(0)).toBe('0 s')
    expect(spokenDuration(185)).toBe('3 min 5 s')
    expect(spokenDuration(3600)).toBe('1 h')
    expect(spokenDuration(3660)).toBe('1 h 1 min')
    expect(spokenDuration(45)).toBe('45 s')
    for (const value of [null, undefined, -5, Number.NaN]) expect(spokenDuration(value)).toBe('')
  })
})

describe('serviceFailureMessage', () => {
  /** El cuerpo que responde el servidor queda en `data`, tanto en un `FetchError` como en el `NuxtError` de `useFetch`. */
  const failure = (cause: unknown, code = 'service_failed') => ({ statusCode: 502, data: { statusCode: 502, message: 'x', data: { code, cause } } })

  it('dice la causa de un error `service_failed`', () => {
    expect(serviceFailureMessage(failure('botCheck'))).toBe(messages.youtube.service.botCheck)
    expect(serviceFailureMessage(failure('failed'))).toBe(messages.youtube.service.failed)
    // Una causa que este cliente no conoce sigue siendo «el servicio no pudo».
    expect(serviceFailureMessage(failure('otra'))).toBe(messages.youtube.service.failed)
  })

  it('el texto es el mismo que responde el servidor', () => {
    expect(messages.youtube.service.botCheck).toBe(YOUTUBE_SERVICE_MESSAGES.botCheck)
    expect(messages.youtube.service.failed).toBe(YOUTUBE_SERVICE_MESSAGES.failed)
  })

  it('cualquier otro error (incluido el viejo `engines_failed`) no cuenta', () => {
    expect(serviceFailureMessage(failure('botCheck', 'expired'))).toBeNull()
    expect(serviceFailureMessage(failure('botCheck', 'engines_failed'))).toBeNull()
    for (const value of [null, undefined, 'texto', new Error('x'), { data: null }, { data: { data: null } }, { statusCode: 502 }]) {
      expect(serviceFailureMessage(value)).toBeNull()
    }
  })
})
