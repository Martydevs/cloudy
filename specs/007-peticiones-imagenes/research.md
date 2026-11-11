# Research: Página Peticiones

**Feature**: `007-peticiones-imagenes` · **Fecha**: 2026-11-07 · Todas las decisiones se tomaron leyendo el código y las dependencias instaladas
(`ai@7.0.145`, `@openrouter/ai-sdk-provider@3.1.0`, `@vueuse/nuxt@15`, `daisyui@5.7`). No quedan `NEEDS CLARIFICATION`.

## Hallazgos del código que condicionan el diseño

| Hallazgo | Consecuencia |
|----------|--------------|
| `PATCH /api/files/:id/text`, `useImageText`, `ImageTextEditor` y `ImageTextPanel` ya existen (feature 002) y guardan `text_edited_at/by` | La **edición de la transcripción no se construye**: se reutiliza (D6). |
| Al aprobar, el texto pasa de `guest_submission_files` a la fila de `files` (`submission_id`, `origin='guest'`) | La fuente de la rejilla es `files ⋈ guest_submissions`; **sin tabla nueva** (D3). |
| `guest_submissions.reviewed_at` guarda la aprobación; `files.created_at` es el momento de aprobar, no el de envío | La fecha de referencia (clarificada) sale de `guest_submissions` (D3). |
| `files.submission_id` es FK sin índice | Se agrega junto con el índice de `(status, reviewed_at, id)` (D4). |
| Los archivos de invitados **no tienen miniatura** (`withThumbnail: false`) | La tarjeta carga la imagen original de forma estrictamente diferida (D9). |
| `server/utils/image-text.ts` es hoy el único importador de `#server/ai` (`architecture.spec.ts`) | Se agrega un segundo módulo de aplicación y se actualiza la prueba (D2). |
| La plantilla entregada (`server/assets/peticiones/plantilla.jpg`, 1376×768, 702 KB) es un paisaje de plastilina (cielo azul, colinas, camino, árboles a los lados, sol y nubes) con el título «Peticiones de oración» ya dibujado arriba. No trae un recuadro ni marca que indique dónde va el texto | El «espacio vacío del cuerpo» es el área abierta de cielo y colinas bajo el título, entre los árboles; como no está marcada, el *system prompt* del preajuste y el prompt de usuario deben nombrarla (D1, D13). |
| `useSongPresentations` ya resolvió una cola con cancelación, `AbortController`, `objectURL` y `pump` | Se copia la forma, no el código (D8). |

## D1 — Cómo se pide la imagen a OpenRouter

- **Decision**: **chat completions** con el cliente existente (`createOpenRouter` en `server/ai/providers/openrouter.ts`) y
  `generateText` del AI SDK. Modelo `@preset/pray-requests-image-generation` (el preajuste elige modelo, enrutado y lleva el
  *system prompt*, igual que `@preset/image-content-extraction`). El mensaje de usuario lleva **dos partes**: el texto con los
  párrafos y la plantilla como `file` (`image/jpeg`). Se activa la salida de imagen con
  `openrouterClient(config)(MODEL, { extraBody: { modalities: ['image', 'text'] } })`. La imagen llega en
  `result.files` (el proveedor 3.1 convierte `message.images[].image_url.url` en partes `file`, ver `index.js` ≈ L4471); se toma la
  primera con `mediaType` `image/*`.
- **Rationale**: es la misma ruta, clave y `baseURL` (stub de e2e) que la lectura de texto; no agrega dependencias ni módulos de
  proveedor. Los modelos de imagen tipo Gemini («nano banana») aceptan imágenes de entrada y devuelven imágenes por esta vía. El
  preajuste ya existe, así que el código solo manda el prompt de usuario (convención del proyecto: `prompt.ts`).
- **Alternatives**: `imageModel` + `generateImage` (endpoint `/images` con `input_references`): es otra superficie del proveedor,
  no comprobamos que acepte `@preset/…` y el stub de e2e tendría que imitar un endpoint nuevo. `Output.object` (como la lectura):
  no aplica, la salida es un archivo. Cliente del navegador directo a OpenRouter: expondría la clave (Constitución IV).
- **Riesgo y verificación**: que el preajuste no fije `modalities`. Por eso se envía en `extraBody`; si el preajuste ya lo
  trae, el campo es inofensivo. El *smoke* real está en [quickstart.md](./quickstart.md) § 5 (única prueba que llama al proveedor).

## D2 — Frontera con el proveedor y capas

- **Decision**: carpeta nueva `server/ai/prayer-image/` (`generate.ts`, `prompt.ts`, `schemas.ts`) más
  `resolvePrayerImageModel` en `providers/openrouter.ts`, exportadas por `server/ai/index.ts`. Un módulo de aplicación nuevo,
  `server/utils/prayer-images.ts`, es el **único** que importa `#server/ai` para esta función (como `image-text.ts` para la
  lectura): carga la plantilla, valida las peticiones, llama a la IA y traduce errores a HTTP. El SQL vive aparte en
  `server/utils/prayer-requests.ts`. Se actualiza `test/unit/architecture.spec.ts` para permitir exactamente ese segundo importador.
- **Rationale**: Constitución IV (una frontera por proveedor, endpoints sin SQL ni detalles del proveedor) y reutiliza
  `classifyProviderError` (`errors.ts`) para 402/429/401/timeouts.
- **Alternatives**: poner la llamada en `image-text.ts` (mezcla dos casos de uso y lo vuelve a crecer sin necesidad); llamar a
  `generateText` desde el endpoint (rompe la regla de capas).

## D3 — Origen de la rejilla (sin tabla nueva)

- **Decision**: una consulta de lectura sobre `files ⋈ guest_submissions ON gs.id = f.submission_id` con
  `gs.status = 'approved' AND f.category = 'image' AND f.upload_status = 'ready' AND f.deleted_at IS NULL`. Orden y filtro por
  `gs.reviewed_at` con desempate por `f.id`; el cursor es keyset `(reviewed_at truncado a ms, id)` reutilizando
  `encodeCursor/decodeCursor` de `pagination.ts`. El DTO reutiliza `toImageText` (estados, `stale reading → failed`, `editedBy`).
  Se excluyen las columnas pesadas del resto de `files`; el texto (hasta 10 000 car.) viaja porque la tarjeta lo muestra.
- **Rationale**: «aprobado» ⇒ el texto ya está en `files` (feature 002, FR-010); la fecha de aprobación clarificada es
  `reviewed_at`; la papelera ya se resuelve con `deleted_at`. Una consulta, sin N+1.
- **Alternatives**: copiar a una tabla `prayer_requests` (duplica datos y se desincroniza al editar o enviar a la papelera);
  paginar por `files.created_at` (es la fecha de aprobación solo de forma accidental y no sirve si cambia la aprobación).
- **Tamaño de página**: **12** (cada tarjeta trae una foto sin miniatura, D9).

## D4 — Índices (migración `0009`) y búsqueda

- **Decision**: la migración solo agrega índices: `guest_submissions (status, reviewed_at, id)` para filtrar/ordenar y
  `files (submission_id) WHERE submission_id IS NOT NULL` para el `JOIN` (hoy la FK no tiene índice). **Búsqueda** sin extensión:
  se normaliza en SQL con `translate(lower(col), 'áéíóúüñ', 'aeiouun')` y el patrón se normaliza igual en el servidor, con
  `LIKE` y comodines escapados, sobre `sender_name`, `note` y `text_content`.
- **Rationale**: el requisito (FR-028) es no distinguir mayúsculas **ni tildes**; el `ILIKE` existente sí distingue tildes y
  `unaccent` exige una extensión nueva. `translate` y `lower` son inmutables y cubren el español. El filtro de búsqueda se evalúa
  sobre el subconjunto ya acotado por los índices (aprobadas, imágenes, rango de fechas); se mide con 5 000 filas en el quickstart
  (SC-006, Constitución I «5 000 elementos < 2 s»).
- **Alternatives**: `CREATE EXTENSION unaccent` (dependencia de plataforma nueva para un solo caso); índice trigram sobre la
  expresión (no sirve con el `OR` entre tres columnas de dos tablas y complica la migración sin necesidad a esta escala).

## D5 — La plantilla viaja con el despliegue

- **Decision**: la imagen se copia a `server/assets/peticiones/plantilla.jpg` y se declara en
  `nitro.serverAssets: [{ baseName: 'peticiones', dir: './server/assets/peticiones' }]`; se lee con
  `useStorage('assets:peticiones').getItemRaw('plantilla.jpg')`. No se guarda en el bucket ni se sube desde la página.
- **Rationale**: es un archivo estático de diseño que debe existir en cada entorno (dev, test, Vercel) sin configurar nada; los
  *server assets* de Nitro se empaquetan con la función en el preset `vercel`. 702 KB caben holgados en la función. Sin plantilla
  la función responde «no disponible» (503 `not_configured`), nunca llama al modelo.
- **Alternatives**: `public/` (hay que descargarla por HTTP desde la propia función); bucket (otro objeto que configurar por
  entorno); variable de entorno con ruta (rompe en Vercel). **Cambiar la plantilla** = reemplazar el archivo y desplegar.

## D6 — Edición de la transcripción: reutilizar la feature 002

- **Decision**: la tarjeta muestra la transcripción de solo lectura (con las marcas de ilegible resaltadas) y un botón
  **Corregir texto** que abre, diferido (`LazyPrayerTextDialog`), un diálogo con la **foto grande** y el `ImageTextPanel` editable
  de siempre apuntado a `/api/files/:id/text`. Cambios a los existentes:
  1. `ImageTextPanel` emite `change` con el `ImageText` nuevo (un `watch` de 2 líneas; no cambia su comportamiento).
  2. `PATCH /api/files/:id/text` agrega un límite de tasa por usuario (FR-033; hoy no tiene).
- **Rationale**: ya hacen validación, `409` si se está leyendo, actividad `file.text_edit`, insignia «Editado por», Escribir
  transcripción cuando está vacía y confirmación antes de **Volver a leer** (que reemplaza la corrección: acción explícita de la
  persona; las lecturas **automáticas** nunca reclaman `ready/empty/failed`, así que FR-016 ya se cumple). Cero código nuevo de
  formulario y la foto queda visible junto al campo (US3-1).
- **Alternatives**: editor en línea dentro de cada tarjeta (con 12–48 tarjetas montaría 12–48 `useImageText` y textareas);
  un editor nuevo (duplica validación y mensajes).

## D7 — Marca de ilegible (función pura)

- **Decision**: `shared/prayers.ts` exporta `hasIllegibleMark(text)` y `splitIllegible(text)` con
  `/\[[^\]\n]*l[eé]gible[^\]\n]*\]/giu` (cubre `[ilegible]`, `[ilegíble]`, `[unlegible]`, `[illegible]`, `[texto ilegible]`, `[ILÉGIBLE]`; ignora mayúsculas y la tilde de la `e`, sin cambiar las posiciones del texto para que `splitIllegible` reconstruya el original). Las tarjetas pintan
  los trozos con `<mark>`-like (daisyUI `badge badge-warning badge-soft` + icono, sin `text-warning` sobre `base-100` claro) y **no**
  usan `v-html`.
- **Rationale**: FR-015 pide detección por patrón; un solo lugar la usa el cliente (resaltado, advertencia de la confirmación) y
  la prueba unitaria.

## D8 — Cola de generación en el cliente

- **Decision**: `usePrayerImages` (estado en `useState('prayer-images')`; `AbortController` y `objectURL` en mapas de módulo,
  igual que `useSongPresentations`). **2 imágenes a la vez** (`PRAYER_IMAGE_CONCURRENCY`), movidas por `pump` desde el propio
  estado. Una imagen = una petición `POST /api/peticiones/imagenes` con `responseType: 'blob'`, plazo de 110 s, cancelación y
  **Reintentar/Generar de nuevo** por imagen. No descarga sola: la persona revisa la vista previa y pulsa **Descargar**
  (`triggerDownload` de `download-blob.ts`). Un fallo transitorio (429, 502, 503 de red, 504, plazo) ofrece reintento; `quota_exceeded`
  y `not_configured`, no.
- **Rationale**: 2 en paralelo reduce el tiempo total (SC-001: 8 peticiones en < 5 min, hasta 10 imágenes ≈ 4 min) sin saturar el
  proveedor; los resultados viven **en la página** (no en una bandeja del layout), por lo que no se apila una tercera bandeja fija
  sobre las de YouTube y Canciones y el layout no cambia.
- **Alternatives**: bandeja del layout como Canciones (CSS de `--*-tray-h` apilado ×3 y cola que sobrevive a la navegación, que la
  spec no pide); generar en un solo POST con N imágenes (un fallo descarta todo y excede el plazo de la función).

## D9 — Rejilla, desplazamiento infinito y fotos sin miniatura

- **Decision**: `useApiFetch('/api/peticiones', { lazy: true, query })` + `loadMore` con cursor y `useInfiniteScroll(window, …)`
  (patrón de `FileExplorer`). Búsqueda con `refDebounced(q, 300)`. La imagen de cada tarjeta recibe su `src` solo cuando la tarjeta
  entra en el viewport (`useElementVisibility` con margen de 200 px y `once`), con caja de proporción fija (`aspect-[4/3]`,
  `object-cover`), `decoding="async"` y `fetchpriority="low"`. La foto grande se abre en el diálogo diferido o en una pestaña.
- **Rationale**: las fotos de invitados llegan sin miniatura (3–5 MB típicas): con 12 por página y carga estrictamente diferida el
  costo se paga por lo que se ve. Generar miniaturas en servidor exigiría `sharp` (dependencia nueva) y quedaría como mejora
  futura; la miniatura es opcional según el Principio I (v1.2.0). La caja fija evita CLS.
- **Alternatives**: `loading="lazy"` nativo (el navegador adelanta la carga hasta ~1250–2500 px, demasiado en 4G); miniaturas en el
  envío del invitado (cambia la feature 003).

## D10 — Selección

- **Decision**: `usePrayerSelection` guarda una **copia de cada tarjeta elegida** en `useState('prayer-selection')`
  (`Record<id, PrayerRequest>`) para que la selección sobreviva a búsquedas, filtros y carga de más páginas, y para listar las
  elegidas aunque el filtro las oculte. Tope `PRAYER_MAX_SELECTION = 40`; solo se marcan tarjetas con texto (`ready` y no vacío).
  `groups` ordena por `(approvedAt, sentAt, id)` ascendente y corta de 4 en 4 (`chunkRequests` en `shared/prayers.ts`). Se limpia
  al salir de la página. El control es un `<input type="checkbox" class="radio radio-primary">` (aspecto circular de daisyUI,
  semántica de casilla) dentro de una `<label>` estirada sobre la tarjeta; los demás controles de la tarjeta quedan por encima.
- **Rationale**: una casilla real da Espacio, estado anunciado y foco gratis (WCAG); «radio» es solo la apariencia pedida.
- **Alternatives**: `role="checkbox"` sobre un `div` (reimplementa teclado y foco); `aria-pressed` en botones (se anuncia «botón
  activado», no «marcada»).

## D11 — Contrato de la generación y errores

- **Decision**: `POST /api/peticiones/imagenes` con `{ fileIds: uuid[1..4] }`; responde **la imagen** (`image/png`/`jpeg`,
  `Content-Disposition: inline`, `Cache-Control: no-store`). El servidor **relee las peticiones** (aprobadas, visibles, con texto
  `ready` no vacío), las ordena por `(reviewed_at, sent_at, id)` y arma los párrafos (FR-027). Errores con `data.code`:
  `request_unavailable` (409, con `data.ids`), `not_configured` (503), `quota_exceeded` (503), `rate_limited` (429),
  `provider` (502), `invalid_output` (502), `too_large` (502), `timeout` (504). Rutas, mensajes y el mapeo exacto en
  [contracts/api.md](./contracts/api.md).
- **Rationale**: el navegador no manda texto (el servidor es la autoridad, no es un generador de imágenes genérico) y un 409
  con los ids no disponibles permite retirarlos de la selección. Los mismos códigos del cliente de IA ya existen
  (`ProviderErrorCode`); solo se agregan `invalid_input` y `too_large`.
- **Límite de uso**: `hitRateLimit(event, 'peticiones-img:<userId>', { limit: 60, windowSec: 3600 })`; cada generación cuesta crédito.

## D12 — El binario de salida (excepción acotada a «nunca pasar binarios por el servidor»)

- **Decision**: la imagen generada **sí** atraviesa la función, con tope duro `PRAYER_IMAGE_MAX_BYTES = 4 000 000` (< 4,5 MB del
  límite de respuesta de Vercel). Si el modelo devuelve más, se responde `502 too_large` y la persona usa **Generar de nuevo**.
  No se guarda en el bucket ni en la base (FR-026).
- **Rationale**: la imagen nace en el servidor (la clave no puede salir) y no existe un objeto en el almacenamiento al cual
  redirigir; guardarla temporalmente exigiría escribir, firmar y limpiar objetos (cron) para algo que la spec dice que no se guarda.
  Es la segunda excepción acotada, tras la `.pptx` de la feature 006 (decenas de KB; esta pesa 1–3 MB). Se registra en
  *Complexity Tracking* y en `AGENTS.md`.
- **Mitigación del tamaño**: el preajuste fija el modelo/resolución; el `quickstart § 5` mide el tamaño real en preview de Vercel.
  Si fuera sistemáticamente > 4 MB, el siguiente paso (fuera de esta feature) es objeto temporal con URL firmada.
- **Alternatives**: base64 en JSON (+33 %); URL firmada con objeto temporal (más piezas, ver arriba).

## D13 — Prompt y contenido literal

- **Decision**: `buildPrayerPrompt(paragraphs)` arma el mensaje de usuario con una instrucción corta (rellenar **solo** el espacio
  vacío bajo el título «Peticiones de oración», un párrafo por petición en el orden dado, texto literal sin corregir ni traducir ni añadir) y cada petición en
  una etiqueta `<peticion n="1">…</peticion>`; `<` y `>` del texto se sustituyen por `‹` y `›` para que nada cierre una etiqueta.
  No se manda nombre, nota ni IP (FR-022): la entrada de la función es `string[]` de 1 a 4 textos.
- **Rationale**: FR-020/021. El *system prompt* detallado (letra legible con el estilo de plastilina de la plantilla y buen contraste sobre cielo y colinas, no tocar árboles, sol, nubes ni título, ajustar tamaño de letra a
  4 párrafos sin tapar el camino ni los árboles) vive en el preajuste de OpenRouter, que el equipo edita sin desplegar.
- **Alternatives**: escapar con entidades HTML (el modelo podría dibujar `&lt;`); JSON (más ruido y el modelo lo copia literal).

## D14 — Estado, mensajes y accesibilidad

- **Decision**: textos de avisos, errores y estados en `messages.prayers` (`app/utils/messages.ts`) y los límites y mensajes por
  código en `shared/constants/prayers.ts`; los errores de la API llegan solo por `serverMessage()`. Cada vista cubre cuatro estados
  con `PrayerCardSkeleton` (esqueleto con la misma caja que la tarjeta), `EmptyState` (dos: «sin peticiones aprobadas» y «sin
  coincidencias»), `ErrorState` con reintento y la rejilla; los resultados usan un esqueleto con la proporción de la plantilla
  mientras se genera. Foco visible, `prefers-reduced-motion` (`motion-reduce:` en esqueletos y barras), contraste de ambos temas.
- **Rationale**: Constitución VI.

## D15 — Pruebas

- **Unitarias**: `shared/prayers` (marca, troceo, agrupación, orden), `prayer-prompt`, `prayer-generate` (AI SDK simulado:
  archivo devuelto, sin imagen, demasiado grande, 402/429/timeout), `prayer-requests` (filtros, cursor y normalización de
  tildes) y `prayer-images` (elegibilidad, orden, mapeo a HTTP, plantilla ausente), más la actualización de `architecture.spec`.
- **Componente (`test/nuxt`)**: `PrayerCard`, `PrayerToolbar`, `PrayerSelectionBar`, `PrayerResultCard`, `usePrayerSelection`,
  `usePrayerImages` (cola, concurrencia 2, cancelar, reintentar) y la página (cuatro estados, desplazamiento infinito).
- **E2E (`test/e2e/peticiones.spec.ts`)**: recorrido completo contra el stub de OpenRouter (que gana una respuesta con
  `message.images`), rutas protegidas (sin sesión y rol incorrecto, página y API), búsqueda con tildes, filtro de fecha, orden,
  edición de la marca y reintento tras un fallo del stub.
- **Cobertura**: cada módulo nuevo ≥ 92 % (igual al gate global).
