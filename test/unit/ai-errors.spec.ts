// Clasificación de errores del proveedor (feature 002, research A11): código, respaldo y persistencia.
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

const timeout = () => new DOMException('timeout of 20000ms exceeded', 'TimeoutError')

describe('classifyProviderError', () => {
  it.each([
    ['red sin statusCode', apiError(undefined), { code: 'provider', fallback: true, persistent: false }],
    ['timeout del propio intento', timeout(), { code: 'timeout', fallback: true, persistent: false }],
    ['OpenAI 429 rate_limit_exceeded', apiError(429, { error: { code: 'rate_limit_exceeded' } }), { code: 'rate_limited', fallback: true, persistent: false }],
    ['Gemini 429 RESOURCE_EXHAUSTED', apiError(429, { error: { status: 'RESOURCE_EXHAUSTED' } }), { code: 'rate_limited', fallback: true, persistent: false }],
    ['OpenAI 429 insufficient_quota', apiError(429, { error: { code: 'insufficient_quota', type: 'insufficient_quota' } }), { code: 'quota_exceeded', fallback: true, persistent: true }],
    ['OpenAI billing_hard_limit_reached (en responseBody)', apiError(400, undefined, '{"error":{"code":"billing_hard_limit_reached"}}'), { code: 'quota_exceeded', fallback: true, persistent: true }],
    ['402', apiError(402), { code: 'quota_exceeded', fallback: true, persistent: true }],
    ['Gemini FAILED_PRECONDITION', apiError(400, { error: { status: 'FAILED_PRECONDITION' } }), { code: 'quota_exceeded', fallback: true, persistent: true }],
    ['401 invalid_api_key', apiError(401, { error: { code: 'invalid_api_key' } }), { code: 'provider', fallback: true, persistent: true }],
    ['403', apiError(403), { code: 'provider', fallback: true, persistent: true }],
    ['404 model_not_found', apiError(404, { error: { code: 'model_not_found' } }), { code: 'provider', fallback: true, persistent: true }],
    ['Gemini 400 API_KEY_INVALID', apiError(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), { code: 'provider', fallback: true, persistent: true }],
    ['400 cualquiera', apiError(400, { error: { status: 'INVALID_ARGUMENT' } }), { code: 'provider', fallback: true, persistent: false }],
    ['500', apiError(500), { code: 'provider', fallback: true, persistent: false }],
    ['Gemini 503 UNAVAILABLE', apiError(503, { error: { status: 'UNAVAILABLE' } }), { code: 'provider', fallback: true, persistent: false }],
    ['529', apiError(529), { code: 'provider', fallback: true, persistent: false }],
    ['clave ausente (LoadAPIKeyError)', new LoadAPIKeyError({ message: 'sin clave' }), { code: 'provider', fallback: true, persistent: true }],
    ['bloqueo por política (content-filter)', noObject('content-filter'), { code: 'provider', fallback: true, persistent: false }],
    ['salida fuera del esquema', noObject('stop'), { code: 'invalid_output', fallback: false, persistent: false }],
    ['salida truncada', noObject('length'), { code: 'invalid_output', fallback: false, persistent: false }],
    ['sin salida', new NoOutputGeneratedError(), { code: 'invalid_output', fallback: false, persistent: false }],
    ['error desconocido', new Error('boom'), { code: 'provider', fallback: true, persistent: false }],
    ['valor no Error', 'boom', { code: 'provider', fallback: true, persistent: false }],
  ])('%s', (_, error, expected) => {
    expect(classifyProviderError(error)).toEqual(expected)
  })

  it('desenrolla RetryError hasta el último error', () => {
    const retry = new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(500), apiError(429, { error: { code: 'insufficient_quota' } })] })
    expect(classifyProviderError(retry)).toEqual({ code: 'quota_exceeded', fallback: true, persistent: true })
  })

  it('tolera un `data` circular', () => {
    const data: Record<string, unknown> = {}
    data.self = data
    expect(classifyProviderError(apiError(500, data)).code).toBe('provider')
  })
})
