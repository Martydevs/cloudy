// Formatos de la página YouTube (feature 005): duración visible y hablada.
import { describe, expect, it } from 'vitest'
import { formatDuration, spokenDuration } from '../../app/utils/youtube'

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
