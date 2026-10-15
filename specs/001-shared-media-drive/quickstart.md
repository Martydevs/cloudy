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

`check:bundle` llega con las tareas de rendimiento.

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
bun run build && bun run check:bundle   # Constitución I: JS inicial ≤ 200 KB gzip por ruta
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
