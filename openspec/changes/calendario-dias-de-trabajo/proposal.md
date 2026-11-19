# Proposal

## Why

The Cloudy team works on fixed church days (usually Wednesday and Sunday) and on special days, when the church lends its
auditoriums for an event that Cloudy covers. Today nothing in the app says which days are coming, who is assigned or
which songs, YouTube lists and folders belong to each day: that lives in chat messages. The team needs one page where
everybody sees the work days and the admins schedule them.

## What Changes

- **New page `/calendario`** (editors and admins) with a menu entry. It has an SSR list **Próximos días** (next 30 days)
  and an event calendar (day, week and month views).
- **Work days**: title, date, kind (normal or special), status (`Sin iniciar` / `En proceso` / `Finalizado`), one
  auditorium (default `Skykids Auditorium`), 1 to 6 non-overlapping time ranges, 0 to 30 members and attached material.
  The kind is **required and has no initial value**: nothing is assumed from the weekday; Wednesday and Sunday only show a
  hint.
- **Material is a reference, never a copy**: song collections, YouTube playlists and drive folders. Deleting the
  collection, playlist or folder removes the attachment; a folder in the trash is hidden.
- **Permissions**: only admins create, edit, change status, assign members, attach material and delete
  (`calendar.manage`). Editors only read (calendar, list and detail).
- **Seven endpoints** under `/api/calendario`, four tables (migration `0015`) and a Cloudy CSS theme for the calendar
  component.

### New dependency (AGENTS.md principle II)

`@svar-ui/vue-calendar@2.7.1` (MIT) plus `@svar-ui/vue-core@2.6.1`, `@svar-ui/calendar-locales@2.7.0` and
`@svar-ui/core-locales@2.6.1`, all pinned to exact versions. Justified in `design.md` (D1). No external service.

### Out of scope

- Recurrence, notes, a role per member, call time and warnings when a member is double-booked.
- Dragging or resizing events in the calendar; SVAR's PRO views (Agenda, Year, Timeline, Resources), time zones and
  dynamic loading.
- Logging calendar actions in `/actividad`.
- Attaching single songs or single videos.
- Any cron cleanup: past days stay as history.
- Running migrations (a person runs them).

## Capabilities

### New Capabilities

- `work-calendar`: the team sees its work days and admins schedule them, with members and attached material.

### Modified Capabilities

None.

## Impact

- **Database**: tables `work_days`, `work_day_slots`, `work_day_members`, `work_day_materials` and enums `work_day_kind`,
  `work_day_status` (migration `drizzle/0015_work_days.sql`).
- **Server**: `server/utils/work-days.ts`, `server/utils/work-day-materials.ts` (all the SQL) and
  `server/api/calendario/**` (7 handlers).
- **Shared**: `shared/constants/calendar.ts`, `shared/validation/calendar.ts`, `calendar.manage` in
  `shared/permissions.ts`, types in `shared/types/api.ts`.
- **App**: `app/pages/calendario.vue`, `app/components/calendar/*`, `app/composables/useWorkCalendar.ts`,
  `app/utils/work-calendar.ts`, `app/assets/css/svar-calendar-cloudy.css`, `workDaySchema`, messages and the menu entry.
- **Tests**: unit, component and e2e specs; architecture, endpoint-guard, route-access and performance specs extended.
- **Docs**: `AGENTS.md` (product areas, stack, gotchas).
