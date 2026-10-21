# Cloudy

Disco de medios interno del equipo de producción multimedia y audio de una iglesia. Las personas del
equipo (administradoras y editoras) suben, organizan, previsualizan, comentan y recuperan archivos;
los invitados envían material desde una página pública a una cola de aprobación que el equipo revisa
en vivo.

- **Stack**: Nuxt 4 (Vue 3.5) · TypeScript estricto · Bun · Neon PostgreSQL con Drizzle ORM · Neon Auth ·
  Neon Object Storage (S3) · Tailwind CSS 4 + daisyUI 5 · Vitest + Playwright · Vercel.
- **Interfaz** en español, *mobile first* (360 px en adelante), temas `cloudy` (oscuro) y `cloudy-light`.

## Documentación

- [`AGENTS.md`](AGENTS.md) — guía para contribuir: reglas por principio, estructura, flujo de trabajo.
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — la constitución del proyecto (fuente de verdad).
- [`specs/001-shared-media-drive/quickstart.md`](specs/001-shared-media-drive/quickstart.md) — puesta en marcha paso a paso, validación manual y despliegue.
- `specs/001-shared-media-drive/` — especificación, plan, investigación, modelo de datos y contratos.

## Requisitos

- [Bun](https://bun.sh) (gestor de paquetes y ejecutor de scripts).
- Un proyecto de [Neon](https://neon.tech) con **Neon Auth** y **Object Storage** habilitados, y una rama
  por entorno (desarrollo, pruebas, producción).
- Node.js, que usa Playwright para el Chromium de los e2e (`bunx playwright install chromium`).

## Variables de entorno

Un archivo por entorno con **los mismos nombres** (plantilla: `.env.example`): `.env.development`,
`.env.test` y `.env` (producción). En Vercel se definen por entorno en los ajustes del proyecto.
Solo nombres; nunca se imprimen ni se versionan los valores.

```text
NUXT_DATABASE_URL
NUXT_NEON_AUTH_BASE_URL
NUXT_NEON_AUTH_COOKIE_SECRET
NUXT_AWS_ENDPOINT_URL_S3
NUXT_AWS_ACCESS_KEY_ID
NUXT_AWS_SECRET_ACCESS_KEY
NUXT_AWS_REGION
NUXT_S3_BUCKET
NUXT_PUBLIC_SITE_URL
CRON_SECRET
NUXT_RATE_LIMIT_SALT
```

## Comandos

```bash
bun install
bun run dev              # http://localhost:3000 con .env.development
bun run build            # build de producción (preset vercel)
bun run preview          # vista previa local del build con .env
bun run typecheck
bun run test:unit        # test/unit — lógica pura
bun run test:nuxt        # test/nuxt — componentes (happy-dom, .env.test)
bun run test:e2e         # test/e2e — navegador real contra la rama de pruebas (.env.test)
bun run test:coverage    # unit + nuxt con umbral de cobertura
bun run analyze          # build con Sonda: reportes de tamaño en .sonda/
bun run db:generate      # migración Drizzle desde server/db/schema.ts
bun run db:migrate       # desarrollo · db:migrate:test · db:migrate:prod
bun run storage:setup    # CORS del bucket, desarrollo · storage:setup:test · storage:setup:prod
```

## Estructura

```text
app/      páginas, layouts, componentes, composables, middleware, utils
shared/   reglas compartidas por cliente y servidor: validación, permisos, constantes, tipos
server/   db/schema.ts · utils/ · middleware/ · api/ · routes/api/auth
test/     unit/ · nuxt/ · e2e/
specs/    documentos de Spec Kit
```

Las reglas de contribución (reutilizar antes de escribir, presupuestos de rendimiento, pruebas por
historia, acciones destructivas) están en [`AGENTS.md`](AGENTS.md).

## Licencias de terceros

- [`heic-to`](https://github.com/hoppergee/heic-to) (LGPL-3.0, incluye libheif): convierte en el navegador las
  fotos HEIC a una copia JPEG para leer su texto (feature 002). Se usa **sin modificar** y se carga como un
  módulo aparte con `import()` dinámico (`app/utils/heic-copy.ts`), solo cuando se elige una HEIC.
