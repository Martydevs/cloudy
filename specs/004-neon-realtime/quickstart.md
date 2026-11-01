# Quickstart: validar la actualización en vivo

**Feature**: [spec.md](./spec.md) · **Contratos**: [api.md](./contracts/api.md), [ui.md](./contracts/ui.md)

Guía de validación, no de implementación. Solo datos de `.env.development` (y `.env.test` para e2e); ningún paso destructivo.
Los comandos que cambian configuración de Neon o usan MCP de base de datos **se piden a la persona antes** (AGENTS.md, "Notes").

## 1. Preparación

```bash
bun install
bun run dev                 # http://localhost:3000 (carga .env.development)
```

Hace falta una cuenta editor (o admin) activa en desarrollo, una **segunda** sesión (otro navegador o ventana privada) para
un segundo miembro del equipo, y un navegador sin sesión para el invitado. Comprobar **sin imprimir valores** que
`NUXT_NEON_REALTIME_URL` de `.env.development` contiene `ep-wandering-base` y el de `.env.test`, `ep-rough-art`:

```bash
grep -c 'ep-wandering-base' .env.development     # debe imprimir 1
grep -c 'ep-rough-art' .env.test                 # debe imprimir 1
```

## 2. Pruebas automáticas

```bash
bun run typecheck
bun run test:unit           # constructores de consultas (guardas, sin now(), sin ;), selladores, rutas de sellado, middleware, imageTextOf, arquitectura
bun run test:nuxt           # useLiveQueries (renovación, pausa, 401/409, error→retry), useTeamLive (diff de ids), useGuestAccess, hilo y texto de imagen
bun run test:e2e            # team-live.spec, access-upload.spec, guest-queue.spec, comments.spec, image-text.spec, routes-guard.spec
bun run test:coverage       # umbral 92 %; además, cada archivo nuevo ≥ 90 % por métrica
bun run build
bun run analyze             # cada ruta ≤ 250 KB gzip; @neon/realtime/client en un chunk diferido
```

## 3. Escenarios manuales (navegador, 360 px y ≥ 1280 px, temas oscuro y claro)

Se cronometran con el reloj del navegador (DevTools → Network → WS/Fetch) y el tiempo medido se anota en el reporte de la fase.

| # | Escenario | Resultado esperado | Requisitos |
|---|-----------|--------------------|------------|
| 1 | Editor en Inicio; invitado en `/upload` pide acceso | En **< 2 s**: toast "{nombre} pide permiso…", badge de Solicitudes +1 y la solicitud arriba en `/solicitudes` | FR-001, SC-001 |
| 2 | Invitado completa un envío | En **< 2 s**: toast con nombre y n.º de archivos, badge +1, envío en Solicitudes | FR-001, SC-001 |
| 3 | Dos editores en Solicitudes; uno toca "Dar acceso" | En el otro, la solicitud sale en **< 2 s** sin recargar | FR-004 |
| 4 | En `/upload`, esperar la decisión | En **< 2 s** el invitado ve el formulario (aprobada) o el rechazo, con anuncio a lector de pantalla | FR-007, SC-002 |
| 5 | Dejar una solicitud 8 min sin atender | Sale de la pantalla y del contador a los 8 min, con el reloj del equipo adelantado y atrasado | FR-005 |
| 6 | DevTools → Network con Inicio visible 2 min | **Ninguna petición repetida cada pocos segundos**; solo el WS y un POST a `/api/realtime/team` ≈ cada 50 s | FR-016, SC-004 |
| 7 | Ocultar la pestaña 2 min y volver | **Ninguna renovación** mientras está oculta; al volver, los datos se ponen al día en < 1 s y se anuncia lo ocurrido fuera | FR-016, SC-005, FR-003 |
| 8 | Simular sin conexión (DevTools → Offline) y volver | Sin renovaciones offline; al volver, vuelve a `live` | FR-016 |
| 9 | Comentar desde el editor A en el mismo archivo que abre el B | En B aparece en **< 2 s**; en A aparece de inmediato y **no** se duplica | FR-011, SC-003 |
| 10 | Leer una imagen (E2E usa el stub; en dev, el preset real) | El panel pasa de "leyendo" al resultado sin peticiones repetidas y deja de seguir el estado | FR-014 |
| 11 | Cerrar sesión en otra pestaña y volver a la primera | La pestaña vieja se recarga **una sola vez** y no muestra datos de la sesión anterior | FR-018 |
| 12 | Quitar el rol a un editor (admin, en Usuarios) con su pestaña abierta | En ≤ 1 min deja de recibir datos nuevos | FR-006 |
| 13 | Vaciar `NUXT_NEON_REALTIME_SECRET` en un arranque local de prueba | Las pantallas en vivo muestran el banner/`ErrorState` con "Reintentar"; subir y decidir siguen funcionando | FR-019, edge cases |
| 14 | Contador de la barra lateral vs `GET /api/dashboard` en el mismo instante | Coinciden (`pendingCount + openAccessRequests`) | FR-021 |
| 15 | Teclado: Tab hasta "Reintentar" del banner, Enter | Foco visible, el botón funciona y el banner se va al reconectar | accesibilidad |

## 4. Medición de cómputo (puerta G1 y medición final)

Solo lectura sobre la rama `development` (MCP `list_branches` / `list_branch_computes`, o `neon branches get`); la persona
autoriza cada comando MCP de base de datos.

**Puerta G1 (Fase 1, antes de construir)** — ver `plan.md`, "Puerta G1":

1. Con `neon realtime subscribe "<sql de equipo>" --branch development` abierto **> 10 min** (más que los 5 min de suspensión),
   confirmar que el endpoint de cómputo **se suspende** (estado `idle`/`suspended` en `list_branch_computes`).
2. Con el servidor de desarrollo y una sesión real, esperar a que caduque la caché de sesión de 5 min, provocar un
   `GET /api/auth/get-session` y confirmar si **despierta** el cómputo (endpoint suspendido antes, activo después).
3. Anotar ambos resultados en `research.md` (sección "Resultados del spike y de la puerta G1") y **detenerse** a preguntar a la
   persona si G1 falla.

**Medición final (Polish, T074)**:

1. Registrar `compute_time_seconds` y `active_time_seconds` de `development`.
2. Dejar **una** pestaña del dashboard visible y quieta **30 min**.
3. Registrar ambos valores otra vez. Esperado: antes ≈ 1 800 s activos; después ≤ ≈ 300–360 s (un despertar y luego se duerme).
4. Leer en Vercel (Functions → Invocations) las invocaciones antes y después. Informar los números.

## 5. Después de cerrar los orígenes (Polish)

Tras `neon realtime enable --allowed-origin …` (con confirmación), repetir `bun run test:e2e` y los escenarios 1, 4 y 9: deben
seguir pasando con la lista cerrada.
