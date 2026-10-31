# Plan de cierre: T074, T075 y T076 (feature 002)

Guía para retomar en una sesión nueva. Todo lo demás de la feature está hecho y en verde (ver `tasks.md` y
`quickstart.md` §6). Aquí solo queda lo que necesita proveedores reales, fotos reales o el despliegue.

## 0. Estado de partida (2026-10-26)

- Rama `002-note-text-extraction`. **Cambios sin commit**: ediciones de `spec.md`, `plan.md`, `tasks.md`,
  `pendientes.md`, esta guía, y los fixtures `test/fixtures/files/paisaje.jpg` (nota adhesiva en blanco) y
  `paisaje.heic` (original). `imagenes-pruebas/*` aparece borrado por la persona. Pedir permiso antes de commitear
  (sugerido: `docs(002): …` y `test(e2e): …`).
- Decisión C1: basta el aviso informativo (FR-011); no se enmienda la constitución.
- T084 hecha: `image-text.spec.ts` pasa 10/10 con el nuevo `paisaje.jpg`.
- `.env.development` ya tiene `NUXT_OPENAI_APIKEY` y `NUXT_GOOGLE_APIKEY` (no imprimir valores).
- `NUXT_OPENAI_BASE_URL` debe estar vacía en desarrollo.

## 1. Bloqueo conocido: el navegador de `agent-browser`

Chrome 156 de `~/.agent-browser/` no arranca porque faltan `libcups`, `libcairo` y `libpango` (Arch Linux). Al cierre
de la sesión anterior `pacman -Q cairo` seguía sin encontrarlos. Antes de nada:

```bash
pacman -Q libcups cairo pango
ldd ~/.agent-browser/browsers/chrome-*/chrome | grep 'not found'   # debe quedar vacío
```

Si falta algo, la persona lo instala (el agente no usa `sudo`):

```bash
sudo pacman -S --needed libcups cairo pango nss at-spi2-core libxkbcommon alsa-lib libxcomposite libxdamage libxrandr mesa
```

Alternativas si no se arregla: Chromium headless de Playwright (el de los e2e, funciona) con una cuenta de editor
desde un archivo git-ignorado `.env.qa` (`QA_EMAIL`, `QA_PASSWORD`); nunca pedir ni imprimir la contraseña en el chat.

## 2. T074 — Pasada en navegador con OpenAI real

**Objetivo**: quickstart §4, escenarios con OpenAI como principal (hasta ahora solo se hicieron con Gemini).

1. `bun run dev` (carga `.env.development`); confirmar `curl -s -o /dev/null -w '%{http_code}' localhost:3000/enviar` = 200.
2. Sesión propia: `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix task)"`.
3. Abrir con `--headed --profile <dir>` para que la persona inicie sesión como **editor aprobado** (cuenta de QA
   «QA Editor 002»; la contraseña la sabe la persona). Seguir desde la sesión guardada.
4. Recorrer a **360 px y ≥ 1280 px, tema oscuro y claro**, con teclado y sin errores de consola:
   | Escenario | Qué comprobar con OpenAI |
   |-----------|--------------------------|
   | 1, 2, 6 | `nota.jpg`: texto sin «Skykids», con saltos de línea; reabrir sin releer (`text_attempts = 1`); copiar → toast |
   | 2c | `nota.jpg` + `nota.png` juntas: dos lecturas en paralelo, cada una con su texto |
   | 3 | `nota.heic`: «Preparando…», panel con texto, sin `<img>` |
   | 4 | `paisaje.jpg` (nueva, nota en blanco): «No se reconoció texto». Anotar si la marca de destello de esquina se lee como texto |
   | 5 | `grande.jpg`, `imagen.webp`, `anim.gif`: «No disponible…», sin botones |
   | 7 | editar, insignia «Editado por», confirmación al volver a leer, entrada `file.text_edit` en Actividad |
   | 9, 10, 11 | `/enviar` sin sesión con `nota.jpg` + `nota.heic`; Pendientes muestra el texto; aprobar sin releer; rechazar sin filas |
   | 12 | búsqueda por palabra del texto → insignia «En el texto»; tras la papelera desaparece |
5. **Verificar que lee OpenAI y no Gemini**: ambas claves están puestas, así que un fallo de OpenAI pasaría
   inadvertido por el respaldo. Revisar el log del dev server: no debe aparecer `fallback openai→google`; si aparece,
   anotar el código (`rate_limited`, `quota_exceeded`, …) y tratarlo como hallazgo.
6. Opcional (no gasta saldo extra): escenario 8b (OpenAI inválida + Gemini válida) ya está cubierto en la pasada
   anterior; no repetirlo salvo cambios en `server/ai/`.
7. Cerrar: anotar resultados en `quickstart.md` §6 (fila «OpenAI real», que hoy dice «⏸ no se ejecutó»), listar los datos
   de QA creados (archivos, carpeta, envíos) para que la persona los borre desde la UI, y marcar T074 con la fecha.
   Antes de marcarla, correr `bun run typecheck` si se tocó código (no debería haber cambios de código).

## 2b. Reglas que no se pueden saltar

- Sin acciones destructivas (AGENTS.md y el hook `block-destructive.mjs`): nada de `DELETE`, `TRUNCATE`, `rm -r`,
  borrar objetos del bucket ni ramas. Los datos de QA los limpia la persona.
- Cualquier comando peligroso o consulta MCP a la base de datos: pedir permiso antes.
- Solo datos de `.env.development`. Los e2e usan `.env.test` y su propia rama.

## 3. T075 — Calidad real (SC-002) y latencia (SC-001)

Necesita **las 20 fotos reales** de la persona (notas adhesivas y peticiones de oración legibles, sin datos sensibles).

1. Transcribir cada foto a mano (la persona) como verdad de referencia.
2. Pasada A con OpenAI y pasada B forzando el respaldo (`NUXT_OPENAI_APIKEY=` vacía y reiniciar `bun run dev`).
3. Medir por foto: palabras correctas (objetivo ≥ 95 %), presencia de «Skykids» (objetivo: ninguna) y tiempo desde que
   termina la subida hasta `ready` (objetivo: 90 % < 30 s). Incluir una imagen sin texto (`paisaje.jpg`) marcada como vacía.
4. Latencia del lado invitado: envíos de 1, 4 y 8 imágenes aptas desde `/enviar`, anotando el tiempo hasta `ready` de
   cada una (SC-001 aplica a ≤ 4; para 8 se registra sin umbral).
5. Si no se cumple: ajustar solo el system prompt del preset `@preset/image-content-extraction` en OpenRouter (ya no vive en el repo: `server/ai/image-text/prompt.ts` solo guarda `IMAGE_EXTRACTION_PROMPT`) y repetir. Cada ajuste necesita test unitario
   y `bun run typecheck` + `bun run test:unit`.
6. Anotar la tabla por proveedor en `quickstart.md` §6 «Calidad real» y marcar T075.

## 4. T076 — Preparar el despliegue (lo hace la persona; el agente guía y verifica)

1. Vercel, por entorno: `NUXT_OPENAI_APIKEY`, `NUXT_OPENAI_ORG`, `NUXT_OPENAI_PROJ` (principal) y `NUXT_GOOGLE_APIKEY`
   (respaldo; si se omite no hay respaldo). **No** definir `NUXT_OPENAI_BASE_URL`.
2. Migración de producción: la ejecuta la persona con `bun run db:migrate:prod` (solo agrega columnas, enum, CHECK e índice).
3. Confirmar que Fluid Compute está activo en el proyecto de Vercel.
4. En el despliegue de vista previa:
   - `.vercel/output/functions/__nitro.func/.vc-config.json` declara runtime Node.
   - Subir `nota.jpg`, **esperar sin abrir la vista previa** y comprobar con `GET /api/files/:id/text` que está en `ready`
     (prueba de que `waitUntil` termina la lectura en segundo plano).
   - Enviar como invitado un envío con varias imágenes y confirmar que todas llegan a `ready` sin abrir Pendientes.
   - Con una `NUXT_OPENAI_APIKEY` inválida y `NUXT_GOOGLE_APIKEY` válida (la persona cambia la variable), una lectura
     termina en `ready` por el respaldo.
5. Anotar el resultado en `quickstart.md` §6 y marcar T076. No hacer deploy sin que la persona lo pida.

## 5. Cierre

- `tasks.md`: marcar T074, T075 y T076 con fecha y evidencia; actualizar G1 en `pendientes.md`.
- Correr de nuevo `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt` y, si hubo cambios de código,
  `bun run test:e2e` y `bun run test:coverage` (umbral 92 %).
- Preguntar a la persona antes de commitear y abrir el PR de `002-note-text-extraction` hacia `main`.
