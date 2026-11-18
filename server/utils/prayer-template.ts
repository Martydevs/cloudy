// La plantilla de las imágenes de peticiones (`server/assets/peticiones/plantilla.jpg`) y su copia en el bucket. La
// generación ya no manda sus ~700 KB en base64 en cada llamada: la plantilla se sube una sola vez al bucket, con el hash de
// su contenido en la clave, y al modelo le llega una URL firmada de lectura. Si el almacenamiento falla, se mandan los bytes
// como antes: no hay un fallo nuevo. Aquí no se firma ni se lee ninguna foto de invitado.
import { createHash } from 'node:crypto'
import type { ImageAspectRatio } from '#shared/jpeg'
import { jpegSize, nearestAspectRatio } from '#shared/jpeg'
import { head, key, presignGet, putObject } from './storage'

/** Vida de la URL firmada: cubre una generación de 105 s con su reintento y la descarga de OpenRouter. */
const TEMPLATE_URL_TTL_SEC = 300

export interface PrayerTemplate {
  /** JPEG de la plantilla. */
  bytes: Uint8Array
  /** Clave de su copia en el bucket: cambia con el contenido, así una plantilla nueva nunca reutiliza la copia vieja. */
  objectKey: string
  /** Relación de aspecto para `image_config`, o `null` si el encabezado no se pudo leer. */
  aspectRatio: ImageAspectRatio | null
}

// El asset es inmutable dentro de un despliegue: se lee y se sube una vez por instancia.
let template: PrayerTemplate | null = null
let storedKey: string | null = null

/** Solo para las pruebas: olvida la plantilla y su copia. */
export function resetPrayerTemplate() {
  template = null
  storedKey = null
}

/** La plantilla empaquetada como server asset (`nitro.serverAssets`); `null` si falta o está vacía. */
export async function loadPrayerTemplate(): Promise<PrayerTemplate | null> {
  if (template) return template
  const raw = await useStorage('assets:peticiones').getItemRaw<Uint8Array | ArrayBuffer>('plantilla.jpg').catch(() => null)
  if (!raw) return null
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  if (bytes.byteLength === 0) return null
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const size = jpegSize(bytes)
  template = { bytes, objectKey: key(`peticiones/plantilla-${hash}.jpg`), aspectRatio: size ? nearestAspectRatio(size) : null }
  return template
}

/**
 * URL firmada https de la copia de la plantilla en el bucket; la sube si todavía no existe. `null` si el almacenamiento no
 * responde o la URL no es https (el modelo solo recibe URLs https sin descargarlas): el llamador manda entonces los bytes.
 */
export async function prayerTemplateUrl({ bytes, objectKey }: PrayerTemplate): Promise<URL | null> {
  try {
    if (storedKey !== objectKey) {
      if (!await head(objectKey)) await putObject(objectKey, bytes, 'image/jpeg')
      storedKey = objectKey
    }
    const url = new URL(await presignGet(objectKey, {}, TEMPLATE_URL_TTL_SEC))
    return url.protocol === 'https:' ? url : null
  }
  catch {
    console.warn('[prayer-image] template_url_failed')
    return null
  }
}
