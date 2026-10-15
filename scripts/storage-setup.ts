// Aplica la política CORS a los buckets de Cloudy (research R5). Uso: `bun run storage:setup`.
import 'dotenv/config'
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`)
  return value
}

const client = new S3Client({
  endpoint: required('NUXT_AWS_ENDPOINT_URL_S3'),
  region: process.env.NUXT_AWS_REGION || 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: required('NUXT_AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('NUXT_AWS_SECRET_ACCESS_KEY'),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// 3000: `bun run dev` · 3100: servidor de los e2e (test/e2e/setup/fixtures.ts).
const origins = [...new Set(
  [process.env.NUXT_PUBLIC_SITE_URL, 'http://localhost:3000', 'http://localhost:3100'].filter(Boolean),
)] as string[]
const mainBucket = required('NUXT_S3_BUCKET')
const buckets = new Set([mainBucket, process.env.NUXT_TEST_S3_BUCKET].filter(Boolean) as string[])

for (const Bucket of buckets) {
  try {
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
    console.log(`CORS aplicado al bucket ${Bucket} para: ${origins.join(', ')}`)
  }
  catch (error) {
    // Los buckets son por rama de Neon: uno de otra rama no existe en este endpoint.
    if (Bucket !== mainBucket && (error as { name?: string }).name === 'NoSuchBucket') {
      console.warn(`Se omite ${Bucket}: no existe en este endpoint (bucket de otra rama).`)
      continue
    }
    throw error
  }
}
