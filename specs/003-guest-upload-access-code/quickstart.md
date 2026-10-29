# Quickstart: validar la subida de invitados con aprobación de acceso

**Feature**: [spec.md](./spec.md) · **Contratos**: [api.md](./contracts/api.md), [ui.md](./contracts/ui.md)

Guía de validación, no de implementación. Solo datos de `.env.development` (y `.env.test` para e2e); ningún paso
destructivo.

## 1. Preparación

```bash
bun install
bun run db:migrate          # aplica 0004 en la rama de desarrollo
bun run db:migrate:test     # y en la de pruebas, para e2e
bun run dev                 # http://localhost:3000
```

Hace falta una cuenta editor o admin activa en desarrollo y un segundo navegador (o ventana privada) para el invitado.

## 2. Pruebas automáticas

```bash
bun run typecheck
bun run test:unit           # access (estado derivado), validación, endpoints públicos y de equipo, pulso, cron, camera utils
bun run test:nuxt           # /upload en sus 9 estados (cargando, none, waiting, approved, rejected, expired, accessExpired, used, error), AccessRequestCard, SubmissionCard (insignias), DropZone (cámara), CameraCapture
bun run test:e2e            # access-upload.spec, camera.spec, guest-queue (ruta /solicitudes), routes-guard
bun run test:coverage       # umbral 92 %
```

## 3. Escenarios manuales (navegador, 360 px y ≥ 1280 px, temas oscuro y claro)

Los escenarios con **tiempo objetivo** se cronometran desde un teléfono (o a 360 px con red 4G simulada) y el tiempo
medido se anota en el reporte de la fase.

| # | Escenario | Resultado esperado | Requisitos |
|---|-----------|--------------------|------------|
| 1 | Sin sesión, abrir `/login` | Enlace "Enviar archivos" visible; lleva a `/upload`. **Tiempo objetivo**: de abrir `/login` a ver "Esperando" < 30 s | FR-001, SC-001 |
| 2 | En `/upload`, escribir un nombre y "Pedir acceso" | Estado "Esperando…" con "Caduca en 8 min" | FR-003, FR-013 |
| 3 | Con el editor conectado en otra ventana | En ≤ 5 s: toast "{nombre} pide permiso…", badge de Solicitudes +1, la solicitud arriba en `/solicitudes` | FR-007, FR-008, SC-002 |
| 4 | El editor toca "Dar acceso" | Toast de éxito; en ≤ 5 s el invitado ve el formulario con su nombre de solo lectura | FR-009, FR-014, SC-005 |
| 5 | El invitado envía una foto | Confirmación; en `/solicitudes` el envío lleva "Por permiso" y "Acceso aprobado por {editor}" (las insignias llegan con US3). **Tiempo objetivo**: de ver el formulario a la confirmación < 1 min | FR-016, FR-020, FR-022, SC-003 |
| 6 | El invitado intenta otro envío con la misma solicitud | "Tu acceso ya se usó…" y botón para pedir otro | FR-015 |
| 7 | Nueva solicitud y el editor toca "Rechazar" (confirma) | El invitado ve "El equipo no aceptó tu solicitud" en ≤ 5 s | FR-009, FR-013 |
| 8 | Nueva solicitud sin atender 8 min | El invitado ve "Tu solicitud caducó sin que nadie la atendiera"; desaparece de `/solicitudes` | FR-005 |
| 8b | Solicitud aprobada sin enviar durante 30 min | El invitado ve "Tu acceso caducó antes de empezar el envío" y "Pedir acceso de nuevo" | FR-015, FR-018 |
| 9 | Desde el mismo navegador, pedir acceso 4 veces en 30 min (el editor rechaza cada una) | La 4.ª muestra "Ya pediste acceso varias veces. Intenta de nuevo en N min"; otro navegador en la misma red sí puede pedir | FR-006 |
| 10 | Dos editores tocan "Dar acceso" a la vez | Uno gana; el otro ve "{nombre} ya dio acceso a esta persona" | FR-009 |
| 11 | Copiar la cookie de otro navegador no es posible (`httpOnly`); abrir `/upload` en otro navegador | Estado inicial "Pedir acceso" | FR-014 |
| 12 | `/enviar` sin sesión | Funciona como antes; su envío llega como "Por enlace" | FR-021, FR-022 |
| 13 | Abrir `/pendientes` con sesión | Redirige a `/solicitudes` | FR-024 |
| 14 | `/actividad` como admin | "dio acceso a {nombre}" y "rechazó la solicitud de {nombre}" | FR-011 |
| 15 | Escritorio a 360 px de ancho (DevTools sin emulación táctil) | No aparece "Abrir cámara" | FR-016e, SC-008 |

## 4. Cámara en un dispositivo real

`getUserMedia` exige HTTPS (o `localhost`). Para probar en un teléfono contra `bun run dev`, exponer el puerto con
un túnel HTTPS que ya tengas (por ejemplo `cloudflared tunnel --url http://localhost:3000`) y añadir su origen a
`CORS_EXTRA_ORIGINS` solo si se sube al bucket desde él (`bun run storage:setup`, ver AGENTS.md).

| # | Escenario | Resultado esperado |
|---|-----------|--------------------|
| C1 | Teléfono, `/upload` aprobado → "Abrir cámara" → permitir | Vista de la cámara trasera dentro de Cloudy, sin abrir la app de cámara |
| C2 | Tomar foto → "Repetir" → tomar otra → "Usar foto" (×2) | Dos fotos `foto-….jpg` en la cola; contador "2 fotos agregadas". **Tiempo objetivo** (SC-007): de tocar "Abrir cámara" a ver la primera foto en la cola < 15 s |
| C3 | Enviar | Las fotos llegan a `/solicitudes`; su texto se lee (feature 002) si son notas |
| C4 | Negar el permiso | Mensaje con cómo activarlo; "Elegir archivos" sigue funcionando |
| C5 | Con la cámara abierta, cambiar de app | El indicador de cámara del sistema se apaga |
| C6 | Tableta en horizontal | "Abrir cámara" visible |
| C6b | iPad con trackpad (si hay uno disponible) | Sin "Abrir cámara"; "Elegir archivos" funciona (riesgo aceptado, FR-016e) |
| C7 | `/enviar` en el teléfono | "Abrir cámara" visible y funcional |
| C8 | Laptop con webcam | Sin "Abrir cámara" |

## 5. Rendimiento

`bun run analyze`: el JS inicial de `/upload`, `/enviar` y `/solicitudes` sigue ≤ 200 KB gzip; `CameraCapture`
aparece como chunk diferido.
