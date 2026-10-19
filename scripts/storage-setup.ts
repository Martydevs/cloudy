// Aplica la política CORS al bucket del entorno elegido con APP_ENV (research R5).
// Uso: `bun run storage:setup` (desarrollo), `storage:setup:test` o `storage:setup:prod`.
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
import { corsOrigins } from './cors-origins'
import { loadEnv, requireVar, resolveAppEnv } from './env'

const appEnv = resolveAppEnv()
// `loadEnv` hace ganar al archivo: el valor dado en la línea de comandos
// (`CORS_EXTRA_ORIGINS=<alias> bun run storage:setup:prod`) se toma antes y se suma al del archivo.
const extraFromShell = process.env.CORS_EXTRA_ORIGINS
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

// Producción acepta su dominio y los extras (p. ej. el alias de vista previa); desarrollo y
// pruebas suman los puertos locales. Ver scripts/cors-origins.ts.
const origins = corsOrigins({
  appEnv,
  siteUrl: env.NUXT_PUBLIC_SITE_URL,
  extra: [extraFromShell, env.CORS_EXTRA_ORIGINS].filter(Boolean).join(','),
})
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
