# Quickstart: validar la página Peticiones

Guía de ejecución y validación. El detalle de interfaces está en [contracts/api.md](./contracts/api.md) y [contracts/ui.md](./contracts/ui.md); las tablas en
[data-model.md](./data-model.md). Todo lo que toca bases de datos o gasta crédito pide permiso a la persona antes de ejecutarse (reglas del proyecto en `AGENTS.md`).

## 0. Prerrequisitos

- `bun install` (sin dependencias nuevas).
- `.env.development` con `NUXT_OPENROUTER_APIKEY` (solo para el *smoke* de § 5; sin clave la página responde «no disponible» y no llama a nadie).
- El preajuste `@preset/pray-requests-image-generation` creado en OpenRouter con un modelo de generación de imágenes y su *system prompt*.
- La plantilla en `server/assets/peticiones/plantilla.jpg` (JPEG de 1376×768, 702 KB) y declarada en
  `nitro.serverAssets` (`baseName: 'peticiones'`).
- Migración `0009` generada con `bun run db:generate` y aplicada con `bun run db:migrate` (**dos `CREATE INDEX`, no destructivos; se aplican a la rama de desarrollo solo con el visto bueno de la persona**; luego `db:migrate:test` para los e2e).

## 1. Calidad automática (en este orden)

```bash
bun run typecheck
bun run test:unit        # shared/prayers, prompt, generate, prayer-requests, prayer-images, architecture
bun run test:nuxt        # PrayerCard/Toolbar/SelectionBar/ResultCard, composables, página
bun run test:e2e         # test/e2e/peticiones.spec.ts (+ routes-guard) — deja ~5 min entre corridas que inician sesión mucho
bun run test:coverage    # umbral 92 % en sentencias, ramas, funciones y líneas
bun run build
```

Resultado esperado: todo en verde; los módulos nuevos ≥ 92 %.

## 2. Datos de prueba (rama de desarrollo)

1. Con `bun run dev`, abre `/upload` como invitado y envía **3 envíos** con 2–3 fotos de tarjetas escritas a mano cada uno (al menos una con letra poco legible).
2. En `/solicitudes` **aprueba** dos envíos y deja uno **por revisar** y, si quieres, rechaza otro.
3. Con la clave configurada, la IA transcribe las imágenes; sin clave quedarán «pendientes» (la página lo debe mostrar).

## 3. Escenarios de la spec (navegador, a 360 px y ≥ 1280 px, tema oscuro y claro)

Usa la skill `agent-browser`; revisa estados de carga/vacío/error, foco con teclado y errores de consola.

| # | Historia | Pasos | Resultado esperado |
|---|----------|-------|--------------------|
| 1 | US1 | Abrir `/peticiones` como editor | Tarjetas en rejilla (no tabla) **solo de envíos aprobados**; foto, texto, nombre, «Aprobada hace…», «Enviada el…». El envío por revisar **no** aparece |
| 2 | US1 | Marcar 3 tarjetas con clic, con la casilla y con Espacio; desmarcar una | Barra «2 peticiones → 1 imagen»; el estado se anuncia; abrir la foto no cambia la selección |
| 3 | US1 | Con > 12 peticiones, desplazarse al final | Se cargan más (skeleton en el sentinela), sin duplicados; la selección se conserva |
| 4 | US1 | Sin envíos aprobados / bloquear `GET /api/peticiones` | Estado vacío con **Ir a Solicitudes** y **Copiar enlace para invitados** / `ErrorState` con **Reintentar** |
| 5 | US3 | En una tarjeta con `[ilegible]`: **Corregir texto** → reemplazar → guardar | Diálogo con foto grande; la tarjeta pasa a «Editada» y pierde «Texto por corregir»; al recargar el texto sigue corregido |
| 6 | US2 | Elegir 5 → **Generar imágenes** → confirmar | Resumen «5 peticiones → 2 imágenes»; dos esqueletos con progreso; imagen 1 con 4 peticiones, imagen 2 con 1; cada una con **Descargar** |
| 7 | US2 | Con una petición con `[ilegible]` elegida | La confirmación avisa y ofrece **Generar de todos modos**; **Cancelar** deja corregir |
| 8 | US2 | Provocar un fallo (clave inválida o `NUXT_OPENROUTER_BASE_URL` apagado) y **Reintentar** | Mensaje por código; las demás imágenes no se pierden; **Reintentar** solo en esa |
| 9 | US2 | Generar y salir de la página sin descargar | Confirmación al salir; al aceptar se liberan los `objectURL` |
| 10 | US4 | Buscar «oracion» (sin tilde) y un nombre; filtrar **Hoy**, **7 días**, **Rango**; cambiar el orden | Resultados correctos sin distinguir tildes; una petición enviada ayer y aprobada hoy aparece con **Hoy**; el orden sigue la aprobación; la selección no cambia |
| 11 | Seguridad | Sin sesión y con un usuario sin rol: `/peticiones`, `GET /api/peticiones`, `POST /api/peticiones/imagenes` | Redirección / `401` / `403` como el resto de rutas protegidas |

## 4. Rendimiento y presupuesto

- **JS inicial**: `bun run analyze` → informe en `.sonda/`; la ruta `/peticiones` ≤ 250 KB gzip y los `Lazy*` en chunks aparte (`PrayerResults`, `PrayerTextDialog`, `PrayerSelectionDialog`, `PrayerImagePreview`).
- **Web Vitals** (móvil, 4G simulado): LCP ≤ 2,5 s con 12 tarjetas (fotos diferidas hasta entrar al viewport), CLS ≤ 0,1 (cajas de proporción fija), INP ≤ 200 ms al marcar tarjetas.
- **Consulta** (SC-005/SC-006): con ~5 000 peticiones aprobadas en la **rama de pruebas** (carga que ejecuta la persona en el editor SQL de Neon), `EXPLAIN (ANALYZE)` del listado con búsqueda, rango y cursor < 100 ms y la primera página + la siguiente dentro de los tiempos de SC-005 (2,5 s / 2 s).

### Resultados (T082, 2026-11-12)

Medido con `test/e2e/performance.spec.ts` (Chromium 360×740, 4G simulado de 9/1,5 Mbps y 170 ms, CPU ×4, sin caché, mediana de 3 cargas, 12
peticiones con una foto de prueba de 8 KB):

| Medida | Resultado | Presupuesto |
|--------|-----------|-------------|
| JS inicial de `/peticiones` (entrada + `modulepreload`, gzip) | **164 KB** en 32 módulos; `PrayerResults`, `PrayerTextDialog`, `PrayerSelectionDialog` y `PrayerImagePreview` van diferidos | ≤ 250 KB ✅ |
| LCP sin fotos (texto y cajas de las tarjetas, SC-005) | **1,8 s** | ≤ 2,5 s ✅ |
| LCP con fotos (la primera foto es el LCP) | 3,2 s antes; **2,2–2,6 s** con la primera foto desde el SSR (`fetchpriority="high"`) + `preconnect` | Excepción aceptada (plan.md, Complexity Tracking) |
| CLS | **0** | ≤ 0,1 ✅ |

Con fotos reales de 3–5 MB el LCP con fotos queda por encima de 2,5 s (≈ 3–4 s por foto en 4G); la persona aceptó la excepción y pospuso las
miniaturas.

### Carga y `EXPLAIN` (T083) — solo en la rama de **pruebas**, la ejecuta la persona

La carga solo inserta. No hace falta limpiarla: `bun run test:e2e` vacía la rama de pruebas al arrancar (`test/e2e/setup/global-setup.ts`).

```sql
-- 1) ~5 000 peticiones aprobadas en los últimos ~3,5 días (una por minuto), con texto «oración» y nota en 1 de cada 3.
WITH s AS (
  INSERT INTO guest_submissions (sender_name, note, status, sender_key, created_at, completed_at, reviewed_at)
  SELECT 'Invitado ' || g, CASE WHEN g % 3 = 0 THEN 'Nota ' || g END, 'approved', 'perf-load',
         now() - make_interval(mins => g) - interval '1 hour', now() - make_interval(mins => g) - interval '1 hour',
         now() - make_interval(mins => g)
  FROM generate_series(1, 5000) AS g
  RETURNING id, sender_name
)
INSERT INTO files (name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, guest_name,
                   submission_id, text_status, text_content, text_read_at)
SELECT 'perf-' || s.id || '.jpg', 'jpg', 'image/jpeg', 'image', 3000000, 'perf/' || s.id, 'ready', 'guest', s.sender_name,
       s.id, 'ready', 'Oremos por la familia de ' || s.sender_name || ', por su salud y su trabajo. Gracias por la oración.', now()
FROM s;
ANALYZE guest_submissions;
ANALYZE files;

-- 2) El listado tal como lo arma `listPrayerRequests` (orden desc): búsqueda sin tildes + rango de 7 días + cursor a mitad.
EXPLAIN (ANALYZE, BUFFERS)
SELECT f.id, f.name, f.text_status, f.text_content, f.text_error, f.text_started_at, f.text_read_at, f.text_edited_at,
       (SELECT p.name FROM profiles p WHERE p.user_id = f.text_edited_by), gs.sender_name, gs.note, gs.created_at, gs.reviewed_at
FROM files f
JOIN guest_submissions gs ON gs.id = f.submission_id
WHERE gs.status = 'approved' AND f.category = 'image' AND f.upload_status = 'ready' AND f.deleted_at IS NULL
  AND gs.reviewed_at >= now() - interval '7 days' AND gs.reviewed_at < now() + interval '1 day'
  AND translate(lower(gs.sender_name || ' ' || coalesce(gs.note, '') || ' ' || coalesce(f.text_content, '')), 'áéíóúüñ', 'aeiouun')
      LIKE '%oracion%' ESCAPE '\'
  AND (date_trunc('milliseconds', gs.reviewed_at), f.id) < (now() - interval '2 days', 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
ORDER BY date_trunc('milliseconds', gs.reviewed_at) DESC, f.id DESC
LIMIT 13;

-- 3) Primera página sin filtros (lo que pide la página al abrir).
EXPLAIN (ANALYZE, BUFFERS)
SELECT f.id, gs.reviewed_at
FROM files f
JOIN guest_submissions gs ON gs.id = f.submission_id
WHERE gs.status = 'approved' AND f.category = 'image' AND f.upload_status = 'ready' AND f.deleted_at IS NULL
ORDER BY date_trunc('milliseconds', gs.reviewed_at) DESC, f.id DESC
LIMIT 13;
```

**Resultado (T083, 2026-11-12, rama de pruebas, con 50 peticiones de carga en lugar de 5 000 por decisión de la persona; ~125 aprobadas en total):**
listado filtrado (búsqueda + rango + cursor) **0,42 ms** de ejecución y primera página **0,21 ms** (objetivo < 100 ms ✅). El JOIN usa
`files_submission_idx` (Index Scan + Merge Join) y el orden es un `top-N heapsort` en memoria (30 kB). Con tan pocas filas el planificador lee
`guest_submissions` por *seq scan* en vez de `guest_submissions_status_reviewed_idx` (es lo esperado por debajo de unas cientos de filas); con
volumen real conviene repetir el `EXPLAIN`.

Objetivo: < 100 ms en las dos y que el plan use `guest_submissions_status_reviewed_idx` (filtro por estado/fecha) y `files_submission_idx` (el
JOIN). A tener en cuenta al leerlo: el orden es sobre `date_trunc('milliseconds', reviewed_at)`, que el planificador no puede tomar del índice, así que
habrá un `Sort` (top-N) sobre las filas que pasan el filtro. Con 5 000 filas debería seguir por debajo del objetivo; si no, se reporta antes de tocar
índices o la consulta (`date_trunc` sobre `timestamptz` es `STABLE`, así que no admite un índice de expresión: la alternativa sería ordenar por
`reviewed_at` y truncar solo el cursor).

## 5. *Smoke* real contra OpenRouter (cuesta crédito; solo con permiso)

1. `bun run dev` con la clave real; elige 1 petición y genera.
2. Verifica que **el modelo devuelve imagen** (`result.files`) con el preajuste y `modalities: ['image','text']`, que el texto bajo el título coincide con la transcripción y que el diseño de la plantilla (título, árboles, sol, nubes y camino) no cambió.
3. Anota el **tamaño en bytes** de la imagen: debe ser < 4 000 000 (`PRAYER_IMAGE_MAX_BYTES`). Repite 3 veces; si pasa de 4 MB de forma sistemática, ver research D12.
4. Con 5 peticiones, comprueba que cada imagen lleva como máximo 4 párrafos y que la quinta abre la segunda imagen (SC-002/SC-003). SC-002 se mide revisando 20 imágenes.
5. Repite en un **preview de Vercel** (límite de respuesta de 4,5 MB, plazo de 120 s, plantilla empaquetada como *server asset*).

### Resultados (T088 y T088b, 2026-11-12, con permiso de la persona)

**T088 — *smoke* por la app** (`bun run dev`, clave nueva de OpenRouter): 1 petición × 3 → 200, `image/jpeg`, **163 353 / 156 585 / 149 543 bytes**,
6–8 s; 5 peticiones → «5 peticiones → 2 imágenes», respuestas con `X-Peticiones-Count` 4 y 1, **187 254 / 155 263 bytes**, 8 s (todas
< 4 000 000). El texto salió exacto en las 5 imágenes. Quitar nubes y pájaros lo pide el preajuste (y lo hizo de forma desigual: dos imágenes dejaron
nubes); fallos reales: una bolita amarilla añadida y, en la de 4 peticiones, el título recortado a «Peticiones» (sin «de oración»). Preview de Vercel: no ejecutado (sin despliegue en esta
sesión).

**T088b — fidelidad (SC-002), 20 imágenes** por el mismo camino que `generate.ts` (preset + `modalities` + prompt + plantilla), 1–4 peticiones por
imagen, con tildes, ñ/ü, ¿¡, emojis y un texto largo de ~210 caracteres. Las 20 se generaron (145–228 KB, 3–8 s), con el orden y el reparto bien.
Revisión a mano:

| Criterio | Resultado | Fallos |
|----------|-----------|--------|
| Texto completo, sin palabras cambiadas, omitidas ni añadidas | **13/20 (65 %)** | palabra repetida (2, 5, 20: «por por», «iglesia iglesia», «cumple cumple»), palabras fusionadas o deformadas (3: «Perdierosu casaen»), errata (9: «dessanimado»), palabras omitidas (4, 13: «le dé», «cada») |
| Plantilla según el preajuste (el preajuste **quita a propósito** nubes y pájaros; se conservan título, sol, árboles y colinas) | **15/20** | 1 deja las nubes; en 4, 9, 13 y 18 el texto pisa el título, un árbol o las colinas |
| Ambos criterios en la misma imagen | **11/20 (55 %)** | |

**SC-002 no se cumple** (criterio: ≥ 18/20). Corrección: una primera lectura contó como fallo la falta de nubes y pájaros, pero eso lo pide el
*system prompt* del preajuste. Los errores de texto caen **en los saltos de línea** (la última palabra de una línea se repite al empezar la
siguiente: «por / por», «iglesia / iglesia», «cumple / cumple») y en los textos largos, que además desbordan el área porque el preajuste prohibía
reducir la letra. Según T088b se reportó antes de tocar el preajuste: la persona pidió mejorarlo y la nueva versión se pegó en
el preajuste de OpenRouter (texto palabra por palabra sin repetir en los saltos, área de texto en porcentajes, reducción uniforme de la letra si no
cabe, una sola imagen por llamada sin numeración, sin viñeta con 1 petición).

**Repetición con el preajuste nuevo y la instrucción de `prompt.ts` alineada (mismo día, mismas 20 entradas):** 20/20 generadas (148–221 KB,
3–8 s). Texto exacto **13/20** (palabra repetida en el salto de línea en 2 y 6; fragmento suelto en 3; el texto largo pierde o deforma palabras
en 4, 9 y 13; en 16 el modelo **añadió numeración** «1) 2)…», probablemente por mencionar «sus números» en la instrucción); diseño correcto
**13/20** (texto largo sobre el título o los árboles en 4, 9 y 13; título recortado a «Peticiones» en 17; nubes sin quitar en 13 y 18; texto
contra los árboles en 15 y 20); **ambos 9/20 (45 %)** frente a 11/20 de la primera corrida. **SC-002 sigue sin cumplirse.** Las peticiones
largas (~210 caracteres) fallan en las dos corridas; los demás fallos varían al azar entre corridas, así que el ajuste del prompt no converge
hacia el 90 %.

**Tercera corrida — modelo nuevo en el preajuste (cambiado por la persona) + etiquetas `<peticion>` sin número (mismo día, mismas 20
entradas):** 20/20 generadas, `image/jpeg` 1376×768, **690–780 KB** (≈ 4 veces más que el modelo anterior, muy por debajo de 4 000 000) en
**8–27 s** (antes 3–8 s; dentro del tope de 105 s del servidor). Texto exacto **20/20**, incluido el texto largo en las cuatro imágenes que lo
llevan (4, 9, 13, 18), sin palabras repetidas, fusionadas ni numeración; cielo despejado y título, sol, árboles y colinas intactos en las 20.
Diseño correcto **19/20**: en 13 una línea del texto largo roza el follaje del árbol derecho (en 17 y 18 el texto queda muy cerca del borde de un
árbol sin taparlo). **Ambos 19/20 (95 %) → SC-002 se cumple** (criterio ≥ 18/20). La letra se ve más tipográfica que modelada en plastilina.
Crédito total del día: 68 generaciones y 2 lecturas de texto (más 4 llamadas fallidas con la clave anterior). Crédito: 28 generaciones (8 del *smoke* + 20) y
2 lecturas de texto, más 4 llamadas fallidas con la clave anterior.

## 6. Definición de terminado (por fase y al final)

Orden fijo (`AGENTS.md`): `typecheck` → pruebas que cubren el cambio → **verificación en navegador al final** (§ 3) → informe de lo ejecutado antes de marcar tareas en `tasks.md`. Los pasos omitidos se declaran con su motivo.
