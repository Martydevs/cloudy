// Orígenes de la política CORS del bucket (scripts/storage-setup.ts): el dominio del sitio, los
// puertos locales fuera de producción y, opcionalmente, `CORS_EXTRA_ORIGINS` (lista separada por
// comas) para sumar un alias estable de vista previa sin quitar el dominio final.
import type { AppEnv } from './env'

/** Puertos locales: 3000 `bun run dev` · 3100 servidor de los e2e (test/e2e/setup/constants.ts). */
export const LOCAL_ORIGINS = ['http://localhost:3000', 'http://localhost:3100'] as const

/** Un origen `https://` o `http://localhost[:puerto]`, sin ruta, consulta ni fragmento. */
export function isAllowedOrigin(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return false
  }
  const scheme = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  return scheme && url.origin === value
}

/**
 * Separa, recorta y valida `CORS_EXTRA_ORIGINS`. Falla con el valor exacto que no sirve: un origen
 * no es un secreto. Las entradas vacías (comas dobles, final) se ignoran.
 */
export function parseExtraOrigins(value: string | undefined): string[] {
  const entries = (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  for (const entry of entries) {
    if (!isAllowedOrigin(entry)) {
      throw new Error(`CORS_EXTRA_ORIGINS: «${entry}» no es un origen válido. Usa https://dominio[:puerto] o http://localhost[:puerto], sin ruta.`)
    }
  }
  return entries
}

/** Lista final, sin repetidos y en orden: sitio, extras y (fuera de producción) locales. */
export function corsOrigins({ appEnv, siteUrl, extra }: { appEnv: AppEnv, siteUrl?: string, extra?: string }): string[] {
  const local = appEnv === 'production' ? [] : LOCAL_ORIGINS
  return [...new Set([siteUrl, ...parseExtraOrigins(extra), ...local].filter((origin): origin is string => !!origin))]
}
