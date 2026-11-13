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
    // La lectura de texto de imágenes se retiró: sus endpoints ya no existen.
    expect(files.filter(f => /\btext\.(get|post|patch)\.ts$/.test(f))).toEqual([])
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
    expect(files.filter(isPublic)).toEqual([
      'public/submissions/[id]/complete.post.ts',
      'public/submissions/index.post.ts',
    ])
    for (const file of files.filter(isPublic)) {
      expect(source(file), `${file} no debe leer la sesión`).not.toMatch(/\brequire(Role|Active|Session)\(/)
    }
    // Fase 1: límite por IP. Fase 2: el id del envío (UUID) es la capacidad; solo cierra envíos pendientes.
    expect(source('public/submissions/index.post.ts')).toMatch(/\bhitRateLimit\(/)
    expect(source('public/submissions/[id]/complete.post.ts')).toMatch(/submission\.status !== 'pending'/)
    expect(source('public/submissions/[id]/complete.post.ts')).toMatch(/\bhitRateLimit\(/)
  })

  it('los 16 endpoints de YouTube exigen rol de equipo y ninguno es público ni exento (feature 005)', () => {
    const youtube = files.filter(f => f.startsWith('youtube/'))
    expect(youtube).toEqual([
      'youtube/downloads/index.get.ts',
      'youtube/downloads/index.post.ts',
      'youtube/health.get.ts',
      'youtube/history/[videoId].delete.ts',
      'youtube/history/index.get.ts',
      'youtube/jobs/[jobId].delete.ts',
      'youtube/jobs/[jobId].get.ts',
      'youtube/jobs/index.post.ts',
      'youtube/playlists/[id]/index.delete.ts',
      'youtube/playlists/[id]/index.get.ts',
      'youtube/playlists/[id]/index.patch.ts',
      'youtube/playlists/[id]/items/[videoId].delete.ts',
      'youtube/playlists/[id]/items/index.post.ts',
      'youtube/playlists/index.get.ts',
      'youtube/playlists/index.post.ts',
      'youtube/videos/[videoId].get.ts',
    ])
    for (const file of youtube) expect(source(file), file).toMatch(/\brequireRole\(event, 'editor'\)/)
    expect(files.filter(f => (isPublic(f) || isCron(f)) && f.includes('youtube'))).toEqual([])
  })

  it('los endpoints de Canciones exigen rol de equipo y ninguno es público ni exento (feature 006)', () => {
    const songs = files.filter(f => f.startsWith('songs/'))
    expect(songs).toEqual(expect.arrayContaining([
      'songs/[id]/index.get.ts',
      'songs/[id]/pptx.post.ts',
      'songs/[id]/refresh.post.ts',
      'songs/collections/[id]/index.delete.ts',
      'songs/collections/[id]/index.get.ts',
      'songs/collections/[id]/index.patch.ts',
      'songs/collections/[id]/items/[songId].delete.ts',
      'songs/collections/[id]/items/index.post.ts',
      'songs/collections/index.get.ts',
      'songs/collections/index.post.ts',
      'songs/fetch.post.ts',
      'songs/history/[id].delete.ts',
      'songs/history/index.get.ts',
      'songs/presentations.post.ts',
    ]))
    // Los 14 de contracts/api.md, ni uno más sin revisarlo aquí.
    expect(songs).toHaveLength(14)
    for (const file of songs) expect(source(file), file).toMatch(/\brequireRole\(event, 'editor'\)/)
    expect(files.filter(f => (isPublic(f) || isCron(f)) && f.includes('songs'))).toEqual([])
  })

  it('los endpoints de Peticiones (con el historial y las colecciones) exigen rol de equipo y ninguno es público ni exento (feature 007)', () => {
    const prayers = files.filter(f => f.startsWith('peticiones/'))
    expect(prayers).toEqual([
      'peticiones/colecciones/[id]/index.delete.ts',
      'peticiones/colecciones/[id]/index.get.ts',
      'peticiones/colecciones/[id]/index.patch.ts',
      'peticiones/colecciones/[id]/items/[imageId].delete.ts',
      'peticiones/colecciones/[id]/items/index.post.ts',
      'peticiones/colecciones/index.get.ts',
      'peticiones/colecciones/index.post.ts',
      'peticiones/imagenes/[id]/content.get.ts',
      'peticiones/imagenes/[id]/index.delete.ts',
      'peticiones/imagenes/index.get.ts',
      'peticiones/imagenes/index.post.ts',
      'peticiones/index.get.ts',
    ])
    for (const file of prayers) expect(source(file), file).toMatch(/\brequireRole\(event, 'editor'\)/)
    expect(files.filter(f => (isPublic(f) || isCron(f)) && f.includes('peticiones'))).toEqual([])
  })

  it('la solicitud de acceso de invitados se retiró: no quedan sus endpoints', () => {
    expect(files.filter(f => f.startsWith('access-requests/') || f.startsWith('public/access/'))).toEqual([])
  })
})
