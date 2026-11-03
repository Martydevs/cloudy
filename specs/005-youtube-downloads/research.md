# Research: Página YouTube — descargas y listas de reproducción

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Fecha**: 2026-11-03

Cada decisión resuelve una incógnita del Technical Context. Formato: Decisión · Razón · Alternativas.
Las referencias al servicio vienen de `C:\Users\andre.perez\Dev\cloudy-api` (README, `schemas.py`, `routers/`, `uv.lock`) tal como estaba el
2026-11-03; las del repositorio de Cloudy, del estado de `main`.

## D1. Frontera con el servicio de descargas (FR-003, FR-030; Constitución IV)

- **Decisión**: un único módulo, `server/utils/cloudy-api.ts`, habla con el servicio. Expone `probeVideo`, `createJob`, `getJob`,
  `cancelJob` y `pingService`; usa `fetch` nativo con `X-API-Key` (de `runtimeConfig.cloudyApiKey`), un `AbortSignal.timeout`
  por llamada y traduce todo error del servicio a `createError` con texto en español (D6). Los endpoints `/api/youtube/**` solo
  llaman a este módulo; nunca leen `cloudyApiUrl` ni `cloudyApiKey`. `test/unit/architecture.spec.ts` lo hace cumplir.
- **Razón**: es la misma regla que ya rige a Neon Auth, el almacenamiento y la IA: una sola puerta por proveedor externo. El
  navegador nunca ve la clave: solo recibe el `download_url` firmado que el servicio construye para cada trabajo.
- **Alternativas**: llamar al servicio desde el navegador (expone `X-API-Key`; descartado por FR-003); un SDK generado desde
  `/openapi.json` (una dependencia o un paso de build más para 5 llamadas; YAGNI).

## D2. Los trabajos viven en el servicio y los orquesta el navegador (FR-008, FR-020, FR-031)

- **Decisión**: Cloudy no guarda trabajos. El navegador crea el trabajo (`POST /api/youtube/jobs`), lo consulta cada 2,5 s
  (`GET /api/youtube/jobs/:id`) y, cuando `status = done`, navega al `downloadUrl`. Para una lista o selección de más de 10
  videos, el cliente la parte en lotes de hasta 10 (`chunkVideoIds`, función pura en `shared/`) y crea **un lote a la vez**: el
  siguiente nace cuando el anterior termina (`done` o `failed`).
- **Razón**:
  - El servicio es la fuente de verdad del estado; duplicarlo en Postgres obligaría a sincronizar un trabajo que vive 30 min y se
    pierde si Render reinicia (spec, Assumptions: "no se recuperan").
  - Las funciones de Vercel no pueden esperar un lote (minutos) ni guardar estado en memoria (Constitución, Despliegue).
  - El servicio procesa un trabajo a la vez (`MAX_CONCURRENT_JOBS=1`) y su cola admite 20 (`MAX_QUEUE`): encolar 11+ lotes de golpe
    chocaría con `429 queue_full`. Un lote a la vez evita el 429 y hace explícito el avance ("lote 2 de 4").
  - Un doble clic crea un solo trabajo porque el botón queda deshabilitado mientras la creación está en vuelo y el trabajo
    activo ocupa el estado (FR-031).
- **Alternativas**: tabla `youtube_jobs` con sondeo del servidor (estado duplicado, trabajo huérfano si Render reinicia); un
  endpoint que espere el lote (excede el tiempo máximo de la función).

## D3. La bandeja de descargas sobrevive a la navegación pero no a la recarga (FR-009, spec Assumptions)

- **Decisión**: el estado de las descargas (`jobs`, lotes pendientes, formato) vive en `useState('youtube-downloads')` y lo muestra
  `YoutubeDownloadTray`, montado de forma diferida (`LazyYoutubeDownloadTray` con `v-if` cuando hay trabajos) en el layout
  `dashboard`. El sondeo usa `useIntervalFn` y se pausa sin conexión (`useOnline`). No se persiste en `localStorage`.
- **Razón**: una descarga debe seguir al pasar de `/youtube` a `/youtube/:id`; persistir tras recargar contradice el supuesto del
  spec (el trabajo no se recupera) y arriesga mostrar trabajos ya expirados. Al ser `Lazy*` con `v-if`, no pesa en el JS inicial
  de las demás rutas (Constitución I).
- **Alternativas**: bandeja por página (se pierde al navegar); `sessionStorage` (resucita trabajos que el servicio ya olvidó).

## D4. Descargas automáticas encadenadas y respaldo manual (FR-008, FR-020)

- **Decisión**: al terminar un trabajo la bandeja intenta guardar el archivo (anclaje `<a href=downloadUrl download>` con `click()`)
  y deja en esa fila un botón **Guardar archivo**, siempre visible, que repite el intento con un enlace nuevo (vuelve a consultar el
  trabajo para renovar la firma, ~10 min de vida).
- **Razón**: Chrome y Safari piden permiso o bloquean la segunda descarga automática sin gesto del usuario; el botón manual
  garantiza que cada lote sea alcanzable. Consultar de nuevo el trabajo evita mostrar un enlace caducado.
- **Alternativas**: abrir `window.open(downloadUrl)` (lo bloquean los bloqueadores de ventanas emergentes); unir los lotes en un
  solo `.zip` (el servicio no lo ofrece y pasarlo por Vercel viola el Principio I).

## D5. Reproductor: copia de reproducción 720p bajo demanda (FR-012–FR-014; spec Assumptions)

- **Decisión**:
  - El reproductor es un componente propio (`YoutubePlayer.vue`) con un `<video>` nativo **sin** `controls` y una barra hecha con
    daisyUI y `lucide` (`useMediaControls` de VueUse: play/pausa, avance, volumen, tiempo, pantalla completa). `useFullscreen`
    (VueUse) se aplica al contenedor, así que la barra propia sigue visible en pantalla completa.
  - La fuente es un trabajo `mp4_720` del servicio. Se crea **solo cuando la persona pulsa Reproducir** (el póster es la miniatura
    con un botón grande), no al abrir la página: el servicio gratuito procesa un trabajo a la vez y abrir tres fichas del historial
    no debe encolar tres conversiones.
  - Si ya hay un trabajo `mp4_720` terminado y vigente para ese video, **Descargar → Video 720p lo reutiliza** (consulta el trabajo
    y baja su archivo) en lugar de crear otro.
  - El enlace firmado dura ~10 min y el archivo 30; cuando `<video>` falla (`error`) o el enlace caducó, el reproductor vuelve a
    consultar el trabajo para renovar la firma y, si el servicio responde `404`/`410`, ofrece **Preparar de nuevo**.
  - Starlette 1.10 (`uv.lock`) atiende `Range` en `FileResponse`, así que el avance dentro del video funciona sin descargar todo.
  - `<video>` y la navegación a un archivo no requieren CORS, así que `ALLOWED_ORIGINS` del servicio no necesita cambios para esta
    feature. `Content-Disposition: attachment` no impide que un `<video src>` lo reproduzca.
- **Razón**: el servicio solo entrega archivos, no streaming (README). El póster con acción explícita protege la cola; reutilizar la
  copia 720p ahorra una conversión de yt-dlp en una instancia de capacidad mínima.
- **Alternativas**: el iframe de YouTube (no es un `<video>` nativo, no usa el tema y no es lo que pidió la persona); crear la copia al
  abrir la página (satura la cola); `controls` nativos (no respetan el tema `cloudy`).

## D6. Errores del servicio → mensajes en español (FR-010, FR-011)

- **Decisión**: `cloudy-api.ts` clasifica la respuesta y lanza `createError` con `message` en español y `data` mínima:

  | Servicio | Cloudy | `data` y copy |
  |----------|--------|---------------|
  | red, timeout, `502/503/504` | **503** | `{ state: 'waking' }` · "El servicio de descargas está despertando o no responde. Reintenta en un momento." |
  | `401` (clave mal configurada) | **502** | sin detalle · "El servicio de descargas no está bien configurado. Avisa a un administrador." (se registra solo el código) |
  | `429 queue_full` | **429** + `Retry-After: 30` | "El servicio está ocupado. Intenta de nuevo en un momento." |
  | `404`/`410` de un trabajo | **404** | `{ code: 'expired' }` · "Esta descarga expiró. Prepárala de nuevo." |
  | `422 videos_rejected` | **422** | `{ videos: [{ videoId, code, message }] }` con el copy de `ITEM_ERROR_MESSAGES` |
  | `422 batch_too_large` / validación de FastAPI | **422** | mensaje genérico (el cliente ya limita a 10; si ocurre es un bug) |
  | `404` de un video | **404** | "No encontramos ese video. Revisa el enlace." |

  Los códigos por elemento (`private`, `unavailable`, `age_restricted`, `members_only`, `geo_restricted`, `live`,
  `format_unavailable`, `bot_check`, `ffmpeg_missing`, `download_failed`, `cancelled`, `internal`) y los motivos de `downloadable: false`
  (`too_long`, `live`, `unknown_duration`) tienen su texto en `shared/constants/youtube.ts`, usado en cliente y servidor.
- **Razón**: el usuario nunca ve respuestas crudas (AGENTS: solo `serverMessage()`); un único mapa evita copy duplicado.
- **Alternativas**: reenviar el `detail.message` del servicio (está en inglés y filtra detalles internos).

## D7. Arranque en frío del servicio (FR-010, SC-002, SC-010)

- **Decisión**: `GET /api/youtube/health` llama a `/healthz` con un plazo de 5 s y responde `{ state: 'up' | 'waking' | 'down' }`
  (`waking` = sin respuesta a tiempo; `down` = respondió `503` degradado). Al montar cualquier página de la feature,
  `useYoutubeService()` lo consulta; mientras no sea `up` muestra `YoutubeServiceBanner` ("Despertando el servicio, puede tardar
  hasta 1 minuto") y reintenta cada 5 s con `useIntervalFn`, y se detiene al quedar `up` o al salir de la página. Cualquier
  acción que falle con `503` muestra el mismo banner con **Reintentar**.
- **Razón**: Render gratuito duerme tras 15 min y tarda ≈1 min (README sugiere exactamente este ping). Así el servicio ya está
  despierto cuando la persona termina de pegar el enlace.
- **Alternativas**: pingar desde un Vercel Cron (mantiene despierto el servicio las 24 h y consume horas gratuitas de Render);
  esperar el timeout de la primera acción real (mala experiencia).

## D8. Plazos de las llamadas y duración de la función (riesgo abierto)

- **Decisión**: plazos por llamada en `cloudy-api.ts`: `ping` 5 s, `getJob`/`cancelJob` 10 s, `probeVideo` 20 s, `createJob` 45 s
  (el servicio sondea cada video antes de encolar: hasta 10 videos con `PROBE_CONCURRENCY=3`). Al vencer el plazo, error `503`.
- **Razón**: `POST /v1/jobs` hace el *preflight* de todos los videos antes de responder `202` (`routers/jobs.py::_preflight`), lo que
  con 10 videos puede tardar decenas de segundos.
- **Riesgo**: el tiempo máximo de la función de Vercel depende del plan. **Verificar en el despliegue** que `createJob` (45 s)
  cabe; si no, bajar el lote a 5 videos (`MAX_BATCH_CLIENT`, constante en `shared/constants/youtube.ts`) sin tocar el servicio.
  Queda como paso de quickstart §6.

## D9. Datos: videos, historial y listas (FR-015–FR-026, FR-032)

- **Decisión**: tres tablas nuevas (detalle en [data-model.md](./data-model.md)):
  - `youtube_videos`: un video conocido (ID, título, canal, duración, miniatura) **más** las columnas del historial compartido
    (`last_viewed_at`, `last_viewed_by`; `NULL` = no está en el historial). Una sola fila por video; quitar del historial pone
    ambas en `NULL` y no borra el video si una lista lo usa.
  - `youtube_playlists`: lista global con autor.
  - `youtube_playlist_items`: PK `(playlist_id, video_id)`, que garantiza FR-018 sin lógica extra.
- **Razón**: historial y videos tienen cardinalidad 1:1 y el historial es compartido; fusionarlos evita un JOIN y una tabla.
  Las listas necesitan la FK al video para mostrar miniatura y título sin pedirlos al servicio (que es lento y puede estar dormido).
- **Orden dentro de la lista**: por `added_at`. El spec lista "posición" en la entidad, pero ninguna historia pide reordenar:
  YAGNI; si luego se pide, se agrega una columna.
- **Huérfanos**: un video sin historial ni listas es basura. La limpieza diaria existente (`/api/cron/cleanup`) suma un `DELETE` de
  esos videos con más de 24 h (el margen evita borrar uno que alguien está a punto de agregar a una lista).
- **Alternativas**: historial en tabla aparte (JOIN extra sin beneficio); guardar el video como JSON dentro de la lista (rompe FR-018,
  duplica datos y no permite buscar).

## D10. Registro del historial al abrir un video (FR-022)

- **Decisión**: `GET /api/youtube/videos/:videoId` hace `probeVideo` y, si responde, ejecuta en un `db.batch` un `INSERT … ON CONFLICT
  (video_id) DO UPDATE` que refresca título/canal/duración/miniatura y fija `last_viewed_at = now()`, `last_viewed_by = quien consulta`.
  Si el servicio dice que el video no se puede descargar (`downloadable: false`), igual se registra (hay datos para mostrar). Si la sonda
  falla por error del video (privado, no encontrado) y ya existe una fila, se devuelve esa fila con `downloadable: false` y el motivo; si no
  existe, se responde el error sin registrar nada (sin título no hay qué mostrar).
- **Razón**: una sola petición abre la ficha y deja el historial consistente; no hay estado a medias si falla la sonda.
- **Alternativas**: registrar al terminar una descarga (el spec dice "al abrir la página", y quien solo mira también quiere encontrarlo luego).

## D11. Paginación del historial y orden de las listas (FR-023, SC-007; Constitución I)

- **Decisión**: cursor keyset sobre `(last_viewed_at DESC, video_id DESC)` con índice parcial `WHERE last_viewed_at IS NOT NULL`, reutilizando
  `encodeCursor`/`decodeCursor` de `server/utils/pagination.ts`. Páginas de 24; el cliente usa `useInfiniteScroll` de VueUse. La fila "reciente"
  de la página de un video pide 12 con `exclude=<id>`. Las listas se ordenan por `updated_at DESC` y se traen todas (decenas) con su conteo y hasta
  4 miniaturas como subconsultas, sin N+1.
- **Razón**: `PAGE_SIZE` de archivos no aplica (60), pero el cursor y su validación sí; el precedente cubre el 422 por cursor inválido.
- **Alternativas**: `useOffsetPagination` (OFFSET degrada con miles de filas y se desplaza si entran filas nuevas arriba).

## D12. Permisos de listas (FR-016, FR-017)

- **Decisión**: todos los endpoints exigen `requireRole(event, 'editor')` (el admin también pasa). Renombrar o eliminar una lista exige ser su
  autor **o** `can(role, 'youtube.moderate')`, acción nueva de `shared/permissions.ts` reservada a `admin` (mismo patrón que
  `comments.moderate`). Agregar y quitar videos solo exige el rol de equipo.
- **Razón**: replica el patrón existente de moderación, lo prueba `permissions.spec.ts` y el cliente lo refleja con `can()` sin duplicar la regla.
- **Alternativas**: comprobar `role === 'admin'` en el endpoint (rompe la regla de `shared/permissions.ts` como única fuente).

## D13. Validación del enlace (FR-004, FR-005)

- **Decisión**: `parseYoutubeUrl(text)` en `shared/validation/youtube.ts` (función pura). Acepta `https?://` con host `youtube.com`, `www.`, `m.`,
  `music.youtube.com`, `youtube-nocookie.com` o `youtu.be`, y rutas `/watch?v=ID`, `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID` o `youtu.be/ID`.
  Ignora `t`, `list`, `si`, `feature`, etc. Rechaza con un motivo (`not_url`, `not_youtube`, `playlist`, `channel`, `no_video`, `bad_id`). El ID debe cumplir
  `^[A-Za-z0-9_-]{11}$`, igual que el servicio. Un ID suelto (sin URL) **no** se acepta, para que texto libre de 11 caracteres no se confunda con un video.
  El esquema `youtubeUrlSchema` de `app/utils/form-schemas.ts` la usa a través de `useFormSchema` (AGENTS: nunca `useRegle` directo), con un `refine`.
- **Razón**: la regla es de dominio, no de UI, y la usan el campo y (por si acaso) el servidor al recibir `videoId`; `test/nuxt/form-schemas.spec.ts`
  comprueba que ambos acuerdan.
- **Alternativas**: dejar que el servicio valide (un viaje de red para rechazar texto libre; peor UX y gasto de la instancia gratuita).

## D14. Rutas y ventana externa (FR-001, FR-013)

- **Decisión**:
  - `app/pages/youtube/index.vue` (Inicio de la feature), `app/pages/youtube/[id]/index.vue` (video) y `app/pages/youtube/[id]/ventana.vue`
    (ventana externa). **Se mueve el stub sin seguir `app/pages/youtube.vue`** (archivo sin versionar creado por la persona): un `youtube.vue`
    junto a la carpeta `youtube/` se convertiría en ruta padre y exigiría `<NuxtPage />`.
  - La ventana externa abre `window.open('/youtube/<id>/ventana?job=<jobId>', 'cloudy-player', 'popup,width=1100,height=640')`. Es una página de
    Cloudy (misma sesión) con layout propio `player` y el mismo `YoutubePlayer`, porque abrir el `downloadUrl` descargaría el archivo
    (`attachment`). Si el trabajo ya expiró, ofrece **Preparar de nuevo**.
  - Pantalla completa dentro de la página: `useFullscreen` sobre el contenedor del reproductor.
- **Razón**: es lo que permite "ver en otra pantalla" con controles del tema y renovar el enlace firmado.
- **Alternativas**: `window.open(downloadUrl)` (descarga en lugar de reproducir); Picture-in-Picture (no es lo pedido).

## D15. Miniaturas de YouTube (Principio I, privacidad)

- **Decisión**: se guarda la URL de la miniatura que devuelve el servicio (`i.ytimg.com`) y se muestra con `<img loading="lazy" width height>`.
  No se copia al almacenamiento de Cloudy.
- **Razón**: son 20–200 imágenes pequeñas; copiarlas añadiría subida, bucket y limpieza para nada (YAGNI). El `Referrer-Policy` ya es
  `strict-origin-when-cross-origin`. Al cargarlas, el navegador de cada persona contacta a Google, algo inherente a mostrar el video.
- **Alternativas**: proxy de imágenes (los binarios no deben pasar por funciones); copia en bucket (almacenamiento y limpieza extra).

## D16. Configuración del servicio y variables de entorno (hallazgo)

- **Decisión**: `runtimeConfig.cloudyApiUrl` y `cloudyApiKey` ya existen en `nuxt.config.ts` (sin versionar). Nuxt los lee de
  **`NUXT_CLOUDY_API_URL`** y **`NUXT_CLOUDY_API_KEY`** (camelCase → `CLOUDY_API_URL`). **`.env.example` hoy declara `NUXT_CLOUDY_APIURL`, que no
  mapea a `cloudyApiUrl`** (sería `cloudyApiurl`) y no declara la clave: hay que corregirlo y añadir `NUXT_CLOUDY_API_KEY` en `.env.example`,
  `.env.development`, `.env.test` y `.env`. Un valor vacío en URL o clave = la feature responde `503` "no configurado" en lugar de fallar con un error de
  red (útil en dev sin servicio). En e2e, `NUXT_CLOUDY_API_URL` apunta a un stub local del servicio (D17).
- **Razón**: sin la corrección, `useRuntimeConfig().cloudyApiUrl` sale vacío aunque el `.env` tenga valor.

## D17. Pruebas sin tocar YouTube (Principio V)

- **Decisión**: igual que el stub de OpenRouter (`test/e2e/setup/openrouter-stub.ts`), `test/e2e/setup/cloudy-api-stub.ts` implementa el contrato
  del servicio (`/healthz`, `/v1/videos/:id`, `/v1/jobs`, `/v1/jobs/:id`, `/v1/jobs/:id/file`) con videos de prueba (un MP4 y un MP3 diminutos
  generados en código) y escenarios por ID de video (`privateVideo`, `tooLong`, `slow`, `failsAfterStart`, …). Los unitarios simulan `fetch` en
  `cloudy-api.ts` (no hay red). Los e2e de la feature nunca llaman a Render ni a YouTube.
- **Razón**: determinista, rápido y sin depender de que YouTube cambie. El servicio ya tiene su propia suite (`cloudy-api/tests`) que cubre yt-dlp.
- **Alternativas**: apuntar los e2e al servicio real (frágil, lento, depende de YouTube y de una instancia que duerme).

## D18. Dependencias (Constitución II)

- **Decisión**: **ninguna dependencia nueva**. VueUse cubre `useMediaControls`, `useFullscreen`, `useInfiniteScroll`, `useIntervalFn`,
  `useOnline`, `useClipboard`, `useConfirmDialog`; daisyUI, `modal`, `dropdown`, `range`, `progress`, `skeleton`, `card`; `@nuxt/icon` con lucide.
- **Servicio externo nuevo**: el servicio de descargas (`cloudy-api` en Render) **sí** es un servicio nuevo y se justifica en Complexity Tracking.
