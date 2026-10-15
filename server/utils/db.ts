import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../db/schema'

function createDb(url: string) {
  return drizzle({ client: neon(url), schema })
}

export type Db = ReturnType<typeof createDb>

let instance: Db | undefined

/** Cliente Drizzle (driver HTTP de Neon), único por instancia de la función. */
export function useDb(): Db {
  instance ??= createDb(useRuntimeConfig().databaseUrl)
  return instance
}

export { schema }
