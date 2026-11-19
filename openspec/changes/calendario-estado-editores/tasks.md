# Tasks

## 1. Shared rule and server

- [x] 1.1 `canSetWorkDayStatus(role, userId, members)` in `shared/permissions.ts`; update the `calendar.manage` comment.
- [x] 1.2 `setWorkDayStatus(id, status, actor)`: membership condition inside the `UPDATE` for editors; 404 / 403
      `not_assigned` when nothing was written. Message in `shared/constants/calendar.ts`.
- [x] 1.3 `estado.patch.ts`: `requireRole(event, 'editor')` and pass the profile.
- [x] 1.4 Verification: `bun run typecheck`, `bun run test:unit`.

## 2. UI

- [x] 2.1 `WorkDayDetailDialog.vue`: `canStatus` for the «Estado» select, `canManage` for «Editar» / «Eliminar», note for
      the editor who is not assigned (`messages.calendar.statusOnlyAssigned`).
- [x] 2.2 `UpcomingWorkDays.vue`: prop `canChangeStatus`; `app/pages/calendario/index.vue` passes it.
- [x] 2.3 Verification: `bun run typecheck`, `bun run test:nuxt`.
- [x] 2.4 Browser verification at 360 px and 1280 px or wider, dark and light themes: assigned editor (select in the
      detail, button in the list), editor not assigned (note, no control), admin unchanged; loading / empty / error /
      content, keyboard focus on the select, console clean.

## 3. Tests

- [x] 3.1 Unit: `permissions.spec.ts`, `api-calendario.spec.ts` (admin, assigned editor, `not_assigned`, 404, guards,
      422), `endpoint-guards.spec.ts` (`estado.patch.ts` moves to the team list).
- [x] 3.2 Component: `WorkDayDetailDialog.spec.ts`, `calendar-components.spec.ts`, `pages-calendario.spec.ts`.
- [x] 3.3 E2E: `test/e2e/calendar.spec.ts` (assigned editor from list and detail; day without assignment answers 403).
      `routes-guard.spec.ts` needs no change (`/estado` stays 401 without session and 403 for a pending account).
- [x] 3.4 Run `bun run test:e2e`: 235 of 236 pass, `calendar.spec.ts` included. The one failure is older than this
      change: `responsive-theme.spec.ts` «las listas cubren todas las páginas» does not list `/calendario`,
      `/calendario/nuevo` and `/calendario/:id/editar` (pages of `calendario-dias-de-trabajo`, whose e2e run is still
      pending there).
- [x] 3.5 Verification: full `test:unit`, `test:nuxt`, `test:coverage`.

## 4. Docs and spec reconciliation

- [x] 4.1 `AGENTS.md` (Calendario): assigned editors change the status.
- [x] 4.2 Reconcile `openspec/changes/calendario-dias-de-trabajo/specs/work-calendar/spec.md` (the two sentences that
      said status was admin-only) and its proposal line.
- [x] 4.3 `openspec validate calendario-estado-editores --strict` and the same for `calendario-dias-de-trabajo`.
- [x] 4.4 Verification: this group changes no code; no migration and nothing «for a person» in this change.
