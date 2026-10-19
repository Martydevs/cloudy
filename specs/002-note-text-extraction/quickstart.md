# Quickstart: validar la extracción del texto de imágenes

Es una guía para comprobar la feature de punta a punta. Los detalles están en
[contracts/api.md](./contracts/api.md), [contracts/ui.md](./contracts/ui.md) y
[data-model.md](./data-model.md).

## 1. Prerrequisitos

- Haber completado la configuración de la feature 001 (`specs/001-shared-media-drive/quickstart.md`).
- En `.env.development` y `.env` (y en Vercel, por entorno), las variables `NUXT_OPENAI_APIKEY`,
  `NUXT_OPENAI_ORG` y `NUXT_OPENAI_PROJ`.
- En `.env.test`, apuntar `NUXT_OPENAI_BASE_URL` al stub (lo pone `global-setup.ts`) y dejar
  `NUXT_OPENAI_APIKEY` con un valor ficticio.
- Fixtures en `test/fixtures/files/`:
  - `nota.jpg`, una nota legible con el logotipo de Skykids;
  - `nota.png`;
  - `nota.heic`, una foto real de iPhone de menos de 5 MB, sin datos personales;
  - `paisaje.jpg`, sin texto;
  - `grande.jpg`, de más de 5 MB;
  - y los `imagen.webp` y `anim.gif` que ya existen.

## 2. Instalación y migración

```bash
bun install                  # sin dependencias nuevas (ai, @ai-sdk/openai, zod y heic-to ya están declaradas)
bun run db:generate          # migración: enum image_text_status, columnas text_*, file.text_edit, CHECK + índice trigram
bun run db:migrate           # rama de desarrollo
bun run db:migrate:test      # rama de pruebas
```

## 3. Pruebas automáticas

```bash
bun run typecheck
bun run test:unit        # server/ai (schemas, extract con MockLanguageModelV4, heic), image-text (reclamación y estados), endpoints
bun run test:nuxt        # ImageTextPanel: 6 estados, copiar, editar, confirmación al volver a leer
bun run test:e2e         # contra el stub de OpenAI: US1, US2, US3 y rutas protegidas
bun run test:coverage    # umbral del 92 % (incluye server/ai/**)
```

## 4. Escenarios manuales (`bun run dev`, datos de desarrollo, OpenAI real)

Verificar cada escenario a 360 px y a ≥ 1280 px, en tema oscuro y claro, con teclado y sin errores en consola.

| # | Pasos | Resultado esperado |
|---|-------|--------------------|
| 1 | Como editor, subir `nota.jpg` y abrir su vista previa | "Leyendo texto…" y, en menos de 30 s, el texto en su orden, sin "Skykids" |
| 2 | Cerrar y volver a abrir la misma vista previa | El texto aparece al instante, sin volver a leer (`text_attempts` sigue en 1) |
| 3 | Subir `nota.heic` (la cola muestra "Preparando…") y abrirla | No hay vista `<img>`, pero el panel muestra el texto; en DevTools, el chunk de `heic-to` solo se descargó al elegir la HEIC y existe el objeto `textsrc/<id>.jpg` |
| 3b | Abrir una HEIC subida antes de la feature | "No disponible para este archivo", sin botones |
| 4 | Abrir `paisaje.jpg` | "No se reconoció texto en esta imagen" |
| 5 | Abrir `grande.jpg`, `imagen.webp` y `anim.gif` | "No disponible para este archivo…", sin botones |
| 6 | Copiar el texto | Llega al portapapeles y aparece el toast |
| 7 | Editar una palabra y guardar; luego pulsar Volver a leer | Insignia "editado"; antes de leer de nuevo pide confirmación; aparece la entrada `file.text_edit` en Actividad |
| 8 | Con `NUXT_OPENAI_APIKEY` inválida, abrir una imagen nueva | Estado de error con Reintentar; la vista previa y la descarga siguen funcionando |
| 9 | Desde `/enviar` (sin sesión), enviar `nota.jpg` y `nota.heic` | Se ve el aviso de lectura automática; el botón muestra "Enviando… estamos leyendo tus notas" y la confirmación llega en menos de 40 s; en Pendientes el editor ya ve el texto de ambas |
| 9b | Enviar 20 imágenes desde `/enviar` | Confirmación en ≤ 40 s extra; las no leídas se leen al abrir el envío en Pendientes |
| 10 | Aprobar ese envío y abrir el archivo | El mismo texto, sin una lectura nueva |
| 11 | Rechazar otro envío con imagen | El archivo y su texto desaparecen (las filas ya no existen) |
| 12 | Buscar en la barra superior una palabra del texto de la nota | La imagen aparece con la insignia "En el texto"; tras enviarla a la papelera ya no aparece |
| 13 | Abrir la misma imagen nueva en dos pestañas a la vez | Una sola lectura (`text_attempts = 1`) y ambas pestañas muestran el texto |

## 5. Calidad del texto (SC-002, manual, antes de liberar)

Subir 20 fotos reales de notas adhesivas y peticiones de oración legibles (sin datos sensibles reales) y
compararlas con su transcripción a mano. El objetivo:

- al menos el 95 % de las palabras correctas;
- ninguna con "Skykids";
- las imágenes sin texto marcadas como vacías.

Anotar el resultado en este archivo, §6.

## 6. Resultado

_Pendiente de la implementación._
