# Verification Scorecard: Actualización en vivo sin sondeo

**Purpose**: Lista de verificación final de la feature 004. Se llena en Polish (T075); **cada fila se marca aprobada o fallida con su evidencia**.
**Regla de integración** (spec SC-010): 004 se integra a `main` solo con **≥ 90 % aprobadas (≥ 16 de 17)** y **cero fallos** en las filas 1–7 y en autorización.
**Feature**: [spec.md](../spec.md) · **Tareas**: [tasks.md](../tasks.md)

Estado: `[ ]` pendiente · `[x]` aprobada · `[!]` fallida (describir y corregir antes de integrar).

| # | Verificación | Cómo se comprueba | Tarea | Estado | Evidencia |
|---|--------------|-------------------|-------|--------|-----------|
| 1 | Typecheck | `bun run typecheck` sin errores | T072 | [ ] | |
| 2 | Build | `bun run build` sin errores | T071, T072 | [ ] | |
| 3 | `test:unit` | `bun run test:unit` en verde | T072 | [ ] | |
| 4 | `test:nuxt` | `bun run test:nuxt` en verde | T072 | [ ] | |
| 5 | `test:e2e` | `bun run test:e2e` en verde contra la rama de pruebas, también con los orígenes cerrados | T070, T072 | [ ] | |
| 6 | Umbral de cobertura | `bun run test:coverage` ≥ 92 % en sentencias, ramas, funciones y líneas (sin bajar el umbral) | T072 | [ ] | |
| 7 | Cobertura por archivo | Cada archivo nuevo ≥ 90 % por métrica en el informe por archivo | T072 | [ ] | |
| 8 | Peso por ruta | `bun run analyze`: cada ruta ≤ 250 KB gzip y `@neon/realtime/client` en un chunk diferido | T071 | [ ] | |
| 9 | Navegador, 360 px, oscuro | Escenarios 1–15 de `quickstart.md` | T073 | [ ] | |
| 10 | Navegador, 360 px, claro | Escenarios 1–15 de `quickstart.md` | T073 | [ ] | |
| 11 | Navegador, 1280 px, oscuro | Escenarios 1–15 de `quickstart.md` | T073 | [ ] | |
| 12 | Navegador, 1280 px, claro | Escenarios 1–15 de `quickstart.md` | T073 | [ ] | |
| 13 | Sin XHR repetido | Network: solo el WS y un POST ≈ cada 50 s (ninguna petición periódica corta) | T027, T073 | [ ] | |
| 14 | Sin renovación con la pestaña oculta | Network: 0 peticiones de mantenimiento con la pestaña oculta o sin conexión | T010, T073 | [ ] | |
| 15 | Cuatro estados | Conectando, vacío, error con reintento y contenido en cada vista en vivo, en ambos temas | T073 | [ ] | |
| 16 | Foco y consola | Foco visible, teclado completo y consola sin errores | T073 | [ ] | |
| 17 | Medición de cómputo | `development`, una pestaña quieta 30 min: de ≈ 1 800 s activos a ≤ ≈ 300–360 s (informar **ambos** números y las invocaciones de Vercel antes y después) | T004, T074 | [ ] | |

## Medición de cómputo (fila 17)

| Momento | `compute_time_seconds` | `active_time_seconds` | Invocaciones de Vercel (Functions → Invocations) |
|---------|------------------------|-----------------------|---------------------------------------------------|
| Antes (feature sin desplegar / inicio de la prueba) | | | |
| Después (30 min con una pestaña visible y quieta) | | | |
| Resultado de la puerta G1 (T004) | | | |

## Tiempos medidos (spec SC-001 a SC-003)

| Medida | Objetivo | Resultado |
|--------|----------|-----------|
| Solicitud o envío → pantalla del equipo | < 2 s (p95) | |
| Decisión del equipo → pantalla del invitado | < 2 s | |
| Comentario de otra persona → hilo | < 2 s | |

## Notas

- Autorización: cero fallos exigidos en las pruebas de guarda (SQL con `$1` y guarda de rol, 401 sin sesión, 409 con otra
  persona, cuenta sin rol sin filas, `pendingUsers` vacío para un editor).
- Si la fila 17 falla por la caché de sesión (research C2), documentar la decisión de la persona y, si retira SC-007, registrar
  que la verificación 17 se reemplaza por el conteo de invocaciones.
