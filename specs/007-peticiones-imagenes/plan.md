# Implementation Plan: Página Peticiones — peticiones de oración a imágenes para proyectar

**Branch**: `007-peticiones-imagenes` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-peticiones-imagenes/spec.md` · Modelo: `@preset/pray-requests-image-generation` (OpenRouter, cliente existente) · Plantilla: `server/assets/peticiones/plantilla.jpg` (1376×768)

## Summary

El equipo abre **Peticiones**, ve como tarjetas en rejilla las imágenes de invitados **ya aprobadas** (foto, transcripción, quién y cuándo), elige varias, corrige las transcripciones con
`[ilegible]` y genera imágenes de «Peticiones de oración del día»: cada imagen lleva hasta 4 peticiones (la quinta abre la segunda imagen) sobre una plantilla, con un modelo de
generación de imágenes que solo rellena el espacio vacío bajo el título. Hay búsqueda sin tildes, filtro por fecha de aprobación, orden y desplazamiento infinito.

**Enfoque técnico**:

- **Sin tablas nuevas.** La rejilla es una consulta sobre `files ⋈ guest_submissions` (envíos aprobados); el texto ya vive en `files.text_*` (feature 002). La migración `0009` solo agrega
  **dos índices** ([data-model.md](./data-model.md)).
- **La edición de transcripciones se reutiliza**: `PATCH /api/files/:id/text`, `ImageTextPanel` (que gana un evento `change`) y `ImageTextEditor` dentro de un diálogo diferido con la foto grande
  ([research D6](./research.md)). Solo se agrega un límite de tasa al `PATCH`.
- **Una frontera de IA nueva dentro de la existente**: `server/ai/prayer-image/` + `resolvePrayerImageModel` (mismo `createOpenRouter`, preajuste `@preset/pray-requests-image-generation`,
  `modalities: ['image','text']`, imagen en `result.files`). El único importador nuevo de `#server/ai` es `server/utils/prayer-images.ts` ([D1, D2](./research.md)).
- **La plantilla viaja con el despliegue** como *server asset* de Nitro (`assets:peticiones`), sin bucket ni variable de entorno ([D5](./research.md)).
- **2 endpoints**: `GET /api/peticiones` (keyset, 12 por página) y `POST /api/peticiones/imagenes` (1–4 ids → 1 imagen; el servidor relee el texto) ([contracts/api.md](./contracts/api.md)).
- **Cliente con lo que ya hay**: `useApiFetch` + `useInfiniteScroll` (cursor), `refDebounced`, `useElementVisibility` (foto diferida), `useState` (selección y cola), `useEventListener`,
  `useConfirm`; daisyUI (`card`, `skeleton`, `join`, `modal`, `progress`, `radio`, `badge`, `input`, `select`). Cola de generación de 2 en paralelo con la forma de `useSongPresentations`
  y resultados **en la propia página** (sin una tercera bandeja fija) ([D8–D10](./research.md), [contracts/ui.md](./contracts/ui.md)).
- **UX de carga**: `PrayerCardSkeleton` con la misma caja que la tarjeta (sin CLS), esqueleto con la proporción de la plantilla mientras se genera, `Lazy*` para resultados, diálogos y vista
  ampliada.
- **Sin dependencias nuevas.**

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2, h3 1) · Bun (local) / Node 22 (Vercel).

**Primary Dependencies**:

- **Sin dependencias nuevas.** `ai@7.0.145` y `@openrouter/ai-sdk-provider@3.1.0` ya instalados.
- **Reutilizadas**:
  - Servidor: `session.ts` (`requireRole`), `validation.ts` (`readValid`, `queryValid`), `pagination.ts` (`encodeCursor`/`decodeCursor`), `rate-limit.ts` (`hitRateLimit`),
    `image-text.ts` (`toImageText`), `server/ai/providers/openrouter.ts` (`openrouterClient`), `server/ai/errors.ts` (`classifyProviderError`), `db.ts`.
  - Compartido: `validation/core.ts`, `types/api.ts` (`ImageText`, `Paginated`), `constants/image-text.ts`.
  - Cliente: `useApi`/`useApiFetch`, `useToast`, `useConfirm`, `useRelativeTime`, `download-blob.ts` (`triggerDownload`, `revokeDownload`), `useGuestLink`, `SkeletonList`, `EmptyState`,
    `ErrorState`, `ConfirmDialog`, `ImageTextPanel`, `ImageTextEditor`.
  - VueUse (ya auto-importado): `useInfiniteScroll`, `refDebounced`, `useElementVisibility`, `useEventListener`, `useElementSize`.

**Storage**:

- **Neon Postgres**: migración `0009` con **2 índices**, sin tablas ni enums ([data-model.md](./data-model.md)).
- **Bucket**: sin cambios. Las imágenes generadas **no se guardan** (FR-026); solo viaja el binario de respuesta.
- **Activos del despliegue**: `server/assets/peticiones/plantilla.jpg` (702 KB) vía `nitro.serverAssets`.

**Testing**: Vitest `unit` / `nuxt` / `e2e`. Unitarias de `shared/prayers`, prompt, `generate` (AI SDK simulado), `prayer-requests`, `prayer-images` y `architecture.spec`; de componente para
tarjeta, barra de filtros, barra de selección, resultado, composables y página; e2e `peticiones.spec.ts` contra el stub de OpenRouter (nueva respuesta con `message.images`) y rutas
protegidas. Detalle en [research D15](./research.md).

**Target Platform**: Vercel (SSR, funciones de hasta 120 s) · navegadores móviles y de escritorio, 360 px – ≥ 1280 px.

**Project Type**: Aplicación web (Nuxt full-stack).

**Performance Goals**: Constitución I — LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1, JS inicial de la ruta ≤ 250 KB gzip; primera página < 2,5 s y siguiente < 2 s con 200 peticiones (SC-005);
búsqueda/filtro/orden < 1 s (SC-006) y < 2 s con 5 000 elementos.

**Constraints**:

- La imagen generada atraviesa la función con tope de 4 000 000 bytes (< 4,5 MB de Vercel); 1 llamada por imagen, tope duro de 105 s dentro del plazo de 120 s.
- El navegador nunca habla con OpenRouter; la clave y el preajuste viven en el servidor. Ni el nombre del invitado, ni su nota, ni su IP se envían al proveedor (FR-022).
- Las fotos de invitados no tienen miniatura: carga estrictamente diferida y páginas de 12.
- Sin estado compartido en memoria del servidor (límites de tasa en Postgres).

**Scale/Scope**: equipo pequeño; cientos a pocos miles de peticiones aprobadas; ≤ 40 elegidas por generación (≤ 10 imágenes); 1 página, 2 endpoints nuevos, 1 migración de índices.

## Constitution Check

*GATE: debe pasar antes de la Fase 0 y se reevalúa tras el diseño.*

| Principio | Evaluación | Estado |
|-----------|------------|--------|
| **I. Rendimiento medible** | Páginas de 12 con keyset e índices `(status, reviewed_at, id)` y `files(submission_id)`; sin N+1 (una consulta con `JOIN`); JS diferido (`Lazy*` con `v-if`: resultados, diálogos, vista ampliada); fotos con `src` solo al entrar al viewport, caja de proporción fija (CLS) y `decoding="async"` (sin miniatura: opcional según el Principio I v1.2.0); la primera vista se renderiza con SSR (`useApiFetch` + `lazy`). **Binarios**: la imagen generada pasa por la función → excepción acotada y justificada (Complexity Tracking). La búsqueda de texto no tiene índice (ver Complexity Tracking) | ✅ con 2 excepciones registradas |
| **II. Funcional y efectivo** | 4 historias independientes (US1 ver/elegir, US2 generar, US3 corregir, US4 buscar/filtrar). YAGNI: sin tabla nueva, sin guardar imágenes, sin elegir plantilla ni orden. Reutiliza el editor de transcripciones, `useConfirm`, `download-blob`, la cola de Canciones (forma) y VueUse antes de escribir código. **Sin dependencias ni servicios nuevos** (mismo OpenRouter y mismo cliente). Fallos sin huérfanos: no se guarda nada; un `409` retira peticiones no disponibles | ✅ |
| **III. Mobile first** | Base 1 columna, `sm:`/`xl:`/`2xl:` solo amplían; 360 px sin scroll horizontal; objetivos ≥ 44 px (`btn`, casilla con etiqueta estirada); nada depende de `hover`; barra de selección al alcance del pulgar con área segura; verificación a 360 y ≥ 1280 px | ✅ |
| **IV. Calidad de código** | `<script setup lang="ts">`, componentes de una responsabilidad y composables (`usePrayerFilters/Requests/Selection/Images`, `usePrayerLeaveGuard`); reglas compartidas una sola vez en `shared/` (`prayers.ts`, `validation/prayers.ts`, `constants/prayers.ts`); endpoints validan entrada y rol en servidor; IA solo por `server/ai/` → `server/utils/prayer-images.ts`; SQL solo en `server/utils/prayer-requests.ts`; sin `any`, sin `v-html`, sin código muerto; `architecture.spec` actualizado | ✅ |
| **V. Pruebas** | Unitarias (lógica pura, prompt, IA simulada, consultas, aplicación), de componente (tarjeta, barras, resultados, cola, página) y e2e (historias + rutas protegidas sin sesión y rol incorrecto); selección por `getByRole`/`getByLabel`; e2e sobre rama de pruebas y stub de OpenRouter (nunca llaman al proveedor); cobertura ≥ 92 % | ✅ |
| **VI. UX consistente** | Tokens de daisyUI (sin colores fijos), lucide, DM Sans; cuatro estados por vista (esqueleto → vacío con guía → error con reintento → contenido); confirmación antes de generar (gasta crédito) y al salir con imágenes sin descargar; toasts al completar; textos en español en `messages.prayers`; WCAG 2.2 AA (casilla real, foco visible, no solo color, `motion-reduce`, sin `text-warning` sobre `base-100` claro) | ✅ |

**Gate (previo a Fase 0)**: ✅ pasa; las dos excepciones se registran abajo.

### Re-evaluación tras el diseño (Fase 1)

El diseño no agrega dependencias, tablas, servicios ni excepciones nuevas a las dos ya registradas. `contracts/ui.md` cubre los cuatro estados de cada vista y `contracts/api.md` valida entrada y rol en
ambos endpoints. Los cambios a código existente son mínimos y quedan listados en [Complexity Tracking](#complexity-tracking). **Gate (posterior al diseño): ✅ pasa.**

## Project Structure

### Documentation (this feature)

```text
specs/007-peticiones-imagenes/
├── plan.md              # Este archivo (/speckit-plan)
├── research.md          # Fase 0 — decisiones D1–D15
├── data-model.md        # Fase 1 — origen de datos, DTO, 2 índices, consulta, validación
├── quickstart.md        # Fase 1 — validación de punta a punta
├── contracts/
│   ├── api.md           # GET /api/peticiones, POST /api/peticiones/imagenes, frontera de IA
│   └── ui.md            # página, componentes, composables, estados, accesibilidad
├── checklists/
│   └── requirements.md  # Calidad de la especificación
└── tasks.md             # Fase 2 — /speckit-tasks (no lo crea /speckit-plan)
```

### Source Code (repository root)

```text
app/
├── pages/
│   └── peticiones.vue                      # NUEVO · delgada: orquesta composables y componentes
├── components/prayers/                     # NUEVO · PrayerToolbar, PrayerGrid, PrayerCard, PrayerCardSkeleton, PrayerSelectionBar,
│   │                                       #         PrayerResults*, PrayerResultCard, PrayerSelectionDialog*, PrayerTextDialog*, PrayerImagePreview*  (*Lazy)
├── components/files/ImageTextPanel.vue     # CAMBIO mínimo · emite `change` con el ImageText nuevo
├── composables/
│   ├── usePrayerFilters.ts                 # NUEVO · búsqueda, preset de fecha, rango, orden → query
│   ├── usePrayerRequests.ts                # NUEVO · primera página + cursor + scroll infinito
│   ├── usePrayerSelection.ts               # NUEVO · selección con copia de tarjetas, tope, grupos
│   ├── usePrayerImages.ts                  # NUEVO · cola de generación (2 a la vez), descarga, descartes
│   └── usePrayerLeaveGuard.ts              # NUEVO · confirma al salir con trabajo sin descargar
└── utils/
    ├── navigation.ts                       # CAMBIO · entrada «Peticiones»
    └── messages.ts                         # CAMBIO · grupo `prayers`

shared/
├── prayers.ts                              # NUEVO · hasIllegibleMark, splitIllegible, chunkRequests, ordenar
├── constants/prayers.ts                    # NUEVO · límites, códigos y mensajes de error
├── validation/prayers.ts                   # NUEVO · prayersQuery, prayerImageInput
└── types/api.ts                            # CAMBIO · PrayerRequest

server/
├── api/peticiones/
│   ├── index.get.ts                        # NUEVO · listado
│   └── imagenes.post.ts                    # NUEVO · generación (devuelve la imagen)
├── api/files/[id]/text.patch.ts            # CAMBIO · límite de tasa
├── ai/prayer-image/{generate,prompt,schemas}.ts   # NUEVO
├── ai/providers/openrouter.ts              # CAMBIO · resolvePrayerImageModel (extraBody modalities)
├── ai/index.ts                             # CAMBIO · exporta generatePrayerImage, resolvePrayerImageModel
├── utils/prayer-requests.ts                # NUEVO · SQL del listado y de la elegibilidad
├── utils/prayer-images.ts                  # NUEVO · aplicación: plantilla + elegibilidad + IA + errores HTTP
├── assets/peticiones/plantilla.jpg         # NUEVO · plantilla (JPEG de 1376×768)
└── db/schema.ts                            # CAMBIO · 2 índices
drizzle/0009_*.sql                          # NUEVO · migración generada con drizzle-kit
nuxt.config.ts                              # CAMBIO · nitro.serverAssets

test/
├── unit/        # prayers-shared, prayer-prompt, prayer-generate, prayer-requests, prayer-images, architecture (CAMBIO)
├── nuxt/        # PrayerCard, PrayerToolbar, PrayerSelectionBar, PrayerResultCard, usePrayerSelection, usePrayerImages, pages-peticiones
└── e2e/         # peticiones.spec.ts (NUEVO), routes-guard.spec.ts (CAMBIO), setup/openrouter-stub.ts (CAMBIO: respuesta con message.images)
```

**Structure Decision**: aplicación web Nuxt existente, sin proyectos nuevos. Capas de siempre: `shared/` (reglas) → `server/utils/` (SQL en `prayer-requests`, aplicación en `prayer-images`) →
`server/ai/` (proveedor, solo desde `prayer-images`) → `server/api/` (endpoints delgados) → `app/composables/` → `app/components/prayers/` → `app/pages/peticiones.vue`. La carpeta de
componentes se llama `prayers/` (como `songs/`, `youtube/`) y los componentes se nombran por archivo.

## Complexity Tracking

> Excepciones al Constitution Check y cambios a código existente.

| Violación / cambio | Por qué es necesario | Alternativa más simple descartada porque |
|--------------------|----------------------|------------------------------------------|
| **Binario por la función** (la imagen generada, ≤ 4 MB, Principio I «binarios MUST NOT pasar por funciones»). Segunda excepción acotada tras la `.pptx` de la feature 006 | La imagen nace en el servidor (la clave de OpenRouter no puede salir) y la spec exige no guardarla; no hay objeto en el almacenamiento al que redirigir | Guardarla en el bucket con URL firmada exige escribir, firmar y limpiar objetos (cron) para algo que no se conserva; el navegador no puede llamar al proveedor sin exponer la clave. Se mitiga con el tope de 4 000 000 bytes y el *smoke* de § 5 del quickstart |
| **Búsqueda sin índice** (Principio I «toda columna de filtro MUST tener índice»): `translate(lower(…))` sobre nombre, nota y transcripción | FR-028 pide no distinguir tildes; el `ILIKE` indexado de la feature 002 sí las distingue y `unaccent` exige una extensión nueva | Un índice trigram sobre la expresión no sirve con un `OR` entre columnas de dos tablas; la búsqueda se evalúa sobre el subconjunto ya acotado por los índices de estado y fecha y se mide con 5 000 filas (quickstart § 4) |
| **Cambio a `ImageTextPanel`**: evento `change` | La página necesita enterarse del texto guardado para actualizar la tarjeta y la selección | Releer el listado tras cerrar el diálogo pierde la posición del scroll infinito y retrasa la tarjeta |
| **Cambio a `PATCH /api/files/:id/text`**: límite de tasa | FR-033 (proteger el crédito y los abusos de edición) | Dejarlo sin límite incumple el requisito; es una línea con `hitRateLimit` existente |
| **Actualizar `architecture.spec.ts`** para permitir un segundo importador de `#server/ai` (`server/utils/prayer-images.ts`) | La regla de la feature 002 nombra un solo archivo; esta función es otro caso de uso de IA con su propia capa de aplicación | Meter la llamada en `image-text.ts` mezcla dos casos de uso; importar `#server/ai` desde el endpoint rompe la regla |
| **Excepción de LCP en `/peticiones`** (Principio I, LCP ≤ 2,5 s en 4G; aceptada por la persona el 2026-11-12, T082) | Las fotos de invitados no tienen miniatura y pesan 3–5 MB: la foto de la primera tarjeta es el elemento LCP. Medido en el laboratorio (4G simulado, CPU ×4, foto de 8 KB): ~2,5 s con la primera foto desde el SSR con `fetchpriority="high"` y `preconnect` al almacenamiento (antes 3,2 s); con fotos reales queda por encima. El presupuesto se mantiene para **el texto de las tarjetas** (SC-005: utilizables sin esperar a las fotos), CLS ≤ 0,1 y JS inicial ≤ 250 KB; `test/e2e/performance.spec.ts` los afirma y solo reporta el LCP con fotos | Miniaturas para las imágenes de invitados (generarlas en la subida o la aprobación y guardarlas en el bucket): trabajo nuevo en el flujo de la feature 003, pospuesto por decisión de la persona |
| **Activo binario en el repositorio** (`plantilla.jpg`, 702 KB) | La plantilla debe existir idéntica en cada entorno y es parte del producto | Un bucket o una variable de entorno agregan configuración por entorno para un archivo que cambia casi nunca |
