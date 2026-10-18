# Research: Cloudy — Disco multimedia compartido

**Fase 0** del plan · 2026-10-14 · Spec: [spec.md](./spec.md)

Cada sección resuelve una incógnita del Technical Context con el formato *Decisión / Justificación / Alternativas*.

---

## R1. Integración de Neon Auth en Nuxt (Nitro/h3)

**Hallazgo**: `server/config/auth.ts` importa `@neondatabase/auth/next/server`, que depende de `next/headers` y **no funciona en Nitro**. El paquete (`0.6.0-beta`) expone un toolkit agnóstico en `@neondatabase/auth/server` (`createAuthServer`, `handleAuthProxyRequest`, `RequestContext`, `extractNeonAuthCookies`, `serializeSetCookie`) y documenta cómo construir un adaptador (`node_modules/@neondatabase/auth/BUILDING-AN-ADAPTER.md`).

**Decisión**: Escribir un adaptador h3 propio y mínimo:

1. `server/utils/auth.ts`: `createAuthServer({ baseUrl, cookieSecret, context })` con un `RequestContext` que obtiene el evento actual con `useEvent()` (requiere `nitro.experimental.asyncContext: true`). El contexto lee las cookies de `getRequestHeader(event, 'cookie')` y escribe con `appendResponseHeader(event, 'set-cookie', serializeSetCookie(...))`.
2. `server/routes/api/auth/[...path].ts`: es una sola línea, `handleAuthProxyRequest({ request: toWebRequest(event), path, ... })`. Todo el tráfico de auth del navegador pasa **same-origin** por este proxy, así que las cookies son de primera parte.
3. Cliente: `createAuthClient(\`${origin}/api/auth\`)` de `@neondatabase/auth`, usando la API Better Auth vanilla (`signUp.email`, `signIn.email`, `signOut`, `requestPasswordReset`, `resetPassword`, `changePassword`, `updateUser`).
4. No se usa el `middleware` del toolkit: la protección de rutas la hace Cloudy con su propio middleware, porque además del inicio de sesión debe comprobar el rol y el estado (ver R2).

**Justificación**: Es el camino oficial del paquete para frameworks no-Next. Además mantiene un solo origen y no requiere React.

**Alternativas**:
- Usar `better-auth` directo: no es Neon-managed y duplicaría usuarios.
- Llamar a Neon Auth desde el navegador sin proxy: cookies de terceros y problemas de CORS.
- Usar el adaptador Next: no aplica a Nitro.

**Riesgo**: el toolkit es *beta*, así que se fija la versión exacta (`0.6.0-beta`) en `package.json` y el adaptador se cubre con tests.

## R2. Roles, estado de aprobación y primer administrador

**Decisión**: Neon Auth gestiona **solo la identidad** (usuario, sesión, contraseña, correos). Los roles y la aprobación viven en la tabla propia `profiles`, ligada por `user_id` al id de Neon Auth:

- **Creación del perfil**: en la primera petición autenticada sin perfil se crea uno. Una sola sentencia `INSERT … SELECT` decide el estado: `active/admin` si no existe ningún perfil todavía, y `pending/null` en cualquier otro caso. Esto cubre FR-002.
- **Middleware de servidor**: `server/middleware/session.ts` resuelve la sesión con `auth.getSession()` (cacheada en la cookie `session_data`) y luego el perfil. Deja ambos en `event.context.user`.
- **Autorización por endpoint**: cada endpoint declara lo que necesita con `requireRole(event, 'admin' | 'editor')`. Así la desactivación o el cambio de rol tienen efecto **en la siguiente petición** (FR-005, US4).
- **Último admin**: la protección (FR-022) se hace con un `UPDATE … WHERE` condicional que cuenta los admins activos restantes en la misma sentencia.
- **Eliminar usuario**: pone `status = 'removed'` y anonimiza el perfil, lo que bloquea el acceso. La cuenta en Neon Auth se conserva, y su borrado físico se hace desde la consola de Neon. Se documenta en el quickstart.

**Justificación**: El plugin admin de Better Auth (`admin/set-role`, `admin/ban-user`) exige que quien lo llama tenga a su vez el rol admin *en Neon Auth*. Eso es un problema de huevo y gallina con el primer admin, y además no modela el estado "pendiente". Una tabla propia es más simple, se puede probar y se consulta con Drizzle.

**Alternativas**:
- Roles del plugin admin de Neon Auth: descartado por el arranque del primer admin y por no tener estado pendiente.
- Claims en el JWT: no reflejan cambios hasta que el token se renueva.

## R3. Límite de intentos de inicio de sesión (FR-006) y anti-abuso de invitados (FR-020)

**Decisión**: Un limitador de ventana fija **respaldado en Postgres**, la tabla `rate_limits (key, window_start, count)`, con un `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` atómico:

- **Proxy de auth**: aplica el limitador a `sign-in/*` y `request-password-reset`, con clave = IP + correo. El límite es de 5 intentos cada 15 minutos.
- **Invitados**: aplica a `POST /api/public/submissions` con clave = hash de IP. El límite es de 5 envíos por hora.
- **Limpieza**: el cron diario borra las ventanas viejas.

**Justificación**: En Vercel hay varias instancias y un limitador en memoria no es fiable. Better Auth tiene su propio rate limit, pero no es configurable en el modo managed. Esta capa propia es la que se puede verificar con tests.

**Alternativas**: Redis o Upstash (otro servicio más, fuera del stack pedido) y limitador en memoria (no funciona con varias instancias).

## R4. Base de datos: driver y transacciones

**Decisión**: Usar `drizzle-orm/neon-http` con `@neondatabase/serverless`, que ya está configurado, como **singleton** en `server/utils/db.ts` (`useDb()`). Las operaciones de varias sentencias se resuelven así:

- **Atómicas en una sola sentencia**: aprobar un envío (`UPDATE … WHERE status='pending' RETURNING`), proteger al último admin, y mandar a papelera o restaurar una carpeta completa con un CTE recursivo.
- **Varias sentencias**: con `db.batch([...])`, que el driver HTTP ejecuta en una sola transacción.

`drizzle.config.ts` **se corrige** para que lea `NUXT_DATABASE_URL`; hoy lee `DATABASE_URL`, que no existe en `.env`. Las migraciones se manejan con `drizzle-kit generate` + `migrate` en la carpeta `drizzle/`.

**Justificación**: HTTP es lo más rápido en serverless (sin handshake TCP) y lo que recomienda Neon para Vercel. Ningún flujo del spec necesita transacciones interactivas.

**Alternativas**: `neon-serverless` con WebSocket `Pool`, que solo haría falta para transacciones interactivas. Queda como opción si una tarea futura lo requiere.

## R5. Almacenamiento de archivos: Neon Object Storage (S3-compatible, beta)

**Hallazgos** ([S3 compatibility](https://neon.com/docs/storage/s3-compatibility)):
- **Operaciones**: soporta `PutObject`, `GetObject` (con `Range`), `HeadObject`, `DeleteObject(s)`, multipart, `PutBucketCors` y URLs prefirmadas SigV4 para GET y PUT.
- **Direccionamiento**: solo **path-style** (`forcePathStyle: true`).
- **`CopyObject`**: no está documentado.
- **Buckets**: tienen alcance **por rama** de Neon.

**Decisión**:
- **Cliente S3**: `server/utils/storage.ts` crea un `S3Client` singleton con `endpoint = NUXT_AWS_ENDPOINT_URL_S3`, `forcePathStyle: true` y las credenciales y región de `.env`. El bucket viene de la variable nueva **`NUXT_S3_BUCKET`**, que agrega el usuario.
- **Subida directa del navegador al bucket con PUT prefirmado** (`@aws-sdk/s3-request-presigner`, expira en 10 min, `ContentType` y `ContentLength` firmados). En Vercel el cuerpo de una función está limitado a ~4.5 MB, así que 100 MB **no pueden pasar por el servidor**.
- **Flujo en dos fases**:
  1. `POST …/uploads` valida el nombre, la extensión, el MIME declarado y el tamaño (≤ 100 MB). Luego crea el registro `status='uploading'` y devuelve la URL firmada.
  2. El navegador sube el archivo con progreso.
  3. `POST …/uploads/:id/complete` verifica con `HeadObject` el tamaño real y con `GetObject Range: bytes=0-4095` la **firma binaria (magic bytes)** contra el tipo declarado (FR-009). Si coincide, marca el archivo como `ready`; si no, borra el objeto y responde 422.
  4. El cron limpia los registros `uploading` de más de 24 horas y sus objetos huérfanos.
- **Descargas y vistas previas**: `GET /api/files/:id/content` responde **302** a una URL GET prefirmada de 15 min. Para descargar se pide con `ResponseContentDisposition=attachment`. Para audio y video el navegador hace peticiones `Range` directamente contra la URL firmada.
- **Claves de los objetos**: `files/{uuid}`, `thumbs/{uuid}.webp` y `guest/{submissionId}/{uuid}`. Al aprobar un envío de invitado **no se copia el objeto**: el nuevo `files.storage_key` reutiliza la clave `guest/...`, y así no hace falta `CopyObject`.
- **CORS**: el script `scripts/storage-setup.ts` aplica `PutBucketCors` (orígenes de la app, `PUT` y `GET`, cabeceras `content-type`, expone `etag`). Se corre una vez por rama.

**Alternativas**:
- Subir a través de la función: imposible por el límite de 4.5 MB.
- Multipart desde el navegador: más complejo, innecesario para ≤ 100 MB.
- El endpoint de presign de la API de Neon: está en Private Beta, así que se prefiere el presigner del SDK de AWS.

**Riesgo**: el servicio está en beta. El acceso a S3 queda encapsulado en `storage.ts` para poder cambiar de proveedor sin tocar el resto.

## R6. Validación del contenido real (magic bytes)

**Decisión**: Escribir una utilidad propia y pura, `server/utils/file-signature.ts`, con una tabla de firmas para los formatos admitidos:

- **Imágenes y video**: JPG `FFD8FF`, PNG `89504E47`, GIF `GIF8`, WEBP `RIFF…WEBP`, HEIC `ftypheic/heix/mif1`, MP4/MOV/M4A `ftyp*`.
- **Audio**: MP3 `ID3` o frame sync `FFFx`, WAV `RIFF…WAVE`, OGG `OggS`, AAC ADTS `FFF1/FFF9`.
- **Documentos**: PDF `%PDF`; PPTX y DOCX son ZIP `PK\x03\x04` y se distinguen por su `[Content_Types].xml` dentro de los primeros 4 KB; ODP también es ZIP; PPT/KEY usan OLE `D0CF11E0` o ZIP.
- **Texto (TXT/MD)**: se valida que sean UTF-8 sin bytes nulos.

Se cubre con tests unitarios exhaustivos usando fixtures de bytes.

**Justificación**: Son pocos formatos y es lógica pura y fácil de probar. Así se evita agregar dependencias como `file-type`, respetando la indicación de usar solo los paquetes ya instalados.

## R7. Tiempo real en Vercel: notificaciones de envíos y comentarios

**Contexto**: En Vercel las funciones no mantienen estado compartido entre instancias. Un SSE con bus en memoria no llega a otras instancias, y Postgres `LISTEN/NOTIFY` no funciona con el pooler de Neon por HTTP.

**Decisión**: **Polling ligero y adaptativo** desde el cliente con VueUse:

- **Pulso**: `useIntervalFn` cada **5 s** contra `GET /api/realtime/pulse?since=<cursor>`. La respuesta trae `{ pendingCount, newSubmissions[], cursor }` y es una consulta indexada barata.
- **Ahorro**: el sondeo se pausa con `useDocumentVisibility` cuando la pestaña está oculta y con `useOnline` cuando no hay conexión. Al volver se dispara un pulso inmediato.
- **Comentarios**: mientras el panel de un archivo está abierto, sus comentarios se sondean con la misma técnica (`?since=`).
- **Avisos**: cuando llega un envío nuevo se muestra un toast y se actualiza el contador de la barra lateral (FR-018, SC-003 < 5 s).

**Justificación**: Cumple < 5 s con certeza en serverless, sin infraestructura extra y con poca complejidad. La carga es despreciable para ~50 usuarios internos.

**Alternativas**:
- SSE con un bucle de polling en el servidor: reconecta cada ~5 min por el `maxDuration` y no aporta latencia real frente al polling de 5 s.
- Pusher, Ably o Supabase Realtime: un servicio externo nuevo, fuera del stack.

## R8. Tareas programadas (papelera 30 días, invitados 7 días, subidas huérfanas)

**Decisión**: **Vercel Cron** en `vercel.json` (`0 9 * * *`, diario, compatible con el plan Hobby) contra `GET /api/cron/cleanup`. El endpoint exige `Authorization: Bearer ${CRON_SECRET}` y en cada ejecución:

1. Purga los elementos de la papelera con `deleted_at < now() - 30 d`, borrando sus objetos y registros.
2. Marca como `expired` los envíos `pending` con `created_at < now() - 7 d` y borra sus objetos.
3. Borra los `uploading` con más de 24 h.
4. Purga `rate_limits` viejos.

El endpoint es idempotente y procesa en lotes de 500, con `DeleteObjects` de hasta 1000 claves.

**Justificación**: Es el mecanismo nativo del destino elegido. La ventana diaria basta: el spec solo exige que la caducidad ocurra, no que sea exacta al minuto.

**Detalle de la UI**: los días restantes que se muestran se calculan desde `deleted_at` y `created_at`, de modo que son exactos aunque la purga corra una vez al día.

## R9. Miniaturas e imágenes

**Decisión**:
- **Generación en el cliente**: al subir una imagen JPG/PNG/WEBP/GIF se genera en el navegador (canvas) una miniatura **WEBP de 320 px** que se sube como segundo objeto `thumbs/{id}.webp`. El endpoint `complete` acepta `hasThumbnail` y el objeto `thumbs/{id}.webp` se verifica con `HeadObject` antes de registrar `thumb_key`.
- **Sin miniatura**: HEIC (no se decodifica en la mayoría de navegadores), audio, video, presentaciones y documentos muestran un ícono `lucide` por categoría.
- **Render**: `<img loading="lazy" decoding="async">` apuntando a `GET /api/files/:id/thumbnail` (302 a una URL firmada, con `Cache-Control: private, max-age=600`).
- **`@nuxt/image`**: se usa para los recursos estáticos de marca (logo y estados vacíos en `public/`).

**Justificación**: Evita procesar imágenes en el servidor, que en Vercel sería caro con IPX/sharp sobre URLs firmadas que cambian. La lista carga rápido (SC-004).

**Alternativas**: Vercel Image Optimization sobre URLs firmadas no cachea bien porque la query cambia, y un worker de miniaturas sería infraestructura extra.

## R10. Tema oscuro/claro sin parpadeo (FR-043, FR-046)

**Decisión**:
- **Valor del tema**: lo guarda la cookie `cloudy-theme` (`cloudy` | `cloudy-light`, por defecto `cloudy`), leída con `useCookie`.
- **SSR**: `app.vue` aplica `useHead({ htmlAttrs: { 'data-theme': theme } })`. El HTML llega desde el servidor con el tema correcto, **sin script inline y sin parpadeo**.
- **Componente**: `ThemeToggle.vue` alterna la cookie. Es un `swap` de daisyUI con íconos `lucide:moon` y `lucide:sun`, con `aria-label` y `aria-pressed`.
- **Marcador de color del navegador**: la etiqueta `theme-color` se actualiza según el tema.

**Justificación**: `useColorMode` de VueUse persiste en `localStorage`, y eso **no está disponible en SSR**, lo que provoca parpadeo. La cookie de Nuxt resuelve el SSR. VueUse sigue usándose en todo lo que no necesita SSR (ver R12).

## R11. Validación de entradas (cliente y servidor)

**Decisión**: Escribir validadores **compartidos y tipados** en `shared/validation/` (carpeta `shared/` de Nuxt 4, que se auto-importa en `app/` y en `server/`). Son funciones puras `(input) => { ok: true, data } | { ok: false, errors: Record<campo, mensaje> }`, con mensajes en español:

- **Servidor**: los usa con `readValidatedBody(event, validator)` de h3.
- **Cliente**: los formularios los usan para validar en línea (FR-027).
- **Reglas compartidas** en el mismo directorio: `ALLOWED_TYPES` (extensión → MIME → categoría) y `MAX_FILE_SIZE = 100 MB`.

**Justificación**: Una sola fuente de verdad para las reglas, testeable con tests unitarios y sin agregar dependencias. `zod` llega solo de forma transitiva por `@neondatabase/auth` y no se importa directamente.

**Alternativa**: agregar `zod` como dependencia directa. Si el usuario lo aprueba, se puede migrar sin cambiar los contratos.

## R12. Uso de VueUse (`@vueuse/nuxt` 15, auto-importado)

Regla del proyecto: **antes de escribir una utilidad reactiva, se busca su equivalente en VueUse.** Este es el mapa de uso acordado (todas las funciones se verificaron en `@vueuse/core` 15.0.0):

| Necesidad | Utilidad VueUse |
|-----------|-----------------|
| Estado contraído de la barra lateral (por dispositivo) | `useLocalStorage` |
| Escritorio vs. panel deslizable | `useBreakpoints(breakpointsTailwind)` |
| Cerrar el panel al tocar fuera o con Esc | `onClickOutside`, `onKeyStroke('Escape')` |
| Bloquear el scroll con el panel abierto | `useScrollLock` |
| Zona de arrastre y selector de archivos | `useDropZone`, `useFileDialog` |
| Vista previa local antes de subir | `useObjectUrl` |
| Búsqueda con debounce | `refDebounced` / `useDebounceFn` |
| Pulso en vivo | `useIntervalFn` + `useDocumentVisibility` + `useOnline` |
| Listas largas (archivos, actividad) | `useInfiniteScroll` |
| Paginación de tablas (usuarios) | `useOffsetPagination` |
| Fechas relativas en español | `formatTimeAgoIntl` (locale `es`) envuelto en `app/utils/dates.ts` (`timeAgo`, «hace un momento» bajo un minuto para no desajustar la hidratación); en comentarios se refresca con `useNow` |
| Confirmaciones (eliminar, vaciar papelera) | `useConfirmDialog` |
| Copiar el enlace público de invitados | `useClipboard` (+ `useShare` en móvil) |
| Reproductor de audio y video | `useMediaControls` |
| Atajos (`/` enfoca la búsqueda) | `onKeyStroke` |
| Auto-ocultar toasts | `useTimeoutFn` |
| Carga diferida de miniaturas fuera de pantalla | `useElementVisibility` (complementa `loading="lazy"`) |

**No se usa VueUse** en dos casos: el tema (R10, por SSR) y el fetching de datos, donde se usan `useFetch`/`$fetch` de Nuxt por SSR, deduplicación y payload.

## R13. Estrategia de pruebas

**Decisión**: Usar los tres proyectos que ya define `vitest.config.ts`:

- **`unit`** (`test/unit/**`, entorno node), con lógica pura:
  - validadores, firmas binarias, sufijos de nombre ante duplicados
  - matriz de permisos `can(role, action)`, días restantes de papelera y caducidad
  - el `RequestContext` del adaptador de auth con un evento h3 simulado
- **`nuxt`** (`test/nuxt/**`, entorno nuxt con happy-dom), con componentes vía `mountSuspended`:
  - `AppSidebar` filtrada por rol, `ThemeToggle`, `UploadQueue` (estados y errores)
  - `ConfirmDialog` y los formularios de auth (validación en línea)
- **`e2e`** (`test/e2e/**`): `@nuxt/test-utils/e2e` con `setup({ browser: true })` sobre `playwright-core`, que ya está instalado. Requiere instalar Chromium una vez con `bunx playwright-core install chromium`.
  - Cubre cada historia de usuario (SC-010), la protección de rutas (SC-009) y los anchos de 360 px y 1280 px (SC-005).
- **Aislamiento de e2e** (actualizado al `.env` real): la BD de pruebas es **`NUXT_TEST_DATABASE_URL`**, definida en el mismo `.env` y que apunta a la rama Neon de pruebas.
  - El `globalSetup` de e2e arranca Nuxt con `NUXT_DATABASE_URL = NUXT_TEST_DATABASE_URL`, aplica las migraciones y vacía las tablas de Cloudy, de modo que **nunca toca la BD de desarrollo** (Constitución V).
  - Neon Auth y el bucket **se comparten con desarrollo**, porque no hay variables de prueba propias. El aislamiento se logra así:
    - Correos de prueba únicos por corrida (`e2e+<runId>-admin@cloudy.test`).
    - Prefijo de claves `storageKeyPrefix = 'e2e/<runId>/'` (runtimeConfig, vacío en producción). El teardown borra ese prefijo con `ListObjectsV2` + `DeleteObjects`.
  - **Limitación**: las identidades de prueba se acumulan en el Neon Auth de desarrollo y se limpian desde la consola de Neon. Si se agregan `NUXT_TEST_NEON_AUTH_BASE_URL` y `NUXT_TEST_S3_BUCKET` de una rama de pruebas, el setup los usa automáticamente y el aislamiento pasa a ser total.
  - **Correo de recuperación**: no se prueba en e2e porque no hay buzón que leer. Se verifica en el quickstart y con un test unitario de la construcción del `redirectTo`.
- **Requisitos de UI**: los e2e usan `getByRole` y `getByLabel`, lo que además verifica la accesibilidad (FR-033).
- **Cobertura**: `vitest.config.ts` agrega `coverage.include: ['server/utils/**', 'shared/**']` y `thresholds: { lines: 80 }` (Constitución V).

**Justificación**: Usa la configuración y los paquetes existentes, y la base de pruebas que el usuario ya creó, sin mocks del proveedor.

## R14. Despliegue en Vercel

**Decisión**:
- **Preset y SSR**: preset Nitro `vercel`, que se detecta solo, con SSR activado.
- **Configuración**: `nitro.experimental.asyncContext: true` (para R1) y `vercel.json` solo con `crons`.
- **Variables de entorno en Vercel**: todas las `NUXT_*` del `.env` **excepto** `NUXT_TEST_DATABASE_URL`, que solo se usa en local y CI. También `CRON_SECRET`, que Vercel envía como Bearer al cron. El `.env` ya contiene `NUXT_S3_BUCKET`, `NUXT_PUBLIC_SITE_URL`, `CRON_SECRET` y `NUXT_RATE_LIMIT_SALT`.
- **Origen público**: `NUXT_PUBLIC_SITE_URL` para CORS, enlaces y el `redirectTo` de recuperación de contraseña.
- **Limpieza de config**: se elimina `runtimeConfig.session.password`, un residuo de nuxt-auth-utils.
- **Hallazgo pendiente**: hoy `nuxt.config.ts` todavía pone una `session.password` vacía.

## R15. Recuperación de contraseña y correos (Neon Auth)

**Hallazgo**: la guía de Neon ([password reset](https://neon.com/docs/auth/guides/password-reset)) exige activar **Sign-up with Email** en *Settings → Better Auth*. Neon envía los correos con su proveedor compartido y recomienda configurar un SMTP propio en producción ([production checklist](https://neon.com/docs/auth/production-checklist)). La guía advierte que el método estilo Supabase `resetPasswordForEmail` "no está totalmente soportado", pero los endpoints Better Auth `request-password-reset` y `reset-password` sí están tipados en el paquete.

**Decisión**:
- **Flujo**: usar los métodos Better Auth `requestPasswordReset({ email, redirectTo: \`${siteUrl}/restablecer\` })` y `resetPassword({ newPassword, token })` a través del proxy.
- **Verificación temprana**: la **primera tarea de implementación** es un spike que comprueba el flujo completo contra la rama `dev`.
- **Plan B si el spike falla**: el correo de recuperación se dispara con el endpoint `forget-password` de Better Auth vía el proxy, que equivale al mismo backend.
- **Contenido de los correos**: el texto lo define Neon. Personalizarlo con webhooks queda fuera de la v1 y está documentado en el quickstart.

## R16. Constitución del proyecto

**Hallazgo**: la constitución **v1.0.0** fue ratificada el 2026-10-14 con seis principios: I Rendimiento medible, II Funcional y efectivo, III Mobile first, IV Calidad de código, V Pruebas por defecto y VI Consistencia de UX.

**Decisión**: El Constitution Check de `plan.md` se evalúa contra los principios I–VI y reemplaza los gates provisionales G1–G6. Derivan dos decisiones nuevas, R18 (medición de rendimiento) y R19 (verificación de tipos).

## R17. `NUXT_NEON_JWKS_URL`

**Hallazgo**: el usuario agregó la URL de JWKS de Neon Auth. El toolkit `@neondatabase/auth/server` **no la usa**: valida la cookie `session_data` con HS256 y `cookieSecret` (`jwtVerify` en `server-pZf5ArnA.mjs`), y renueva la sesión contra `baseUrl`.

**Decisión**: En la v1 la variable **no se conecta a nada**. Conectarla sin usarla sería código muerto (Constitución IV). Solo sería útil para validar JWT `Bearer` de Neon Auth emitidos fuera de la cookie, por ejemplo para una API para clientes externos o para RLS con la Data API, y eso no está en el alcance. Queda documentada como opcional en el quickstart.

## R18. Verificación de los presupuestos de rendimiento (Constitución I)

**Decisión**: Medir **sin dependencias nuevas**:
- **Web Vitals en e2e** (`test/e2e/performance.spec.ts`):
  - **Condiciones**: Chromium de `playwright-core` con emulación de un móvil de 360×740 y red 4G vía CDP (`Network.emulateNetworkConditions`: 9 Mbps de bajada, 1.5 Mbps de subida, 170 ms de RTT) y CPU ×4.
  - **Medición**: LCP y CLS con `PerformanceObserver` dentro de `page.evaluate`.
  - **Criterio**: falla si LCP > 2.5 s o CLS > 0.1 en Inicio, Archivos (carpeta con 200 elementos) y `/enviar`.
- **Presupuesto de JS por ruta**: Sonda (dependencia de desarrollo, módulo `sonda/nuxt`) con `bun run analyze`: genera reportes interactivos en `.sonda/` con el tamaño gzip de cada chunk tras tree-shaking, a partir de source maps. Solo se activa con `SONDA=1`, así los builds normales y de Vercel no publican source maps ni generan reportes.
- **INP**: se verifica manualmente con Chrome DevTools (quickstart §4), porque en CI no se puede medir de forma fiable sin interacción real.

Con esto se resuelve el `TODO(PERF_BUDGET_TOOLING)` de la constitución, excepto el INP, que sigue siendo manual.

## R19. Verificación de tipos (Constitución IV)

**Hallazgo**: `nuxt typecheck` requiere `vue-tsc` y `typescript`, que no están instalados.

**Decisión**: Agregarlos como **devDependencies**, justificado en el Complexity Tracking del plan porque la propia constitución los exige. Se agrega el script `"typecheck": "nuxt typecheck"`. Con esto se resuelve el `TODO(TYPECHECK_TOOLING)`.

---

## Resultado del spike (T052, 2026-10-14)

Ejecutado contra la rama de desarrollo con `bun run dev`.

**R1 — Neon Auth vía proxy `/api/auth/*`**: ✅
- `sign-up/email` → 200 con las cookies `__Secure-neon-auth.session_token` y `__Secure-neon-auth.local.session_data` (`HttpOnly; Secure; SameSite=Lax`). No exige verificación de correo.
- `sign-in/email` → 200; `get-session` → sesión y usuario.
- `GET /api/me` con esa cookie: `useAuthServer().getSession()` + `ensureProfile` crean el primer perfil como `active/admin` (FR-002). El perfil del spike se borró después de la BD de desarrollo.
- **Desviación**: `NUXT_NEON_AUTH_BASE_URL` en `.env` era el placeholder de la documentación (`ep-xxx…us-east-1…/neondb/auth`) y respondía `endpoint not found`. Neon Auth está aprovisionado en la rama de desarrollo para la BD `neondb` (no `produccion`): `https://<endpoint>.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth`. Se corrigió el `.env`. La identidad vive en `neondb.neon_auth`; Cloudy solo guarda el id, así que no importa que las tablas de la app estén en `produccion`.

**R15 — Recuperación de contraseña**: ⚠️ parcial
- `request-password-reset` con `redirectTo=<origen>/restablecer` → 200 (`"If this email exists…"`).
- `reset-password` con un token inválido → 400 `INVALID_TOKEN`, que la UI traduce a "El enlace caducó o ya se usó".
- **Pendiente manual**: la entrega del correo y la aceptación de un token real no se pudieron verificar sin un buzón (quickstart §4, escenario 12). No se activó el plan B.

**R5 — Object Storage**: ✅
- `presignPut` con `content-type` y `content-length` firmados → PUT 200. Un PUT con otra longitud → 403, así que el tamaño también se impone en el bucket.
- `HeadObject` (tamaño y tipo), `GetObject` con `Range: bytes=0-4095` y `presignGet` con `ResponseContentDisposition=attachment` funcionan.
- Preflight CORS desde `http://localhost:3000` → 200 tras `bun run storage:setup`. `DeleteObjects` funciona.
- **Necesario**: `requestChecksumCalculation: 'WHEN_REQUIRED'` en el `S3Client`; el SDK actual agrega checksums CRC por defecto.
- **Desviación**: `NUXT_TEST_S3_BUCKET` (`test-peticiones`) no existe en este endpoint (los buckets son por rama). Los e2e usan el bucket principal con el prefijo `e2e/<runId>/`, como preveía R13.
