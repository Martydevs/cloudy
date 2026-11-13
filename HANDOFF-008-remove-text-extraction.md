# Handoff — 008 · Retirada de la lectura de texto de imágenes

**Fecha**: 2026-11-13 · **Rama**: `008-remove-text-extraction` (fusionada en `development`)
**Plan y decisiones**: `PLAN-remove-text-extraction.md` (mismo commit)

---

## 1. Qué se hizo (ya está en el commit)

Se retiró por completo la extracción de texto de imágenes con el modelo de visión de OpenRouter (feature 002), tanto en
las subidas del equipo como en los envíos de invitados, y se reescribió la página **Peticiones** (feature 007), que
dependía de esa transcripción.

**Borrado**: `server/ai/image-text/`, `server/ai/breaker.ts`, `server/utils/image-text.ts`, `server/utils/image-text-store.ts`,
los cinco endpoints `…/text`, el pool de lectura en segundo plano, `ImageTextPanel`, `ImageTextEditor`, `useImageText`,
`PrayerSelectionDialog`, `PrayerTextDialog`, `messages.imageText`, `shared/validation/image-text.ts`, la búsqueda por
transcripción (`matchedIn`, insignia «En el texto», índice `files_text_trgm_idx`) y 14 suites de pruebas.

**Nuevo**: `app/components/prayers/PrayerComposeDialog.vue`, `test/nuxt/PrayerComposeDialog.spec.ts`,
`test/unit/uploads.spec.ts`, `drizzle/0011_breezy_malcolm_colcord.sql`.

**Peticiones ahora**: cualquier imagen aprobada se puede elegir → «Escribir textos y generar» abre
`PrayerComposeDialog` → se escribe el texto de cada petición (agrupadas por imagen) → se genera.
`POST /api/peticiones/imagenes` recibe `{ requests: [{ fileId, text }] }`. El texto **no se guarda en ningún lado**:
vive en `usePrayerSelection` (`useState`, solo memoria) y viaja con la generación.

**Se conserva a propósito**: la copia JPEG de los HEIC (`withTextSource`, `textsrc/<id>.jpg`, columna `text_source_key`,
`heic-to`, `checkTextSourceCopy` reubicada en `server/utils/uploads.ts`). Nadie la lee ya, pero se sigue subiendo y la
limpieza diaria la borra junto al original. Retirar ese canal es una decisión aparte, aún pendiente de decidir.

### Estado de verificación al cerrar la sesión

| Check | Resultado |
|-------|-----------|
| `bun run typecheck` | ✅ limpio |
| `bun run test:coverage` (unit + nuxt) | ✅ 139 archivos, 2044 pruebas · 97,48 % stmts / 93,11 % branches / 95 % funcs / 98,37 % lines (umbral 92 %) |
| `bun run build` | ✅ completo |
| `bun run test:e2e` | ⚠️ **NO EJECUTADO** |
| Verificación en navegador | ⚠️ **NO HECHA** |

La línea base antes del cambio también estaba verde (typecheck limpio, unit 1358, nuxt 935): no había nada roto de antes.

---

## 2. Pendientes (en este orden)

### 2.1 Ejecutar la migración `0011` — BLOQUEA todo lo demás

`drizzle/0011_breezy_malcolm_colcord.sql`. **Es destructiva: borra todas las transcripciones guardadas.**
Haz una instantánea de la rama de Neon antes.

```bash
bun run db:migrate        # rama development (.env.development)
bun run db:migrate:test   # rama de pruebas (.env.test) — `bun run test:e2e` ya la aplica en su global-setup
bun run db:migrate:prod   # producción (.env)
```

Borra de `files` y `guest_submission_files`: `text_status`, `text_content`, `text_error`, `text_attempts`,
`text_started_at`, `text_read_at` (y en `files` además `text_edited_by` / `text_edited_at`), la FK, los dos CHECK, el
índice `files_text_trgm_idx` y el tipo `image_text_status`.
**Conserva** `text_source_key` en ambas tablas y el valor `file.text_edit` del enum `activity_action` (Postgres no borra
valores de un enum y el registro de actividad antiguo lo usa).

> Sin esta migración, la app contra una base vieja **sigue funcionando** (el código ya no selecciona esas columnas), pero
> `bun run db:generate` volvería a proponer el borrado y el esquema quedaría desalineado.

### 2.2 `bun run test:e2e`

Las specs y el stub de OpenRouter ya están actualizados y pasan `typecheck`, pero **nunca se ejecutaron**. Es el
pendiente con más riesgo de encontrar fallos.

Qué cambió en e2e y hay que mirar con lupa si falla:

- `test/e2e/setup/openrouter-stub.ts` — se quitó toda la rama de lectura de texto (`NOTE_TEXT`, `fail`, `delayMs`,
  `total`, `byImage`, los hashes de fixtures). Ahora **solo** sirve generación; cualquier otra llamada responde 400.
- `test/e2e/setup/fixtures.ts` — `seedFiles` ya no acepta `textContent`; `seedPrayerRequest` ya no acepta `text` ni
  `textStatus`; se borró `textColumns`; `stubCalls` dejó de exportarse (queda `prayerCalls`, `setStubMode`, `resetStub`).
- `test/e2e/peticiones.spec.ts` — `seedTexts` ahora **devuelve** el texto en vez de sembrarlo; el helper `generate(page,
  entries)` abre el diálogo y rellena cada `textarea` con `dialog.getByLabel(name, { exact: true })`. **Punto frágil**:
  ese `getByLabel` depende de que la etiqueta del campo sea exactamente el nombre del remitente
  (`PrayerComposeDialog.vue`, `<label :for>`). Si los nombres sembrados colisionan, el locator será ambiguo.
- `test/e2e/guest-queue.spec.ts` — se borró el `describe('US2 · texto de las imágenes de invitados')` entero.
- `test/e2e/routes-guard.spec.ts` — se quitaron las cinco rutas `…/text`.
- `test/e2e/performance.spec.ts` — la prueba SC-006 pasó de «buscar por texto» a «buscar por nombre» (siembra 50
  archivos extra con la palabra en el nombre).
- `test/e2e/peticiones-historial.spec.ts` — `generateOne` ahora pasa por el diálogo.

Recuerda: deja ~5 min entre corridas que inician sesión mucho (Neon Auth bloquea por IP).

### 2.3 Verificación en navegador (`bun run dev`, skill `agent-browser`)

A 360 px y ≥ 1280 px, en tema oscuro y claro, revisando estados loading/empty/error/content, foco de teclado y errores
de consola:

1. **/peticiones** — elegir varias tarjetas → «Escribir textos y generar» → el diálogo agrupa por imagen, cada entrada
   con foto, remitente, nota y `textarea`; el botón queda deshabilitado hasta que todas tengan texto; «Quitar» saca una;
   cerrar conserva lo escrito; generar encola y baja al historial. Comprobar que el menú de una imagen del historial ya
   **no** ofrece «Generar de nuevo».
   > Ojo: con una clave de OpenRouter en `.env.development`, «Generar» es una llamada real y **de pago**. Mockea
   > `POST /api/peticiones/imagenes` con `page.route` para la QA.
2. **/archivos** — buscar: no debe aparecer la insignia «En el texto» ni la nota sobre el texto de las imágenes.
3. **/archivos/ver/\<id\>** de una imagen — ya no hay panel de texto; los comentarios siguen.
4. **/solicitudes** — las tarjetas de envío ya no muestran paneles de texto por imagen.
5. **/upload** (invitado) — ya no aparecen los dos avisos sobre la lectura automática con IA.

### 2.4 Decisión abierta: ¿se retira también la copia JPEG de los HEIC?

Hoy es código vivo que no sirve a nadie (ver §1). Retirarla tocaría: `withTextSource` en los tickets de subida,
`app/utils/heic-copy.ts`, la dependencia `heic-to`, `checkTextSourceCopy`, la columna `text_source_key` (otra migración)
y la limpieza en cron/papelera/rechazo. Quedaría una decisión del equipo; dejarla también es válido.

---

## 3. Cosas que conviene saber al retomar

- **`shared/constants/image-text.ts` sigue existiendo**, recortado a `MAX_IMAGE_TEXT_BYTES` + `isImageTextEligible`
  (los usan la copia HEIC y `app/utils/camera.ts`). El nombre quedó desalineado a propósito para no inflar el diff; si se
  retira la copia HEIC, el archivo entero se va.
- **`PRAYER_TEXT_MAX_LENGTH`** (10 000) vive ahora en `shared/constants/prayers.ts`; antes era
  `MAX_IMAGE_TEXT_LENGTH`. Lo usa `server/ai/prayer-image/schemas.ts` y el diálogo.
- **El diálogo no usa Regle.** Una lista dinámica de `textarea` no encaja en un formulario Regle de campos con nombre, así
  que valida en línea contra `PRAYER_TEXT_MAX_LENGTH`. `test/unit/architecture.spec.ts` solo prohíbe llamar a
  `useRegle`/`useRegleSchema` fuera de `useFormSchema`, así que no hay conflicto.
- **`architecture.spec.ts` tiene un guardia nuevo** que falla si reaparece cualquiera de los símbolos retirados
  (`extractImageText`, `readSubmissionImages`, `toImageText`, `createProviderBreaker`, …) en cualquier archivo del árbol.
- **`AI_IMPORTERS` ahora es solo `['server/utils/prayer-images.ts']`**: es el único importador de `#server/ai`.
- `test/nuxt/pages-files.spec.ts` → «muestra vista previa, metadatos y acciones» falló **una vez** bajo cobertura y pasó
  en las corridas siguientes. Es el problema de timing de los chunks `Lazy*` que el propio test documenta, no una
  regresión de este cambio.

---

## 4. Documentación ya actualizada

- `AGENTS.md`: feature activa, lista de specs, fila de IA de la tabla, principio IV, variables de entorno, el bullet de
  IA y el de `heic-to` en «Known gotchas», el bullet de `#server/ai`, la sección de la feature 007 (con un bloque
  **Text removed (2026-11-13)**) y la nota de los valores de enum que no se pueden borrar.
- `specs/002-note-text-extraction/spec.md`: nota de **RETIRADA** al principio.
- `specs/007-peticiones-imagenes/spec.md`: **Enmienda (2026-11-13)** al principio, con los FR que quedan sin efecto.
