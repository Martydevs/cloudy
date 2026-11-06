// Puerto fijo para que el origen esté en la política CORS del bucket (scripts/storage-setup.ts).
export const E2E_PORT = 3100
export const E2E_URL = `http://localhost:${E2E_PORT}`

/**
 * Enlaces de escenario del stub de Apify (feature 006, `apify-stub.ts`): el último segmento elige qué devuelve. Para
 * canciones distintas en una misma corrida, usar `letrasUrl('<slug-único>')`.
 */
export const letrasUrl = (slug: string) => `https://www.letras.com/e2e/${slug}/`
export const APIFY_SCENARIOS = {
  /** La página real del fixture (quickstart § 2). */
  real: 'https://www.letras.com/musiko/de-buenas-part-josh-gamez/',
  noLyrics: letrasUrl('sin-letra'),
  tooLong: letrasUrl('muy-larga'),
  runFailed: letrasUrl('fallo-del-run'),
  noCredit: letrasUrl('sin-credito'),
  redirects: letrasUrl('redirige'),
  withAccents: letrasUrl('con-tildes'),
} as const
