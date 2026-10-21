# Pendientes: 002-note-text-extraction

Hallazgos de `/speckit-analyze` (2026-10-21) que quedan por resolver. Se arreglan editando `spec.md`; ninguno
requiere cambios de código.

## [ ] I1 — La spec no menciona el respaldo con Gemini

- **Problema**: `spec.md` habla de "el servicio de lectura" en singular, y FR-019 dice que solo se le envía la
  imagen. El plan, `AGENTS.md` y `server/ai/providers/candidates.ts` mandan la imagen a Google Gemini cuando
  OpenAI no tiene clave o falla. La decisión ya está tomada, pero no consta en la spec.
- **Arreglo**: añadir en Clarifications "OpenAI principal; Gemini de respaldo ante falta de clave o cualquier
  fallo; con `NUXT_GOOGLE_APIKEY` vacía no hay respaldo" y cambiar FR-019 a "los servicios de lectura".

## [ ] D1 — Privacidad del texto de invitados (constitución, "Privacidad")

- **Problema**: la constitución dice que no se guardan datos personales de invitados más allá de su nombre y
  nota. El texto extraído puede traer nombres y datos de salud de terceros (p. ej. "David, oración por mi primo
  que se siente mal"). Se guarda en `guest_submission_files.text_content` y se envía a OpenAI o Google.
- **Por qué no es crítico**: el texto ya estaba en la imagen que el invitado envió y se borra con ella al
  rechazar o caducar (FR-010). Ese argumento solo vive en el Constitution Check de `plan.md`.
- **Arreglo**: añadir a Assumptions de `spec.md`: "el texto extraído es contenido del archivo enviado, no un dato
  nuevo del invitado; sigue el mismo ciclo de vida que la imagen".

## [ ] I2 — FR-006 contradice la UI con `invalid_input`

- **Problema**: FR-006 exige poder reintentar toda extracción en error, pero
  `app/components/files/ImageTextPanel.vue:165` oculta Reintentar cuando el error es `invalid_input` y muestra
  `messages.imageText.failedPermanent` ("Descárgala y vuelve a subirla en JPG o PNG"). La UI es correcta
  (reintentar un objeto vacío o corrupto no sirve), y FR-021 ya pide indicar qué hacer.
- **Arreglo**: añadir a FR-006 "salvo cuando la entrada no es válida (FR-021), en cuyo caso se indica volver a
  subir la imagen".

## [ ] A1 — "5 MB" es ambiguo

- **Problema**: la spec dice "hasta 5 MB" y "exactamente 5 MB se lee"; el código usa
  `MAX_IMAGE_TEXT_BYTES = 5_242_880` (5 MiB). Quien lea 5 000 000 bytes esperaría otro límite.
- **Arreglo**: escribir "5 MB (5 242 880 bytes)" en FR-001, FR-021 y en el caso límite de Edge Cases.
