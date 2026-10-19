# Research: Extracción del texto de notas e intenciones de oración

**Fase 0** del plan · 2026-10-19 · Spec: [spec.md](./spec.md)

Cada sección resuelve una incógnita con el formato *Decisión / Justificación / Alternativas*. Las versiones y
APIs se verificaron leyendo los paquetes instalados (`ai@7.0.145`, `@ai-sdk/openai@4.0.97`, `zod@4.6.7`) y la
documentación de OpenAI y Vercel.

---

## A1. Llamada al modelo con el AI SDK v7

**Decisión**: `generateText` con `output: Output.object({ schema })` y lectura de `result.output`.

- **Modelo**: `openaiClient(config)('gpt-4o')`. En `@ai-sdk/openai` v4 la llamada por defecto usa la
  **Responses API**, y `strictJsonSchema` viene activado por defecto, así que OpenAI garantiza el formato.
- **Instrucciones**: la opción es `instructions`, porque `system` quedó como alias obsoleto. Recibe
  `IMAGE_EXTRACTION_INSTRUCTION`.
- **Mensaje**: un `user` con dos partes:
  - `{ type: 'text', text: IMAGE_EXTRACTION_PROMPT }`.
  - `{ type: 'file', mediaType: 'image/jpeg' | 'image/png', data: Uint8Array, providerOptions: { openai: { imageDetail: 'high' } } }`.

  La parte `{ type: 'image' }` está obsoleta en v7.
- **Límites**:
  - `timeout: 30_000` ms y `maxRetries: 1`.
  - Un `abortSignal` propio con un tope total de 45 s, que cubre FR-007.
- **Errores**: `NoObjectGeneratedError.isInstance(e)` cuando la respuesta no se puede leer o no cumple el
  esquema. `NoOutputGeneratedError.isInstance(e)` cuando la ejecución no terminó en `stop`. `APICallError` del
  proveedor cubre timeout, 429, saldo agotado y 5xx. Todo se traduce a `failed` con un código interno
  (A5), nunca a texto.

**Justificación**: `generateObject` está marcado como `@deprecated` en v7, y `generateText` + `Output` es la
forma recomendada. El resultado estructurado elimina la cadena centinela `[texto no reconocido]`
(clarificación de la spec).

**Alternativas**:
- `openai.chat('gpt-4o')` (Chat Completions): funciona igual, pero no es la opción por defecto ni la
  recomendada.
- Texto libre con un centinela: lo rechazó el usuario en la clarificación.

## A2. Imagen como bytes, no como URL prefirmada

**Decisión**: el servidor descarga el objeto (≤ 5 MB) con `readRange(key, 0, size - 1)` de
`server/utils/storage.ts` y envía los bytes al modelo.

**Justificación**:
- Una URL prefirmada abriría a un tercero un enlace a un objeto privado; además caduca y depende de que OpenAI
  pueda alcanzarlo.
- Para HEIC se descarga la **copia JPEG** que subió el navegador (A4), no el original.
- Con bytes, el mismo `matchesSignature` del flujo de subida vuelve a verificar el contenido real antes de
  enviarlo (FR-021).
- 5 MB caben con holgura en memoria de una función.

**Alternativas**: URL prefirmada (descartada por privacidad); Files API de OpenAI (otra subida y
otro ciclo de vida que limpiar, sin beneficio).

> Constitución I prohíbe que los binarios **del usuario** pasen por funciones (límite de 4.5 MB del cuerpo).
> Aquí el binario no viaja en la petición ni en la respuesta HTTP: es una lectura servidor → almacenamiento de
> como máximo 5 MB. Se registra en Complexity Tracking.

## A3. Esquemas Zod de entrada y salida (directiva del usuario)

**Decisión**: los esquemas viven en `server/ai/schemas.ts` y se usan **solo en el flujo de IA**. Los
validadores propios de `shared/validation/*` siguen validando las peticiones HTTP, como en la feature 001.

| Esquema | Valida | Fallo → |
|---------|--------|---------|
| `imageSourceSchema` | `{ fileId: uuid, extension: 'jpg'\|'jpeg'\|'png'\|'heic', sizeBytes: int 1..5 242 880 }`, antes de descargar | `unavailable` (formato o tamaño) |
| `modelImageSchema` | `{ mediaType: 'image/jpeg'\|'image/png', data: Uint8Array no vacía ≤ 5 242 880 B }`, tras descargar el original o la copia JPEG de una HEIC | `failed` (`invalid_input`) |
| `imageTextOutputSchema` | `{ hasText: boolean, text: string }` con `.trim()`, `max(10 000)`; un refine exige `text` no vacío si `hasText` y vacío si no | `failed` (`invalid_output`) |

- `imageTextOutputSchema` se pasa a `Output.object` y además se vuelve a aplicar con `safeParse` sobre
  `result.output`. Las reglas que el JSON Schema estricto de OpenAI no expresa (el `refine` y el `trim`) solo
  se garantizan con esa segunda pasada.
- `hasText: false` → estado `empty` ("sin texto reconocido", FR-003).
- El límite de 5 MB se compara contra el tamaño **original** del archivo (clarificación). La copia JPEG de una
  HEIC también debe medir ≤ 5 MB: el navegador baja la calidad si hace falta (A4) y el servidor la valida al
  completar la subida.

**Justificación**: cumple la directiva del usuario y mantiene la frontera de IA autocontenida. Migrar los
validadores HTTP a Zod sería un cambio transversal fuera del alcance.

**Alternativas**: los validadores propios también para la IA (no cumplen la directiva y no producen el JSON
Schema que exige `Output.object`).

## A4. Conversión HEIC → JPEG en el navegador, al subir (`heic-to`)

**Hallazgo**: `heic-to@1.6.6`, que el usuario eligió e instaló, es **solo para navegador**:

- Su `src/index.js` usa `document.createElement('canvas')`, `ImageData`, `createImageBitmap` y `canvas.toBlob`,
  así que no puede correr en una función de Vercel.
- El bundle es de ~3 MB (libheif 1.23.6 en WASM embebido) y la licencia es LGPL-3.0.

**Decisión**: convertir al subir, en el navegador de quien sube, siguiendo el mismo patrón que las miniaturas
(R9 de la feature 001: generar en el cliente y subir con PUT prefirmado).

1. `app/utils/heic-copy.ts` → `makeTextSourceCopy(file): Promise<Blob | null>`.
   - Solo actúa si la extensión es `heic` y `file.size ≤ 5 MB` (`isImageTextEligible`).
   - Carga `heic-to` con `await import('heic-to')`, en un chunk aparte que **solo se descarga cuando se elige una
     HEIC**, para no tocar el presupuesto de 200 KB por ruta.
   - Llama a `heicTo({ blob: file, type: 'image/jpeg', quality: 0.85 })`; si el resultado supera 5 MB, reintenta
     una vez con 0.7.
   - Cualquier error devuelve `null`, como `makeThumbnail`.
2. `useUploader` (equipo) y `useGuestSubmission` (invitados) piden la firma con `withTextSource: true`, reciben
   `textSourceUploadUrl` y suben la copia **después** del original. Si la copia falla, se ignora: el archivo se
   sube igual (FR-023).
3. Al completar, el servidor valida la copia con `head` (0 < tamaño ≤ 5 MB) y `matchesSignature('jpg', …)`.
   - Si es válida, guarda `text_source_key`.
   - Si no lo es, borra el objeto y marca la imagen `unavailable`.
   - Una HEIC sin copia también queda `unavailable`, incluidas las subidas antes de esta feature (clarificación).
4. La clave es `textsrc/<id>.jpg`, derivada del id como `thumbs/<id>.webp`. Como la aprobación reutiliza el id
   del archivo de invitado, la copia sirve sin moverla.

**Justificación**: es la única ubicación donde `heic-to` funciona. Reutiliza un patrón existente y probado, y
deja al servidor sin procesamiento de imágenes (sigue cumpliendo R9 de la 001). Además el servidor ya no
necesita ninguna dependencia de conversión.

**Alternativas**:
- Convertir en el servidor (`heic-convert`): la descartó el usuario al elegir `heic-to`.
- Convertir al abrir la vista previa: no sirve para invitados leídos al recibir; lo descartó el usuario.
- Convertir al abrir, además, las HEIC antiguas: otra ruta de código; lo descartó el usuario.

**Riesgos**:
- En móvil 4G, el primer HEIC descarga ~3 MB extra; queda en caché después.
- Decodificar fotos de 12 MP en teléfonos modestos tarda unos segundos; la cola de subida muestra el estado
  "Preparando…" mientras tanto.
- LGPL-3.0: se carga como módulo aparte sin modificarlo, lo cual es compatible; se documenta en el plan.

## A5. Estados, reclamación concurrente y tiempo máximo

**Decisión**: una máquina de estados en columnas de la propia fila de la imagen (ver
[data-model.md](./data-model.md)):

```text
null (sin evaluar) ─▶ reading ─▶ ready | empty | failed
       └──────────────▶ unavailable   (formato o tamaño no apto; no se llama al modelo)
failed | ready | empty ── (reintentar / volver a leer) ─▶ reading
reading con text_started_at > 90 s ── se puede reclamar de nuevo
```

- **Reclamación atómica**: `UPDATE … SET text_status = 'reading', text_started_at = now(), text_attempts = text_attempts + 1
  WHERE id = $1 AND (text_status IS NULL OR text_status = ANY($allowed) OR (text_status = 'reading' AND text_started_at < now() - interval '90 seconds'))
  RETURNING …`. Si dos personas abren la imagen a la vez, solo una obtiene la fila; la otra recibe `reading` y
  consulta hasta ver el resultado. Esto cubre el caso límite de dos aperturas simultáneas.
- **Escritura del resultado**: `UPDATE … WHERE id = $1 AND text_status = 'reading' AND text_started_at = $claimedAt`.
  Así una lectura vencida que termina tarde no pisa una más nueva.
- **Códigos de error** (`text_error`, solo para registro y para el copy del mensaje): `timeout`, `provider`,
  `rate_limited`, `invalid_input`, `invalid_output`.

**Justificación**: el driver `neon-http` no tiene transacciones interactivas (R4 de la feature 001). Un
`UPDATE … RETURNING` condicional es atómico y no necesita bloqueo. El tope de 90 s es mayor que los 45 s de la
llamada, así que no reclama lecturas que siguen vivas.

## A6. Disparo: invitados al recibir, equipo al abrir

**Decisión**:
- **Equipo (FR-001b)**: al montar el panel de texto de la vista previa, el cliente llama a
  `POST /api/files/:id/text`. El servidor reclama la fila y **ejecuta la lectura dentro de la misma petición**
  (≤ 45 s), y responde con el resultado. Mientras, la UI muestra "Leyendo texto…". Si la fila ya está en
  `reading`, responde enseguida con ese estado y el cliente consulta `GET` cada 3 s.
- **Invitados (FR-009)**: `POST /api/public/submissions/:id/complete`, tras aceptar los archivos y antes de
  responder, llama a `await readSubmissionImages(submissionId, { concurrency: 4, deadlineMs: 40_000 })`.
  - **Pool**: un pool mínimo con `Promise` nativas (un índice compartido y 4 "trabajadores" `async` que toman la
    siguiente imagen), sin bibliotecas.
  - **Tope**: un `AbortSignal.timeout(40_000)` compartido, combinado con el tope de 30 s de cada lectura mediante
    `AbortSignal.any`. Al vencer el tope no se inician más lecturas; las que estaban en curso se abortan y quedan
    `failed` (`timeout`).
  - **Imágenes no iniciadas**: quedan en `NULL`.
  - **Reintentos**: `maxRetries: 0` en este camino, para que el tope sea predecible.
  - **Respuesta**: la misma de hoy. El guardado de cada resultado nunca lanza; si algo falla, el envío se confirma
    igual (FR-004).
- **Red de seguridad**: si al abrir Pendientes una imagen del envío sigue sin evaluar, en `failed` o con una
  lectura vencida, la tarjeta llama a `POST /api/submissions/:id/files/:fileId/text` (`force` solo con
  `failed`). Cubre el tope de 40 s y el límite de FR-008.
- **UI del invitado**: el botón Enviar muestra "Enviando… estamos leyendo tus notas" mientras espera.

**Justificación**:
- El usuario prohibió las bibliotecas de segundo plano. Además `event.waitUntil` de Nitro 2.13 **no** está
  conectado en el preset de Vercel para Node: la promesa no se espera tras responder. Así que la única forma
  fiable sin dependencias es leer **dentro** de la petición.
- La concurrencia de 4 mantiene la espera típica (1–3 fotos) en 5–15 s, y el tope de 40 s acota el peor caso.
  Todo cabe en el máximo por defecto de las funciones de Vercel (300 s con fluid compute), así que no hay que
  cambiar `maxDuration`.
- Para el equipo, la lectura síncrona al abrir es la opción más simple y fiable: no queda trabajo huérfano.

**Alternativas**:
- `@vercel/functions` `waitUntil`: prohibida por el usuario.
- Cola o worker externo: un servicio más (Constitución II).
- Cron cada minuto: Vercel Hobby no lo permite y la latencia no cumpliría SC-001.
- Leer solo al abrir Pendientes, o desde el navegador del invitado tras confirmar: el usuario los descartó.

## A7. Límite de costo de invitados (FR-008)

**Decisión**: `hitRateLimit(null, \`guest-text:${senderKey}\`, { limit: 20, windowSec: 3600 })` antes de cada
lectura dentro del envío. Al exceder el límite, la imagen queda sin evaluar (`null`) sin lanzar error, y se
leerá cuando un revisor abra el envío (A6).

**Justificación**: reutiliza el limitador en Postgres que ya existe. Los envíos ya están limitados a 5 por hora
con 20 archivos cada uno; este tope evita que un solo remitente genere 100 lecturas por hora.

## A8. Búsqueda por texto extraído (FR-015)

**Decisión**:
- `server/api/files/search.get.ts` agrega `OR files.text_content ILIKE $q` sobre el mismo patrón ya escapado.
- Índice GIN `pg_trgm` en `files.text_content`, que la migración agrega a mano como en la `0000`.
- Cada resultado devuelve `matchedIn: 'name' | 'text'`.
- La paginación por cursor no cambia.

**Justificación**: es el mismo mecanismo que ya cumple < 2 s con 5 000 elementos (SC-006).

**Alternativas**: `tsvector` con diccionario en español. Ofrece mejor ranking, pero no encuentra fragmentos de
palabras ni nombres propios mal escritos, y añade otra columna y otro trigger.

## A9. Pruebas sin llamar a OpenAI

**Decisión**:
- **Unitarias**: `MockLanguageModelV4` de `ai/test`, inyectado en `extractImageText({ …, model })`. Devuelve
  texto JSON válido, inválido o un error lanzado.
- **Componentes**: `mockApi` (helpers existentes de `test/nuxt`).
- **e2e**:
  - Un servidor stub de la Responses API, levantado en `global-setup.ts` en un puerto local.
  - La app de pruebas arranca con `NUXT_OPENAI_BASE_URL` apuntando a él.
  - El stub responde según el nombre del fixture (nota → texto, paisaje → `hasText: false`, `falla` → 500).
- **Calidad real (SC-002)**: no corre en CI. Es un paso manual del quickstart con 20 fotos reales.

**Justificación**: los e2e no deben depender de un servicio de pago ni de su latencia. `baseURL` es una opción
estándar de `createOpenAI`, así que no hace falta código de prueba en producción.

## A10. Organización del código de IA (pedido del usuario)

**Decisión**: `server/ai/` es la **única frontera con el proveedor de IA**, igual que `server/utils/auth.ts` y
`storage.ts` lo son para sus servicios (Constitución IV). Cada archivo tiene un solo propósito:

| Archivo | Responsabilidad |
|---------|-----------------|
| `server/ai/openai.ts` (existente) | Cliente `openaiClient(config)`, constante `IMAGE_TEXT_MODEL = 'gpt-4o'`, `IMAGE_EXTRACTION_INSTRUCTION` y `IMAGE_EXTRACTION_PROMPT` |
| `server/ai/schemas.ts` | Esquemas Zod de A3 y sus tipos inferidos |
| `server/ai/extract-image-text.ts` | `extractImageText({ image, model? })`: valida, llama al modelo, valida la salida y devuelve `ImageTextResult` (`ready`/`empty`/`failed` con código). Sin BD ni storage |
| `server/utils/image-text.ts` | Orquestación auto-importada: elegibilidad, reclamación (A5), descarga (original o copia JPEG), guardado, pool de lecturas del envío (A6), validación de la copia al completar (A4) y mapeo a DTO. Es lo que usan los endpoints |
| `app/utils/heic-copy.ts` (cliente) | `makeTextSourceCopy(file)`: carga `heic-to` bajo demanda y genera la copia JPEG (A4). No conoce al proveedor de IA |

Cambios en `openai.ts`, el archivo que el usuario ya preparó:
- Se corrige el typo `IMAGE_EXRTACTION_PROMPT` → `IMAGE_EXTRACTION_PROMPT`.
- `RuntimeConfig` se importa como tipo (`import type`).
- Se pasa `baseURL` opcional (A9).
- Las dos últimas reglas de la instrucción se ajustan al resultado estructurado: una imagen por llamada,
  `hasText`/`text` en lugar del centinela. El resto de las reglas del usuario (literal, sin "Skykids", idioma
  original, sin preámbulo) se conservan.

`shared/` solo recibe lo que ve el cliente: `IMAGE_TEXT_STATUSES`, las extensiones aptas, `MAX_IMAGE_TEXT_BYTES`,
`MAX_IMAGE_TEXT_LENGTH`, `isImageTextEligible()` y el DTO `ImageText`.
