# Quickstart: validar la página Peticiones

Guía de ejecución y validación. El detalle de interfaces está en [contracts/api.md](./contracts/api.md) y [contracts/ui.md](./contracts/ui.md); las tablas en
[data-model.md](./data-model.md). Todo lo que toca bases de datos o gasta crédito pide permiso a la persona antes de ejecutarse (reglas del proyecto en `AGENTS.md`).

## 0. Prerrequisitos

- `bun install` (sin dependencias nuevas).
- `.env.development` con `NUXT_OPENROUTER_APIKEY` (solo para el *smoke* de § 5; sin clave la página responde «no disponible» y no llama a nadie).
- El preajuste `@preset/pray-requests-image-generation` creado en OpenRouter con un modelo de generación de imágenes y su *system prompt*.
- La plantilla copiada a `server/assets/peticiones/plantilla.jpg` (origen: `/mnt/c/Users/workpc/Pictures/google-gemini-nano-banana-2.1-generated.jpg`) y declarada en
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

## 5. *Smoke* real contra OpenRouter (cuesta crédito; solo con permiso)

1. `bun run dev` con la clave real; elige 1 petición y genera.
2. Verifica que **el modelo devuelve imagen** (`result.files`) con el preajuste y `modalities: ['image','text']`, que el texto del pizarrón coincide con la transcripción y que el diseño de la plantilla (título, personajes) no cambió.
3. Anota el **tamaño en bytes** de la imagen: debe ser < 4 000 000 (`PRAYER_IMAGE_MAX_BYTES`). Repite 3 veces; si pasa de 4 MB de forma sistemática, ver research D12.
4. Con 5 peticiones, comprueba que cada imagen lleva como máximo 4 párrafos y que la quinta abre la segunda imagen (SC-002/SC-003). SC-002 se mide revisando 20 imágenes.
5. Repite en un **preview de Vercel** (límite de respuesta de 4,5 MB, plazo de 120 s, plantilla empaquetada como *server asset*).

## 6. Definición de terminado (por fase y al final)

Orden fijo (`AGENTS.md`): `typecheck` → pruebas que cubren el cambio → **verificación en navegador al final** (§ 3) → informe de lo ejecutado antes de marcar tareas en `tasks.md`. Los pasos omitidos se declaran con su motivo.
