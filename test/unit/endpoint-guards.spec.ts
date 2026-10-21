// T158 — Ningún endpoint de `server/api/**` omite el guard de sesión/rol (Constitución IV): ocultar
// la UI no es autorización. Las únicas excepciones son las rutas públicas (`public/*`, con límite por
// IP), el cron (`cron/*`, con `CRON_SECRET`) y `me.get` (cualquier sesión, aun pendiente, para saber
// su estado). Recorre los archivos reales para que un endpoint nuevo sin guard rompa la prueba.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const API_DIR = fileURLToPath(new URL('../../server/api', import.meta.url))

/** Rutas relativas a `server/api`, con `/` en cualquier sistema. */
function handlers(): string[] {
  return readdirSync(API_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => relative(API_DIR, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

const source = (file: string) => readFileSync(join(API_DIR, file), 'utf8')

const isPublic = (file: string) => file.startsWith('public/')
const isCron = (file: string) => file.startsWith('cron/')
const isMe = (file: string) => file === 'me.get.ts'

describe('guards de los endpoints', () => {
  const files = handlers()

  it('encuentra los handlers', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('me.get.ts')
    expect(files).toContain('cron/cleanup.get.ts')
    // Texto de las imágenes (feature 002): también pasan por el guard de abajo.
    expect(files).toEqual(expect.arrayContaining([
      'files/[id]/text.get.ts',
      'files/[id]/text.post.ts',
      'files/[id]/text.patch.ts',
      'submissions/[id]/files/[fileId]/text.get.ts',
      'submissions/[id]/files/[fileId]/text.post.ts',
    ]))
  })

  it.each(files.filter(f => !isPublic(f) && !isCron(f) && !isMe(f)))('%s exige sesión activa y rol', (file) => {
    expect(source(file), `${file} no llama a requireRole( ni a requireActive(`).toMatch(/\brequire(Role|Active)\(/)
  })

  it('cron/* se protege con el secreto de Vercel Cron', () => {
    for (const file of files.filter(isCron)) expect(source(file), file).toMatch(/\brequireCron\(/)
  })

  it('me.get exige sesión (cualquier estado: la cuenta pendiente consulta el suyo)', () => {
    expect(source('me.get.ts')).toMatch(/\brequireSession\(/)
  })

  it('public/* son solo las dos fases del envío de invitados y no leen la sesión', () => {
    // Una ruta pública nueva debe revisarse aquí a propósito.
    expect(files.filter(isPublic)).toEqual(['public/submissions/[id]/complete.post.ts', 'public/submissions/index.post.ts'])
    for (const file of files.filter(isPublic)) {
      expect(source(file), `${file} no debe leer la sesión`).not.toMatch(/\brequire(Role|Active|Session)\(/)
    }
    // Fase 1: límite por IP. Fase 2: el id del envío (UUID) es la capacidad; solo cierra envíos pendientes.
    expect(source('public/submissions/index.post.ts')).toMatch(/\bhitRateLimit\(/)
    expect(source('public/submissions/[id]/complete.post.ts')).toMatch(/submission\.status !== 'pending'/)
  })
})
