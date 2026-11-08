# Contrato de UI: página `/peticiones`

Una sola página (`app/pages/peticiones.vue`, `layout: 'dashboard'`, `access: 'private'`) con entrada **Peticiones** (`lucide:hand-heart`) en
`app/utils/navigation.ts` para `editor` y `admin`, justo después de **Solicitudes**. La página es delgada: orquesta composables y componentes; no contiene lógica de cola,
de selección ni de filtros.

## Estructura de la página (orden de arriba abajo)

```text
┌ Encabezado ───────────────────────────────────────────────────────────────┐
│ h1 «Peticiones»  · descripción  ·  [Copiar enlace para invitados]          │
├ Imágenes generadas (solo si hay; <LazyPrayerResults v-if>) ───────────────┤
│ rejilla de PrayerResultCard (1 col móvil · 2 col ≥ sm)                     │
├ Barra de filtros (PrayerToolbar, role="search") ──────────────────────────┤
│ [🔍 buscar…  ✕]   (Todas|Hoy|7 días|Rango) [desde][hasta]   [Orden ▾]     │
├ Rejilla de peticiones (PrayerGrid) ───────────────────────────────────────┤
│ PrayerCard × 12 por página (1 col móvil · 2 col sm · 3 col xl · 4 col 2xl)  │
│ … sentinela de scroll infinito: skeleton / «Fin» / error + Reintentar      │
└───────────────────────────────────────────────────────────────────────────┘
        ▲ fija abajo, solo con selección: PrayerSelectionBar
```

La zona «Imágenes generadas» va **arriba de los filtros** y se desplaza a la vista (`scrollIntoView`, `behavior: 'smooth'` salvo `prefers-reduced-motion`) al empezar una generación.

## Componentes (`app/components/prayers/`)

Se nombran por archivo (`components: [{ pathPrefix: false }]`). Cada uno tiene una sola responsabilidad.

| Componente | Props → eventos | Notas |
|------------|-----------------|-------|
| `PrayerToolbar` | `v-model:q`, `v-model:preset`, `v-model:from`, `v-model:to`, `v-model:dir` | Búsqueda (`label.input` + icono + botón limpiar), `join` de presets, dos `input type="date"` solo con **Rango**, `select` de orden. Todo `min-h-11`. Resumen del filtro activo con botón **Quitar filtros** |
| `PrayerGrid` | `items`, `loadingMore`, `moreError`, `done` → `retry-more` | `ul` en rejilla CSS; sentinela con `PrayerCardSkeleton ×3`, aviso «Ya viste todas las peticiones» o `ErrorState` de «más» con **Reintentar** |
| `PrayerCard` | `request`, `selected`, `disabled` → `toggle`, `fix`, `open` | `article` + casilla (ver abajo). Foto con carga diferida, nombre, «Aprobada hace…», «Enviada el…», nota, transcripción con marcas resaltadas, insignias (**Editada**, **Texto por corregir**, **Texto largo**), botón **Corregir texto** |
| `PrayerCardSkeleton` | `rows?` | Misma caja que `PrayerCard` (foto `aspect-[4/3]` + 3 líneas) con `skeleton` de daisyUI; `motion-reduce:` sin animación. Sin CLS |
| `PrayerSelectionBar` | `count`, `images`, `unreadable`, `limit` → `generate`, `review`, `clear` | Barra fija abajo (forma de `SongSelectionBar`, `--app-sidebar-w`, área segura): «N peticiones → M imágenes», advertencia de ilegibles, **Generar imágenes**, **Ver elegidas**, **Limpiar** |
| `PrayerSelectionDialog` *(Lazy)* | `items` → `remove`, `close` | `dialog.modal.modal-bottom sm:modal-middle`: lista compacta de elegidas (incluidas las que el filtro oculta) con quitar |
| `PrayerTextDialog` *(Lazy)* | `request` → `change`, `close` | `dialog.modal`: foto grande + `ImageTextPanel` **editable** (`/api/files/<id>/text`); reenvía `change` |
| `PrayerResults` *(Lazy)* | — (usa `usePrayerImages`) | Encabezado «Imágenes generadas» + **Descartar todas**; rejilla de `PrayerResultCard`; región `aria-live="polite"` con los cambios de estado |
| `PrayerResultCard` | `item` → `download`, `regenerate`, `cancel`, `dismiss`, `preview` | Esqueleto `aspect-[1152/928]` + `progress` mientras `queued/running`; `<img>` al estar lista; acciones por estado; error en español |
| `PrayerImagePreview` *(Lazy)* | `url`, `title` → `close` | `dialog` con la imagen a tamaño completo |

**Reutilizados sin cambios**: `EmptyState`, `ErrorState`, `ConfirmDialog` (vía `useConfirm`), `SkeletonList`, `ActionMenu`, `ImageTextPanel` (gana el evento `change`), `ImageTextEditor`.

### Carga diferida (Constitución I)

- Se importan de forma estática solo `PrayerToolbar`, `PrayerGrid`, `PrayerCard`, `PrayerCardSkeleton` y `PrayerSelectionBar` (lo que se ve al abrir).
- `LazyPrayerResults` (`v-if="images.hasItems"`), `LazyPrayerSelectionDialog` (`v-if` al abrir), `LazyPrayerTextDialog` (`v-if` al corregir) y `LazyPrayerImagePreview`
  (`v-if` al ampliar) no entran en el JS inicial de la ruta; `ImageTextPanel`/Regle solo llegan con `PrayerTextDialog`.
- Foto de cada tarjeta: `src` asignado cuando la tarjeta entra en el viewport (`useElementVisibility`, `rootMargin: '200px'`, `once: true`); hasta entonces se ve `skeleton`.
- Presupuesto: ruta ≤ 250 KB gzip de JS inicial; se mide con `bun run analyze` (quickstart § 6).

## Composables (`app/composables/`)

| Composable | Responsabilidad | VueUse / Nuxt |
|------------|-----------------|---------------|
| `usePrayerFilters()` | Estado de búsqueda, preset de fecha, rango y orden; expone `query` (`q`, `from`, `to`, `dir`) y `activeSummary`/`reset()` | `refDebounced` (300 ms) |
| `usePrayerRequests(query)` | Primera página (`useApiFetch`, `lazy`), `loadMore` por cursor, `items`, `error`, `loadingMore`, `moreError`, `done`, `refresh`, `patchText(id, ImageText)`; reinicia al cambiar `query` | `useInfiniteScroll`, `useApiFetch` |
| `usePrayerSelection()` | Selección con copia de tarjetas, tope 40, `ordered`, `groups`, `unreadable`, `toggle`, `remove`, `clear`, `sync(request)` | `useState` |
| `usePrayerImages()` | Cola de generación (2 a la vez), `enqueue(groups)`, `cancel`, `retry`, `regenerate`, `download`, `dismiss`, `reset`, `needsLeaveGuard` | `useState`, `useEventListener` |
| `usePrayerLeaveGuard()` | Confirma al salir (ruta y `beforeunload`) si hay generación en curso o imágenes sin descargar | `onBeforeRouteLeave`, `useEventListener`, `useConfirm` |

`usePrayerImages` copia la forma de `useSongPresentations` (estado en `useState`, `pump`, `AbortController`/`objectURL` en mapas de módulo, `$api` sin `.raw`, `Blob` de error
leído de vuelta con el mismo asistente) pero genera con **concurrencia 2**, no descarga sola y reparte los grupos con `chunkRequests`.

## Tarjeta seleccionable (accesibilidad)

```text
<article class="card relative …" :class="selected && 'ring-2 ring-primary'" aria-label="Petición de <nombre>">
  <label class="absolute inset-0 z-0 cursor-pointer" >                      ← cubre la tarjeta
    <input type="checkbox" class="radio radio-primary absolute right-3 top-3 z-10"
           :checked="selected" :disabled="disabled" aria-label="Elegir la petición de <nombre>" @change="toggle">
  </label>
  … foto · textos …
  <a/button class="relative z-10">  ← «Abrir foto», «Corregir texto»: encima de la etiqueta; no alteran la selección
</article>
```

- Casilla **real** (Espacio, estado «marcada/no marcada» anunciado, foco visible `focus-visible:outline`); `radio` de daisyUI solo da el aspecto circular. El objetivo táctil de la
  casilla mide ≥ 44 px (`size-7` + área de la etiqueta); toda la tarjeta es objetivo.
- La marca no depende del color: borde `ring-2`, icono `lucide:check` dentro del indicador y texto accesible «elegida».
- `disabled` cuando la tarjeta no tiene texto (no seleccionable) o se alcanzó el tope; el motivo va en `aria-describedby` («Sin texto: escríbelo primero», «Tope de 40 alcanzado»).
- Las marcas de ilegible se pintan con `badge badge-warning badge-soft` + `lucide:triangle-alert` (no `text-warning` sobre `base-100` claro) y la tarjeta añade «Texto por corregir» como texto, no solo color.

## Estados (cuatro por vista, Constitución VI)

| Vista | Cargando | Vacío | Error | Contenido |
|-------|----------|-------|-------|-----------|
| Rejilla (primera página) | `PrayerCardSkeleton ×6` (`aria-busy`, texto «Cargando…») | `EmptyState` «Todavía no hay peticiones aprobadas» + **Ir a Solicitudes** (`NuxtLink`) + **Copiar enlace para invitados** | `ErrorState` con **Reintentar** | `PrayerGrid` |
| Rejilla filtrada | igual | `EmptyState` «No hay peticiones con esos filtros» + **Quitar filtros** | igual | igual |
| Más páginas | `PrayerCardSkeleton ×3` en el sentinela | aviso de fin | `ErrorState` compacto «No pudimos cargar más peticiones» + **Reintentar** (conserva lo cargado) | — |
| Transcripción de la tarjeta | texto en `skeleton` + «Leyendo texto…» (`reading`/`pending`) | «No se reconoció texto» / «Sin texto» + **Escribir transcripción** | «No se pudo leer» + **Corregir texto** | texto + insignias |
| Imagen generada | `skeleton aspect-[1152/928]` + `progress` | — | mensaje por `errorCode` + **Reintentar** (si aplica) | `<img>` + **Descargar** |

## Interacciones clave

- **Elegir**: casilla/tarjeta; la barra aparece con la primera selección. Con 40 elegidas las no elegidas pasan a `disabled` con motivo.
- **Corregir texto**: abre `LazyPrayerTextDialog`; al guardar, `ImageTextPanel` emite `change` → `usePrayerRequests.patchText` actualiza la tarjeta y
  `usePrayerSelection.sync` actualiza la copia (la tarjeta pasa a «Editada» y deja de decir «por corregir» si ya no hay marcas).
- **Generar imágenes**: la barra llama a `useConfirm().confirm({ title: 'Generar imágenes', message: 'N peticiones → M imágenes. Cada imagen usa crédito del servicio de imágenes.' [+ 'K peticiones todavía tienen texto ilegible ([ilegible])…'], confirmLabel: 'Generar' | 'Generar de todos modos' })`.
  **Cancelar** devuelve a la página (la barra ofrece **Ver elegidas** para revisarlas). Al confirmar: `usePrayerImages.enqueue(selection.groups)`; la selección **se conserva** para poder corregir y volver a generar.
- **Imagen lista**: **Descargar** (`triggerDownload` con `objectURL`; nombre `peticiones-AAAA-MM-DD-<n>.png`), **Ver en grande**, **Generar de nuevo**, **Descartar**. Fallida: **Reintentar** si `retryable`, **Descartar**. En curso: **Cancelar**.
- **Cambios de selección durante `request_unavailable`**: el `409` trae `data.ids`; se retiran de la selección, se avisa con toast y la imagen queda `failed` sin reintento.
- **Salir**: `usePrayerLeaveGuard` pide confirmación si hay imágenes `queued/running` o `done` sin descargar (`beforeunload` nativo + `ConfirmDialog` en navegación interna). Al aceptar, `reset()` aborta, revoca los `objectURL` y vacía selección.
- **Filtros**: cambiar `q/preset/from/to/dir` reinicia la lista (no la selección). `Hoy` = `[inicio del día local, inicio del día siguiente)`; `7 días` = `[inicio del día local − 6 días, mañana)`; `Rango` usa `desde` 00:00 local y `hasta` 24:00 local (inclusivo para la persona). Se envían como instantes ISO.

## Responsivo y tema

- Mobile first: base 1 columna, `sm:grid-cols-2`, `xl:grid-cols-3`, `2xl:grid-cols-4`; barra de filtros en columna en 360 px y en fila desde `lg:`; botones `btn` (≥ 44 px), nunca `btn-sm` como base (solo `lg:btn-sm`).
- Sin desplazamiento horizontal a 360 px (`min-w-0`, `break-words` en nombres y texto). `PrayerSelectionBar` respeta `env(safe-area-inset-bottom)` y se apoya sobre las bandejas de YouTube/Canciones con las variables CSS ya existentes (`--youtube-tray-h`, `--song-tray-h`); la página agrega relleno inferior con la barra visible.
- Colores solo por tokens de daisyUI (`base-*`, `primary`, `warning`, `error`); íconos `lucide`; sin colores fijos. Se verifica en `cloudy` (oscuro) y `cloudy-light`.
- `prefers-reduced-motion`: `motion-reduce:animate-none` en `skeleton`, `progress` y `loading`; el desplazamiento suave se desactiva.

## Textos (`messages.prayers`, español)

Avisos, errores y estados viven en `app/utils/messages.ts`; los mensajes por código de la API en `PRAYER_ERROR_MESSAGES` (`shared/constants/prayers.ts`). Ejemplos:
`selected: (n) => '3 peticiones elegidas'`, `willGenerate: (n, m) => '8 peticiones → 2 imágenes'`, `illegibleWarning: (n) => '1 petición todavía tiene texto ilegible'`,
`limit: 'Elegiste el máximo de 40 peticiones por generación'`, `emptyApproved`, `emptyFiltered`, `loadMore`, `leaveTitle`, `leaveBody`, `generated: (n) => 'Imagen <n> lista'`,
y por código: `not_configured`, `quota_exceeded`, `provider`, `invalid_output`, `too_large`, `timeout`, `request_unavailable`.
