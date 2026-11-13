# Quickstart: validar la página Canciones

Guía de validación de extremo a extremo (no incluye código de implementación). Contratos: [api.md](./contracts/api.md) · [ui.md](./contracts/ui.md) · modelo: [data-model.md](./data-model.md).

## 0. Requisitos

| Qué | Cómo |
|-----|------|
| Servicio de presentaciones local | `cloudy-api` corriendo en `http://localhost:8000` (`/docs` abre su OpenAPI) con la clave del `.env` del servicio |
| Variables de desarrollo (`.env.development`) | `NUXT_CLOUDY_API_URL=http://localhost:8000`, `NUXT_CLOUDY_API_KEY=<clave del servicio>`, `NUXT_APIFY_API_KEY=<token de Apify>`; `NUXT_APIFY_BASE_URL` vacío (Apify real). **Nunca imprimir ni versionar los valores** |
| Migración | `bun run db:migrate` (rama `development`); `bun run db:migrate:test` para e2e. La persona las aplica a cada rama |
| Un rastreo real cuesta crédito | Usar pocas canciones en las pruebas manuales; los e2e usan stubs |
| MCP de Apify | Habilitar `apify-webcrawler` (`.mcp.json`) para cerrar los «(verificar)» de [research D2](./research.md) antes de implementar `lyrics-crawler.ts` |

## 1. Tarea 0 — fixtures reales (bloquea el parser)

1. Con el actor (MCP o consola de Apify) rastrear `https://www.letras.com/musiko/de-buenas-part-josh-gamez/` con las opciones de D2 y guardar el `html` del item en `test/unit/fixtures/letras-song.html`.
2. Rastrear una página sin letra (por ejemplo la de un artista) y guardarla en `letras-no-lyrics.html`.
3. Confirmar en el fixture: contenedor `lyric-original`, forma de estrofas/líneas, `<h1>`, lugar del artista, nombres de campos del item (`crawl.httpStatusCode`, `metadata.title`, `html`).
4. Ajustar [research D4](./research.md) si la estructura difiere; solo entonces escribir `lyrics-parser.ts`.

## 2. Escenario US1 — enlace → letra (Fase 1) · 360 px y ≥ 1280 px, tema oscuro y claro

1. `bun run dev` → entrar como editor → **Canciones** en la barra lateral.
2. Pegar `https://www.letras.com/musiko/de-buenas-part-josh-gamez/` → el campo muestra «Buscando la letra…» → llega a `/canciones/<id>`: metadatos, botones y **letra por estrofas** (en ese orden), historial reciente debajo.
3. Volver y pegar el mismo enlace con `?utm_source=x` y sin `www.`: abre **la misma** canción al instante, sin rastreo (comprobar en la consola de Apify que no hay un run nuevo).
4. Rechazos **antes de cualquier petición** (red del navegador sin `POST /api/songs/fetch` y sin runs): `http://www.letras.com/a/b/`, `https://letras.com.evil.test/a/b/`, `https://letras.com@evil.test/a/b/`,
   `https://example.com`, texto libre, `https://www.letras.com/musiko/` (sin canción).
5. Página sin letra (enlace de Letras inexistente): «No encontramos una letra en ese enlace»; no queda canción en el historial.
6. **Volver a obtener la letra** → confirma → letra reemplazada y `updated_at` nuevo.

## 3. Escenario US2 — generar la presentación (Fase 2)

1. En la ficha, junto a **Generar presentación**, se lee «La letra va en blanco: proyecta la presentación sobre un fondo oscuro.» → **Generar presentación** → progreso → descarga `<Título>.pptx` (con tildes bien) → aviso «N diapositivas generadas».
2. Abrir el archivo en PowerPoint y aplicar un fondo oscuro: letra repartida en diapositivas, texto blanco, sin relleno de fondo.
3. Doble clic rápido en **Generar**: una sola solicitud (red del navegador).
4. Reparto de respaldo: apagar o romper la IA del servicio (o usar el escenario `fallback` del stub) → se descarga igual y aparece la nota.
5. Servicio dormido: esperar 15 min o detener el servicio, recargar `/canciones` (banner «Despertando…»), generar → termina dentro de 90 s o muestra **Reintentar**.
6. `422`: generar una canción de más de 300 líneas (stub `muy-larga`) → mensaje «Eso no parece una canción» sin **Reintentar**.

## 4. Escenarios US3 y US4

- **Colecciones**: con la fila vacía, **Nueva colección** crea una colección sin canciones → aviso; crear colección desde la ficha → aviso; segunda canción a la misma colección; repetir agrega «ya estaba»; desde otra cuenta del equipo se ve con su autor; un editor ajeno no puede renombrar ni
  eliminar (y sí agregar/quitar); administrador sí. Botón de generar de la tarjeta: hover y foco en escritorio, siempre visible en móvil; dice cuántos archivos llegan; una canción con fallo no detiene las demás.
- **Historial**: obtener 3 canciones → aparecen la más reciente primero; marcar las 3 → barra con conteo y **Generar selección** → 3 `.pptx`, uno a la vez; quitar una entrada no la saca de su colección;
  «Cargar más» con > 24.
- **Vacíos y errores**: colecciones e historial vacíos; `NUXT_APIFY_API_KEY` vacía → «El rastreo de letras no está configurado» y las canciones guardadas siguen funcionando; consola sin errores; teclado y foco visibles.

## 5. Pruebas automáticas y calidad

```bash
bun run typecheck
bun run test:unit                 # parser, url, crawler, cloudy-api, endpoints, keyset, guards, arquitectura
bun run test:nuxt                 # componentes, composable de la cola, páginas, form-schemas
bun run test:e2e                  # stubs de Apify y cloudy-api (.env.test)
bun run test:coverage             # gate global 92 %
bun run build                     # y revisar el peso por ruta (≤ 250 KB gzip)
```

**Meta de calidad de la feature (≥ 92 % por archivo nuevo)**: tras `test:coverage`, revisar en el reporte que cada archivo nuevo cumpla sentencias, ramas, funciones y líneas ≥ 92 %: `lyrics-parser.ts`,
`lyrics-crawler.ts`, `songs.ts`, `song-collections.ts`, `shared/validation/songs.ts`, `shared/constants/songs.ts`, `createLyricsPptx` en `cloudy-api.ts`, los `Song*` y `useSong*`. Si alguno baja, se agregan pruebas;
no se baja el umbral ni se excluyen archivos.

Reglas verificadas por pruebas: `endpoint-guards.spec.ts` (13 endpoints con `requireRole(event, 'editor')`), `architecture.spec.ts` (SDK y claves solo en sus módulos), `route-access.spec.ts` (rutas privadas),
`form-schemas.spec.ts` (paridad con `shared/validation`), `permissions.spec.ts` (`songs.moderate`).

## 6. Despliegue y operación

- **Variables en Vercel**: `NUXT_APIFY_API_KEY`, `NUXT_CLOUDY_API_URL`, `NUXT_CLOUDY_API_KEY` (y `NUXT_APIFY_BASE_URL` vacía). Sin ellas la página responde «no configurado», no se rompe el resto.
- **Duración de las funciones** (D15): máximo del proyecto confirmado por la persona el 2026-11-05: **300 s** (pasado, `504 FUNCTION_INVOCATION_TIMEOUT`). T005 fija `maxDuration = 120` s para
  `/api/songs/fetch`, `/refresh` y `/pptx` y anota aquí cómo quedó configurado: **`nitro.vercel.functions.maxDuration = 120`** en `nuxt.config.ts` (el preset `vercel` de Nitro copia `vercel.functions` a la configuración de la función del servidor, que atiende todas las rutas).
- **Medición del rastreo real** (T003, 2026-11-05: tres rastreos de ~20–22 s y ~0,0018 USD cada uno; queda al borde de SC-002 y el endpoint suma poco a eso): tiempo típico del actor para Letras (objetivo < 20 s, SC-002) y crédito consumido por canción; si excede, ajustar `requestTimeoutSecs`/`waitSecs` o evaluar D15 (trabajo asíncrono).
- **Lote de presentaciones** (`POST /api/songs/presentations`): `CLOUDY_API_TIMEOUTS.pptxBatch = 110 s` supone que cloudy-api reparte con el LLM bajo un solo plazo de 45 s por lote
  (`LYRICS_BATCH_DEADLINE_SECONDS` en Railway). Ese valor debe quedarse en ≤ ~50 s; si sube, revisar los 110 s y los 120 s de la función.
- **Presupuesto**: `bun run analyze` y revisar que `/canciones` y `/canciones/[id]` no superen 250 KB gzip de JS inicial.
- **Credenciales**: en el navegador (pestaña Red y bundle) no debe aparecer ninguna clave (SC-010).

## 7. Definición de terminado por fase

Cada fase del futuro `tasks.md` termina con: typecheck → pruebas de la fase → **verificación en navegador al final** (`agent-browser`, 360 px y ≥ 1280 px, temas oscuro y claro, cuatro estados, foco y consola) con
datos de `.env.development` y sin pasos destructivos → informe de lo ejecutado antes de marcar la fase.
