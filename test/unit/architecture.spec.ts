// Feature 002 · reglas de capas (plan, "Organización por capas"; Constitución IV): la IA solo se usa por su
// superficie pública y solo desde la capa de aplicación; el SQL del texto solo vive en el store; los
// endpoints no lo tocan; `@vercel/functions` solo desde `background.ts`. Lee los fuentes reales.
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SOURCE_DIRS = ['server', 'app', 'shared']

/** Fuentes `.ts`/`.vue` del producto, con rutas relativas a la raíz y separadas por `/`. */
function sources(): { path: string, code: string }[] {
  return SOURCE_DIRS.flatMap(dir => readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(ts|vue)$/.test(entry.name))
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      return { path: relative(ROOT, full).split(sep).join('/'), code: readFileSync(full, 'utf8') }
    }))
}

/** Especificadores de `import … from '…'`, `import '…'`, `export … from '…'` e `import('…')` de un archivo. */
function imports(code: string): string[] {
  return [...code.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map(m => m[1]!)
}

/** Ruta de destino de un import desde `from` (relativa a la raíz), o el especificador si es de un paquete. */
function target(from: string, spec: string): string {
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(from), spec))
  if (spec.startsWith('#server/')) return `server/${spec.slice('#server/'.length)}`
  if (spec === '#server/ai' || spec === '#server') return spec.replace('#server', 'server')
  if (spec.startsWith('~~/')) return spec.slice(3)
  return spec
}

const inAi = (path: string) => /^server\/ai(\/|$)/.test(path)
const touchesAi = (from: string, spec: string) => spec === '#server/ai' || inAi(target(from, spec))

const files = sources()

describe('arquitectura de la feature 002', () => {
  it('resuelve los imports relativos y con alias', () => {
    expect(touchesAi('server/api/files/x.ts', '../../ai/index')).toBe(true)
    expect(touchesAi('server/utils/x.ts', '#server/ai/image-text/extract')).toBe(true)
    expect(touchesAi('server/utils/x.ts', '#server/ai')).toBe(true)
    expect(touchesAi('server/utils/x.ts', './storage')).toBe(false)
    expect(target('server/ai/image-text/extract.ts', '../breaker')).toBe('server/ai/breaker')
  })

  it('encuentra los fuentes', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.map(f => f.path)).toContain('server/ai/index.ts')
  })

  it('fuera de server/ai solo server/utils/image-text.ts importa la IA, y solo como #server/ai', () => {
    const offenders = files
      .filter(f => !inAi(f.path))
      .flatMap(f => imports(f.code)
        .filter(spec => touchesAi(f.path, spec))
        .filter(spec => !(f.path === 'server/utils/image-text.ts' && spec === '#server/ai'))
        .map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
    expect(imports(files.find(f => f.path === 'server/utils/image-text.ts')!.code)).toContain('#server/ai')
  })

  it('server/ai no importa la base de datos, server/utils ni h3', () => {
    const offenders = files
      .filter(f => inAi(f.path))
      .flatMap(f => imports(f.code)
        .filter((spec) => {
          const to = target(f.path, spec)
          return spec === 'h3' || (to.startsWith('server/') && !inAi(to))
        })
        .map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
  })

  it('ningún endpoint usa las funciones del store', () => {
    const store = ['claimImageText', 'saveImageTextResult', 'releaseImageText', 'markUnavailable', 'editImageTextQuery', 'setTextSourceKey', 'listPendingSubmissionImages', 'loadImageTextRow']
    const offenders = files
      .filter(f => f.path.startsWith('server/api/'))
      .flatMap(f => store.filter(name => new RegExp(`\\b${name}\\b`).test(f.code)).map(name => `${f.path} usa ${name}`))
    expect(offenders).toEqual([])
  })

  it('@vercel/functions solo aparece en server/utils/background.ts', () => {
    const users = files.filter(f => imports(f.code).some(spec => spec.startsWith('@vercel/functions'))).map(f => f.path)
    expect(users).toEqual(['server/utils/background.ts'])
  })

  it('los formularios validan solo con useFormSchema (esquemas zod): nada en app/ usa useRegle ni useRegleSchema directo', () => {
    // Los de Regle arrancarían con los modificadores por defecto (errores mientras se escribe) y sin esquemas zod.
    const direct = /\b(useRegle|useRegleSchema|inferRules)\b/
    const offenders = files
      .filter(f => f.path.startsWith('app/') && f.path !== 'app/utils/form-schema.ts')
      .filter(f => direct.test(f.code))
      .map(f => f.path)
    expect(offenders).toEqual([])
    // El único punto que toca la API de Regle es el que fija la configuración de todos los formularios.
    expect(files.find(f => f.path === 'app/utils/form-schema.ts')!.code).toMatch(/defineRegleSchemaConfig[\s\S]*from '@regle\/schemas'|from '@regle\/schemas'[\s\S]*defineRegleSchemaConfig/)
  })

  it('ninguna regla de @regle/rules en app/: los esquemas viven en app/utils/form-schemas.ts', () => {
    expect(files.filter(f => f.path.startsWith('app/') && imports(f.code).includes('@regle/rules')).map(f => f.path)).toEqual([])
  })

  // Feature 005 (research D1): una sola puerta al servicio de descargas; la clave nunca llega al cliente.
  const BOUNDARY = 'server/utils/cloudy-api.ts'

  it('solo server/utils/cloudy-api.ts lee cloudyApiUrl y cloudyApiKey', () => {
    const offenders = files
      .filter(f => f.path !== BOUNDARY && /\bcloudyApi(Url|Key)\b/.test(f.code))
      .map(f => f.path)
    expect(offenders).toEqual([])
    expect(files.find(f => f.path === BOUNDARY)!.code).toMatch(/cloudyApiKey/)
  })

  it('nada de app/ ni shared/ importa la frontera del servicio', () => {
    const offenders = files
      .filter(f => f.path.startsWith('app/') || f.path.startsWith('shared/'))
      .flatMap(f => imports(f.code).filter(spec => /server\/utils\/cloudy-api/.test(target(f.path, spec))).map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
  })

  it('los endpoints de YouTube no llaman a fetch: usan las funciones de la frontera', () => {
    const youtube = files.filter(f => f.path.startsWith('server/api/youtube/'))
    expect(youtube.length).toBeGreaterThan(0)
    const offenders = youtube.filter(f => /\b(\$?fetch|ofetch)\s*\(/.test(f.code)).map(f => f.path)
    expect(offenders).toEqual([])
    // En server/, solo la frontera habla con el servicio: `/v1/…`, `/v2/…`, `/${motor}/…` o `/healthz`.
    const callers = files
      .filter(f => f.path.startsWith('server/') && /['"`]\/((v1|v2|\$\{\w+\})\/(videos|jobs)|healthz)/.test(f.code))
      .map(f => f.path)
    expect(callers).toEqual([BOUNDARY])
    // Y la frontera arma las rutas con el motor: ninguna queda fija en `/v1` (el respaldo se decide en un solo lugar).
    const boundary = files.find(f => f.path === BOUNDARY)!.code
    expect(boundary).toMatch(/`\/\$\{\w+\}\/jobs/)
    expect(boundary).not.toMatch(/['"`]\/v[12]\/(videos|jobs)/)
  })

  // Feature 006 (research D1): una sola puerta a Apify; el parser de la letra es puro.
  const CRAWLER = 'server/utils/lyrics-crawler.ts'
  const PARSER = 'server/utils/lyrics-parser.ts'

  it('solo server/utils/lyrics-crawler.ts importa apify-client y lee apifyApiKey/apifyBaseUrl', () => {
    const importers = files.filter(f => imports(f.code).some(spec => spec === 'apify-client' || spec.startsWith('apify-client/'))).map(f => f.path)
    expect(importers).toEqual([CRAWLER])
    const readers = files.filter(f => /\bapify(ApiKey|BaseUrl)\b/.test(f.code)).map(f => f.path)
    expect(readers).toEqual([CRAWLER])
  })

  it('nada de app/ ni shared/ importa el rastreador', () => {
    const offenders = files
      .filter(f => f.path.startsWith('app/') || f.path.startsWith('shared/'))
      .flatMap(f => imports(f.code).filter(spec => /server\/utils\/lyrics-crawler/.test(target(f.path, spec))).map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
  })

  it('el parser de la letra no toca la red, el SDK ni la configuración', () => {
    const parser = files.find(f => f.path === PARSER)!
    expect(parser).toBeDefined()
    expect(imports(parser.code).filter(spec => spec === 'apify-client' || spec === '#imports' || spec === 'h3')).toEqual([])
    expect(parser.code).not.toMatch(/\buseRuntimeConfig\b|\b\$?fetch\s*\(/)
  })

  it('los endpoints de Canciones no llaman al SDK ni a fetch: usan crawlLetras y createLyricsPptx', () => {
    const songs = files.filter(f => f.path.startsWith('server/api/songs/'))
    expect(songs.length).toBeGreaterThan(0)
    const offenders = songs.filter(f => /\b(\$?fetch|ofetch)\s*\(|ApifyClient/.test(f.code)).map(f => f.path)
    expect(offenders).toEqual([])
    // En server/, solo la frontera de cloudy-api habla con el servicio de presentaciones.
    const callers = files.filter(f => f.path.startsWith('server/') && /['"`]\/v1\/lyrics/.test(f.code)).map(f => f.path)
    expect(callers).toEqual([BOUNDARY])
  })

  it('heic-to solo se carga con import() dinámico desde app/utils/heic-copy.ts', () => {
    const users = files.filter(f => imports(f.code).includes('heic-to')).map(f => f.path)
    expect(users).toEqual(['app/utils/heic-copy.ts'])
    expect(files.find(f => f.path === 'app/utils/heic-copy.ts')!.code).not.toMatch(/^import[^\n]+['"]heic-to['"]/m)
  })
})

describe('estilos globales', () => {
  // happy-dom no calcula el CSS de daisyUI: lo único que se puede vigilar sin navegador es que la regla exista,
  // y en `utilities` (daisyUI vive en `utilities.daisyui.l1.l2.l3`; en `components` o `base` perdería).
  it('los ítems de .menu se centran en vertical (daisyUI los alinea arriba) desde la capa utilities', () => {
    const css = readFileSync(join(ROOT, 'app/assets/css/globals.css'), 'utf8')
    expect(css).toMatch(/@layer utilities\s*\{\s*\.menu :where\(li:not\(\.menu-title\) > :not\(ul, menu, details, \.menu-title, \.btn\)\)\s*\{\s*align-content:\s*center;/)
  })
})
