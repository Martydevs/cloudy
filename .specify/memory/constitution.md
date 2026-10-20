<!--
Sync Impact Report (1.0.1, 2026-10-20)
- Version change: 1.0.0 → 1.0.1 (PATCH: clarification, no change in obligations)
- Modified principles: IV. Calidad de código: the "single wrapper module" rule now names IA and background
  work and allows a dedicated folder (e.g. `server/ai/`) when it is reached only through one
  `server/utils/` module. Matches existing practice in AGENTS.md and specs/002-note-text-extraction.
- Added/removed sections: none
- Templates checked: ✅ plan/spec/tasks templates need no change
- Follow-up: AGENTS.md already describes this boundary; no migration plan needed

Sync Impact Report (1.0.0)
- Version change: (unratified template) → 1.0.0
- Modified principles (template placeholders → new titles):
  - [PRINCIPLE_1_NAME] → I. Rendimiento medible
  - [PRINCIPLE_2_NAME] → II. Funcional y efectivo
  - [PRINCIPLE_3_NAME] → III. Mobile first
  - [PRINCIPLE_4_NAME] → IV. Calidad de código
  - [PRINCIPLE_5_NAME] → V. Pruebas por defecto
- Added principles: VI. Consistencia de UX por defecto (the user asked for 6 principles; the template has 5)
- Added sections: "Restricciones técnicas y de plataforma" (SECTION_2),
  "Flujo de desarrollo y quality gates" (SECTION_3)
- Removed sections: none
- Templates checked:
  - ✅ .specify/templates/plan-template.md: its generic "Constitution Check" reads this file; no change needed
  - ✅ .specify/templates/spec-template.md: no conflicts
  - ✅ .specify/templates/tasks-template.md: compatible (tasks per story + tests)
  - ⚠ specs/001-shared-media-drive/plan.md: uses provisional gates G1–G6 and must be re-evaluated against
    principles I–VI (pending; not modified by this command)
- Deferred TODOs:
  - TODO(TYPECHECK_TOOLING): `nuxt typecheck` requires the `vue-tsc` and `typescript` dev dependencies,
    which are not installed yet.
  - TODO(PERF_BUDGET_TOOLING): there is no automated measurement of Web Vitals or bundle size yet;
    until there is, it is verified manually per Principle I.
-->

# Cloudy Constitution

## Core Principles

### I. Rendimiento medible

Cloudy MUST sentirse instantánea en un teléfono de gama media con red móvil. Toda feature MUST
cumplir estos presupuestos, salvo que su plan justifique una excepción:

- Core Web Vitals en móvil (perfil 4G simulado): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- JavaScript inicial por ruta ≤ 200 KB comprimido; lo no crítico se carga de forma diferida
  (componentes `Lazy*`, imports dinámicos).
- Listados y búsquedas MUST responder en < 2 s con 5 000 elementos; toda columna usada para
  filtrar u ordenar MUST tener índice, y quedan prohibidas las consultas N+1.
- Los archivos binarios grandes MUST NOT pasar por funciones del servidor: se suben y descargan
  directamente contra el almacenamiento mediante URLs firmadas.
- Imágenes con miniatura, `loading="lazy"` y dimensiones declaradas; la primera vista se
  renderiza con SSR.

**Razón**: el equipo usa la app en domingo, desde el celular, con conexiones de iglesia; la
lentitud es la principal causa de abandono de una herramienta interna.

### II. Funcional y efectivo

Cada entrega MUST resolver una necesidad real del equipo de forma completa y usable.

- Cada historia de usuario MUST ser un incremento independiente, demostrable y desplegable.
- YAGNI: no se construye funcionalidad especulativa ni configuraciones no pedidas.
- Antes de escribir una utilidad MUST buscarse en lo ya instalado, en este orden: auto-imports
  de Nuxt, VueUse, componentes de daisyUI y luego paquetes del proyecto. Código propio solo si
  ninguno lo cubre.
- Agregar una dependencia o un servicio externo nuevo MUST justificarse en la sección
  "Complexity Tracking" del plan.
- Los flujos fallidos MUST dejar el sistema en un estado consistente (sin archivos huérfanos ni
  registros a medias) y comunicar al usuario qué pasó y cómo seguir.

**Razón**: un equipo de voluntarios necesita herramientas que funcionen a la primera, no
plataformas complejas de mantener.

### III. Mobile first

Toda interfaz MUST diseñarse y construirse primero para teléfono y luego ampliarse.

- Las clases base corresponden a móvil; los prefijos `sm:`/`md:`/`lg:` solo agregan
  comportamiento para pantallas mayores.
- Ancho mínimo soportado 360 px, sin desplazamiento horizontal en ningún flujo.
- Objetivos táctiles ≥ 44×44 px; ninguna acción depende de `hover` para ser descubierta.
- Toda pantalla MUST verificarse a 360 px y a ≥ 1280 px antes de considerarse terminada.
- La navegación MUST poder usarse con una mano en móvil (panel deslizable, acciones principales
  al alcance).

**Razón**: la mayoría de las subidas (fotos, audios de servicio) ocurren desde el celular, y los
invitados solo usan teléfono.

### IV. Calidad de código

El código MUST ser legible, tipado y seguro por defecto.

- TypeScript en modo estricto; `any` prohibido salvo con un comentario que lo justifique.
- Vue 3 con Composition API y `<script setup lang="ts">`; componentes pequeños con una sola
  responsabilidad; lógica reutilizable en composables.
- Las reglas compartidas (validaciones, permisos, tipos de archivo, DTOs) MUST vivir una sola vez
  en `shared/` y usarse en cliente y servidor.
- Todo endpoint MUST validar su entrada y verificar sesión y rol en el servidor; ocultar la UI
  no cuenta como autorización.
- Los servicios externos o en beta (auth, almacenamiento, IA, segundo plano) MUST encapsularse en una
  única frontera con el proveedor: un módulo de `server/utils/` o, si el proveedor necesita varios
  archivos, una carpeta dedicada (p. ej. `server/ai/`) a la que los endpoints solo acceden a través de
  un único módulo de `server/utils/`.
- Prohibido dejar código de demostración, código muerto o secretos en el repositorio.
- La verificación de tipos (`nuxt typecheck`) y el build MUST pasar sin errores.

**Razón**: es un proyecto de voluntarios que cambiará de manos; el código MUST poder entenderse y
modificarse sin miedo.

### V. Pruebas por defecto

Ninguna funcionalidad se considera terminada sin pruebas automatizadas que la respalden.

- **Unitarias** (`test/unit`) para toda lógica pura y regla de negocio: validaciones, permisos,
  cálculos y utilidades de servidor.
- **De componente** (`test/nuxt`) para todo componente con estado, interacción o variación por
  rol.
- **E2E** (`test/e2e`) para cada historia de usuario y para cada ruta protegida (sin sesión y
  con rol incorrecto).
- Todo bug corregido MUST incluir una prueba de regresión que fallaba antes de la corrección.
- Las pruebas e2e MUST correr contra un entorno aislado (rama de base de datos de pruebas),
  nunca contra datos reales.
- Las pruebas MUST seleccionar elementos por rol y etiqueta accesible (`getByRole`,
  `getByLabel`), lo que además valida la accesibilidad.
- Cobertura mínima de líneas: 80 % en `server/utils/` y `shared/`.

**Razón**: las pruebas permiten iterar rápido sin romper lo que el equipo usa cada semana.

### VI. Consistencia de UX por defecto

Toda pantalla MUST verse y comportarse como parte de la misma aplicación.

- Colores solo desde los tokens de los temas `cloudy` (oscuro, predeterminado) y `cloudy-light`;
  prohibidos los colores fijos en componentes. Íconos solo del set `lucide`; tipografía DM Sans.
- Componentes de daisyUI como base; un patrón nuevo MUST reutilizarse, no reinventarse por
  pantalla.
- Toda vista con datos MUST cubrir los cuatro estados: cargando (skeleton), vacío (con guía),
  error (con acción para reintentar) y con contenido.
- Toda acción destructiva MUST pedir confirmación; toda acción completada MUST dar una
  confirmación breve (toast).
- Textos de interfaz en español, con tono cercano y consistente; mensajes de error que
  expliquen qué hacer.
- Accesibilidad WCAG 2.2 AA en ambos temas: contraste ≥ 4.5:1 en texto normal, foco visible,
  navegación por teclado, etiquetas en todos los controles y respeto de
  `prefers-reduced-motion`.

**Razón**: la consistencia reduce la curva de aprendizaje de voluntarios nuevos y hace que la app
se sienta confiable.

## Restricciones técnicas y de plataforma

- **Stack**: Nuxt 4 (Vue 3, Nitro) con TypeScript y Bun como gestor de paquetes. PostgreSQL en
  Neon con Drizzle ORM. Neon Auth para identidad y correos de autenticación. Neon Object Storage
  vía `@aws-sdk/*` para archivos. Tailwind CSS 4 + daisyUI 5. `@nuxt/icon` (lucide),
  `@nuxt/fonts`, `@nuxt/image` y `@vueuse/nuxt`. Vitest con `@nuxt/test-utils` y `playwright-core`.
- **Despliegue**: Vercel. El código de servidor MUST ser sin estado entre peticiones (nada de
  estado compartido en memoria), respetar el límite de cuerpo de petición de la plataforma y
  usar Vercel Cron para tareas programadas.
- **Secretos**: solo en variables de entorno (`NUXT_*` vía `runtimeConfig`); nunca en el
  código, en el cliente ni en el repositorio.
- **Datos**: los cambios de esquema MUST hacerse con migraciones versionadas de Drizzle; queda
  prohibido modificar a mano la base de producción.
- **Privacidad**: no se guardan datos personales de invitados más allá de su nombre y nota; las
  IPs solo se almacenan como hash con sal.

## Flujo de desarrollo y quality gates

- **Flujo Spec Kit**: `/speckit-specify` → `/speckit-clarify` (opcional) → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`. El "Constitution Check" de cada plan MUST evaluar
  los principios I–VI y registrar cualquier excepción en "Complexity Tracking".
- **Gates para integrar a `main`**:
  1. `nuxt typecheck` y `bun run build` sin errores.
  2. `test:unit`, `test:nuxt` y `test:e2e` en verde, con la cobertura del Principio V.
  3. Revisión manual a 360 px y a ≥ 1280 px en tema oscuro y claro (Principios III y VI).
  4. Ningún presupuesto del Principio I empeora sin justificación.
  5. Revisión de código por al menos una persona (o una revisión asistida documentada en el PR
     cuando el equipo sea de una persona).
- **Commits**: mensajes descriptivos en formato Conventional Commits (`feat:`, `fix:`,
  `docs:`, `test:`, `refactor:`, `chore:`).
- **Ramas**: una rama por feature (`NNN-nombre-corto`), integrada por PR.

## Governance

- Esta constitución prevalece sobre cualquier otra práctica o preferencia del proyecto. Ante
  conflicto entre un plan, una tarea o una revisión y esta constitución, prevalece la
  constitución.
- **Enmiendas**: se proponen por PR que modifique este archivo, incluyan un Sync Impact Report y
  expliquen el impacto en las features en curso. Si la enmienda cambia obligaciones existentes,
  MUST incluir un plan de migración.
- **Versionado** (SemVer):
  - MAJOR: elimina o redefine un principio de forma incompatible.
  - MINOR: agrega un principio o sección, o amplía materialmente una guía.
  - PATCH: aclaraciones, redacción o correcciones sin cambio semántico.
- **Cumplimiento**: cada `/speckit-plan` y cada PR MUST verificar el cumplimiento. La guía
  operativa para agentes y personas vive en `AGENTS.md`, que MUST mantenerse alineado con esta
  constitución.

**Version**: 1.0.1 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-20
