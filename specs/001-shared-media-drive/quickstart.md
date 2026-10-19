# Quickstart y validación: Cloudy

Guía para levantar Cloudy en local y comprobar de punta a punta que la feature funciona. Los detalles están en [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md) y [contracts/ui-routes.md](./contracts/ui-routes.md).

## 1. Requisitos previos

- **Bun**, que es el gestor del proyecto.
- **Proyecto de Neon** con tres ramas: **producción**, **desarrollo** y **pruebas**. Cada rama tiene su propia BD y su propio bucket. En cada rama:
  - **Neon Auth**, con **Sign-up with Email** activado en *Settings → Better Auth*.
  - **Object Storage**, con un bucket y una credencial S3.
- **Extensión `pg_trgm`**: la crea la migración inicial (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) en cada BD.
- **Producción** (opcional): un SMTP propio en Neon Auth.

## 2. Variables de entorno: un archivo por rama

Cada rama de Neon tiene su archivo, con **los mismos nombres de variables** (plantilla: `.env.example`). Ningún archivo `.env*` real se versiona.

| Archivo | Rama | Lo usan |
|---------|------|---------|
| `.env.development` | desarrollo | `bun run dev`, `db:migrate`, `storage:setup` |
| `.env.test` | pruebas | `test:e2e` (BD, bucket y Neon Auth), `test:nuxt`, `db:migrate:test`, `storage:setup:test` |
| `.env` | producción | `bun run preview`, `db:migrate:prod`, `storage:setup:prod` |

Nuxt elige el archivo con `nuxi --dotenv`. drizzle-kit y los scripts lo eligen con `APP_ENV` (`development` por omisión, nunca producción) a través de `scripts/env.ts`. En **Vercel** no hay archivos: las mismas variables se cargan por entorno en *Project → Settings → Environment Variables*. Con la integración de Neon para Vercel, cada *preview* puede tener su propia rama.

| Variable | Uso |
|----------|-----|
| `NUXT_DATABASE_URL` | BD de la rama (pooled) |
| `NUXT_NEON_AUTH_BASE_URL`, `NUXT_NEON_AUTH_COOKIE_SECRET` (≥ 32 car.) | Neon Auth de la rama |
| `NUXT_AWS_ENDPOINT_URL_S3`, `NUXT_AWS_ACCESS_KEY_ID`, `NUXT_AWS_SECRET_ACCESS_KEY`, `NUXT_AWS_REGION`, `NUXT_S3_BUCKET` | Neon Object Storage de la rama |
| `NUXT_PUBLIC_SITE_URL` | Origen público: CORS, enlaces, `redirectTo` del reset |
| `CRON_SECRET` | Bearer del cron de Vercel |
| `NUXT_RATE_LIMIT_SALT` | Sal para el hash de IPs |
| `NUXT_NEON_JWKS_URL` | **No se usa en la v1** (R17); opcional |

## 3. Instalación y preparación

```bash
bun install
bun run db:migrate                         # rama de desarrollo (.env.development)
bun run db:migrate:test                    # rama de pruebas (.env.test)
bun run db:migrate:prod                    # producción (.env), solo al desplegar cambios de esquema
bun run storage:setup                      # CORS del bucket de desarrollo; storage:setup:test / :prod para las otras ramas
bunx playwright-core install chromium      # navegador para e2e y medición de rendimiento, una vez
bun run dev                                # http://localhost:3000 con .env.development
```

`bun run analyze` compila con Sonda y deja los reportes del bundle en `.sonda/`.

> **Nota (T008)**: `typescript` se fija en `~5.9`. TypeScript 7 (compilador nativo) no expone `lib/tsc`, y `vue-tsc` 3 falla con `ERR_PACKAGE_PATH_NOT_EXPORTED`. Con 5.9, `bun run typecheck` corre sin errores.

## 4. Escenarios de validación manual

Cada escenario indica el resultado esperado y la referencia al spec.

1. **Primer administrador** (FR-002): registrarse en `/registro`. Se entra directo a `/` (Inicio) con todas las secciones del menú, incluidas Usuarios y Actividad.
2. **Registro con aprobación** (US2, US4):
   - En otra ventana privada se registra un segundo usuario, que es enviado a `/pendiente`.
   - El admin lo activa como *editor* en `/usuarios`.
   - El segundo usuario recarga y entra al dashboard sin ver "Usuarios" ni "Actividad".
   - Si abre `/usuarios` directamente, ve "Acceso denegado", y `GET /api/users` responde 403.
3. **Protección de rutas** (US6, SC-009): sin sesión, abrir `/archivos/<id>` redirige a `/login?redirect=…`. Al iniciar sesión se llega a esa carpeta.
4. **Subir y encontrar** (US1, SC-001):
   - Crear la carpeta "Domingo" y subir 3 archivos a la vez (JPG, MP3 y PPTX). Se ve el progreso de cada uno, la miniatura del JPG, el reproductor del MP3 y el ícono del PPTX.
   - Buscar "dom" encuentra la carpeta y su contenido.
   - Filtrar por *Audio* deja solo el MP3.
   - Las descargas funcionan.
5. **Rechazos de validación** (FR-009, FR-010):
   - Un archivo de 120 MB se rechaza **antes** de subir.
   - Un `.exe` renombrado a `.jpg` se sube, pero el servidor lo rechaza con 422 y no aparece en la carpeta.
6. **Invitados en vivo** (US3, SC-003):
   - Con el admin en Inicio, desde un teléfono (o con DevTools a 360 px) se abre `/enviar` y se mandan 2 fotos con nombre.
   - En menos de 5 s aparecen el toast y el contador de "Pendientes".
   - Se aprueba el envío en "Domingo" y los archivos aparecen ahí con origen *invitado*.
   - Se manda un segundo envío y se rechaza: no aparece en ningún lado.
7. **Concurrencia en la aprobación** (edge case): dos pestañas aprueban el mismo envío. La segunda recibe el aviso "ya fue revisado".
8. **Papelera** (US7):
   - Al eliminar "Domingo" la confirmación muestra el número de elementos.
   - En `/papelera` aparece con los días restantes (30).
   - Al restaurarla vuelve completa, incluidos sus comentarios.
   - "Vaciar papelera" solo lo ve el admin.
9. **Comentarios** (US8, SC-011):
   - El editor comenta un archivo y el admin, con el mismo archivo abierto, lo ve en menos de 5 s.
   - El editor no puede editar comentarios ajenos.
   - El admin puede borrar cualquiera.
   - Un comentario vacío o de más de 2000 caracteres se bloquea en el formulario.
10. **Último admin** (FR-022): el único admin intenta quitarse el rol. Recibe un 409 con un mensaje que explica el motivo.
11. **Tema y responsivo** (US5, US9, FR-043, FR-046):
    - La primera visita es en oscuro, aunque el sistema esté en claro.
    - `ThemeToggle` cambia a claro sin recargar, y al recargar no hay parpadeo.
    - A 360 px el menú es un panel deslizable que se cierra al tocar fuera o al elegir una sección, sin scroll horizontal.
    - En escritorio, contraer la barra lateral se mantiene tras recargar.
    - **INP** (Constitución I, verificación manual): en Chrome DevTools → Performance, con CPU ×4 y 4G, abrir el drawer, cambiar de carpeta y abrir una vista previa. Cada interacción debe quedar en ≤ 200 ms.
    - Los botones y campos en móvil miden ≥ 44 px (Constitución III), y cada vista muestra skeleton, estado vacío y estado de error (Constitución VI).
12. **Recuperar contraseña** (FR-004): `/recuperar` envía un correo con un enlace a `/restablecer?token=…`, que permite definir la contraseña nueva. Si se usa el enlace por segunda vez, aparece un mensaje con la opción de pedir uno nuevo.
13. **Cron** (R8): `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/cleanup` devuelve los contadores. Sin la cabecera responde 401.

## 5. Pruebas automatizadas y gates de la constitución

```bash
bun run typecheck        # Constitución IV: sin errores de tipos
bun run analyze          # Constitución I: revisar en .sonda/ que el JS inicial sea ≤ 200 KB gzip por ruta
bun run test:unit        # validadores, firmas binarias, permisos, utilidades
bun run test:nuxt        # componentes (sidebar por rol, ThemeToggle, UploadQueue, formularios)
bun run test:e2e         # navegador real contra la rama de pruebas (.env.test) (incluye performance.spec: LCP ≤ 2.5 s, CLS ≤ 0.1 en 4G emulado)
bun run test:coverage    # todo + cobertura v8
```

Resultado esperado: todo en verde, con cobertura ≥ 80 % de líneas en `server/utils` y `shared` (Constitución V). Cada historia de usuario tiene al menos un e2e (SC-010) y cada ruta privada se prueba sin sesión y con el rol incorrecto (SC-009).

## 6. Despliegue en Vercel

1. Importar el repositorio en Vercel. El preset Nitro `vercel` se detecta solo.
2. Cargar en Vercel las variables de `.env` (producción), con `NUXT_PUBLIC_SITE_URL` igual al dominio final. Para los *previews*, usar la rama de desarrollo o la integración de Neon para Vercel.
3. Correr `bun run storage:setup:prod` para que el CORS del bucket de producción incluya el dominio.
4. `vercel.json` registra el cron diario `/api/cron/cleanup`. Verificarlo en *Project → Cron Jobs*.
5. Hacer una prueba de humo con los escenarios 1, 4 y 6 en el dominio final.

## 7. Operación

- **Eliminar una cuenta por completo**: en Cloudy, "Eliminar" deja al usuario como `removed` y bloquea el acceso. Para borrar también la identidad, hacerlo en la consola de Neon Auth.
- **Correos con marca propia**: en producción, configurar un SMTP en Neon Auth. Personalizar el contenido con webhooks queda fuera de la v1.

## 8. Resultado de validación (T162, 2026-10-18)

Ejecutado contra la rama de desarrollo (`bun run dev`) en Chromium, a 360 px y ≥ 1280 px, en `cloudy` y `cloudy-light`, con CPU ×4 y 4G emulados para las mediciones. Los e2e corren contra la rama de pruebas.

### Escenarios de §4

| # | Escenario | Resultado |
|---|-----------|-----------|
| 1 | Primer administrador | NO EJECUTADO: exige una BD vacía; lo cubre el e2e `auth-roles` (US2) en cada corrida. |
| 2 | Registro con aprobación | PASS |
| 3 | Protección de rutas | PASS |
| 4 | Subir y encontrar | PASS (tras corregir el conteo de las tarjetas de carpeta, ver defectos) |
| 5 | Rechazos de validación | PASS |
| 6 | Invitados en vivo | PASS |
| 7 | Concurrencia en la aprobación | PASS parcial: el aviso «ya fue revisado» se verificó; el comportamiento del sondeo fallido se comprobó con una lista simulada (defecto 3). |
| 8 | Papelera | PASS |
| 9 | Comentarios | PASS |
| 10 | Último admin | NO APLICA en desarrollo: la rama tiene 4 administradores; lo cubre el unit test de `users.ts` (409 al quitar al último). |
| 11 | Tema y responsivo | PASS (tras corregir el teclado del menú de cuenta, el cajón móvil y el buscador de 43 px, ver defectos) |
| 12 | Recuperar contraseña | PASS parcial: el enlace usado muestra «El enlace caducó o ya se usó» con «Pedir un enlace nuevo» (defecto 2 corregido); la entrega del correo no se comprobó (sin buzón). |
| 13 | Cron | PASS parcial: solo se verificó el 401 sin cabecera; la limpieza la cubre el unit test de `cron/cleanup`. |

**INP** (escenario 11, CPU ×4 + 4G, 360 px): abrir el cajón 72–80 ms · elegir una sección 48 ms · cambiar de carpeta 16–24 ms · abrir una vista previa 16–24 ms. Todo ≤ 200 ms.

**Cabeceras de seguridad** (T158): toda respuesta trae `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` y `Permissions-Policy` (cámara, micrófono, geolocalización, pago, USB y captura de pantalla denegados).

**Vista previa de PDF**: `X-Frame-Options: DENY` no bloquea el `<iframe>` (el navegador lo evalúa en la respuesta final del bucket, no en el 302), pero el renderizado no se confirmó visualmente: Chromium sin cabeza no trae visor de PDF.

**Precarga de la fuente**: `@nuxt/fonts` no emite el `<link rel="preload">` en desarrollo; se omitió comprobarlo en `preview` porque ese comando usa el `.env` de producción. Queda para la prueba de humo del despliegue (§6).

### Defectos encontrados y corregidos

1. Las tarjetas de carpeta decían «0 elementos» siempre: la subconsulta correlacionada referenciaba `"id"` sin calificar y Postgres lo resolvía contra la tabla interior. `folderItemCountSql()` califica la columna; unit test sobre el SQL generado y e2e en `files.spec`.
2. Un enlace de restablecimiento usado mostraba «Correo o contraseña incorrectos»: el cliente de Neon convierte el `INVALID_TOKEN` de Better Auth en `bad_jwt` (401). `resetPassword()` devuelve `INVALID_TOKEN`; pruebas de componente del composable y de la página.
3. Un sondeo fallido en `/pendientes` sustituía la lista por el estado de error: se conserva la última lista buena con un aviso, botón «Reintentar» y reintento automático a los 5 s. Prueba de componente.
4. El menú de cuenta no se alcanzaba con el teclado (vive en `body`): ↓/↑ abren y enfocan, las flechas recorren, Tab cierra y devuelve el foco. Prueba de componente.
5. El cajón móvil no movía el foco: al abrirse enfoca el primer enlace cuando el panel ya es visible (daisyUI anima `visibility`), la página queda `inert` y al cerrar vuelve a «Abrir menú». Pruebas de componente y e2e (`responsive-theme`).
6. El buscador de la barra superior medía 43 px en teléfono: `min-h-11` en la etiqueta (el `input` interior mide 43 px dentro de los 45 px de la etiqueta, que es lo que recibe el toque, como mide T151).
7. Con `prefers-reduced-motion: reduce` el cajón móvil tampoco enfocaba: el panel ya era visible pero el enlace seguía oculto unos cuadros. Ahora se reintenta cuadro a cuadro hasta que el foco queda en el enlace o vence el plazo. E2E también con movimiento reducido.
8. El reintento automático de `/pendientes` no se re-armaba si el propio reintento fallaba (solo reaccionaba al primer fallo). Ahora cada recarga fallida lo re-arma. Prueba de componente con dos fallos seguidos y un éxito.

No son defectos (se dejan como están): los PDF se clasifican como «Presentaciones»; la búsqueda «dom» solo compara nombres.

### Gates de §5

| Gate | Resultado |
|------|-----------|
| `bun run typecheck` | PASS |
| `bun run test:unit` + `bun run test:nuxt` | PASS · 624 pruebas |
| `bun run test:e2e` | PASS · 73 pruebas (9 archivos, incluido `performance.spec`) |
| `bun run test:coverage` | PASS · líneas 98,63 % · ramas 93,12 % · funciones 94,46 % · sentencias 98,03 % (umbral 92 %) |
| `bun run build` | PASS |
| `bun run analyze` (Sonda) | PASS · ruta más pesada ≈ 132 KiB gzip (≤ 200 KB) |
| Rendimiento (e2e, 360×740, 4G, CPU ×4, mediana de 3 cargas en frío) | PASS · `/` LCP 1020 ms · carpeta con 200 elementos 1348 ms · `/enviar` 848 ms · CLS 0 en las tres |

### Desviaciones

- Escenarios 1 y 10 no se ejecutaron a mano (BD vacía / varios administradores); quedan cubiertos por pruebas automatizadas.
- Escenarios 7, 12 y 13 son parciales por los motivos indicados en la tabla.
- La verificación del `preload` de la fuente y el renderizado del PDF se trasladan a la prueba de humo del despliegue (§6).
- Las corridas completas de e2e revelaron dos fragilidades del laboratorio, corregidas en `test/e2e/setup/fixtures.ts` y en la prueba de rendimiento: el ritmo de inicios de sesión frente al límite de Better Auth (3 por 10 s por ruta, ventana desde la última petición) y una carga de calentamiento por ruta antes de medir.
