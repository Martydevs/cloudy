# Proposal

## Why

Only admins can change the status of a work day (`Sin iniciar` / `En proceso` / `Finalizado`). The people who actually
know when a day starts and ends are the editors assigned to it, and today they have to ask an admin to tap the button.
The status should be changed by whoever is working that day.

## What Changes

- **An editor changes the status of a work day they are assigned to** (a row in `work_day_members` for their account),
  from the two places where an admin does it today: the «Estado» select of the day's detail dialog and the quick
  «Iniciar» / «Finalizar» button of the «Próximos días» list.
- **Admins keep changing the status of any day**, assigned or not.
- **An editor who is not assigned** sees no status control; the detail dialog explains why («Solo quienes están asignados
  a este día pueden cambiar su estado.») and the API answers `403` with `data.code = 'not_assigned'`.
- `PATCH /api/calendario/:id/estado` is opened to the team (`requireRole(event, 'editor')`); the per-day rule is enforced
  inside the same `UPDATE`.
- Any status can be set from any status, as admins can today.

### Out of scope

- Editing, deleting and scheduling work days, assigning members and attaching material: still admins only
  (`calendar.manage`).
- A mode where any editor changes any day.
- A status history or an activity-log entry for status changes.
- Schema changes: there is no migration.

### New dependency (AGENTS.md principle II)

None. No new package, service, endpoint or table.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `work-calendar`: adds the requirement «Assigned editors change the status of their work day». The capability is
  introduced by the change `calendario-dias-de-trabajo`, which is not archived yet, so this change carries the
  requirement as `ADDED` and reconciles the two sentences of that change's spec that said status was admin-only.

## Impact

- **Shared**: `shared/permissions.ts` (new pure helper `canSetWorkDayStatus`), `shared/constants/calendar.ts` (the 403
  message).
- **Server**: `server/api/calendario/[id]/estado.patch.ts`, `setWorkDayStatus` in `server/utils/work-days.ts`.
- **UI**: `WorkDayDetailDialog.vue`, `UpcomingWorkDays.vue`, `app/pages/calendario/index.vue`, one text in
  `app/utils/messages.ts`.
- **Tests**: `permissions.spec.ts`, `api-calendario.spec.ts`, `endpoint-guards.spec.ts`, `WorkDayDetailDialog.spec.ts`,
  `calendar-components.spec.ts`, `pages-calendario.spec.ts`, `test/e2e/calendar.spec.ts`.
- **Docs**: `AGENTS.md` (Calendario), the base change's `specs/work-calendar/spec.md`.
- **API shape**: unchanged (`members[].userId` is already in the list and detail payloads).
