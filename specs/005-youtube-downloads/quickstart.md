# Quickstart: validar la página YouTube

**Feature**: [spec.md](./spec.md) · **Contratos**: [api.md](./contracts/api.md), [ui.md](./contracts/ui.md) · **Modelo**: [data-model.md](./data-model.md)

Guía de validación de extremo a extremo. Solo usa datos de `.env.development` en el navegador y la rama de pruebas en e2e; no ejecuta pasos destructivos.

## 0. Requisitos

- Variables en `.env.development`, `.env.test` y `.env` (nombres, sin valores; ver research D16):
  `NUXT_CLOUDY_API_URL` (`http://localhost:8000` en local, `https://<servicio>.onrender.com` en Render) y `NUXT_CLOUDY_API_KEY` (la misma `API_KEY` del servicio).
  Corregir antes `.env.example`: hoy dice `NUXT_CLOUDY_APIURL`.
- Migración aplicada a la rama de desarrollo y a la de pruebas: `bun run db:migrate` y `bun run db:migrate:test` (la persona las ejecuta).
- Servicio local para el modo "real" (§4): en `C:\Users\andre.perez\Dev\cloudy-api`, `bun run dev` (necesita `uv`, ffmpeg y Node/deno; ver su README). Para el resto
  no hace falta: los e2e usan el stub.

## 1. Automatizadas (cada fase, en este orden)

```bash
bun run typecheck
bun run test:unit      # parseYoutubeUrl, validadores, cloudy-api (fetch simulado), historial/listas, permisos, guards, architecture
bun run test:nuxt      # YoutubeUrlInput, YoutubePlayer, YoutubeHistoryList, YoutubePlaylistCard, bandeja, schemas
bun run test:e2e       # test/e2e/youtube-*.spec.ts contra el stub del servicio (sin YouTube ni Render)
bun run test:coverage  # umbral del proyecto: 92 %
```

## 2. Escenarios por historia (navegador, `bun run dev`, 360 px y ≥ 1280 px, tema oscuro y claro)

Cada fila es la **Independent Test** de su historia; pasar `agent-browser` con el stub (`NUXT_CLOUDY_API_URL` apuntando a él) o con el servicio real.

| # | Historia | Pasos | Resultado esperado |
|---|----------|-------|--------------------|
| 1 | US1 | Iniciar sesión como editor → **YouTube** → pegar `https://youtu.be/<id>?t=30` → **Ver video** | abre `/youtube/<id>`; título, canal, duración y miniatura visibles; sin errores de consola |
| 2 | US1 | Pegar `hola`, luego un enlace `.../playlist?list=…` | el campo muestra el mensaje de cada caso y no navega |
| 3 | US1 | **Descargar → Audio MP3** | bandeja con avance → termina → el navegador baja `<título>.mp3`; toast "Tu archivo está listo" |
| 4 | US1 | **Descargar → Video 720p** | baja un MP4; si ya había copia de reproducción lista, no se crea otro trabajo (§ Red). Con el stub, **Video 1080p** sobre `lowResVid01` baja el archivo y la bandeja muestra "Entregado en 480p" |
| 5 | US1 | Abrir un video privado / muy largo / en vivo (stub: `privateVid1`, `tooLongVid1`, `liveVideo01`) | datos disponibles, **Descargar** deshabilitado y motivo en español |
| 6 | US1 | Detener el servicio (o stub `down`) y abrir la página | `YoutubeServiceBanner` "Despertando…" con **Reintentar** en < 1 s (SC-002); al volver, se recupera sola, sin recargar, en ≤ 5 s (SC-010) |
| 7 | US1 | Salir de sesión y abrir `/youtube` y `/youtube/<id>`; repetir con un usuario `pending` | redirige a `/login?redirect=…` y a `/pendiente` |
| 8 | US2 | En un video, **Crear lista** → nombre → confirmar | toast; la lista aparece en `/youtube` con autor |
| 9 | US2 | Con otra cuenta de editor, abrir `/youtube` | ve la lista con el nombre del autor; **no** puede renombrar/eliminar (403 en la API; el menú no lo ofrece); sí agrega y quita videos |
| 10 | US2 | Agregar el mismo video dos veces | "Ya estaba en la lista", sin duplicado |
| 11 | US2 | En escritorio, pasar el cursor y tabular sobre una lista; en 360 px mirar la tarjeta | el botón **Descargar lista** aparece con hover y con foco; en móvil está siempre visible |
| 12 | US2 | Descargar una lista de 3 videos / una de 12 | un `.zip` / dos `.zip` ("lote 1 de 2", "lote 2 de 2"); con un video no disponible, el `.zip` trae los demás y la bandeja lista el fallido |
| 13 | US3 | Abrir tres videos distintos y volver a `/youtube` | los tres en el historial, el último arriba con tu nombre y "hace N" |
| 14 | US3 | Marcar los tres → **Descargar selección** (MP3) | barra "3 seleccionados"; un `.zip` con 3 pistas; **Limpiar** deja la barra oculta |
| 15 | US3 | Quitar una entrada del historial | confirma, desaparece; si estaba en una lista, la lista la conserva |
| 16 | US4 | En un video, **Reproducir** → esperar → **Pantalla completa** → `Esc` | prepara con progreso, reproduce, ocupa la pantalla y sale con `Esc` |
| 17 | US4 | **Abrir en ventana nueva** | ventana separada con `/youtube/<id>/ventana?job=…`, reproduce desde 0; con trabajo expirado ofrece **Preparar de nuevo** |
| 18 | US4 | Teclado solamente en el reproductor | Espacio, ←/→, ↑/↓ y `F` funcionan; todos los botones tienen nombre accesible |

## 3. Verificación de rendimiento y accesibilidad

- `bun run analyze`: ninguna ruta de la feature supera 250 KB gzip de JS inicial; el reproductor y la bandeja salen en trozos diferidos.
- Historial con 5 000 filas (se siembra en la rama de pruebas con el script de e2e): la primera página en < 2 s (SC-007); marcar casillas < 200 ms de INP.
- Lighthouse/axe en `/youtube` y `/youtube/:id` en ambos temas: contraste ≥ 4.5:1, foco visible, sin `text-warning` sobre `base-100` claro.
- A 360 px: sin scroll horizontal de página; todos los objetivos táctiles ≥ 44 px.

## 4. Modo "real" (una vez, antes de integrar)

Con el servicio local o el de Render y un video corto público (<5 min) elegido por la persona:

1. `GET {servicio}/healthz` → `status: "ok"`.
2. Escenarios 1, 3, 4, 12 (lista de 2–3 videos cortos) y 16 sin stub.
3. **Red**: en la pestaña Network, confirmar que el navegador llama a `{servicio}/v1/jobs/<id>/file?...` directamente y que **ninguna** petición del navegador lleva
   `X-API-Key` (SC-009); y que los bytes del MP4/MP3 no pasan por `/api/youtube/**` (FR-030).
4. **Duración de la función de Vercel** (research D8): en un despliegue de vista previa, crear un lote de 10 videos cortos y comprobar que `POST /api/youtube/jobs` responde dentro del
   tiempo máximo de la función; si no, bajar `YOUTUBE_MAX_BATCH` (`shared/constants/youtube.ts`).
5. **Tiempos** (con el servicio despierto): cronometrar SC-001 (video de 5 min: pegar → archivo en < 2 min, en ≤ 3 clics) y SC-002 (título, canal y miniatura en < 3 s) y anotar los resultados en § 6.

## 5. Despliegue

- Vercel: definir `NUXT_CLOUDY_API_URL` y `NUXT_CLOUDY_API_KEY` por entorno (no hay archivos `.env`). `ALLOWED_ORIGINS` del servicio no cambia para esta feature (no hay `fetch` entre orígenes).
- Render: el servicio ya existe (`render.yaml`); confirmar `API_KEY` igual a `NUXT_CLOUDY_API_KEY`.
- Después de `main`: la limpieza diaria (`/api/cron/cleanup`) ya incluye el borrado de videos huérfanos.

## 6. Resultados

Se completa al implementar (T076, T080). Registrar fecha, entorno (stub o servicio real) y número medido.

**2026-11-03 · `bun run build` / `bun run analyze` (T076)**: la feature suma trozos pequeños y diferidos. Página `/youtube` 4,6 KB gzip;
`YoutubePlayer` 3,4 KB, `YoutubePlaylistDialog` 3,3 KB y `YoutubeDownloadTray` 2,5 KB, cada uno en su propio trozo `Lazy*` (no van en el JS
inicial); el layout `dashboard` carga 1,9 KB gzip compartidos (estado de las descargas). El total inicial por ruta se mide con `.sonda/` y en el
navegador (pestaña Network) durante la verificación de la fase.

| Medición | Meta | Resultado |
|----------|------|-----------|
| JS inicial de `/youtube` (gzip) | ≤ 250 KB | La feature agrega ≈ 6,5 KB gzip (página 4,6 + layout 1,9) al JS inicial; total por ruta: _pendiente de la verificación en navegador_ |
| JS inicial de `/youtube/<id>` (gzip) | ≤ 250 KB | Reproductor diferido; total por ruta: _pendiente de la verificación en navegador_ |
| CLS de `/youtube` y `/youtube/<id>` | ≤ 0,1 | _pendiente_ |
| Historial con 5 000 filas: primer bloque (SC-007) | < 2 s | _pendiente_ |
| Ficha del video con servicio despierto (SC-002) | < 3 s | _pendiente_ |
| Pegar enlace → archivo, video de 5 min (SC-001) | < 2 min | _pendiente_ |
| `POST /api/youtube/jobs` con 10 videos en Vercel (D8) | dentro del plazo de la función | _pendiente_ |
