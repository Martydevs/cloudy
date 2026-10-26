# Research: Extracción del texto de notas e intenciones de oración

**Fase 0** del plan · 2026-10-19 · Spec: [spec.md](./spec.md)

Cada sección resuelve una incógnita con el formato *Decisión / Justificación / Alternativas*. Las versiones y
APIs se verificaron leyendo los paquetes instalados (`ai@7.0.145`, `@ai-sdk/openai@4.0.97`,
`@ai-sdk/google@4.0.101`, `zod@4.6.7`) y la documentación de OpenAI, Google y Vercel.

---

## A1. Llamada al modelo con el AI SDK v7

**Decisión**: `generateText` con `output: Output.object({ schema })` y lectura de `result.output`.

- **Modelo**: `extractImageText` recorre en orden los candidatos de `resolveImageTextCandidates(config)` (A11):
  - **Principal**, OpenAI: `openaiClient(config)('gpt-4o')`. En `@ai-sdk/openai` v4 la llamada por defecto usa
    la **Responses API**, y `strictJsonSchema` viene activado por defecto, así que OpenAI garantiza el formato.
  - **Respaldo**, Google: `googleClient(config)('gemini-3.5-flash-lite')`. `@ai-sdk/google` convierte el esquema de
    `Output.object` en el esquema de respuesta de Gemini (`structuredOutputs` activo por defecto), así que la
    llamada, el prompt y el esquema son los mismos.
- **Instrucciones**: la opción es `instructions`, porque `system` quedó como alias obsoleto. Recibe
  `IMAGE_EXTRACTION_INSTRUCTION`.
- **Mensaje**: un `user` con dos partes:
  - `{ type: 'text', text: IMAGE_EXTRACTION_PROMPT }`.
  - `{ type: 'file', mediaType: 'image/jpeg' | 'image/png', data: Uint8Array, providerOptions: { openai: { imageDetail: 'high' } } }`.
    Los bytes se envían tal como están guardados: el original JPEG/PNG o la copia JPEG de una HEIC.
    Las `providerOptions` se leen por clave de proveedor: Gemini ignora `openai.imageDetail`, y su resolución se pide en
    la llamada (A11).

  La parte `{ type: 'image' }` está obsoleta en v7.
- **Límites**:
  - Sin respaldo disponible: `timeout: 30_000` ms y `maxRetries: 1`. Con respaldo: el principal usa
    `timeout: 20_000` y `maxRetries: 0` para fallar rápido y pasar al respaldo, y el último candidato conserva
    `timeout: 30_000` y `maxRetries: 1`. Igual en todos los caminos (equipo al subir o al abrir, invitados en
    segundo plano, Reintentar y Volver a leer).
  - Un `abortSignal` propio con un tope total de 45 s **para todos los intentos juntos**, que cubre FR-007. El pool de invitados le combina además
    su presupuesto global (A6).
- **Errores**: `NoObjectGeneratedError.isInstance(e)` cuando la respuesta no se puede leer o no cumple el
  esquema. `NoOutputGeneratedError.isInstance(e)` cuando la ejecución no terminó en `stop`. `APICallError` del
  proveedor (OpenAI o Google) cubre timeout, 429, saldo o cuota agotados y 5xx. Todo se traduce a `failed` con un código interno
  (A5), nunca a texto; cuáles de esos errores activan el respaldo está en A11.

**Justificación**: `generateObject` está marcado como `@deprecated` en v7, y `generateText` + `Output` es la
forma recomendada. El resultado estructurado elimina la cadena centinela `[texto no reconocido]`
(clarificación de la spec).

**Alternativas**:
- `openai.chat('gpt-4o')` (Chat Completions): funciona igual, pero no es la opción por defecto ni la
  recomendada.
- `generateObject` o la API nativa de Gemini (`@google/genai`): descartadas; `generateText` + `Output.object`
  funciona igual con ambos adaptadores y no añade dependencias.
- Texto libre con un centinela: lo rechazó el usuario en la clarificación.

## A2. Imagen como bytes, no como URL prefirmada

**Decisión**: el servidor descarga el objeto (≤ 5 MB) con `readRange(key, 0, size - 1)` de
`server/utils/storage.ts` y envía los bytes al modelo.

**Justificación**:
- Una URL prefirmada abriría a un tercero (OpenAI o Google) un enlace a un objeto privado; además caduca y
  depende de que el proveedor pueda alcanzarlo.
- Para HEIC se descarga la **copia JPEG** que subió el navegador (A4), no el original.
- Con bytes, el mismo `matchesSignature` del flujo de subida vuelve a verificar el contenido real antes de
  enviarlo (FR-021); si no coincide con la extensión, la imagen queda `unavailable` (formato no apto).
- Tras la firma, los bytes se validan con `modelImageSchema` (A3) y van al modelo tal cual: el servidor no
  procesa imágenes.
- 5 MB caben con holgura en memoria de una función.

**Alternativas**: URL prefirmada (descartada por privacidad); Files API de OpenAI o de Google (otra subida
y otro ciclo de vida que limpiar, sin beneficio).

> Constitución I prohíbe que los binarios **del usuario** pasen por funciones (límite de 4.5 MB del cuerpo).
> Aquí el binario no viaja en la petición ni en la respuesta HTTP: es una lectura servidor → almacenamiento de
> como máximo 5 MB. Se registra en Complexity Tracking.

## A3. Esquemas Zod de entrada y salida (directiva del usuario)

**Decisión**: los esquemas viven en `server/ai/image-text/schemas.ts` y se usan **solo en el flujo de IA**. Los
validadores propios de `shared/validation/*` siguen validando las peticiones HTTP, como en la feature 001.

| Esquema | Valida | Fallo → |
|---------|--------|---------|
| `imageSourceSchema` | `{ fileId: uuid, extension: 'jpg'\|'jpeg'\|'png'\|'heic', sizeBytes: int 1..5 242 880 }`, antes de descargar | `unavailable` (formato o tamaño); otro fallo → `failed` (`invalid_input`) |
| `modelImageSchema` | `{ mediaType: 'image/jpeg' \| 'image/png', data: Uint8Array no vacía ≤ 5 242 880 B }`, sobre los bytes descargados (el original JPEG/PNG o la copia JPEG de una HEIC) | `failed` (`invalid_input`) |
| `imageTextOutputSchema` | `{ hasText: boolean, text: string }` con `.trim()`, `max(10 000)`; un refine exige `text` no vacío si `hasText` y vacío si no | `failed` (`invalid_output`) |

- `imageTextOutputSchema` se pasa a `Output.object` y además se vuelve a aplicar con `safeParse` sobre
  `result.output`. Las reglas que el JSON Schema estricto del proveedor (OpenAI o Gemini) no expresa (el `refine` y el `trim`) solo
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

1. `app/utils/heic-copy.ts` → `makeTextSourceCopy(file): Promise<Blob | null>` y
   `uploadTextSourceCopy(file, url): Promise<void>` (convierte y hace el PUT; nunca rechaza), compartidos por
   `useUploader` y `useGuestSubmission`.
   - Solo actúa si la extensión es `heic` y `file.size ≤ 5 MB` (`isImageTextEligible`).
   - Carga `heic-to` con `await import('heic-to')`, en un chunk aparte que **solo se descarga cuando se elige una
     HEIC**, para no tocar el presupuesto de 200 KB por ruta.
   - Llama a `heicTo({ blob: file, type: 'image/jpeg', quality: 0.85 })`; si el resultado supera 5 MB, reintenta
     una vez con 0.7.
   - Cualquier error devuelve `null`, como `makeThumbnail`.
2. `useUploader` (equipo) y `useGuestSubmission` (invitados) piden la firma con `withTextSource: true` para cada
   HEIC apta **sin esperar la conversión**, reciben `textSourceUploadUrl`, empiezan a subir el original de
   inmediato y convierten la copia **en paralelo**; la copia se sube antes de llamar a `complete`, que espera a
   ambas. Si la copia falla, se ignora: el archivo se sube igual (FR-023).
3. Al completar, el servidor valida la copia con `head` (0 < tamaño ≤ 5 MB) y `matchesSignature('jpg', …)`.
   - Si es válida, guarda `text_source_key`.
   - Si no lo es, borra el objeto y marca la imagen `unavailable`.
   - Una HEIC sin copia también queda `unavailable`, incluidas las subidas antes de esta feature (clarificación).
4. La clave es `textsrc/<id>.jpg`, derivada del id como `thumbs/<id>.webp`. Como la aprobación reutiliza el id
   del archivo de invitado, la copia sirve sin moverla.

**Justificación**: el modelo no acepta HEIC y `heic-to` solo funciona en el navegador, así que es ahí donde se
hace la copia JPEG; el servidor no procesa imágenes. Reutiliza un patrón existente y probado.

**Alternativas**:
- Convertir en el servidor (`heic-convert`): la descartó el usuario al elegir `heic-to`, y añadiría
  procesamiento de imágenes al servidor.
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
  RETURNING …`. Si dos personas abren la imagen a la vez, o alguien la abre mientras la lectura de segundo
  plano sigue en curso, solo una reclamación obtiene la fila; el resto recibe `reading` y consulta hasta ver el
  resultado. Esto cubre el caso límite de dos aperturas simultáneas y el de abrir durante la lectura al subir.
- **Escritura del resultado**: `UPDATE … WHERE id = $1 AND text_status = 'reading' AND text_started_at = $claimedAt`.
  Así una lectura vencida que termina tarde no pisa una más nueva.
- **Códigos de error** (`text_error`, solo para registro y para el copy del mensaje): `timeout`, `provider`,
  `rate_limited`, `quota_exceeded`, `invalid_input`, `invalid_output`.

**Justificación**: el driver `neon-http` no tiene transacciones interactivas (R4 de la feature 001). Un
`UPDATE … RETURNING` condicional es atómico y no necesita bloqueo. El tope de 90 s es mayor que los 45 s de la
llamada, así que no reclama lecturas que siguen vivas; y cubre también una tarea de segundo plano que la
plataforma detuvo sin escribir su resultado (A6).

## A6. Disparo: en segundo plano al subir (equipo) y al recibir (invitados)

**Decisión**: la lectura se programa con `runInBackground(task)` de `server/utils/background.ts`, que llama a
`waitUntil(task().catch(log))` de `@vercel/functions` (en el log solo el id y el código de error). Es el único
módulo que importa `@vercel/functions`, con la misma regla de encapsulación que `auth.ts` y `storage.ts`
(Constitución IV).

- **Equipo (FR-001b)**: `POST /api/uploads/:fileId/complete` responde como hoy y, después de completar (y de
  validar la copia JPEG de una HEIC), si la imagen es apta llama a `runInBackground(() => readFileImage(fileId))`.
  `readFileImage` reclama la fila (`NULL` → `reading`) y la lee. Varias imágenes subidas juntas → cada
  `complete` programa su propia lectura, así que corren a la vez en invocaciones distintas. Sin límite de tasa
  para el equipo.
  - **Panel de la vista previa**: al abrirse, si el estado es `reading` consulta `GET` cada 3 s; los estados
    terminales se muestran tal cual. **Respaldo**: si el estado es `pending` (`NULL`: imagen subida antes de la
    feature o lectura que nunca empezó), el panel llama a `POST /api/files/:id/text` sin `force` y el servidor
    lee **en esa misma petición**, como antes. Reintentar y Volver a leer (`force`) también leen en la petición.
  - Una fila en `reading` con más de 90 s la devuelve el servidor como `failed`/`timeout` (A5), con Reintentar:
    cubre también una tarea de segundo plano que la plataforma detuvo. El cliente no calcula antigüedades.
  - La búsqueda encuentra la imagen por su texto en cuanto termina la lectura de segundo plano (FR-015).
- **Invitados (FR-009)**: `POST /api/public/submissions/:id/complete` responde **igual de rápido que hoy** y,
  tras aceptar los archivos, llama a `runInBackground(() => readSubmissionImages(submissionId, { concurrency: 4 }))`.
  - **Pool**: un pool mínimo con `Promise` nativas (un índice compartido y 4 "trabajadores" `async` que toman la
    siguiente imagen), sin bibliotecas.
  - **Por lectura**: los mismos tiempos que fuera del pool (A1/A11: principal 20 s sin reintento si hay respaldo;
    último candidato 30 s + 1 reintento; tope de 45 s), más `hitRateLimit` de `guest-text:<senderKey>` (A7);
    si se excede, la imagen queda en `NULL`.
  - **Presupuesto global**: las promesas de `waitUntil` comparten el plazo de la invocación y la plataforma las
    cancela al vencer, así que el presupuesto sale del plazo real y no de una constante:
    `budgetMs = min(240_000, remainingMs() - 15_000)`. `remainingMs()` es de `server/utils/background.ts` y envuelve
    `getDeadline()` de `@vercel/functions`, que devuelve `undefined` fuera de Vercel (entonces se usa 240 s). Se
    calcula al empezar la tarea, cuando ya transcurrió el tiempo del handler. Un `AbortSignal.timeout(budgetMs)`
    compartido se pasa como `abortSignal` a `extractImageText`, que lo combina con su propio tope de 45 s; el
    pool no añade un tope por lectura. Al vencer no se inician más lecturas;
    las que estaban en curso se abortan y quedan `failed` (`timeout`), con 15 s de margen para escribir el
    resultado. Si `budgetMs <= 0` no se lee nada y todo queda en `NULL`. El presupuesto se ajusta solo si cambia
    `maxDuration` (hoy 300 s) o la plataforma recorta el plazo.
  - **Cortacircuito por ejecución**: cada llamada a `readSubmissionImages` crea su propio `createProviderBreaker()`
    (variable local: no se comparte entre invocaciones ni sobrevive a la tarea, así que no es estado de servidor)
    y lo pasa a `extractImageText({ breaker })`. Un proveedor se abre con un error **persistente**
    (`quota_exceeded`, 401, 403, 404 o clave ausente: no se arregla en segundos) o tras **3 fallos transitorios
    seguidos** (red, timeout, 429, 5xx); un éxito reinicia la cuenta. Los candidatos abiertos se omiten en las
    lecturas siguientes de la ejecución; si queda uno solo, pasa a ser el último candidato (`timeout` 30 s,
    `maxRetries: 1`). Si **todos** están abiertos, el pool deja de iniciar lecturas y las imágenes restantes quedan
    en `NULL` (se leen al abrir Pendientes); las que ya estaban en curso terminan. Cada apertura se registra una
    vez, sin texto: `breaker open openai (<código>)`. El orden de cada trabajador es: presupuesto, cortacircuito,
    reclamar, `hitRateLimit` y leer. El límite se consulta tras reclamar para no gastar cupo en una fila que ya
    tomó otro lector; si se excede, `releaseImageText` devuelve la fila a `NULL` (condicionado a su
    `text_started_at`) y resta el intento. `readFileImage` (equipo) no usa cortacircuito: cada lectura es una
    invocación independiente.
  - **Reclamación por trabajador**: cada trabajador reclama su fila (`claimImageText`) justo antes de leerla,
    nunca todas al inicio, de modo que las imágenes en cola siguen en `NULL` (`pending`).
  - **Imágenes no iniciadas**: quedan en `NULL`.
  - `readSubmissionImages` nunca lanza: cualquier fallo queda en la fila (FR-004).
- **Red de seguridad**: si al abrir Pendientes una imagen del envío está en `pending` (sin evaluar), la tarjeta
  llama a `POST /api/submissions/:id/files/:fileId/text` sin `force` y consulta
  `GET /api/submissions/:id/files/:fileId/text` mientras dure `reading`. Una imagen `failed` (incluida una
  lectura vencida, que llega como `failed`/`timeout`) espera el Reintentar del usuario (`force: true`); nada
  reintenta solo. Cubre el presupuesto de tiempo, el cortacircuito y el límite de FR-008.
  - Si un revisor abre Pendientes mientras el pool aún tiene imágenes en cola, la tarjeta lee esas imágenes
    `pending` directamente, fuera del pool y del límite de invitados; la reclamación atómica evita lecturas
    dobles y se acepta porque es una acción del revisor.
- **Fuera de Vercel** (dev, tests): `waitUntil` no tiene contexto de petición; la promesa corre igual en el
  proceso de desarrollo, que vive mucho más que la petición. Los tests unitarios simulan `runInBackground`:
  capturan la tarea y la esperan de forma explícita.

**Justificación**:
- `event.waitUntil` de Nitro 2.13 **no** está conectado en el preset de Vercel para Node: la promesa no se
  espera tras responder. `waitUntil` de `@vercel/functions` es el mecanismo oficial de la plataforma y es la
  dependencia más pequeña posible para esto.
- El trabajo en segundo plano no guarda estado en memoria entre peticiones (la reclamación y el resultado
  viven en Postgres), así que sigue cumpliendo la restricción de servidor sin estado; solo alarga la vida de la
  invocación dentro de su duración máxima (300 s con fluid compute, sin tocar `maxDuration`).
- Leer al subir deja el texto listo antes de que alguien abra la imagen y hace que la búsqueda encuentre las
  imágenes nuevas desde el principio; leer al recibir mantiene la confirmación del invitado tan rápida como
  antes.
- La lectura síncrona en la petición se conserva solo como respaldo (`NULL` al abrir) y para `force`, donde
  quien pulsa el botón espera el resultado.

**Alternativas**:
- Leer dentro de la petición (diseño anterior): retrasaba la confirmación del invitado hasta 40 s y dejaba al
  equipo sin texto hasta abrir cada imagen.
- Cola o worker externo: un servicio más (Constitución II).
- Cron cada minuto: Vercel Hobby no lo permite y la latencia no cumpliría SC-001.
- Leer solo al abrir Pendientes, o desde el navegador del invitado tras confirmar: el usuario los descartó.

## A7. Límite de costo de invitados (FR-008)

**Decisión**: `hitRateLimit(null, \`guest-text:${senderKey}\`, { limit: 20, windowSec: 3600 })` antes de cada
lectura del envío en segundo plano, justo después de reclamar la fila (A6). Al exceder el límite, la fila vuelve a
sin evaluar (`null`) sin lanzar error, y se leerá cuando un revisor abra el envío (A6).

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

## A9. Pruebas sin llamar al proveedor de IA

**Decisión**:
- **Unitarias**: `MockLanguageModelV4` de `ai/test`, inyectado como candidato en `extractImageText({ …, candidates })`. Devuelve
  texto JSON válido, inválido o un error lanzado. `runInBackground` se simula en los tests de endpoints
  (captura la tarea y se espera de forma explícita, para afirmar que la respuesta no la espera); el test de
  `background.ts` simula `@vercel/functions` con `vi.mock`.
- **Componentes**: `mockApi` (helpers existentes de `test/nuxt`).
- **e2e**:
  - Un servidor stub de la Responses API, levantado en `global-setup.ts` en un puerto local.
  - La app de pruebas arranca con `NUXT_OPENAI_BASE_URL` apuntando a él.
  - El stub responde según el contenido de la imagen recibida, que distingue por los bytes exactos del fixture
    (`nota.*` → texto, `paisaje.jpg` → `hasText: false`). Un endpoint de control del propio stub
    (`POST /__stub/mode { fail, delayMs }`) provoca el 500 y el retraso por prueba, y `GET /__stub/calls` cuenta
    las llamadas (tasks T026).
  - Como `complete` responde antes de que termine la lectura, las specs no esperan la respuesta del endpoint
    sino el texto en el panel (que consulta mientras dura `reading`) o consultan `GET …/text` hasta un estado
    terminal. El stub cuenta una llamada por imagen y admite un retraso de respuesta configurable para poder
    observar "Leyendo texto…" de forma determinista.
- **Respaldo (Gemini)**: en e2e el stub es el único candidato. `.env.test` deja `NUXT_GOOGLE_APIKEY` vacía, así
  que `resolveImageTextCandidates` omite a Gemini y un 500 del stub termina en `failed` sin llamar a Google. No
  se simula la API REST de Gemini. En unit se prueban `resolveImageTextCandidates` (claves presentes, ausentes
  y en blanco) y el respaldo de `extractImageText` (qué errores lo activan y cuáles no, orden, intentos y
  tiempos), con un `MockLanguageModelV4` por candidato.
- **Calidad real (SC-002)**: no corre en CI. Es un paso manual del quickstart con 20 fotos reales, con OpenAI
  y, aparte, forzando el respaldo (clave de OpenAI vacía).

**Justificación**: los e2e no deben depender de un servicio de pago ni de su latencia. `baseURL` es una opción
estándar de `createOpenAI`, así que no hace falta código de prueba en producción.

## A10. Organización del código de IA (pedido del usuario)

**Decisión**: `server/ai/` es la **única frontera con el proveedor de IA** (Constitución IV, v1.0.1), organizada
por capas y por caso de uso, con `index.ts` como única superficie pública. Vive fuera de `server/utils/` porque
Nitro 2 auto-importa `server/utils/**/*` con subcarpetas
([nitro v2, `resolvers/imports.ts`](https://github.com/nitrojs/nitro/blob/v2/src/core/config/resolvers/imports.ts));
fuera, solo `server/utils/image-text.ts` la importa, con el alias `#server/ai` (Nuxt ≥ 4.3,
[docs](https://nuxt.com/docs/4.x/directory-structure/server#server-alias-v43); el proyecto usa 4.6.1). Cada archivo
tiene un solo propósito (detalle de capas, DRY y KISS en plan.md, "Organización por capas"):

| Archivo | Responsabilidad |
|---------|-----------------|
| `server/ai/index.ts` | Reexporta lo que usa la capa de aplicación: `extractImageText`, `createProviderBreaker`, `resolveImageTextCandidates`, `imageSourceSchema` y los tipos (`ImageTextResult`, `ImageTextCandidate`, `ModelImage`). Nada más es público |
| `server/ai/providers/openai.ts` (movido desde `ai/openai.ts`) | Cliente `openaiClient(config)` y `OPENAI_DEFAULT_MODEL = 'gpt-4o'`. Sin prompts |
| `server/ai/providers/google.ts` (movido desde `ai/gemini.ts`) | Cliente `googleClient(config)` y `GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'`. Sin reexports |
| `server/ai/providers/candidates.ts` | `resolveImageTextCandidates(config)`: lista ordenada [OpenAI, Gemini] con solo los que tienen clave, cada uno con su modelo y `providerOptions` (A11) |
| `server/ai/image-text/prompt.ts` | `IMAGE_EXTRACTION_INSTRUCTION` e `IMAGE_EXTRACTION_PROMPT`: una sola fuente para los dos proveedores |
| `server/ai/image-text/schemas.ts` | Esquemas Zod de A3 y sus tipos inferidos |
| `server/ai/image-text/extract.ts` | `extractImageText({ image, candidates?, breaker?, abortSignal?, maxRetries? })`: valida, llama al principal y, si procede, al respaldo (A11), valida la salida y devuelve `ImageTextResult`. Los tiempos son constantes con nombre al inicio del archivo. Sin BD ni storage |
| `server/ai/errors.ts` | `classifyProviderError(error)`: función pura que traduce un error del SDK a `{ code, fallback, persistent }` (A11). Sin red ni estado |
| `server/ai/breaker.ts` | `createProviderBreaker()`: cortacircuito local a una ejecución del pool (A6). Sin estado de módulo |
| `server/utils/image-text.ts` | Capa de aplicación auto-importada, la única que usan los endpoints: `toImageText` (DTO), `readImageText` (elegibilidad → descarga → firma → IA → guardar), `readFileImage(fileId)`, `requestImageTextRead(target, { force })` (reglas comunes de los dos `POST …/text`), `readSubmissionImages` (pool, A6) y `checkTextSourceCopy` (A4) |
| `server/utils/image-text-store.ts` | Capa de persistencia: solo SQL sobre las columnas `text_*`, genérica por `ImageTextTarget = { table: 'files' \| 'guest_submission_files', id }`: `claimImageText`, `saveImageTextResult`, `releaseImageText`, `markUnavailable` (A5) |
| `server/utils/background.ts` | `runInBackground(task)` y `remainingMs()`: único módulo que importa `@vercel/functions`; registra solo id y código de error (A6) |
| `app/utils/heic-copy.ts` (cliente) | `makeTextSourceCopy(file)` y `uploadTextSourceCopy(file, url)`: carga `heic-to` bajo demanda, genera la copia JPEG y la sube (A4). Lo reutilizan `useUploader` y `useGuestSubmission`. No conoce al proveedor de IA |

Cambios en los archivos que el usuario ya preparó:
- `openai.ts` y `gemini.ts` se mueven con `git mv` a `providers/openai.ts` y `providers/google.ts` (se conserva el
  historial y el contenido del usuario).
- La instrucción y el prompt pasan de `openai.ts` a `image-text/prompt.ts`; se elimina el reexport de `gemini.ts`.
- Se corrige el typo `IMAGE_EXRTACTION_PROMPT` → `IMAGE_EXTRACTION_PROMPT`.
- `RuntimeConfig` se importa como tipo (`import type`).
- Se pasa `baseURL` opcional (A9).
- Las dos últimas reglas de la instrucción se ajustan al resultado estructurado: una imagen por llamada,
  `hasText`/`text` en lugar del centinela. El resto de las reglas del usuario (literal, sin "Skykids", idioma
  original, sin preámbulo) se conservan.

`shared/` solo recibe lo que ve el cliente: `IMAGE_TEXT_STATUSES`, las extensiones aptas, `MAX_IMAGE_TEXT_BYTES`,
`MAX_IMAGE_TEXT_LENGTH`, `isImageTextEligible()` y el DTO `ImageText`.

## A11. Proveedor principal y respaldo: OpenAI → Gemini (pedido del usuario)

**Decisión**: OpenAI (`gpt-4o`) es el proveedor principal y Google (`gemini-3.5-flash-lite`) el respaldo. No hay
variable para elegir proveedor: el orden es fijo y el respaldo se activa solo.
Cubre errores comunes (red, tiempo), propios del proveedor (clave, modelo, sobrecarga, bloqueo) y de uso (exceso de
peticiones, saldo o cuota agotados).

- `server/ai/providers/candidates.ts` → `resolveImageTextCandidates(config)`: lista ordenada de
  `ImageTextCandidate { provider: 'openai' | 'google', model, providerOptions? }` con **solo los proveedores que
  tienen clave** (`config.openaiApikey` y `config.googleApikey` no vacías tras `trim()`). Un proveedor sin clave se
  omite sin llamarlo: ese es el caso "no hay clave".
- `extractImageText` recorre los candidatos en orden hasta obtener una respuesta o agotarlos. Si no se inyecta
  `candidates` (los tests sí lo hacen), usa `resolveImageTextCandidates(useRuntimeConfig())`.
- Sin candidatos → `failed`/`provider`, sin llamar a nadie.

**Qué activa el respaldo**: cualquier fallo **del proveedor**; no el contenido que el modelo devolvió ni el tiempo
del llamador. La clasificación vive en `server/ai/errors.ts` → `classifyProviderError(error): { code, fallback, persistent }`,
una función pura que lee `APICallError` (`statusCode`, `data` / `responseBody`), desenrolla `RetryError.lastError` y
mira `NoObjectGeneratedError.finishReason`. Se pasa al siguiente candidato solo si queda uno.
`persistent` es `true` para `quota_exceeded`, 401, 403, 404 y clave ausente (no se arreglan en segundos) y lo usa el
cortacircuito del pool (A6).

| Fallo | Ejemplos propios de cada proveedor | ¿Respaldo? | Código |
|-------|------------------------------------|------------|--------|
| Red y conexión | `APICallError` sin `statusCode`, `fetch failed`, DNS, conexión reiniciada, TLS | Sí | `provider` |
| Timeout del propio intento | `timeout` del SDK | Sí | `timeout` |
| Exceso de peticiones | OpenAI 429 `rate_limit_exceeded` (peticiones o tokens por minuto); Gemini 429 `RESOURCE_EXHAUSTED` | Sí | `rate_limited` |
| Saldo o cuota agotados | OpenAI 429 `insufficient_quota` y `billing_hard_limit_reached`; 402; Gemini `FAILED_PRECONDITION` (facturación o capa gratuita sin habilitar) | Sí | `quota_exceeded` |
| Clave o permisos | 401 `invalid_api_key`; 403 (permiso, región no soportada); Gemini 400 `API_KEY_INVALID`, `PERMISSION_DENIED`; `LoadAPIKeyError` | Sí | `provider` |
| Modelo no disponible o sobrecargado | 404 `model_not_found` / `NOT_FOUND`; 500, 502, 503 `UNAVAILABLE`, 504, 529 | Sí | `provider` |
| Petición rechazada por el proveedor | Otros 4xx (400 `INVALID_ARGUMENT`, 413, 422): otro proveedor puede aceptarla | Sí | `provider` |
| Bloqueo por política del proveedor | `NoObjectGeneratedError` / `NoOutputGeneratedError` con `finishReason: 'content-filter'` (Gemini `SAFETY`, `PROHIBITED_CONTENT`; rechazo de OpenAI) | Sí | `provider` |
| Error no reconocido | Excepción inesperada del SDK (se asume fallo del proveedor) | Sí | `provider` |
| Respuesta ilegible o fuera del esquema | `NoObjectGeneratedError` con otra razón de fin, o salida que no pasa Zod | No: el modelo respondió; no es un fallo del servicio (A3) | `invalid_output` |
| Aborto del llamador, presupuesto del pool o tope de 45 s | `abortSignal` | No: no queda tiempo | `timeout` |

- Gemini no distingue de forma fiable entre límite por minuto y cuota agotada (ambos llegan como
  `RESOURCE_EXHAUSTED`), así que su 429 se clasifica como `rate_limited`. `quota_exceeded` solo se asigna cuando el
  cuerpo lo dice sin ambigüedad (OpenAI `insufficient_quota` / `billing_hard_limit_reached`, 402, Gemini
  `FAILED_PRECONDITION`). Ambos códigos activan el respaldo; la diferencia solo cambia el mensaje y el registro.
- El principal falla rápido: con respaldo no reintenta (`maxRetries: 0`), así que un 429, un saldo agotado o una
  caída pasan al respaldo de inmediato. Como no hay estado compartido entre invocaciones, fuera de un envío de invitados
  cada imagen intenta OpenAI primero; esos fallos responden al instante, así que el costo es una llamada rechazada
  por imagen. Dentro de un envío, el cortacircuito por ejecución (A6) evita repetirla.
- Si todos los candidatos fallan, el resultado lleva el código del **último** intento, salvo que alguno haya sido
  `quota_exceeded`: ese prevalece, porque es el que pide acción de una persona. Con un solo candidato el
  comportamiento es el de antes (`timeout` 30 s, `maxRetries: 1`).

**Resultado y registro**: `ImageTextResult` gana `usedProvider?: 'openai' | 'google'`, solo para tests y registro;
no se persiste ni viaja al cliente, así que el DTO `ImageText` y la base de datos no cambian (salvo el código
nuevo `quota_exceeded`) y la interfaz no dice qué proveedor leyó. El registro anota, solo con códigos y sin texto,
`fallback openai→google (<código>)`; `quota_exceeded` y la clave rechazada se registran como error (no como aviso)
para que un administrador recargue el saldo o cambie la clave.

| | Principal | Respaldo |
|---|---|---|
| Proveedor | OpenAI (`@ai-sdk/openai@4.0.97`) | Google (`@ai-sdk/google@4.0.101`, `createGoogleGenerativeAI`) |
| Cliente | `openaiClient(config)` | `googleClient(config)` |
| Modelo | `OPENAI_DEFAULT_MODEL = 'gpt-4o'` | `GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'` |
| Clave | `NUXT_OPENAI_APIKEY` (+ `_ORG`, `_PROJ`) | `NUXT_GOOGLE_APIKEY` (vacía = sin respaldo) |
| Detalle de imagen | `providerOptions: { openai: { imageDetail: 'high' } }` en la parte de imagen (siempre presente; Gemini la ignora) | `providerOptions: { google: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } }` en la llamada (lo aporta el candidato) |
| Salida estructurada | `strictJsonSchema` (Responses API) | `structuredOutputs` activo por defecto |
| Base URL de pruebas | `NUXT_OPENAI_BASE_URL` (stub e2e) | no aplica: sin stub e2e |

**Lo que NO cambia** (es genérico del AI SDK): `generateText` + `Output.object`, `imageTextOutputSchema` y su
segunda pasada con `safeParse`, bytes en lugar de URL, el tope de 45 s, el mapeo de errores (A5) y el prompt
(`IMAGE_EXTRACTION_INSTRUCTION`/`PROMPT`, definidos una sola vez en `server/ai/image-text/prompt.ts`).

**Justificación**: el cliente y la clave de Gemini ya están en el proyecto (`server/ai/gemini.ts`, que pasa a `server/ai/providers/google.ts`,
`NUXT_GOOGLE_APIKEY`), así que no hay dependencias ni servicios nuevos más allá de Complexity Tracking. El
respaldo cubre errores comunes (red, tiempo), propios del proveedor (clave, modelo, sobrecarga, bloqueo) y de uso
(exceso de peticiones, saldo o cuota agotados), sin intervención y sin desplegar código.

**Alternativas**:
- Elegir el proveedor con una variable (`NUXT_AI_PROVIDER`): descartado por el usuario a favor del respaldo.
- Gemini como único proveedor: descartado por el usuario.
- Reintentar solo con OpenAI (`maxRetries`): no cubre la falta de clave ni una caída sostenida.
- Respaldo también ante salida inválida: descartado; el modelo respondió y cambiarlo duplicaría costo sin
  evidencia de que mejore (puede revisarse si SC-007 lo pide).

**Riesgos conocidos**:
- `gemini-3.5-flash-lite` es un modelo ligero; su lectura de letra a mano puede ser inferior a la de `gpt-4o`.
  SC-002 se mide con OpenAI y, aparte, forzando el respaldo (quickstart §5, tasks T075).
- El respaldo envía los bytes de la imagen a un segundo tercero (FR-019 sigue cumpliéndose: solo bytes) y solo
  cuando OpenAI no está disponible.
