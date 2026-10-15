// Aplica la política CORS al bucket del entorno elegido con APP_ENV (research R5).
// Uso: `bun run storage:setup` (desarrollo), `storage:setup:test` o `storage:setup:prod`.
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
import { loadEnv, requireVar, resolveAppEnv } from './env'

const appEnv = resolveAppEnv()
loadEnv(appEnv)
const env = process.env
const need = (name: string) => requireVar(process.env, name, appEnv)

const client = new S3Client({
  endpoint: need('NUXT_AWS_ENDPOINT_URL_S3'),
  region: process.env.NUXT_AWS_REGION || 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: need('NUXT_AWS_ACCESS_KEY_ID'),
    secretAccessKey: need('NUXT_AWS_SECRET_ACCESS_KEY'),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// Producción solo acepta su dominio; desarrollo y pruebas, los puertos locales
// (3000: `bun run dev` · 3100: servidor de los e2e, ver test/e2e/setup/constants.ts).
const local = appEnv === 'production' ? [] : ['http://localhost:3000', 'http://localhost:3100']
const origins = [...new Set([env.NUXT_PUBLIC_SITE_URL, ...local].filter(Boolean))] as string[]
const Bucket = need('NUXT_S3_BUCKET')

await client.send(new PutBucketCorsCommand({
  Bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['content-type', 'content-length'],
      ExposeHeaders: ['etag'],
      MaxAgeSeconds: 3600,
    }],
  },
}))
console.log(`[${appEnv}] CORS aplicado al bucket ${Bucket} para: ${origins.join(', ')}`)
