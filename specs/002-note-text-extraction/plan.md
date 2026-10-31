# Implementation Plan: Extracción del texto de notas e intenciones de oración

**Branch**: `002-note-text-extraction` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-note-text-extraction/spec.md`

## Summary

Cloudy lee el texto de las imágenes JPEG/JPG, PNG y HEIC de hasta 5 MB (5 242 880 bytes). Así el equipo deja de transcribir a
mano las notas adhesivas y las peticiones de oración.

**Cuándo se lee** (siempre en segundo plano, sin retrasar ninguna respuesta):
- **Imágenes del equipo**: en cuanto termina la subida. Al abrir la vista previa el texto ya está, o se ve
  "Leyendo texto…" hasta que termine. Una imagen que quedó sin leer se lee al abrirla, como respaldo.
- **Imágenes de invitados**: al recibir el envío, para que el texto ya esté en Pendientes.

El texto se guarda con el archivo y se puede copiar, corregir, volver a leer y buscar.

**Enfoque técnico**:
- **IA**: AI SDK v7 (`generateText` + `Output.object`) con **OpenAI gpt-4o** (`@ai-sdk/openai`) como proveedor
  principal y **Google gemini-3.5-flash-lite** (`@ai-sdk/google`) como **respaldo**, aislado en `server/ai/`.
  Si OpenAI no tiene clave, o la llamada falla (red, tiempo, error del proveedor, exceso de peticiones, saldo o cuota agotados), la misma lectura se
  repite con Gemini (mismo prompt, esquema y contrato; no hay variable para elegir proveedor). La entrada y la
  salida se validan con **Zod**.
- **Segundo plano**: `waitUntil` de `@vercel/functions`, encapsulado en `server/utils/background.ts`
  (`runInBackground`), porque `event.waitUntil` de Nitro no está conectado en el preset de Vercel para Node.
- **Imagen**: el servidor descarga la imagen de Neon Object Storage (≤ 5 MB, 5 242 880 bytes) y envía los bytes al modelo tal
  como están guardados, sin procesarlos. Las HEIC se convierten a JPEG **en el navegador al subir** con
  `heic-to`, que solo funciona en el navegador; esa copia se sube con PUT prefirmado, como las miniaturas, y es
  la que se lee.
- **Estado**: el texto vive en columnas `text_*` de `files` y `guest_submission_files`, así que hereda papelera,
  aprobación, rechazo y caducidad sin código extra. Una reclamación atómica evita lecturas duplicadas.
- **Invitados**: la confirmación responde de inmediato; la lectura corre en segundo plano con 4 lecturas a la
  vez, un presupuesto de hasta 240 s (menos si el plazo real de la función lo exige) y un cortacircuito por
  ejecución que deja de probar a un proveedor caído. Lo que quede pendiente se lee al abrir Pendientes.
- **Búsqueda**: se extiende con un índice trigram sobre el texto.

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2.13, h3 1.15) · Bun (local) / Node 22 (Vercel)

**Primary Dependencies**:
- **Ya declaradas por el usuario**: `ai@^7.0.145`, `@ai-sdk/openai@^4.0.97`, `@ai-sdk/google@^4.0.101`,
  `zod@^4.6.7`, `heic-to@^1.6.6`
  (solo navegador, carga bajo demanda).
- **A agregar** (justificada en Complexity Tracking): `@vercel/functions` (`waitUntil`, solo desde
  `server/utils/background.ts`).
- **Reutilizadas**: `storage.ts` (`head`, `readRange`), `file-signature.ts`, `rate-limit.ts`, `activity.ts`,
  `session.ts` (`requireRole`), `validation.ts`, `useApiFetch`, `useToast`, `useConfirm`, `useClipboard`,
  `useIntervalFn`, y los componentes `SkeletonList`, `EmptyState`, `ErrorState` y `ConfirmDialog`.

**Storage**:
- **Neon Postgres**: un enum nuevo, columnas `text_*` en dos tablas, un valor nuevo de `activity_action`, un
  índice GIN trigram y CHECKs ([data-model.md](./data-model.md)).
- **Bucket**: un objeto nuevo por HEIC apta, la copia `textsrc/<id>.jpg` (≤ 5 MB, 5 242 880 bytes), con el mismo ciclo de vida
  que la miniatura (data-model).

**Testing**: Vitest con los proyectos `unit`, `nuxt` y `e2e`. Los unit usan `MockLanguageModelV4` de `ai/test`.
Los e2e usan un stub local de la Responses API vía `NUXT_OPENAI_BASE_URL` y `NUXT_GOOGLE_APIKEY` vacía, así que
el respaldo no corre en e2e (research A9); la resolución de candidatos y el respaldo se cubren en unit con
`MockLanguageModelV4` (sin stub HTTP de Gemini). La calidad real (SC-002)
se mide a mano según el quickstart §5.

**Target Platform**: Vercel (preset `vercel`, Node, fluid compute) con navegadores desde 360 px.

**Project Type**: Aplicación web full-stack: el mismo proyecto Nuxt (`app/`, `server/`, `shared/`).

**Performance Goals**:
- Texto visible en ≤ 30 s para el 90 % de las imágenes (SC-001).
- Búsqueda < 2 s con 5 000 archivos (SC-006).
- Panel cargado con `Lazy*` y `heic-to` (~3 MB) con `import()` dinámico solo al elegir una HEIC: sin impacto en
  el JS inicial de ninguna ruta (presupuesto de 200 KB, verificado con `bun run analyze`).
- La subida del equipo y la confirmación de un envío de invitado no tardan más: la lectura se programa tras
  responder y nunca se espera (SC-004).

**Constraints**:
- **Lectura**: máximo 45 s por lectura, sumados todos los intentos. Con respaldo, el principal usa `timeout` 20 s sin
  reintento y el último candidato `timeout` 30 s + 1 reintento; sin respaldo, `timeout` 30 s + 1 reintento. Un
  tope duro de 45 s cubre todo. Las lecturas de un
  envío de invitado comparten además un presupuesto de hasta 240 s, recortado al plazo real de la función. El estado `reading` vence a los 90 s, lo que
  cubre también una tarea de segundo plano que la plataforma detuvo.
- **Segundo plano**: solo con `runInBackground` (`server/utils/background.ts`), único módulo que importa
  `@vercel/functions`. Una tarea no guarda estado en memoria entre peticiones: la reclamación y el resultado
  viven en Postgres. Fuera de Vercel (dev, tests) `waitUntil` no tiene contexto de petición y la promesa corre
  igual en el proceso de desarrollo; los tests unitarios simulan `runInBackground`.
- **Duración en Vercel**: el trabajo en segundo plano está limitado por la duración máxima de la función (300 s
  con fluid compute); el presupuesto es `min(240 s, plazo real - 15 s)` (`getDeadline()` de `@vercel/functions`, solo desde
  `server/utils/background.ts`), así que no se toca `maxDuration` y se ajusta solo si cambia. El presupuesto
  de 240 s y las lecturas de 45 s requieren **Fluid Compute** de Vercel (300 s de duración máxima, activado por
  defecto en proyectos nuevos).
- **Privacidad**: al proveedor solo se envían bytes de imagen (FR-019), nunca una URL prefirmada. A Google solo
  llegan si OpenAI no está disponible; dejar `NUXT_GOOGLE_APIKEY` vacía desactiva el respaldo.
- **Secretos**: `NUXT_OPENAI_*` y `NUXT_GOOGLE_APIKEY` solo en `runtimeConfig` del servidor.

**Scale/Scope**:
- Unos cientos de imágenes al mes; `guest-text` limitado a 20 lecturas/h por remitente.
- 5 endpoints nuevos y unos 10 modificados (subidas, envíos, aprobación, rechazo, búsqueda, cron).
- En cliente: 1 composable y 1 util nuevos, 2 composables y 4 pantallas tocadas.
- 3 historias.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la constitución **v1.0.1** (la 1.0.1 aclara el principio IV: la frontera de IA en `server/ai/` cumple).

| Principio | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------|-----------------------------|
| **I. Rendimiento** | ✅ | Ver el detalle bajo la tabla. |
| **II. Funcional y efectivo** | ✅ | Ver el detalle bajo la tabla. |
| **III. Mobile first** | ✅ | El panel va bajo la vista previa en móvil y en la columna lateral en `lg:` (contracts/ui). Botones `btn` base con `lg:btn-sm`; menú `⋯` visible, sin hover. Verificación a 360 px y a 1280 px (quickstart §4). |
| **IV. Calidad de código** | ✅ | Ver el detalle bajo la tabla. |
| **V. Pruebas** | ✅ | Ver el detalle bajo la tabla. |
| **VI. Consistencia de UX** | ✅ | Seis estados mapeados a `SkeletonList`, `EmptyState`, `ErrorState` y contenido (contracts/ui). Toasts al copiar y guardar; `ConfirmDialog` antes de reemplazar una corrección. Copy en `messages.imageText`; `serverMessage()` para los errores HTTP. Icono lucide `scan-text`; `aria-live` y foco gestionado. |
| **Restricciones técnicas** | ✅ | Sin estado en memoria: la reclamación y el limitador viven en Postgres, y las tareas en segundo plano (`waitUntil`) no comparten nada entre peticiones; solo alargan la vida de la invocación dentro de su duración máxima. Migración Drizzle con SQL manual para CHECK e índice. Secretos `NUXT_OPENAI_*` y `NUXT_GOOGLE_APIKEY`. Al proveedor (OpenAI o Google) no van datos del invitado. **Privacidad**: el texto extraído de una imagen de invitado es contenido del archivo que el invitado ya envió (como la imagen misma), no un dato personal nuevo del invitado; no se guarda nada más que su nombre y nota, y se elimina con el archivo al rechazar o caducar (FR-010). |
| **Flujo y gates** | ✅ | Rama `002-note-text-extraction` (se crea en T001). Conventional Commits. DoD de AGENTS.md por fase (typecheck → tests → navegador). |

**Detalle de los principios I, II, IV y V**:

- **I. Rendimiento**:
  - Búsqueda con un índice GIN trigram sobre `text_content` y sin N+1: el texto viaja en el mismo `SELECT` de
    Pendientes y su endpoint solo pide por id.
  - Panel `Lazy*`; `heic-to` en un chunk dinámico que solo se descarga al elegir una HEIC.
  - La copia JPEG sube directo al bucket con PUT prefirmado, sin pasar por el servidor.
  - La lectura nunca retrasa una respuesta: `complete` (equipo e invitados) programa la lectura con
    `runInBackground` y responde como hoy.
  - ⚠ El servidor lee hasta 5 MB del bucket para enviarlos al modelo. No es un binario del usuario a través del
    cuerpo HTTP; está justificado en Complexity Tracking.
- **II. Funcional y efectivo**:
  - 3 historias independientes: P1 equipo, P2 invitados, P3 corrección y búsqueda.
  - Reutiliza el limitador, la actividad, el storage y la firma binaria; usa VueUse (`useClipboard`,
    `useIntervalFn`, `useDocumentVisibility`).
  - Las columnas en la fila evitan huérfanos; la copia `textsrc/<id>.jpg` se borra en los mismos puntos que la
    miniatura (data-model).
  - Una lectura fallida nunca hace fallar subir, enviar ni aprobar (FR-004); una conversión HEIC fallida nunca
    impide la subida (FR-023). Una tarea de segundo plano que no termina deja la fila en `reading`, que vence a
    los 90 s y se muestra como error con Reintentar: nunca queda "leyendo" para siempre.
  - Una dependencia nueva (`@vercel/functions`) y las ya instaladas por el usuario se justifican abajo.
- **IV. Calidad de código**:
  - `server/ai/` es la única frontera con el proveedor de IA (research A10), con `index.ts` como única
    superficie pública, y `server/utils/image-text.ts` la única orquestación (ver "Organización por capas").
  - `server/utils/background.ts` es el único módulo que importa `@vercel/functions`, con la misma regla que
    auth y storage.
  - Las reglas compartidas viven en `shared/constants/image-text.ts`.
  - `requireRole` en cada endpoint.
  - Zod limitado al flujo de IA (A3), sin `any`.
  - Se corrige el typo de `IMAGE_EXRTACTION_PROMPT`.
- **V. Pruebas**:
  - Unit para:
    - los esquemas, `resolveImageTextCandidates` y `extractImageText` (válido, sin texto, salida inválida, timeout,
      429, respaldo a Gemini);
    - `runInBackground` (ejecuta la tarea, registra y traga errores sin el texto; `@vercel/functions` simulado
      con `vi.mock`);
    - la reclamación y las transiciones, y el pool de invitados con presupuesto (240 s o plazo real) y cortacircuito (con temporizadores
      falsos);
    - la validación de la copia en `complete` y que `complete` programa la lectura sin esperarla
      (`runInBackground` simulado);
    - los endpoints vía `installNitro`, que se amplía con `image-text` y `background`.
  - Componente: `ImageTextPanel` en sus 6 estados; `makeTextSourceCopy` con `heic-to` simulado (éxito, > 5 MB →
    segunda calidad, error → `null`) y `useUploader` subiendo la copia.
  - e2e por historia y por ruta nueva (sin sesión y rol incorrecto) contra el stub. Como `complete` responde
    antes de leer, las specs esperan el texto en el panel (que consulta mientras dura `reading`).
  - Cobertura ≥ 92 % incluyendo `server/ai/**`.

**Privacidad de invitados** (2026-10-26): decisión de la persona: el aviso informativo de FR-011 es suficiente; el
texto extraído se trata como contenido del archivo enviado (no se enmienda la constitución ni se pide consentimiento).

**Resultado**: **PASS**. La única tensión con un principio (I, la lectura de ≤ 5 MB en el servidor), la
dependencia nueva y las que instaló el usuario están justificadas en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-note-text-extraction/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Fase 0 (A1–A10)
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   ├── api.md           # endpoints nuevos y modificados
│   └── ui.md            # panel, composable, pantallas, copy
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
server/
├── ai/                                  # capa de IA: NO auto-importada; solo se importa como `#server/ai`
│   ├── index.ts                         # única superficie pública: extractImageText, createProviderBreaker,
│   │                                    # resolveImageTextCandidates, imageSourceSchema y los tipos
│   ├── providers/                       # infraestructura reutilizable por cualquier caso de uso de IA
│   │   ├── openai.ts                    # (movido desde ai/openai.ts) openaiClient(config) + OPENAI_DEFAULT_MODEL
│   │   ├── google.ts                    # (movido desde ai/gemini.ts) googleClient(config) + GEMINI_DEFAULT_MODEL
│   │   └── candidates.ts                # resolveImageTextCandidates(config): [OpenAI, Gemini] con clave
│   ├── image-text/                      # el caso de uso de esta feature
│   │   ├── prompt.ts                    # IMAGE_EXTRACTION_PROMPT (la instrucción salió del repo: el preset de OpenRouter lleva el system prompt)
│   │   ├── schemas.ts                   # Zod: imageSourceSchema · modelImageSchema · imageTextOutputSchema
│   │   └── extract.ts                   # extractImageText(): validar → principal (→ respaldo) → validar → ImageTextResult
│   ├── errors.ts                        # classifyProviderError(): código, si activa el respaldo y si es persistente
│   └── breaker.ts                       # createProviderBreaker(): cortacircuito local a una ejecución
├── utils/image-text.ts                  # capa de aplicación (la usan los endpoints): toImageText(), readImageText(),
│                                        # readFileImage(), requestImageTextRead() (lógica común de los dos POST),
│                                        # readSubmissionImages() (pool de 4, presupuesto ≤ 240 s, cortacircuito),
│                                        # checkTextSourceCopy()
├── utils/image-text-store.ts            # capa de persistencia: solo SQL sobre las columnas text_* de files |
│                                        # guest_submission_files (claim, save, release, markUnavailable)
├── utils/background.ts                  # runInBackground() · remainingMs(): único import de @vercel/functions
├── utils/uploads.ts · trash.ts          # textSourceKeyFor(id); borrar la copia en descarte y purga
├── db/schema.ts                         # enum image_text_status, columnas text_* (+ text_source_key), 'file.text_edit'
├── api/files/[id]/text.get.ts · text.post.ts · text.patch.ts
├── api/submissions/[id]/files/[fileId]/text.get.ts · text.post.ts
├── api/uploads/index.post.ts · [fileId]/complete.post.ts   # + withTextSource / validar copia / runInBackground(readFileImage)
├── api/public/submissions/index.post.ts                    # + withTextSource por archivo
├── api/public/submissions/[id]/complete.post.ts            # + validar copias + runInBackground(readSubmissionImages)
├── api/submissions/[id]/approve.post.ts · reject.post.ts   # + copiar text_* / borrar copia
├── api/cron/cleanup.get.ts                                 # + borrar copias caducadas y huérfanas
├── api/submissions/index.get.ts (o utils/submissions.ts)  # + text en SubmissionFile
└── api/files/search.get.ts                        # + OR text_content ILIKE, matchedIn

shared/
├── constants/image-text.ts              # estados, extensiones aptas, MAX_IMAGE_TEXT_BYTES, MAX_IMAGE_TEXT_LENGTH, isImageTextEligible()
├── validation/image-text.ts             # cuerpo de PATCH (validador propio)
└── types/api.ts                         # ImageText, SubmissionFile.text, matchedIn

app/
├── composables/useImageText.ts · useUploader.ts · useGuestSubmission.ts   # + copia JPEG de HEIC
├── utils/heic-copy.ts                   # makeTextSourceCopy() + uploadTextSourceCopy(): import('heic-to') bajo demanda;
│                                        # lo reutilizan useUploader y useGuestSubmission
├── components/files/ImageTextPanel.vue  # estados, copiar, reintentar, volver a leer
├── components/files/ImageTextEditor.vue # modo edición (US3): textarea, contador, Guardar/Cancelar
├── pages/archivos/ver/[fileId].vue · enviar.vue
├── components/guests/SubmissionCard.vue · files/FileExplorer.vue
└── utils/messages.ts                    # sección imageText

drizzle/000N_*.sql                       # generada + SQL manual (CHECK, índice trigram)
test/
├── unit/   ai-schemas · ai-extract · ai-errors · ai-provider · ai-breaker · background · image-text · image-text-store ·
│           image-text-constants · api-image-text · api-files (subidas y búsqueda) · api-trash · api-submissions ·
│           api-cron · validation-image-text · architecture (reglas de capas)
├── nuxt/   ImageTextPanel · ImageTextEditor · heic-copy · useUploader · UploadQueue (copia) · useGuestSubmission · pages-files · pages-guests
├── e2e/    image-text (US1, US3) · guest-queue (US2) · routes-guard (rutas nuevas)
│   └── setup/openai-stub.ts             # stub de la Responses API (puerto local); Gemini no tiene stub e2e
└── fixtures/files/  nota.jpg · nota.png · nota.heic · paisaje.jpg · grande.jpg
```

**Structure Decision**: Es el mismo proyecto Nuxt de la feature 001.

- **`server/ai/`**: agrupa todo lo que conoce al proveedor (clientes, prompt, esquemas y llamada). Vive **fuera**
  de `server/utils/` a propósito: Nitro 2 auto-importa `server/utils/**/*`, subcarpetas incluidas
  ([nitro v2, `resolvers/imports.ts`](https://github.com/nitrojs/nitro/blob/v2/src/core/config/resolvers/imports.ts)),
  así que dentro de `utils/` sus funciones quedarían disponibles en todos los endpoints. Fuera, solo se importa
  explícitamente con el alias `#server/ai` (Nuxt ≥ 4.3; el proyecto usa 4.6.1) y solo desde
  `server/utils/image-text.ts` (Constitución IV, v1.0.1). La conversión HEIC no vive aquí porque es de navegador.
- **`server/utils/background.ts`**: un módulo para la dependencia externa (`@vercel/functions`), como `auth.ts`
  y `storage.ts`.
- **`shared/`**: solo recibe reglas y tipos que ve el cliente.
- **Pruebas**: `test/unit/helpers/nitro.ts` se amplía con los nuevos utils.

### Organización por capas (responsabilidad, DRY y KISS)

| Capa | Archivos | Hace | No hace |
|------|----------|------|---------|
| UI | `ImageTextPanel.vue`, `ImageTextEditor.vue` | Pinta los estados y emite acciones | Peticiones, reglas de negocio |
| Estado del cliente | `useImageText.ts` | GET/POST/PATCH, polling, copiar, toasts | Decidir elegibilidad (la lee de `shared/`) |
| Utilidad de navegador | `app/utils/heic-copy.ts` | Convertir HEIC a JPEG y subir la copia con PUT prefirmado | Saber de IA o de la BD |
| Reglas compartidas | `shared/constants/image-text.ts`, `shared/validation/image-text.ts`, `shared/types/api.ts` | Estados, límites, `isImageTextEligible`, validador del PATCH, DTO | Código de servidor o de Vue |
| HTTP | `server/api/**/text.*.ts` y los endpoints modificados | `requireRole`, `paramId`/`readValid`, visibilidad del recurso (404/409) y una llamada a la capa de aplicación | SQL de `text_*`, IA, storage |
| Aplicación | `server/utils/image-text.ts` | Orquesta: elegibilidad → reclamar → descargar → firma → IA → guardar; pool de invitados; `requestImageTextRead` | SQL directo (usa el store), detalles del proveedor |
| Persistencia | `server/utils/image-text-store.ts` | UPDATE condicionados sobre `text_*`, genéricos por tabla | IA, storage, HTTP |
| IA | `server/ai/**` | Clientes, prompt, Zod, llamada, clasificación de errores, respaldo, cortacircuito | BD, storage, h3 |
| Infraestructura | `storage.ts`, `background.ts`, `uploads.ts` | S3, `waitUntil`, claves de objetos | Reglas de la feature |

**Dirección de las dependencias** (nunca al revés): UI → composable → HTTP → aplicación → { persistencia, IA,
storage, background } → `shared/`. `server/ai/` solo importa `shared/constants/image-text.ts`, el AI SDK y
`useRuntimeConfig`; ningún endpoint importa `#server/ai` ni llama al store directamente (lo revisa T077).

**DRY**:
- Un solo prompt e instrucción (`image-text/prompt.ts`) para los dos proveedores; ya no hay reexport de `gemini.ts`.
- Un solo store y una sola tubería de lectura, genéricos sobre `files` y `guest_submission_files`
  (`ImageTextTarget = { table, id }`).
- `requestImageTextRead(target, { force })` concentra las reglas de `force`, terminales y `409` que comparten
  `POST /api/files/:id/text` y `POST /api/submissions/:id/files/:fileId/text`; cada endpoint solo resuelve su recurso.
- `isImageTextEligible` (shared) decide en cliente y servidor; `textSourceKeyFor` es la única fuente de la clave.
- `uploadTextSourceCopy` (heic-copy) lo usan `useUploader` y `useGuestSubmission`.
- Los tiempos (20 s, 30 s, 45 s) son constantes con nombre al inicio de `image-text/extract.ts`.

**KISS**:
- Funciones y objetos literales; sin clases, contenedores de inyección ni capas de "repositorio" genéricas.
- El pool de invitados es un bucle con 4 trabajadores `async` dentro de `image-text.ts`; el cortacircuito es un
  cierre local. Se separan en otro archivo solo si un segundo caso de uso los necesita.
- `providers/` se separa porque es infraestructura reutilizable; `image-text/` porque es un caso de uso. Un caso
  de uso nuevo de IA será una carpeta hermana, sin tocar los proveedores.

## Cambios a la base existente

1. `server/ai/openai.ts` → **mover** a `server/ai/providers/openai.ts` (con `git mv`, para conservar el historial):
   - `import type { RuntimeConfig }`.
   - `baseURL: config.openaiBaseUrl || undefined`.
   - Se conserva la constante existente `OPENAI_DEFAULT_MODEL = 'gpt-4o'` (no se crea `IMAGE_TEXT_MODEL`).
   - `IMAGE_EXTRACTION_INSTRUCTION` y el prompt salen de este archivo a `server/ai/image-text/prompt.ts`, donde
     `IMAGE_EXRTACTION_PROMPT` se renombra a `IMAGE_EXTRACTION_PROMPT`.
   - Ajustar las dos últimas reglas de la instrucción a una imagen por llamada y a `hasText`/`text` (research
     A10). El resto del texto del usuario se conserva literalmente.
1b. `server/ai/gemini.ts` → **mover** a `server/ai/providers/google.ts` (con `googleClient(config)` y
   `GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'`, sin cambios):
   - Se elimina el reexport de la instrucción y el prompt: ambos proveedores los leen de `image-text/prompt.ts`.
   - Nuevo `server/ai/providers/candidates.ts` con `resolveImageTextCandidates(config)`: devuelve, en orden, los candidatos que
     tienen clave (`openaiApikey` y `googleApikey` no vacías): `{ provider: 'openai', model:
     openaiClient(config)(OPENAI_DEFAULT_MODEL) }` y `{ provider: 'google', model:
     googleClient(config)(GEMINI_DEFAULT_MODEL), providerOptions: { google: { mediaResolution:
     'MEDIA_RESOLUTION_HIGH' } } }`. Un proveedor sin clave se omite sin llamarlo (research A1 y A11).
2. `nuxt.config.ts`: agregar `openaiBaseUrl: ''` a `runtimeConfig` (`openai*` y `googleApikey` ya existen; no hay variable para elegir
   proveedor).
   Los demás cambios del usuario (`openai*`,
   `neonRealtime*`) se mantienen; `neonRealtime*` no pertenece a esta feature y queda fuera de su alcance.
3. `.env.example`: agregar `NUXT_OPENAI_BASE_URL=` con el comentario "vacío = OpenAI; solo e2e".
   `NUXT_OPENAI_APIKEY` y `NUXT_GOOGLE_APIKEY` ya existen: comentar la primera como "proveedor principal" y la
   segunda como "respaldo; vacía = sin respaldo".
4. `AGENTS.md`:
   - Agregar el área "IA" a la tabla Stack (AI SDK v7 + OpenAI gpt-4o principal y Google gemini-3.5-flash-lite de
     respaldo, en `server/ai/`).
   - Agregar `NUXT_OPENAI_*` y `NUXT_GOOGLE_APIKEY` a la lista de variables.
   - Agregar el gotcha "IA: OpenAI es el principal y Gemini el respaldo (sin clave, o ante cualquier fallo del
     proveedor: red, tiempo, exceso de peticiones, saldo o cuota agotados, clave o modelo no válidos). `NUXT_GOOGLE_APIKEY` va vacía en `.env.test` para que los e2e nunca llamen a
     Gemini".
   - Agregar el gotcha "`event.waitUntil` de Nitro no está conectado en Vercel Node: el trabajo en segundo
     plano usa `waitUntil` de `@vercel/functions`, solo a través de `server/utils/background.ts`".
   - Agregar el gotcha de que `heic-to` solo funciona en navegador y se carga con `import()` dinámico.
   - Agregar la regla "Neon Auth, storage, IA **y segundo plano** solo a través de sus módulos".
   - Marcar 002 como feature activa.
5. `package.json`: `bun add @vercel/functions`.
6. `test/unit/helpers/nitro.ts`: registrar las funciones de `image-text.ts`, `image-text-store.ts` y
   `runInBackground` en la lista de stubs.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| El presupuesto (≤ 240 s) o un cortacircuito con ambos proveedores abiertos deja imágenes de invitado sin leer | Quedan en `NULL` o `failed`/`timeout`; la tarjeta de Pendientes lee las `pending` y las `failed` esperan el Reintentar del usuario (A6) |
| La plataforma detiene una tarea de segundo plano (duración máxima, error de la invocación) | La fila queda en `reading` y vence a los 90 s: la UI la muestra como error con Reintentar y la siguiente reclamación la toma; el panel y la tarjeta de Pendientes leen las `pending` (A6) |
| `heic-to` pesa ~3 MB y la decodificación es lenta en teléfonos modestos | Chunk dinámico solo al elegir una HEIC; estado "Preparando…" en la cola; si falla, la foto se sube igual, sin copia (`unavailable`) |
| Licencia LGPL-3.0 de `heic-to` | Se usa sin modificar, como módulo cargado aparte; se menciona en el README del proyecto |
| El proveedor (OpenAI o Gemini) cambia o ignora el formato estricto | Segunda pasada de `safeParse` con Zod; si falla → `failed`/`invalid_output`, nunca se muestra (SC-007) |
| `gemini-3.5-flash-lite` (modelo ligero) lee peor la letra a mano que `gpt-4o` | Solo actúa como respaldo. SC-002 se mide con OpenAI y, aparte, forzando el respaldo (tasks T075); si no cumple, se cambia `GEMINI_DEFAULT_MODEL` a un modelo mayor sin tocar el flujo |
| Ninguna clave configurada, o ambos proveedores caídos | Sin candidatos: `failed`/`provider` sin llamar a nadie. Con ambos caídos: `failed` con el código del último intento y Reintentar; nunca se muestra texto parcial |
| Una caída de OpenAI duplica el tiempo y el consumo de la lectura | El respaldo se activa por cualquier fallo del proveedor (research A11); el principal falla rápido (20 s, sin reintento) y el tope de 45 s sigue acotando la lectura; el costo extra lo limita `guest-text` (20/h); dentro de un envío de invitados, el cortacircuito deja de probar a OpenAI tras un error persistente o 3 fallos transitorios seguidos (A6) |
| Saldo o cuota agotados en OpenAI (o en Gemini) | Código `quota_exceeded`: activa el respaldo; si ambos fallan, el aviso dice que se alcanzó el límite de uso y que se avise a un administrador, con Reintentar. Se registra como error para recargar el saldo. Fuera de un envío de invitados cada imagen vuelve a intentar OpenAI primero, pero el rechazo es inmediato y sin reintento; dentro de un envío, el cortacircuito (A6) lo evita |
| El respaldo envía la imagen a un segundo tercero | Solo bytes (FR-019) y solo cuando OpenAI no está disponible; se explica en el aviso de privacidad de la página pública (`messages.imageText.guestPrivacy`) y se desactiva dejando `NUXT_GOOGLE_APIKEY` vacía |
| Un lote grande de fotos del equipo programa una lectura simultánea por archivo y el proveedor (OpenAI o Gemini) puede responder 429 (`rate_limited`) | un 429 de OpenAI activa el respaldo con Gemini (A11) y, si ambos fallan, Reintentar manual; sin tope de concurrencia por ahora (unos cientos de imágenes al mes) |
| Costo por abuso de invitados | `guest-text` con 20/h por remitente, más los límites de envíos ya existentes |
| Texto sensible (peticiones de oración) | Mismos permisos que el archivo (FR-016); no se guarda en la actividad (solo la longitud); no se registra en logs (solo id y código de error) |
| La build con `bun --bun` fija el runtime `bun1.x` en Vercel | Verificar que `.vercel/output/functions/__nitro.func/.vc-config.json` diga Node en la vista previa |

## Complexity Tracking

| Excepción / adición | Por qué es necesaria | Alternativa más simple rechazada porque |
|---------------------|----------------------|-----------------------------------------|
| Servicio externo OpenAI (principal) + Google Gemini (respaldo) + `ai` + `@ai-sdk/openai` + `@ai-sdk/google` | La spec exige leer texto manuscrito; no hay OCR local capaz de manuscritos con esta calidad. El usuario fijó los proveedores (OpenAI principal; Gemini de respaldo ante falta de clave o fallo de red), los modelos y el SDK; Gemini y su clave ya estaban en el proyecto, sin dependencias nuevas | OCR local (`tesseract.js`, ~10 MB de WASM) no lee bien letra a mano ni omite el logotipo |
| `zod` | Directiva explícita del usuario para la entrada y la salida del flujo de IA. Además `Output.object` necesita un esquema que produzca JSON Schema | Los validadores propios de `shared/validation` no generan JSON Schema; se mantienen para HTTP |
| `heic-to` (instalada por el usuario, solo navegador, ~3 MB, LGPL-3.0) | El modelo no acepta HEIC, que es el formato por defecto de las fotos de iPhone; el usuario eligió esta biblioteca | Convertir en el servidor: `heic-to` no corre en Node y el servidor no procesa imágenes (research A4). Mitigación del peso: `import()` dinámico solo al elegir una HEIC |
| `@vercel/functions` (`waitUntil`), solo desde `server/utils/background.ts` | Leer al subir (equipo) y al recibir (invitados) sin retrasar ninguna respuesta; `event.waitUntil` de Nitro no está conectado en Vercel Node | Leer dentro de la petición: retrasa la confirmación del invitado hasta 40 s y deja al equipo sin texto hasta abrir cada imagen. Cron: Vercel Hobby no permite cada minuto y la latencia no cumple SC-001. Cola externa: otro servicio (Constitución II) |
| Lectura servidor → bucket de ≤ 5 MB (Constitución I) | El modelo necesita los bytes; con bytes se revalida la firma | Una URL prefirmada para OpenAI o Google expone el objeto privado a un tercero |

## Siguientes pasos

1. Ejecutar `/speckit-tasks`.
2. Antes de implementar, el usuario prepara `nota.heic`, una foto real de menos de 5 MB sin datos personales,
   para el fixture de e2e.
