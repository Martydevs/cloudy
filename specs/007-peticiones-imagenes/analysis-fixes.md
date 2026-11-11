# Suggested fixes — /speckit-analyze on feature 007 (Peticiones)

How to use this file: each fix has a **checkbox**, the **file + line** to edit, the **current text** and the **suggested text**.
Line numbers are from the files as they are today; they shift after each edit, so search for the quoted text instead.
Suggested text is in Spanish because the specs are. Nothing here has been applied.

Order: CRITICAL → HIGH → MEDIUM → LOW. Fix the first four before running `/speckit-implement`.

**Status (2026-11-11): all fixes applied.** I1 (`.specify/feature.json` points to 007) and every item below, with one change:
for **C1**, instead of the plan.md Complexity Tracking row, the constitution was amended (Principle I, v1.1.1 → v1.2.0: thumbnails are
optional) and AGENTS.md, tasks.md, plan.md and research D9 were aligned. The boxes below are left unticked on purpose as a record of what was suggested.

---

## C1 · CRITICAL · Register the "guest photos have no thumbnail" exception (constitution I)

Principle I says images MUST have thumbnails. Guest photos have none (3–5 MB each), and the plan never registers this as an exception,
although research D9 says it is "registrada en el plan". Add one row and one measurement.

- [ ] **plan.md** — "Complexity Tracking" table, add a row **after** the "Búsqueda sin índice" row (line ~166):

```markdown
| **Fotos de invitados sin miniatura** (Principio I «imágenes con miniatura»): cada tarjeta carga la foto original (3–5 MB típicas) | Las fotos del feature 003 se guardan sin miniatura; generarlas exigiría `sharp` (dependencia nueva) o cambiar el envío del invitado | Se mitiga con páginas de 12, `src` asignado solo al entrar en el viewport (`useElementVisibility`, 200 px), caja `aspect-[4/3]` (sin CLS) y la transcripción visible aunque la foto aún no haya cargado. Las miniaturas quedan como mejora futura |
```

- [ ] **tasks.md** — T082, append at the end of the line (after "…si ese spec recorre rutas."):

```markdown
 Medir además, con perfil 4G simulado y 12 fotos reales de 3–5 MB, que el texto y el esqueleto de las tarjetas son utilizables sin esperar a las fotos (SC-005) y anotar el resultado; si no lo son, reportarlo antes de decidir miniaturas.
```

---

## I2 · HIGH · The template source path does not exist

`/mnt/c/Users/workpc/Pictures/...` is a WSL path for a different Windows user. The file is not on this machine, and `server/assets/` does not exist yet.
T003 (`serverAssets` build check) and all of US2 depend on it. **You need to provide the JPEG** (1152×928, ≈ 733 KB) or tell me where it is.

- [ ] **tasks.md** — T002 (line 42). Current:

```markdown
- [ ] T002 Copiar la plantilla (research D5, quickstart § 0): `mkdir -p server/assets/peticiones` y `cp /mnt/c/Users/workpc/Pictures/google-gemini-nano-banana-2.1-generated.jpg server/assets/peticiones/plantilla.jpg`. Verificar que la copia es un JPEG de 1152×928 y 733 339 bytes (`file server/assets/peticiones/plantilla.jpg`, `stat -c %s …`). No modificar ni borrar el original.
```

Suggested:

```markdown
- [ ] T002 Traer la plantilla al repositorio (research D5, quickstart § 0): **pedir a la persona la ruta del JPEG de la plantilla** (1152×928, ≈ 733 KB; en el diseño se llama `google-gemini-nano-banana-2.1-generated.jpg`), y ejecutar `mkdir -p server/assets/peticiones` y `cp "<ruta entregada>" server/assets/peticiones/plantilla.jpg`. Verificar que la copia es un JPEG de 1152×928 (`file server/assets/peticiones/plantilla.jpg`) y anotar su tamaño en bytes. No modificar ni borrar el original. **Bloquea T003 y US2; el agente no inventa ni genera una plantilla.**
```

- [ ] **quickstart.md** — line 11, replace only the parenthetical. Current: `(origen: `/mnt/c/Users/workpc/Pictures/google-gemini-nano-banana-2.1-generated.jpg`)` → suggested: `(origen: la ruta que entregue la persona; el diseño original se llama `google-gemini-nano-banana-2.1-generated.jpg`)`

---

## I3 · HIGH · Test and regex disagree about accents (`[Ilégible]`)

FR-015 says "sin distinguir mayúsculas ni tildes". T005 expects `[Ilégible]` to match, but the regex only ignores case, so `é` ≠ `e`.
Fix with a character class: offsets stay the same, so `splitIllegible` still rebuilds the original text exactly.

- [ ] **research.md** — D7, lines 102–103. Current:

```markdown
`/\[[^\]\n]*legible[^\]\n]*\]/giu` (cubre `[ilegible]`, `[unlegible]`, `[illegible]`, `[texto ilegible]`).
```

Suggested:

```markdown
`/\[[^\]\n]*l[eé]gible[^\]\n]*\]/giu` (cubre `[ilegible]`, `[ilegíble]`, `[unlegible]`, `[illegible]`, `[texto ilegible]`, `[ILÉGIBLE]`; ignora mayúsculas y la tilde de la `e`, sin cambiar las posiciones del texto para que `splitIllegible` reconstruya el original).
```

- [ ] **tasks.md** — T005 (line 58). Replace the regex in `regex /\[[^\]\n]*legible[^\]\n]*\]/giu` with `regex /\[[^\]\n]*l[eé]gible[^\]\n]*\]/giu` and add `[ILÉGIBLE]` to the list of strings that return `true` (it already lists `[Ilégible]`).

---

## I4 · MEDIUM · The button is called "Editar" in the spec and "Corregir texto" everywhere else

Pick one. Suggestion: keep **Corregir texto** (contracts/ui.md, T065, T066, T069 already use it; it also matches the user's goal of fixing `[ilegible]`) and change the spec.

- [ ] **spec.md** — US3 intro (line ~162). Current: `la persona pulsa **Editar**, ve la foto original…` → suggested: `la persona pulsa **Corregir texto**, ve la foto original…`
- [ ] **spec.md** — US3 scenario 1 (line ~177). Current: `**When** la persona pulsa **Editar**, **Then** el texto pasa a un campo editable…` → suggested: `**When** la persona pulsa **Corregir texto**, **Then** el texto pasa a un campo editable…`
- [ ] **spec.md** — US3 Independent Test (line ~171). Current: `pulsar **Editar**, sustituir la marca…` → suggested: `pulsar **Corregir texto**, sustituir la marca…`
- [ ] **spec.md** — FR-013 (line ~302). Current: `Cada tarjeta con transcripción MUST ofrecer **Editar**, con campo de texto…` → suggested: `Cada tarjeta con transcripción MUST ofrecer **Corregir texto**, con campo de texto…`

---

## G1 · MEDIUM · "Image trashed while selected" edge case promises more than the tasks build

The spec says the card leaves the grid and the selection with a notice. The tasks only react when generation answers `409` (T049/T060).
Simplest honest fix (YAGNI, no polling): narrow the spec to what is built.

- [ ] **spec.md** — Edge Cases, lines 247–248. Current:

```markdown
- **Una imagen aprobada deja de estar disponible mientras su tarjeta está elegida** (por ejemplo, se envía a la
  papelera o se elimina): la tarjeta deja de aparecer en la rejilla y se retira de la selección con un aviso.
```

Suggested:

```markdown
- **Una imagen aprobada deja de estar disponible mientras su tarjeta está elegida** (por ejemplo, se envía a la
  papelera o se elimina): la tarjeta desaparece de la rejilla al recargar o volver a la página; si ya estaba elegida,
  se detecta al pulsar **Generar imágenes** (el servidor responde que ya no está disponible), se retira de la
  selección con un aviso y esa imagen no se genera.
```

Alternative (more work): add a revalidation on window focus (`useWindowFocus`) that refreshes the list and prunes the selection. Say so if you prefer it and I will write the task.

---

## G2 · MEDIUM · SC-002 (20-image fidelity review) has no task

- [ ] **tasks.md** — Phase 7, add right after T088 (line 217). Using `T088b` avoids renumbering:

```markdown
- [ ] T088b Revisión de fidelidad (SC-002) — **gasta crédito: requiere permiso explícito de la persona**. Con la clave real, generar 20 imágenes (variando el número de peticiones por imagen, con tildes, emojis y un texto largo) y revisar a mano cada una: texto completo sin palabras cambiadas, omitidas ni añadidas y plantilla intacta. Criterio: al menos 18 de 20 (90 %). Anotar el resultado y el crédito usado en `specs/007-peticiones-imagenes/quickstart.md`; si no se alcanza, reportarlo antes de ajustar el preajuste o el prompt (research D13).
```

- [ ] **tasks.md** — T090, so the final check includes it. Optional: change `La generación real solo si T088 tuvo permiso.` → `La generación real solo si T088 y T088b tuvieron permiso.`

---

## G3 · LOW · No test for the "Sin conexión" edge case

- [ ] **tasks.md** — T066 (US3 e2e, line 167), append at the end:

```markdown
 Con la red cortada (`context.setOffline(true)`), **Guardar** muestra un mensaje accionable y el texto escrito se conserva; al volver la red, reintentar guarda.
```

- [ ] **tasks.md** — T051 (US2 e2e, line 136), append before "Ampliar `test/e2e/routes-guard.spec.ts`…":

```markdown
 Con la red cortada, **Generar imágenes** deja la imagen en error reintentable con mensaje accionable y no se pierde la selección.
```

---

## U1 · LOW · Dangling reference and `invalid_input` not in the error-code list

- [ ] **tasks.md** — T044 (line 129). Current: `` `invalid_input` → 502 `provider` (ver inconsistencia anotada en el reporte de tareas) `` → suggested:

```markdown
`invalid_input` → 502 `provider` (es un fallo interno: el endpoint ya validó 1–4 ids y textos; `invalid_input` es un código de `PrayerImageErrorCode` en `server/ai/`, no de `PRAYER_ERROR_CODES`, y nunca llega al cliente)
```

---

## I5 · LOW · Stale branch notes (the branch now exists)

- [ ] **plan.md** — line 3. Current: `**Branch**: `007-peticiones-imagenes` (la rama no se creó: no hay hook `before_specify`; se crea al implementar)` → suggested: `**Branch**: `007-peticiones-imagenes``
- [ ] **tasks.md** — T001 (line 41). Current:

```markdown
- [ ] T001 Confirmar el punto de partida: `.specify/feature.json` apunta a `specs/007-peticiones-imagenes`; `git branch --show-current` (hoy `development`). AGENTS.md pide una rama por feature (`007-peticiones-imagenes`): **preguntar a la persona** si la crea antes de implementar; el agente no crea ni cambia de rama por su cuenta. Confirmar que `ai@7.0.145` …
```

Suggested (keep the rest of the line from "Confirmar que `ai@7.0.145`" as it is):

```markdown
- [ ] T001 Confirmar el punto de partida: `.specify/feature.json` apunta a `specs/007-peticiones-imagenes` y `git branch --show-current` es `007-peticiones-imagenes` (rama ya creada; el agente no crea ni cambia de rama por su cuenta). Confirmar que `ai@7.0.145` …
```

---

## I6 · LOW · "Bandeja" (spec) vs "in the page, no tray" (plan)

- [ ] **spec.md** — "Terminología" list (after the **Imagen de peticiones** item, line ~37), add:

```markdown
- **Bandeja de resultados**: la sección «Imágenes generadas» de la propia página de Peticiones (no una bandeja fija del layout como las de YouTube y Canciones), donde aparecen, se descargan y se reintentan las imágenes.
```

---

## D1 · LOW · Missing task dependencies

- [ ] **tasks.md** — "Dependencias clave entre tareas" (line ~243), add a line:

```markdown
- T027 (`seedPrayerRequest`) → T033, T051, T066, T077 · T050 (stub de OpenRouter) → T051, T066.
```

---

## Y1 · LOW · `sync(request)` is built in US1 but only US3 uses it

- [ ] **tasks.md** — T029 (line 98): delete `, \`sync(request)\` (reemplaza la copia; si deja de ser seleccionable, la quita)` from the list.
- [ ] **tasks.md** — T036 (line 108): delete `, \`sync(request)\`` from the API list.
- [ ] **tasks.md** — T072 (line 176). Current: `…su `change` → `usePrayerRequests().patchText` + `usePrayerSelection().sync` (si la tarjeta deja de tener texto, sale de la selección); …` → suggested, adding the work at the start of the task:

```markdown
- [ ] T072 [US3] Agregar `sync(request)` a `app/composables/usePrayerSelection.ts` (reemplaza la copia de la tarjeta elegida; si deja de ser seleccionable, la quita) con su prueba en `test/nuxt/usePrayerSelection.spec.ts`, y conectar US3 en `app/pages/peticiones.vue`: `fix` de una tarjeta abre `LazyPrayerTextDialog` con `v-if`; su `change` → `usePrayerRequests().patchText` + `usePrayerSelection().sync`; toast al guardar (`messages.imageText.*` existente).
```

---

## A1 · LOW · FR-033 has no numbers

The server limits are 60 images/hour and 120 edits/hour (contracts/api.md). One 40-petition run is 10 images, so 6 full runs per hour, with retries counted too.

- [ ] **spec.md** — FR-033 (line ~361). Current:

```markdown
- **FR-033**: La acción **Generar imágenes** y la edición de transcripciones MUST estar limitadas por tasa para
  proteger el crédito del proveedor, informando con un mensaje accionable cuando se alcance el límite.
```

Suggested:

```markdown
- **FR-033**: La acción **Generar imágenes** y la edición de transcripciones MUST estar limitadas por tasa para
  proteger el crédito del proveedor, informando con un mensaje accionable cuando se alcance el límite. Valores
  iniciales por persona: 60 imágenes por hora (cada reintento y cada **Generar de nuevo** cuenta) y 120 ediciones por hora.
```

If 60/hour feels too tight for a Sunday service, change the number here **and** in contracts/api.md (line 64), T045 and T053.
