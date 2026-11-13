# Contrato de API: `/api/peticiones/**` y reutilizados

Todos los endpoints: `requireRole(event, 'editor')` (editores y administradores), entrada validada con `readValid`/`queryValid` (`shared/validation/prayers.ts`),
`Cache-Control: no-store`. Errores con el cuerpo habitual de Nitro (`statusCode`, `message` en español, `data` opcional); el navegador solo muestra
`serverMessage()`. Ningún cuerpo ni registro lleva `NUXT_OPENROUTER_APIKEY`, nombres de invitados ni texto de peticiones (los registros llevan solo códigos).

## Resumen

| # | Método y ruta | Historia | Qué hace |
|---|---------------|----------|----------|
| 1 | `GET /api/peticiones` | US1, US4 | Página de peticiones aprobadas (keyset), con búsqueda, rango de fechas y orden |
| 2 | `POST /api/peticiones/imagenes` | US2 | Genera **una** imagen con hasta 4 peticiones sobre la plantilla, la guarda y devuelve su JSON *(enmendado, § 5)* |
| 5 | `GET /api/peticiones/imagenes` · `GET …/imagenes/:id/content` · `DELETE …/imagenes/:id` | Historial | Historial keyset, ver/descargar por 302 firmado, eliminar (autora o admin) |
| 6 | `GET`/`POST /api/peticiones/colecciones` · `GET`/`PATCH`/`DELETE …/colecciones/:id` · `POST …/:id/items` · `DELETE …/:id/items/:imageId` | Colecciones | Colecciones de imágenes generadas (forma de `songs/collections`) |
| — | `PATCH /api/files/:id/text` | US3 | **Existente** (feature 002): corrige la transcripción. Gana un límite de tasa (ver § 3) |
| — | `GET`/`POST /api/files/:id/text` | US3 | **Existentes**: estado y relectura que usa `ImageTextPanel` |
| — | `GET /api/files/:id/content` | US1 | **Existente**: 302 a la foto firmada (vista previa de la tarjeta) |

## 1. `GET /api/peticiones`

Query (`prayersQuery`, todo opcional):

| Parámetro | Regla | Efecto |
|-----------|-------|--------|
| `q` | `str({ min: 0, max: 100 })` | Coincidencia en nombre de quien envió, nota o transcripción, sin mayúsculas ni tildes |
| `from` | ISO 8601, inclusivo | `gs.reviewed_at >= from` |
| `to` | ISO 8601, exclusivo (`from < to`) | `gs.reviewed_at < to` |
| `dir` | `asc` \| `desc` (por defecto `desc`) | Orden por `reviewed_at`, desempate por `f.id` en la misma dirección |
| `cursor` | opaco, ≤ 500 car. | Página siguiente (`decodeCursor`; inválido ⇒ `422`) |

Respuesta `200` — `Paginated<PrayerRequest>` (`shared/types/api.ts`):

```jsonc
{
  "items": [{
    "id": "uuid",                       // files.id
    "name": "tarjeta-1.jpg",
    "senderName": "Ana",
    "note": "para el culto del domingo", // o null
    "sentAt": "2026-11-06T22:14:03.120Z",
    "approvedAt": "2026-11-07T14:02:45.903Z",
    "previewUrl": "/api/files/<id>/content",
    "text": { "status": "ready", "text": "Oremos por…", "error": null,
              "readAt": "…", "editedAt": null, "editedBy": null }   // ImageText de la feature 002
  }],
  "nextCursor": "base64url…" // o null
}
```

- Solo imágenes de envíos **aprobados**, `upload_status = 'ready'` y fuera de la papelera. Tamaño de página: **12** (`PRAYER_PAGE_SIZE`).
- `text.text` solo viaja con `status = 'ready'`; una lectura `reading` vencida se muestra `failed/timeout` (`toImageText`).
- Sin resultados ⇒ `{ "items": [], "nextCursor": null }` (`200`).

| Estado | Condición |
|--------|-----------|
| `200` | Página (posiblemente vacía) |
| `401` / `403` | Sin sesión / sin rol de equipo (guard habitual) |
| `422` | `from ≥ to`, fecha o cursor mal formados, `q` > 100 (`data.errors`) |

## 2. `POST /api/peticiones/imagenes`

Cuerpo (`prayerImageInput`): `{ "fileIds": ["uuid", …] }` — de 1 a 4, sin repetidos. **El navegador no manda texto**: el servidor lo lee en ese momento (FR-027).

Flujo (`server/utils/prayer-images.ts`):

1. `requireRole('editor')` → `readValid` → `hitRateLimit(event, 'peticiones-img:<userId>', { limit: 60, windowSec: 3600 })`.
2. `loadEligibleRequests(fileIds)` (`prayer-requests.ts`): mismas condiciones del listado + `text_status = 'ready'` y texto no vacío. Si falta alguna ⇒ `409 request_unavailable` con `data.ids`.
3. Ordena por `(reviewed_at, sent_at, id)` ascendente → `paragraphs: string[]` (texto tal cual, `trim`).
4. Lee la plantilla (`assets:peticiones/plantilla.jpg`); sin clave de OpenRouter o sin plantilla ⇒ `503 not_configured`, **sin llamar a nadie**.
5. `generatePrayerImage({ paragraphs, template })` (`#server/ai`): 1 llamada, intento de 90 s, tope duro de 105 s, 1 reintento solo en 429/5xx.
6. Valida `mediaType` `image/*` y `bytes ≤ 4 000 000`; responde el binario.

~~Respuesta `200`: cuerpo = bytes de la imagen · `Content-Type: image/png|image/jpeg` · `Content-Disposition: inline; filename="peticiones.<ext>"` ·
`Cache-Control: no-store` · `X-Peticiones-Count: <n>` (párrafos incluidos). **No se guarda nada** en el bucket ni en la base.~~ *Enmendado (2026-11-12)*: ver § 5.

Errores (JSON; el cliente que pide `blob` lo lee de `response._data` como en `useSongPresentations`):

| Estado | `data.code` | Condición | ¿Reintentable? |
|--------|-------------|-----------|----------------|
| `401` / `403` | — | Sin sesión / sin rol | — |
| `409` | `request_unavailable` (+ `data.ids`) | Alguna petición ya no existe, no está aprobada, está en la papelera o no tiene texto | No (se retiran de la selección) |
| `422` | — | `fileIds` vacío, > 4, repetidos o no-uuid | — |
| `429` | `rate_limited` | Límite de uso propio (60/h) o del proveedor | Sí, tras `Retry-After` |
| `502` | `provider` | Fallo del proveedor | Sí |
| `502` | `invalid_output` | El modelo no devolvió una imagen | Sí (**Generar de nuevo**) |
| `502` | `too_large` | La imagen superó 4 000 000 bytes | Sí |
| `503` | `not_configured` | Sin clave de OpenRouter o sin plantilla | No |
| `503` | `quota_exceeded` | OpenRouter 402 (sin saldo) | No |
| `504` | `timeout` | Plazo de 105 s (o 504 de la plataforma) | Sí |
| `502` | `save_failed` | *(enmienda)* La imagen se generó pero no se pudo subir al bucket o guardar su fila (sin objeto suelto) | Sí |

Mensajes en español por código: `PRAYER_ERROR_MESSAGES` (`shared/constants/prayers.ts`), usados por `usePrayerImages` y compartidos con las pruebas.
Registro del servidor: solo `[prayer-image] <código>`; nunca el texto, el nombre ni la respuesta del modelo.

## 3. Cambios en endpoints existentes

- `PATCH /api/files/:id/text` (feature 002): se agrega `hitRateLimit(event, 'text-edit:<userId>', { limit: 120, windowSec: 3600 })` antes de guardar (FR-033).
  Sin otro cambio de comportamiento; la respuesta, `409` y la actividad `file.text_edit` siguen igual.
- Sin cambios en `POST /api/submissions/:id/approve`: sigue copiando el texto a `files`, que es lo que lista esta feature.

## 5. Historial de imágenes generadas (enmienda 2026-11-12)

**`POST /api/peticiones/imagenes`** (cambia la respuesta): tras validar el tipo (`image/png|jpeg|webp`, si no `502 invalid_output`) sube
la imagen con `putObject` (`server/utils/storage.ts`) a `key('peticiones/<id>.<ext>')`, inserta la fila en `prayer_images` y responde
**`201`** con `PrayerGeneratedImage` (`Cache-Control: no-store`). Si el insert falla se borra el objeto subido y responde `502 save_failed`.
El binario ya no vuelve por la función: sube **al bucket** desde el servidor (≤ 4 MB, acotado por `PRAYER_IMAGE_MAX_BYTES`). El límite
de 60 por hora y el resto de errores no cambian.

**`GET /api/peticiones/imagenes`** (`prayerHistoryQuery`: `limit` 1–48, 12 por defecto; `cursor`): `{ items: PrayerGeneratedImage[], nextCursor }`,
keyset sobre `(created_at, id)` descendente, `Cache-Control: no-store`. Global del equipo. Cursor manipulado ⇒ `422`.

**`GET /api/peticiones/imagenes/:id/content`**: `302` a `presignGet` (`Cache-Control: private, max-age=600`). Con `?download=1`,
`Content-Disposition: attachment` con el nombre `peticiones-AAAA-MM-DD-<6 del id>.<ext>` (fecha UTC). `404` si ya no existe.

**`DELETE /api/peticiones/imagenes/:id`**: autora o `prayers.moderate` (admin); si no, `403` «Solo quien la generó o un administrador
puede eliminar esta imagen.». Borra la fila (sus elementos de colección caen en cascada) y después el objeto. `204`; `404` si no existe.

## 6. Colecciones de imágenes (enmienda 2026-11-12)

Misma forma que `/api/songs/collections` (feature 006); el SQL vive en `server/utils/prayer-collections.ts`.

| Método y ruta | Quién | Respuesta |
|---------------|-------|-----------|
| `GET /api/peticiones/colecciones` | equipo | `{ items: PrayerImageCollection[] }`, conteo por subconsulta en la misma sentencia, `updated_at` desc |
| `POST /api/peticiones/colecciones` `{ name, imageId? }` | equipo | `201` `PrayerImageCollection`; con `imageId` crea colección + elemento en un `db.batch`; imagen inexistente ⇒ `404` sin crear nada |
| `GET /api/peticiones/colecciones/:id` | equipo | `PrayerImageCollectionDetail` (colección + imágenes en un `db.batch`); `404` |
| `PATCH /api/peticiones/colecciones/:id` `{ name }` | autora o admin | `PrayerImageCollection`; `403`/`404`/`422` |
| `DELETE /api/peticiones/colecciones/:id` | autora o admin | `204`; las imágenes siguen en el historial |
| `POST /api/peticiones/colecciones/:id/items` `{ imageId }` | equipo | `{ added }` idempotente (`ON CONFLICT DO NOTHING`); `404` colección o imagen |
| `DELETE /api/peticiones/colecciones/:id/items/:imageId` | equipo | `204` idempotente |

Limpieza diaria (`GET /api/cron/cleanup`, paso 7): `expiredPrayerImages` = imágenes de más de 30 días fuera de toda colección,
borradas en lotes de 500 (filas, luego objetos).

## 4. Frontera con el proveedor (`server/ai/prayer-image/`)

```ts
// server/ai/index.ts (nuevas exportaciones)
export { generatePrayerImage } from './prayer-image/generate'
export type { PrayerImageErrorCode, PrayerImageResult } from './prayer-image/generate'
export { resolvePrayerImageModel } from './providers/openrouter'

generatePrayerImage(options: {
  paragraphs: string[]              // 1–4, cada uno 1–10 000 car.
  template: Uint8Array              // JPEG de la plantilla
  model?: LanguageModel | null      // por defecto resolvePrayerImageModel(useRuntimeConfig()); null ⇒ no llama a nadie
  abortSignal?: AbortSignal
}): Promise<
  | { status: 'ready', mediaType: string, data: Uint8Array }
  | { status: 'failed', error: 'timeout' | 'provider' | 'rate_limited' | 'quota_exceeded' | 'invalid_output' | 'invalid_input' | 'too_large' }
>
```

Solicitud al proveedor: modelo `@preset/pray-requests-image-generation` · `extraBody: { modalities: ['image', 'text'] }` · un mensaje de usuario con
`[{ type: 'text', text: buildPrayerPrompt(paragraphs) }, { type: 'file', mediaType: 'image/jpeg', data: template }]` · `timeout: 90_000` · `maxRetries: 1` ·
`AbortSignal.any([abortSignal, AbortSignal.timeout(105_000)])`. Nunca lanza. Sin clave (`openrouterApikey` vacío) ⇒ `model = null` ⇒ `failed/provider` sin red; el módulo de
aplicación lo traduce a `not_configured` cuando comprueba la clave antes.
