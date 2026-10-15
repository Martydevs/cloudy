// Prepara el entorno aislado de los e2e (Constitución V, research R13):
// BD de pruebas migrada y vacía, prefijo de storage único por corrida, build y servidor en :3100.
import 'dotenv/config'
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import type { TestProject } from 'vitest/node'
import { E2E_PORT, E2E_URL } from './constants'

const TABLES = [
  'profiles', 'folders', 'files', 'guest_submissions', 'guest_submission_files',
  'comments', 'activity_log', 'rate_limits',
]

declare module 'vitest' {
  export interface ProvidedContext {
    runId: string
  }
}

async function waitForServer(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/me`)
      if (res.status === 401) return
    }
    catch {
      // Todavía arrancando.
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`El servidor de e2e no respondió en ${url}`)
}

export default async function setup(project: TestProject) {
  const testDb = process.env.NUXT_TEST_DATABASE_URL
  if (!testDb) throw new Error('Falta NUXT_TEST_DATABASE_URL: los e2e no pueden correr sin BD de pruebas.')
  if (testDb === process.env.NUXT_DATABASE_URL) {
    throw new Error('NUXT_TEST_DATABASE_URL es igual a NUXT_DATABASE_URL: los e2e nunca deben tocar la BD de desarrollo.')
  }

  const runId = randomUUID().slice(0, 8)
  const prefix = `e2e/${runId}/`
  project.provide('runId', runId)

  execSync('bunx drizzle-kit migrate', { stdio: 'inherit', env: { ...process.env, DRIZZLE_TARGET: 'test' } })
  const sql = neon(testDb)
  await sql.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)

  if (process.env.E2E_SKIP_BUILD !== '1' || !existsSync('.output/server/index.mjs')) {
    execSync('bunx nuxi build', { stdio: 'inherit' })
  }

  const server: ChildProcess = spawn('node', ['.output/server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(E2E_PORT),
      NUXT_DATABASE_URL: testDb,
      NUXT_STORAGE_KEY_PREFIX: prefix,
      NUXT_PUBLIC_SITE_URL: E2E_URL,
    },
    stdio: process.env.E2E_SERVER_LOGS === '1' ? 'inherit' : 'ignore',
  })
  await waitForServer(E2E_URL, 60_000)

  return async () => {
    server.kill()
    // El teardown borra los objetos de esta corrida; el storage se carga con las variables NUXT_*.
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      endpoint: process.env.NUXT_AWS_ENDPOINT_URL_S3,
      region: process.env.NUXT_AWS_REGION || 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.NUXT_AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.NUXT_AWS_SECRET_ACCESS_KEY ?? '',
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    const Bucket = process.env.NUXT_S3_BUCKET
    const listed = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))
    const keys = (listed.Contents ?? []).map(o => ({ Key: o.Key! }))
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }))
    }
  }
}
