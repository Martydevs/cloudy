// Un archivo `.env` por rama de Neon, con los mismos nombres de variables en todos.
// Nuxt los lee con `nuxi --dotenv <archivo>`; las herramientas fuera de Nuxt (drizzle-kit,
// scripts, e2e) eligen el archivo con APP_ENV mediante este módulo.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

export const APP_ENVS = ['development', 'test', 'production'] as const
export type AppEnv = (typeof APP_ENVS)[number]

export const ENV_FILES: Record<AppEnv, string> = {
  development: '.env.development',
  test: '.env.test',
  production: '.env',
}

/** APP_ENV o, si falta, desarrollo: nunca se cae en producción por omisión. */
export function resolveAppEnv(value: string | undefined = process.env.APP_ENV): AppEnv {
  if (value === undefined || value === '') return 'development'
  if ((APP_ENVS as readonly string[]).includes(value)) return value as AppEnv
  throw new Error(`APP_ENV="${value}" no es válido. Usa ${APP_ENVS.join(', ')}.`)
}

/** Variables del archivo del entorno, sin tocar `process.env`. */
export function readEnvFile(appEnv: AppEnv, root = process.cwd()): Record<string, string> {
  const path = resolve(root, ENV_FILES[appEnv])
  if (!existsSync(path)) {
    throw new Error(`Falta ${ENV_FILES[appEnv]} para el entorno "${appEnv}". Usa .env.example como guía.`)
  }
  return parse(readFileSync(path))
}

/**
 * Carga el archivo del entorno en `process.env` y **gana** a lo que ya hubiera: Bun carga solo
 * `.env` y `.env.development` al arrancar, y `APP_ENV=test` no puede terminar usando la rama de
 * desarrollo. Si el archivo no existe (CI, Vercel), se usan las variables reales del entorno.
 */
export function loadEnv(appEnv: AppEnv = resolveAppEnv(), root = process.cwd()): Record<string, string> {
  if (!existsSync(resolve(root, ENV_FILES[appEnv]))) return {}
  const values = readEnvFile(appEnv, root)
  Object.assign(process.env, values)
  return values
}

export function requireVar(values: Record<string, string | undefined>, name: string, appEnv: AppEnv): string {
  const value = values[name]
  if (!value) throw new Error(`Falta ${name} en ${ENV_FILES[appEnv]}.`)
  return value
}
