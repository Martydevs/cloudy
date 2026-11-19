# Proposal

## Why

The Cloudy team works on fixed church days (usually Wednesday and Sunday) and on special days, when the church lends its
auditoriums for an event that Cloudy covers. Today nothing in the app says which days are coming, who is assigned or
which songs, YouTube lists and folders belong to each day: that lives in chat messages. The team needs one page where
everybody sees the work days and the admins schedule them.

## What Changes

- **New page `/calendario`** (editors and admins) with a menu entry. It has an event calendar (day, week and month
  views) and an SSR list **Próximos días** (next 30 days); a **Calendario / Lista** switch shows one or the other.
- **Own layout for `/calendario`** (Nuxt layout `calendar`): the page uses the full width of the content column (side
  menu, top bar, toasts and trays stay) and the calendar takes 80 % of the height below the top bar; the strip above it
  carries the title, the switch and «Agendar día».
- **Scheduling and editing are pages, not dialogs**: `/calendario/nuevo` and `/calendario/[id]/editar` (admins only)
  share one form component, which warns before leaving with unsaved changes. The day's detail stays a read-only dialog.
- **Work days**: title, date, kind (normal or special), status (`Sin iniciar` / `En proceso` / `Finalizado`), one
  auditorium (default `Skykids Auditorium`), 1 to 6 non-overlapping time ranges, 0 to 30 members and attached material.
  The kind is **required and has no initial value**: nothing is assumed from the weekday; Wednesday and Sunday only show a
  hint.
- **Material is a reference, never a copy**: song collections, YouTube playlists and drive folders. Deleting the
  collection, playlist or folder removes the attachment; a folder in the trash is hidden.
- **Permissions**: only admins create, edit, assign members, attach material and delete (`calendar.manage`). Editors
  read (calendar, list and detail); the change `calendario-estado-editores` lets an editor change the status of a day
  they are assigned to.
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
- **App**: `app/pages/calendario/index.vue`, `app/pages/calendario/nuevo.vue`, `app/pages/calendario/[id]/editar.vue`,
  `app/layouts/calendar.vue`, `app/components/app/AppShell.vue` (the dashboard frame, extracted so both layouts share
  it), `app/components/calendar/*` (`WorkDayForm.vue` is the form), `app/composables/useWorkCalendar.ts`,
  `app/utils/work-calendar.ts`, `app/assets/css/svar-calendar-cloudy.css`, `workDaySchema`, messages and the menu entry.
- **Tests**: unit, component and e2e specs; architecture, endpoint-guard, route-access and performance specs extended.
- **Docs**: `AGENTS.md` (product areas, stack, gotchas).
