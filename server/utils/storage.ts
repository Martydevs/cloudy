// Única frontera con Neon Object Storage (S3-compatible, path-style). Ver research R5.
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | undefined

function config() {
  return useRuntimeConfig()
}

function useS3(): S3Client {
  if (!client) {
    const c = config()
    client = new S3Client({
      endpoint: c.awsEndpointUrlS3,
      region: c.awsRegion || 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: c.awsAccessKeyId, secretAccessKey: c.awsSecretAccessKey },
      // Neon no soporta los checksums CRC por defecto del SDK y romperían los PUT prefirmados del navegador.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  return client
}

function bucket(): string {
  return config().s3Bucket
}

/** Antepone el prefijo de entorno (vacío en producción, `e2e/<runId>/` en pruebas). */
export function key(path: string): string {
  return `${config().storageKeyPrefix}${path}`
}

/** URL de PUT directo al bucket. Si se indica `contentLength`, el bucket rechaza otro tamaño. */
export async function presignPut(
  objectKey: string,
  { contentType, contentLength }: { contentType: string, contentLength?: number },
  expiresIn = 600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: objectKey,
    ContentType: contentType,
    ContentLength: contentLength,
  })
  return getSignedUrl(useS3(), command, {
    expiresIn,
    signableHeaders: new Set(['content-type', 'content-length']),
  })
}

export async function presignGet(
  objectKey: string,
  { download }: { download?: string } = {},
  expiresIn = 900,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: objectKey,
    ResponseContentDisposition: download
      ? `attachment; filename*=UTF-8''${encodeURIComponent(download)}`
      : undefined,
  })
  return getSignedUrl(useS3(), command, { expiresIn })
}

/** Metadatos del objeto, o `null` si no existe. */
export async function head(objectKey: string): Promise<{ size: number, contentType?: string } | null> {
  try {
    const res = await useS3().send(new HeadObjectCommand({ Bucket: bucket(), Key: objectKey }))
    return { size: res.ContentLength ?? 0, contentType: res.ContentType }
  }
  catch (error) {
    if (error instanceof NotFound || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) {
      return null
    }
    throw error
  }
}

/** Lee los bytes `[start, end]` (inclusive) del objeto. */
export async function readRange(objectKey: string, start = 0, end = 4095): Promise<Uint8Array> {
  const res = await useS3().send(new GetObjectCommand({
    Bucket: bucket(),
    Key: objectKey,
    Range: `bytes=${start}-${end}`,
  }))
  if (!res.Body) return new Uint8Array()
  return res.Body.transformToByteArray()
}

/** Borra las claves en lotes de 1000. Si `DeleteObjects` falla, recurre al borrado individual. */
export async function deleteMany(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000)
    try {
      await useS3().send(new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }))
    }
    catch {
      await Promise.all(batch.map(Key => useS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key }))))
    }
  }
}

export async function listPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await useS3().send(new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return keys
}
