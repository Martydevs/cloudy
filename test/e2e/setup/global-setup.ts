// Prepara el entorno aislado de los e2e (Constitución V, research R13):
// BD de pruebas migrada y vacía, prefijo de storage único por corrida, build y servidor en :3100.
import 'dotenv/config'
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import type { TestProject } from 'vitest/node'
import { ENV_FILES, readEnvFile, requireVar } from '../../../scripts/env'
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

/** La BD de pruebas no puede coincidir con la de ningún otro entorno (Constitución V). */
function assertIsolated(testDb: string) {
  for (const other of ['development', 'production'] as const) {
    let otherDb: string | undefined
    try {
      otherDb = readEnvFile(other).NUXT_DATABASE_URL
    }
    catch {
      continue // Ese archivo no existe en esta máquina (p. ej. en CI).
    }
    if (otherDb === testDb) {
      throw new Error(`${ENV_FILES.test} apunta a la misma BD que ${ENV_FILES[other]}: los e2e solo corren en la rama de pruebas.`)
    }
  }
}

export default async function setup(project: TestProject) {
  // Las variables de .env.test ganan a las del shell: un NUXT_* suelto no puede sacar los e2e de la rama de pruebas.
  const testEnv = { ...process.env, ...readEnvFile('test') }
  const testDb = requireVar(testEnv, 'NUXT_DATABASE_URL', 'test')
  assertIsolated(testDb)

  const runId = randomUUID().slice(0, 8)
  const prefix = `e2e/${runId}/`
  project.provide('runId', runId)

  execSync('bunx drizzle-kit migrate', { stdio: 'inherit', env: { ...testEnv, APP_ENV: 'test' } })
  const sql = neon(testDb)
  await sql.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)

  if (process.env.E2E_SKIP_BUILD !== '1' || !existsSync('.output/server/index.mjs')) {
    execSync('bunx nuxi build', { stdio: 'inherit' })
  }

  const server: ChildProcess = spawn('node', ['.output/server/index.mjs'], {
    env: {
      ...testEnv,
      PORT: String(E2E_PORT),
      NUXT_STORAGE_KEY_PREFIX: prefix,
      NUXT_PUBLIC_SITE_URL: E2E_URL,
    },
    stdio: process.env.E2E_SERVER_LOGS === '1' ? 'inherit' : 'ignore',
  })
  await waitForServer(E2E_URL, 60_000)

  return async () => {
    server.kill()
    // El teardown borra los objetos de esta corrida del bucket de pruebas.
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      endpoint: testEnv.NUXT_AWS_ENDPOINT_URL_S3,
      region: testEnv.NUXT_AWS_REGION || 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: testEnv.NUXT_AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: testEnv.NUXT_AWS_SECRET_ACCESS_KEY ?? '',
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    const Bucket = testEnv.NUXT_S3_BUCKET
    const listed = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))
    const keys = (listed.Contents ?? []).map(o => ({ Key: o.Key! }))
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }))
    }
  }
}
