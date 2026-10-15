import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ENV_FILES, loadEnv, readEnvFile, requireVar, resolveAppEnv } from '../../scripts/env'

const touched: string[] = []

afterEach(() => {
  for (const name of touched.splice(0)) delete process.env[name]
})

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cloudy-env-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

describe('resolveAppEnv', () => {
  it('usa desarrollo por omisión y nunca producción', () => {
    expect(resolveAppEnv(undefined)).toBe('development')
    expect(resolveAppEnv('')).toBe('development')
    expect(resolveAppEnv('test')).toBe('test')
    expect(resolveAppEnv('production')).toBe('production')
  })

  it('rechaza valores desconocidos', () => {
    expect(() => resolveAppEnv('prod')).toThrow('APP_ENV="prod" no es válido')
  })

  it('cada entorno tiene su archivo', () => {
    expect(ENV_FILES).toEqual({ development: '.env.development', test: '.env.test', production: '.env' })
  })
})

describe('readEnvFile', () => {
  it('lee el archivo del entorno sin tocar process.env', () => {
    const dir = project({ '.env.test': 'NUXT_DATABASE_URL="postgres://test"\nCLOUDY_ENV_SOLO_ARCHIVO=pruebas\n' })
    expect(readEnvFile('test', dir)).toEqual({ NUXT_DATABASE_URL: 'postgres://test', CLOUDY_ENV_SOLO_ARCHIVO: 'pruebas' })
    expect(process.env.CLOUDY_ENV_SOLO_ARCHIVO).toBeUndefined()
  })

  it('explica qué archivo falta', () => {
    const dir = project({})
    expect(() => readEnvFile('development', dir)).toThrow('Falta .env.development para el entorno "development"')
  })
})

describe('loadEnv', () => {
  it('regresión: el archivo elegido gana a lo que Bun ya cargó de otro entorno', () => {
    const dir = project({ '.env.test': 'CLOUDY_ENV_BUCKET=peticiones-test\nCLOUDY_ENV_NUEVA=archivo\n' })
    touched.push('CLOUDY_ENV_BUCKET', 'CLOUDY_ENV_NUEVA')
    // Simula lo que Bun carga solo desde .env.development al arrancar.
    process.env.CLOUDY_ENV_BUCKET = 'peticiones-dev'
    expect(loadEnv('test', dir)).toEqual({ CLOUDY_ENV_BUCKET: 'peticiones-test', CLOUDY_ENV_NUEVA: 'archivo' })
    expect(process.env.CLOUDY_ENV_BUCKET).toBe('peticiones-test')
    expect(process.env.CLOUDY_ENV_NUEVA).toBe('archivo')
  })

  it('sin archivo (CI, Vercel) usa las variables reales del entorno', () => {
    const dir = project({})
    touched.push('CLOUDY_ENV_CI')
    process.env.CLOUDY_ENV_CI = 'secreto-del-ci'
    expect(loadEnv('production', dir)).toEqual({})
    expect(process.env.CLOUDY_ENV_CI).toBe('secreto-del-ci')
  })
})

describe('requireVar', () => {
  it('devuelve la variable o dice en qué archivo falta', () => {
    expect(requireVar({ A: '1' }, 'A', 'test')).toBe('1')
    expect(() => requireVar({}, 'NUXT_DATABASE_URL', 'production')).toThrow('Falta NUXT_DATABASE_URL en .env.')
  })
})
