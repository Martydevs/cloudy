// Aplica los validadores de `shared/validation` a peticiones h3 y responde 422 con `data.errors`.
import type { H3Event } from 'h3'
import { createError, getQuery, getRouterParam, readBody } from 'h3'
import type { Result, Validator } from '#shared/validation/core'
import { uuid } from '#shared/validation/core'

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data
  throw createError({
    statusCode: 422,
    statusMessage: 'Validation failed',
    data: { errors: result.errors },
  })
}

export async function readValid<T>(event: H3Event, validator: Validator<T>): Promise<T> {
  const body = await readBody(event).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Cuerpo JSON no válido' })
  })
  return unwrap(validator(body ?? {}))
}

export function queryValid<T>(event: H3Event, validator: Validator<T>): T {
  return unwrap(validator(getQuery(event)))
}

/** Parámetro de ruta uuid; 404 si no tiene la forma correcta. */
export function paramId(event: H3Event, name = 'id'): string {
  const res = uuid()(getRouterParam(event, name))
  if (!res.ok) throw createError({ statusCode: 404, statusMessage: 'No encontrado' })
  return res.value
}
