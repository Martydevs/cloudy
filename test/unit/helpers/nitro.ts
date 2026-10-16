// Ejecuta handlers de `server/**` en pruebas unitarias: instala como globales los auto-imports
// de Nitro (h3 + server/utils reales) y construye eventos h3 con sesión, parámetros y cuerpo.
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import * as h3 from 'h3'
import type { H3Event } from 'h3'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { vi } from 'vitest'
import * as activity from '../../../server/utils/activity'
import * as auth from '../../../server/utils/auth'
import * as cron from '../../../server/utils/cron'
import * as fileAccess from '../../../server/utils/file-access'
import * as fileSignature from '../../../server/utils/file-signature'
import * as files from '../../../server/utils/files'
import * as naming from '../../../server/utils/naming'
import * as pagination from '../../../server/utils/pagination'
import * as rateLimit from '../../../server/utils/rate-limit'
import * as session from '../../../server/utils/session'
import * as submissions from '../../../server/utils/submissions'
import * as trash from '../../../server/utils/trash'
import * as uploads from '../../../server/utils/uploads'
import * as users from '../../../server/utils/users'
import * as validation from '../../../server/utils/validation'
import type { AuthContext, ProfileRow } from '../../../server/utils/session'
import { fakeDb } from './fake-db'

export const RUNTIME_CONFIG = {
  neonAuthBaseUrl: 'https://auth.test/neondb/auth',
  neonAuthCookieSecret: 'x'.repeat(32),
  rateLimitSalt: 'sal',
  storageKeyPrefix: '',
  s3Bucket: 'bucket',
  cronSecret: 'cron-secreto',
}

/** Instala los globales de Nitro; `db` reemplaza `useDb()` con una cola de resultados. */
export function installNitro(results: unknown[] = [], overrides: Record<string, unknown> = {}) {
  const fake = fakeDb(results)
  const globals: Record<string, unknown> = {
    ...h3,
    ...activity,
    ...auth,
    ...cron,
    ...fileAccess,
    ...fileSignature,
    ...files,
    ...naming,
    ...pagination,
    ...rateLimit,
    ...session,
    ...submissions,
    ...trash,
    ...uploads,
    ...users,
    ...validation,
    defineEventHandler: (handler: unknown) => handler,
    useDb: () => fake.db,
    useRuntimeConfig: () => RUNTIME_CONFIG,
    ...overrides,
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
  return fake
}

export const created = new Date('2026-10-14T10:00:00.000Z')

export function profileRow(changes: Partial<ProfileRow> = {}): ProfileRow {
  return {
    userId: 'u1',
    email: 'ana@iglesia.org',
    name: 'Ana',
    role: 'editor',
    status: 'active',
    createdAt: created,
    updatedAt: created,
    approvedBy: null,
    ...changes,
  }
}

export function authAs(changes: Partial<ProfileRow> = {}): AuthContext {
  return { user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' }, profile: profileRow(changes) }
}

export interface EventOptions {
  auth?: AuthContext | null
  method?: string
  url?: string
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
}

export function makeEvent(options: EventOptions = {}): H3Event {
  const { method, url = '/api/x', params, body, headers = {} } = options
  // `auth: undefined` explícito significa "sin resolver" (lo que ve el middleware), distinto de la sesión por defecto.
  const auth = 'auth' in options ? options.auth : authAs()
  const req = new IncomingMessage(new Socket())
  req.method = method ?? (body === undefined ? 'GET' : 'POST')
  req.url = url
  req.headers = { host: 'cloudy.test', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }
  // h3 lee `req.body` cuando ya viene resuelto.
  if (body !== undefined) Object.assign(req, { body: typeof body === 'string' ? body : JSON.stringify(body) })
  const event = h3.createEvent(req, new ServerResponse(req))
  event.context.auth = auth
  if (params) event.context.params = params
  return event
}

export type Handler<T = unknown> = (event: H3Event) => Promise<T> | T

/** Importa el handler por defecto de un archivo de `server/` (después de `installNitro`). */
export async function loadHandler<T = unknown>(path: string): Promise<Handler<T>> {
  const mod = await import(/* @vite-ignore */ `../../../server/${path}`)
  return mod.default as Handler<T>
}

/** Los guards de rol se comportan igual en todos los endpoints: se prueban en bloque. */
export async function expectGuarded(handler: Handler, options: EventOptions = {}, role: 'editor' | 'admin' = 'editor') {
  const run = (auth: AuthContext | null) => Promise.resolve().then(() => handler(makeEvent({ ...options, auth })))
  await expectStatus(run(null), 401)
  await expectStatus(run(authAs({ status: 'pending', role: null })), 403)
  await expectStatus(run(authAs({ status: 'disabled' })), 403)
  if (role === 'admin') await expectStatus(run(authAs({ role: 'editor' })), 403)
}

export async function expectStatus(promise: Promise<unknown>, statusCode: number) {
  const error = await promise.then(() => null, (e: unknown) => e)
  if (!error) throw new Error(`Se esperaba un error ${statusCode} y la petición terminó bien`)
  const actual = (error as { statusCode?: number }).statusCode
  if (actual !== statusCode) throw new Error(`Se esperaba ${statusCode} y llegó ${actual}: ${(error as Error).message}`)
  return error as { statusCode: number, message: string, data?: unknown }
}

/** SQL y parámetros de una expresión de drizzle (`where`, `orderBy`, `sql\`…\``) para afirmar sobre su texto. */
export function sqlText(value: unknown): string {
  const query = new PgDialect().sqlToQuery(value as SQL)
  return `${query.sql} ${JSON.stringify(query.params)}`
}

export const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
export const UUID2 = '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
