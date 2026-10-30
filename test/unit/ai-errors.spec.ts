// Clasificación de errores de OpenRouter (feature 002): código y si abre el cortacircuito al instante.
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'
import { classifyProviderError } from '../../server/ai/errors'

function apiError(statusCode: number | undefined, data?: unknown, responseBody?: string) {
  return new APICallError({ message: 'x', url: 'https://api.test', requestBodyValues: {}, statusCode, data, responseBody })
}

const noObject = (finishReason: 'content-filter' | 'stop' | 'length') => new NoObjectGeneratedError({
  message: 'x',
  text: '{',
  response: { id: 'r', timestamp: new Date(), modelId: 'm' },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
  finishReason,
})

const timeout = () => new DOMException('timeout of 30000ms exceeded', 'TimeoutError')

describe('classifyProviderError', () => {
  it.each([
    ['red sin statusCode', apiError(undefined), { code: 'provider', persistent: false }],
    ['timeout del propio intento', timeout(), { code: 'timeout', persistent: false }],
    ['429 de OpenRouter', apiError(429, { error: { code: 429, message: 'Rate limit exceeded' } }), { code: 'rate_limited', persistent: false }],
    ['402 de OpenRouter (sin créditos)', apiError(402, { error: { code: 402, message: 'Insufficient credits' } }), { code: 'quota_exceeded', persistent: true }],
    ['401 clave rechazada', apiError(401, { error: { code: 401, message: 'No auth credentials found' } }), { code: 'provider', persistent: true }],
    ['403', apiError(403), { code: 'provider', persistent: true }],
    ['404 preset o modelo inexistente', apiError(404), { code: 'provider', persistent: true }],
    ['400 cualquiera', apiError(400, { error: { code: 400, message: 'bad request' } }), { code: 'provider', persistent: false }],
    ['400 con marcas de otros proveedores no se trata como saldo', apiError(400, undefined, '{"error":{"code":"insufficient_quota"}}'), { code: 'provider', persistent: false }],
    ['500', apiError(500), { code: 'provider', persistent: false }],
    ['502', apiError(502), { code: 'provider', persistent: false }],
    ['529', apiError(529), { code: 'provider', persistent: false }],
    ['clave ausente (LoadAPIKeyError)', new LoadAPIKeyError({ message: 'sin clave' }), { code: 'provider', persistent: true }],
    ['bloqueo por política (content-filter)', noObject('content-filter'), { code: 'provider', persistent: false }],
    ['salida fuera del esquema', noObject('stop'), { code: 'invalid_output', persistent: false }],
    ['salida truncada', noObject('length'), { code: 'invalid_output', persistent: false }],
    ['sin salida', new NoOutputGeneratedError(), { code: 'invalid_output', persistent: false }],
    ['error desconocido', new Error('boom'), { code: 'provider', persistent: false }],
    ['valor no Error', 'boom', { code: 'provider', persistent: false }],
    ['null', null, { code: 'provider', persistent: false }],
  ])('%s', (_, error, expected) => {
    expect(classifyProviderError(error)).toEqual(expected)
  })

  it('desenrolla RetryError hasta el último error', () => {
    const retry = new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(500), apiError(402)] })
    expect(classifyProviderError(retry)).toEqual({ code: 'quota_exceeded', persistent: true })
  })
})
