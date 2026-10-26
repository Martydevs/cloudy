# Pendientes: 002-note-text-extraction

Hallazgos de `/speckit-analyze` (2026-10-21) y su estado. Se resuelven en `spec.md`, `plan.md`, los contratos y el
quickstart; D1 añade además el aviso de privacidad de `/enviar` y el resto no requiere cambios de código.

**Actualización 2026-10-24**: I1, D1, I2 y A1 quedaron resueltos (nueva sesión de Clarifications, FR-006/019/021/022, Assumptions, SC-001, el límite de 5 242 880 bytes y el aviso `guestPrivacy` de `/enviar`).

**Actualización 2026-10-24 (segundo análisis)**: se aplicaron los hallazgos MEDIUM y LOW de la segunda pasada
(latencia de `complete`, stub e2e, FR-007/008/011/014, contratos de UI, referencias de AGENTS.md y tasks). Quedan
abiertos C1 y G1 abajo.

## [ ] C1 — Privacidad de invitados vs. servicios externos de IA (decisión de la persona)

- **Problema**: la constitución ("Privacidad") dice que solo se guardan nombre y nota del invitado. El texto
  extraído y los bytes de la imagen van a OpenAI y, de respaldo, a Google. El plan y la spec lo justifican como
  contenido del archivo que el invitado ya envió, con un aviso (FR-011) pero sin consentimiento explícito.
- **Decisión pendiente**: (a) aceptar el aviso informativo como suficiente, o (b) enmendar la constitución con una
  aclaración PATCH (como la 1.0.1) vía `/speckit-constitution`, o (c) pedir consentimiento en `/enviar`.
  No se modificó la constitución: es una decisión de la persona, fuera de `/speckit-analyze`.

## [ ] G1 — T078 y verificación pendiente

- 2026-10-25: con el shell ya disponible, `typecheck`, `test:unit` (608), `test:nuxt` (305) y `test:coverage`
  (98,3 % / 93,68 % / 95,13 % / 98,8 %) pasaron en verde. T078 queda solo a falta de la verificación en navegador.
- Los dos fallos de e2e de esa corrida (ruta con `\` en Windows y una carrera en `uploadAndClose`) se corrigieron en T082 y T083: `responsive-theme.spec.ts` pasa completo (27) y el escenario 8 pasa.
- Observación: en la corrida de verificación de T082/T083 (dos archivos a la vez, ~5 veces más lenta de lo normal) el escenario 13 (dos pestañas) agotó el tiempo; solo, pasa en 85 s. Se trata como fallo por lentitud del entorno. Si reaparece en la corrida completa de la fase, investigarlo (carrera con el retraso del stub o límite de Neon Auth) antes de dar la fase por cerrada.
- 2026-10-25 (segunda pasada): T079 y T080 hechas; T078 verificada en navegador y marcada. Batería completa en verde
  (914 unit + nuxt, 85 e2e con el escenario 13 incluido, cobertura sin cambios). Siguen abiertas T074 (escenarios con
  sesión de editor: 3, 4 y la parte de Pendientes del 9; y OpenAI real), T075 (la persona la hará con sus 20 fotos) y
  T076 (pasos de despliegue que hace la persona).
- 2026-10-25 (tercera pasada): con la cuenta de QA «QA Editor 002» (`qa+feature002@cloudy.test`, editor, aprobada por la
  persona) se recorrieron en navegador los escenarios 3, 4 y 9 (Pendientes): todo en verde (detalle en quickstart §6).
  De T074 solo queda la pasada con OpenAI real (`NUXT_OPENAI_APIKEY` está vacía en desarrollo).
- Hallazgos fuera del alcance de la feature: `paisaje.jpg` no es una imagen sin texto para un proveedor real (tiene el
  logotipo «PEQUEÑOS HÉROES»); la miniatura de una HEIC en Pendientes se ve rota (`SubmissionCard.vue:68`, feature 001).
- Datos de QA en desarrollo para que la persona los limpie desde la UI: el envío de «QA feature 002» en Pendientes, la
  carpeta «QA 002 202610260530» (`nota.heic`, `paisaje.jpg`, `degradado.jpg`) y la cuenta de QA.

## [x] I1 — La spec no menciona el respaldo con Gemini *(resuelto 2026-10-24)*

- **Problema**: `spec.md` habla de "el servicio de lectura" en singular, y FR-019 dice que solo se le envía la
  imagen. El plan, `AGENTS.md` y `server/ai/providers/candidates.ts` mandan la imagen a Google Gemini cuando
  OpenAI no tiene clave o falla. La decisión ya está tomada, pero no consta en la spec.
- **Arreglo**: añadir en Clarifications "OpenAI principal; Gemini de respaldo ante falta de clave o cualquier
  fallo; con `NUXT_GOOGLE_APIKEY` vacía no hay respaldo" y cambiar FR-019 a "los servicios de lectura".

## [x] D1 — Privacidad del texto de invitados (constitución, "Privacidad") *(resuelto 2026-10-24)*

- **Problema**: la constitución dice que no se guardan datos personales de invitados más allá de su nombre y
  nota. El texto extraído puede traer nombres y datos de salud de terceros (p. ej. "David, oración por mi primo
  que se siente mal"). Se guarda en `guest_submission_files.text_content` y se envía a OpenAI o Google.
- **Por qué no es crítico**: el texto ya estaba en la imagen que el invitado envió y se borra con ella al
  rechazar o caducar (FR-010). Ese argumento solo vive en el Constitution Check de `plan.md`.
- **Arreglo**: añadir a Assumptions de `spec.md`: "el texto extraído es contenido del archivo enviado, no un dato
  nuevo del invitado; sigue el mismo ciclo de vida que la imagen".

## [x] I2 — FR-006 contradice la UI con `invalid_input` *(resuelto 2026-10-24)*

- **Problema**: FR-006 exige poder reintentar toda extracción en error, pero
  `app/components/files/ImageTextPanel.vue:165` oculta Reintentar cuando el error es `invalid_input` y muestra
  `messages.imageText.failedPermanent` ("Descárgala y vuelve a subirla en JPG o PNG"). La UI es correcta
  (reintentar un objeto vacío o corrupto no sirve), y FR-021 ya pide indicar qué hacer.
- **Arreglo**: añadir a FR-006 "salvo cuando la entrada no es válida (FR-021), en cuyo caso se indica volver a
  subir la imagen".

## [x] A1 — "5 MB" es ambiguo *(resuelto 2026-10-24)*

- **Problema**: la spec dice "hasta 5 MB" y "exactamente 5 MB se lee"; el código usa
  `MAX_IMAGE_TEXT_BYTES = 5_242_880` (5 MiB). Quien lea 5 000 000 bytes esperaría otro límite.
- **Arreglo**: escribir "5 MB (5 242 880 bytes)" en FR-001, FR-021 y en el caso límite de Edge Cases.
