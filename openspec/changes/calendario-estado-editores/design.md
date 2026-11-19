# Design

## Context

- `can(role, action)` in `shared/permissions.ts` is a role matrix: it answers by role only. `calendar.manage` is
  admin-only and guards everything that writes a work day, status included.
- The list (`GET /api/calendario`) and the detail (`GET /api/calendario/:id`) already return `members[].userId`, and
  `useMe()` gives the browser the signed-in profile.
- `setWorkDayStatus(id, status)` is one `UPDATE … WHERE id RETURNING id`; no row means 404.

## Goals / Non-Goals

- **Goal**: an assigned editor changes the status of their day from the detail dialog and from the list; nobody else
  gains anything.
- **Non-goals**: editing, deleting or scheduling by editors; a status history; a migration.

## Decisions

### D1. A pure per-day helper beside the role matrix

The rule depends on the day (who its members are), so it cannot be an `Action` of `can()`. It lives once, in `shared/`,
as `canSetWorkDayStatus(role, userId, members)`: `true` for an admin; for an editor only when `userId` is among
`members`; `false` otherwise. The UI uses it to decide what to draw; the server does not call it (see D2) but applies the
same rule in SQL. `calendar.manage` stays admin-only and keeps guarding edit, delete and schedule.

*Alternative considered*: a new `calendar.status` action granted to editors. Rejected: it would say «any editor», which
is the mode the team decided against, and the UI would still need the per-day check.

### D2. The membership check travels inside the write

The endpoint guard becomes `requireRole(event, 'editor')` (401 without a session, 403 for a pending or disabled account)
and hands the profile to `setWorkDayStatus(id, status, actor)`:

- admin: the same `UPDATE … WHERE id = :id` as today;
- editor: `UPDATE … WHERE id = :id AND EXISTS (SELECT 1 FROM work_day_members WHERE work_day_id = :id AND user_id = :me)
  RETURNING id`.

One statement, so there is no window between checking and writing (an admin removing the editor at the same moment
either lands before the write, and nothing is written, or after it). Only when no row came back, and only for an
editor, one `SELECT` tells the two reasons apart: the day does not exist → the existing `404`; it exists → `403` with
the message «Solo quienes están asignados al día pueden cambiar su estado.» and `data.code = 'not_assigned'`. All the SQL
stays in `server/utils/work-days.ts` (`architecture.spec.ts`). Input validation (`workDayStatusInput`) is unchanged.

«Assigned» is a `work_day_members` row for the caller's own `userId`. The member's `active` flag does not matter: an
inactive account cannot sign in.

### D3. UI: split «can manage» from «can change status»

- `WorkDayDetailDialog.vue` keeps the `canManage` prop for «Editar» / «Eliminar» and computes `canStatus` with the helper
  from `useMe()` and the loaded day. The footer row renders when either is true: the «Estado» select under `canStatus`,
  the two buttons under `canManage`. Without `canStatus` (an editor who is not assigned) a muted note under the badges
  explains it.
- `UpcomingWorkDays.vue` takes `canChangeStatus: (day) => boolean` (default: nobody) for the quick button; `canManage`
  remains for the empty state and «Agendar día».
- `app/pages/calendario/index.vue` builds that function with the helper and the profile.
- `useWorkCalendar.setStatus` is unchanged: a `403 not_assigned` reaches the person through `serverMessage()` (server
  text on a 4xx), and the refresh it already does removes the control if the assignment is gone.

### D4. Route JS budget (250 KB)

`/calendario` gets no new component, chunk or import beyond one small pure function from `#shared/permissions`, which
the page already imports. The budget asserted in `performance.spec.ts` is unaffected.

## Risks / Trade-offs

- A stale list can still show the button to an editor who was just removed; the tap gets the 403 toast and the refresh
  hides it. Accepted: the server is the authority.
- Status changes are not audited (as today for admins). Out of scope.

## Rollback

Revert the commit: no data or schema changed.
