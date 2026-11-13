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

  // Feature 007 (plan, Complexity Tracking): las imágenes de peticiones son otro caso de uso con su propia capa de aplicación.
  const AI_IMPORTERS = ['server/utils/image-text.ts', 'server/utils/prayer-images.ts']

  it('fuera de server/ai solo image-text.ts y prayer-images.ts importan la IA, y solo como #server/ai', () => {
    const offenders = files
      .filter(f => !inAi(f.path))
      .flatMap(f => imports(f.code)
        .filter(spec => touchesAi(f.path, spec))
        .filter(spec => !(AI_IMPORTERS.includes(f.path) && spec === '#server/ai'))
        .map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
    for (const path of AI_IMPORTERS) expect(imports(files.find(f => f.path === path)!.code), path).toContain('#server/ai')
  })

  it('ni app/, ni shared/, ni los endpoints importan la capa de aplicación de peticiones (feature 007)', () => {
    const offenders = files
      .filter(f => f.path.startsWith('app/') || f.path.startsWith('shared/') || f.path.startsWith('server/api/'))
      .flatMap(f => imports(f.code).filter(spec => /server\/utils\/prayer-images/.test(target(f.path, spec))).map(spec => `${f.path} → ${spec}`))
    expect(offenders).toEqual([])
    // El SQL de la feature vive solo en prayer-requests.ts, prayer-gallery.ts y prayer-collections.ts: los endpoints de
    // Peticiones no tocan drizzle.
    const endpoints = files.filter(f => f.path.startsWith('server/api/peticiones/'))
    expect(endpoints.length).toBeGreaterThan(0)
    expect(endpoints.filter(f => imports(f.code).some(spec => spec.startsWith('drizzle-orm') || spec.includes('db/schema'))).map(f => f.path)).toEqual([])
  })

  it('el SQL de las tablas de Peticiones solo vive en sus tres capas (más la limpieza diaria, que las llama)', () => {
    const PRAYER_SQL = ['server/utils/prayer-requests.ts', 'server/utils/prayer-gallery.ts', 'server/utils/prayer-collections.ts']
    const tables = /\b(prayerImages|prayerImageCollections|prayerImageCollectionItems)\b|\bprayer_image/
    const users = files
      .filter(f => (f.path.startsWith('server/') || f.path.startsWith('app/') || f.path.startsWith('shared/')) && f.path !== 'server/db/schema.ts')
      .filter(f => tables.test(f.code))
      .map(f => f.path)
      .sort()
    expect(users).toEqual(PRAYER_SQL.filter(path => path !== 'server/utils/prayer-requests.ts').sort())
    // La subida de la imagen generada pasa solo por la frontera de storage, desde la capa del historial.
    const putters = files.filter(f => /\bputObject\(/.test(f.code)).map(f => f.path).sort()
    expect(putters).toEqual(['server/utils/prayer-gallery.ts', 'server/utils/storage.ts'])
  })

  it('server/ai/prayer-image existe dentro de la frontera', () => {
    expect(files.map(f => f.path)).toEqual(expect.arrayContaining(['server/ai/prayer-image/generate.ts', 'server/ai/prayer-image/prompt.ts']))
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
    // En server/, solo la frontera habla con el servicio: `/api/videos…`, `/api/jobs…` o `/healthz`.
    const callers = files
      .filter(f => f.path.startsWith('server/') && /['"`]\/(api\/(videos|jobs)|healthz)/.test(f.code))
      .map(f => f.path)
    expect(callers).toEqual([BOUNDARY])
    // Y la frontera ya no usa las rutas versionadas que el servicio quitó (`/v1/…`, `/v2/…` responden 404).
    const boundary = files.find(f => f.path === BOUNDARY)!.code
    expect(boundary).toMatch(/['"`]\/api\/jobs/)
    expect(boundary).not.toMatch(/['"`]\/(v[12]|\$\{\w+\})\/(videos|jobs|lyrics)/)
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
    const callers = files.filter(f => f.path.startsWith('server/') && /['"`]\/api\/lyrics/.test(f.code)).map(f => f.path)
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

  it('las casillas tienen el aspecto de la tarjeta de Peticiones por defecto (primary y relleno base-100 sin marcar)', () => {
    const css = readFileSync(join(ROOT, 'app/assets/css/globals.css'), 'utf8')
    expect(css).toMatch(/@layer utilities\s*\{\s*\.checkbox:not\([^)]*\.checkbox-error\s*\)\s*\{\s*--input-color:\s*var\(--color-primary\);/)
    expect(css).toMatch(/\.checkbox:not\(:checked, :indeterminate[^)]*\)\s*\{\s*background-color:\s*var\(--color-base-100\);/)
  })

  it('ninguna casilla repite el fondo del tema ni lleva una pastilla translúcida detrás', () => {
    const offenders = files.filter(f => f.path.endsWith('.vue')).flatMap(({ path, code }) =>
      [...code.matchAll(/<label[^>]*>\s*<input[^>]*class="[^"]*\bcheckbox\b[^"]*"/g)]
        .filter(m => /\bbg-base-100\/|not-checked:bg-|\sbg-base-100\b/.test(m[0]))
        .map(() => path))
    expect(offenders).toEqual([])
  })
})
