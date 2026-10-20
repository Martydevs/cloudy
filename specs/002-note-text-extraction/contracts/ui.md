# Contrato de UI: texto extraído de imágenes

Extiende [001 contracts/ui-routes.md](../../001-shared-media-drive/contracts/ui-routes.md). No hay rutas nuevas.

## Componentes y composable nuevos

### `app/composables/useImageText.ts`

Es la única lógica de cliente del panel.

**Entrada**:
- `endpoint`: `/api/files/:id/text` o `/api/submissions/:sid/files/:fid/text`.
- `{ autoRead: boolean, editable: boolean }`.

**Expone**:
- Estado: `state: Ref<ImageText | null>`, `loading` y `error`, que es el error de red, no el de la lectura.
- Acciones: `read(force?)`, `save(text)` y `copy()`.

**Comportamiento**:
- **Al montar**: con `autoRead`, primero obtiene el estado (`GET`, o el `initial` que vino en el listado de
  Pendientes). Solo hace `POST` sin `force` si el estado es `pending` (respaldo: imagen que quedó sin leer);
  los estados terminales, incluido `failed`, se muestran tal cual, sin ninguna petición más. Una lectura
  vencida ya llega del servidor como `failed`/`timeout`: el cliente no calcula antigüedades.
- **Mientras dura `reading`** (la lectura en segundo plano tras subir o recibir, o la de otra petición):
  consulta `GET` cada 3 s con `useIntervalFn` y se detiene en un estado terminal. Se pausa con
  `useDocumentVisibility` y `useOnline`, como `usePulsePolling`.
- **`copy()`**: usa `useClipboard` y muestra el toast `messages.imageText.copied`.

### `app/components/files/ImageTextPanel.vue`

- **Props**: `endpoint`, `initial?: ImageText | null`, `editable`, `autoRead`.
- **Estados** (FR-005, FR-020), todos con copy de `messages.imageText`:

| Estado | Contenido |
|--------|-----------|
| `reading` o carga inicial | `SkeletonList` de 3 filas en variante `list` y el texto "Leyendo texto…" en una región `aria-live="polite"`; tras subir, normalmente dura unos segundos |
| `ready` | El texto en `<p class="whitespace-pre-line">`, que conserva los saltos de línea (FR-002). Botón **Copiar texto**. Si `editable`: botón **Editar** y **Volver a leer** en un menú `⋯` visible. Insignia "editado por X" si aplica |
| `empty` | `EmptyState` con el icono `scan-text` y "No se reconoció texto en esta imagen", más **Volver a leer** |
| `failed` | `ErrorState` con el mensaje según `error` (`timeout`/`provider`/`rate_limited` → "No pudimos leer el texto ahora. Inténtalo de nuevo en un momento."; `quota_exceeded` → "El servicio de lectura alcanzó su límite de uso. Avisa a un administrador e inténtalo más tarde.", con Reintentar; `invalid_input` → "No pudimos leer esta imagen. Descárgala y vuelve a subirla en JPG o PNG." **sin** Reintentar, porque repetir no puede funcionar; `invalid_output` → mismo copy con Reintentar), que emite `retry` → `read(true)` |
| `unavailable` | Texto de ayuda "No disponible para este archivo: solo se lee el texto de imágenes JPG, PNG o HEIC de hasta 5 MB." (para HEIC sin copia: "…esta foto HEIC se subió sin copia para lectura"), sin botones |
| error de red del propio panel | `ErrorState` con reintento de la petición |

- **Edición**: un `textarea` con etiqueta "Texto de la imagen", contador `n / 10 000`, botones **Guardar** y
  **Cancelar**. Al guardar muestra el toast `messages.imageText.saved`.
- **Volver a leer con corrección manual**: si `editedAt` no es nulo, primero pasa por `useConfirm` →
  `ConfirmDialog` ("Se reemplazará tu corrección").
- **Botones**: de tamaño `btn` base, con `lg:btn-sm` solo en escritorio (Constitución III).

### `app/utils/heic-copy.ts`

- **Función**: `makeTextSourceCopy(file: File): Promise<Blob | null>`, en el mismo estilo que `makeThumbnail`
  (research A4).
- **Cuándo actúa**: solo si `isImageTextEligible({ extension: 'heic', size })`.
- **Carga**: `heic-to` con `import()` dinámico, en un chunk aparte que no entra en el JS inicial de ninguna ruta.
- **Conversión**: JPEG con calidad 0.85; si pesa más de 5 MB, una vez más con 0.7.
- **Errores**: cualquier error → `null`.

### Subida con copia JPEG

| Composable | Cambio |
|------------|--------|
| `app/composables/useUploader.ts` (equipo) | Si el archivo es una HEIC apta, pide la firma con `withTextSource: true` sin esperar la conversión, sube el original de inmediato y ejecuta `makeTextSourceCopy(file)` en paralelo; antes de `complete` sube la copia a `ticket.textSourceUploadUrl` con `content-type: image/jpeg` (si la copia es `null` o su PUT falla, llama a `complete` igual y el servidor marca `unavailable`). Un fallo se ignora, igual que con la miniatura. Mientras convierte, la fila de la cola muestra "Preparando…" |
| `app/composables/useGuestSubmission.ts` (invitados) | Igual, por archivo: `withTextSource: true` para cada HEIC apta en el cuerpo de `POST /api/public/submissions`, convirtiendo en paralelo con la subida del original, y PUT a `textSourceUploadUrl`. `complete` responde como hoy (la lectura sigue en segundo plano), así que no hay ningún estado de espera nuevo |

## Pantallas que cambian

| Pantalla | Cambio |
|----------|--------|
| `app/pages/archivos/ver/[fileId].vue` | Si `file.category === 'image'`, el aside muestra `<LazyImageTextPanel :endpoint="/api/files/${id}/text" auto-read editable />` antes de los comentarios. Como la lectura empezó al subir, lo normal es ver el texto ya listo o "Leyendo texto…" unos segundos. En móvil va debajo de la vista previa y en `lg:` en la columna lateral, como el aside actual. Las fotos HEIC, que no tienen `<img>`, también muestran su texto |
| `app/components/guests/SubmissionCard.vue` | Bajo cada miniatura de imagen, `<LazyImageTextPanel :endpoint=… :initial="file.text" auto-read :editable="false" />` en versión compacta: el texto se trunca a 6 líneas con un botón "Ver todo". Mientras el envío recién recibido se lee en segundo plano, muestra "Leyendo texto…" y consulta `GET …/text`. Hace `POST` sin `force` solo si el estado es `pending`; `failed` espera el Reintentar del usuario |
| `app/pages/enviar.vue` | Junto al selector de archivos, un aviso `text-base-content/70` (FR-011): "Leeremos automáticamente el texto de tus imágenes para que el equipo pueda revisarlas." El botón Enviar y su estado no cambian |
| `app/components/files/FileExplorer.vue` (resultados de búsqueda) | Si `matchedIn === 'text'`, la fila muestra la insignia "En el texto". Siempre que `q` esté activo (con resultados y en el estado vacío), una nota breve `text-base-content/70` muestra `searchHint`: solo se busca en el texto de las imágenes que ya se leyeron; las que se están leyendo, las no aptas y las subidas antes de esta feature que nadie ha abierto no aparecen por su texto (FR-015) |

## Copy (`app/utils/messages.ts`)

La sección nueva `imageText` lleva:
- `reading`, `empty`, `unavailable`, `failedRetryable`, `failedQuota`, `failedPermanent`.
- `copied`, `saved`, `confirmReread`, `editedBy(name)`.
- `searchHint` ("Solo buscamos en el texto de las imágenes que ya se leyeron"), `guestNotice`.
- Además, en la sección `files`, `preparing`.

Todo en español y en el mismo tono amable del resto de la sección `messages`.

## Accesibilidad

- El panel es una `<section>` con encabezado "Texto de la imagen".
- Los cambios de estado se anuncian con `aria-live="polite"`.
- Los botones tienen nombre accesible.
- El foco vuelve al botón **Editar** al cancelar o guardar.
- `motion-reduce` en el skeleton.
- Contraste AA en ambos temas (no `text-warning` sobre `base-100` claro).
