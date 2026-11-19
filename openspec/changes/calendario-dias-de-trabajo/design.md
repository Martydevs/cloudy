# Design

## Context

See `proposal.md`. Facts that shape the approach:

- A work day has several time ranges but one date, one kind, one status and one auditorium. A calendar shows one event per
  range.
- Dates and times are wall-clock values with no time zone: the whole team is in one place and must read the same hours.
- The project keeps every feature's SQL in its own `server/utils` layer, validates with shared validators, uses daisyUI
  tokens for every colour and holds each route to 250 KB gzip of initial JS.
- Agents never run migrations or destructive statements; a person runs migration `0015`.

## Goals / Non-Goals

**Goals:** one page to read the coming days fast on a phone; admins schedule without assumptions; the calendar component
replaceable by touching one file; no route budget regression.

**Non-Goals:** recurrence, drag and drop, activity log, cron cleanup (see the proposal's "Out of scope").

## Decisions

### D1. Calendar component: SVAR Vue Calendar (new dependency)
`@svar-ui/vue-calendar@2.7.1` is an **event** calendar (not a date picker), MIT, with day, week and month views in its
open edition. It depends only on `vue ^3`, uses native `Date`, ships a Spanish locale and is themed with `--wx-*` CSS
variables. The three other packages are transitive dependencies of it, declared explicitly because `WorkCalendar.vue`
imports them; all four are pinned to the exact versions `vue-calendar@2.7.1` itself pins (a newer `vue-core` would install
a second copy).

*Alternative rejected:* Schedule-X, which needs `preact`, `@preact/signals` and `temporal-polyfill` (more weight and
dependencies) and has its own variable system.

*Accepted risks:* the project is young (few users). Mitigation: exact versions and a single boundary file,
`app/components/calendar/WorkCalendar.vue`, the only importer of `@svar-ui/*` (enforced by `architecture.spec.ts`).

### D2. Findings of the spike on the installed package
Verified by reading the installed 2.7.1 code; items marked *browser* still need the browser check of the tasks.

1. **Icons with `:fonts="false"`**: SVAR's own toolbar draws its arrows with an icon font loaded from `cdn.svar.dev`, and
   `fonts: false` skips that stylesheet together with Open Sans. Decision: pass `toolbar: null` and render **our own
   toolbar** (previous, today, next, period title, view switch) with daisyUI `btn` and lucide icons. That also gives 45 px
   touch targets and Spanish labels without overriding `.wx-*` toolbar classes, and no request to a third-party CDN.
2. **Visible date/range**: the store state exposes `currentDate`, `currentView` and `visibleDateRange`. We do not read
   them: whenever `events` changes SVAR re-initialises from its `view` and `date` props, so both live outside as
   `v-model`s and the toolbar changes them directly. Navigation that starts inside SVAR (click on a day number in the
   month grid → day view) arrives through `api.on('navigate-to')`.
3. **`select-event` with `readonly`**: it fires, but only from mouse events. Each event's content is therefore a
   `<button>` (`WorkCalendarEvent.vue`) that opens the day's detail through `provide`/`inject`, keyboard included.
4. **SSR**: the layout uses `ResizeObserver`; the component is mounted inside `<ClientOnly>`.
5. **Locale**: `calendar.weekStart` (0 = Sunday) comes from the core locale and `timeScaleFormat: '%H:%i'` (24 h) from the
   calendar locale. The month view's "+N more" button is hard-coded English, so the month section runs with
   `eventOverflow: 'expand'` and never shows it.
6. **`readonly` must be bound as `:readonly="true"`**: the prop is declared without a type, so the bare attribute arrives
   as `''` and SVAR's `readonly ?? false` treats it as editable. Found by the component test.
7. **Time grid**: day and week views default to 08:00–18:00. We configure them from 06:00 (or the earliest range, if
   earlier) to 24:00, so an evening service is never hidden.
8. **Chunk size** (production build): the calendar's JS chunk is 40.1 KB gzip and its CSS 17.7 KB gzip, both loaded only
   by `/calendario` after hydration.

### D3. Read-only calendar, one editing path
Dragging one range would change the date of the whole day and its other ranges. The calendar is read-only and SVAR's
`Editor` and `ContextMenu` are not mounted; every change goes through our form.

### D4. Cloudy theme with one set of variables for both themes
`app/assets/css/svar-calendar-cloudy.css` is imported by `WorkCalendar.vue` after `@svar-ui/vue-calendar/all.css` (never
in `nuxt.config.ts`). Willow sets its variables on its own element, so the selector is
`.cloudy-calendar .wx-willow-theme`. Each `--wx-*` points at a daisyUI token, which already switches with `data-theme`, so
there is no `WillowDark` and no JS. Weekend cells are transparent (Sunday is a normal work day). Events: normal = tint of
`secondary`, special = tint of `primary`, text `base-content`, a 4 px stripe of the full colour; finished events use a
fainter tint (not a lower text opacity, which would fail AA in the light theme). Kind and status are also said with an
icon and text.

### D5. Data model and SQL layers
Four tables (see `server/db/schema.ts`): `work_days` (`kind` has **no default**), `work_day_slots`, `work_day_members`
and `work_day_materials` (three nullable FKs with `ON DELETE CASCADE`, a check for exactly one, a partial unique index per
kind and day). All SQL lives in `server/utils/work-days.ts` and `server/utils/work-day-materials.ts`; endpoints never
import drizzle. Reads are one `db.batch` each (range: 3 queries; detail: 8, grouped by kind, no N+1). Writes are one batch
each, preceded by one batch that checks members and material, so a day is never half written; a foreign-key failure
between check and write answers `409 material_unavailable`.

### D6. Validation
The shared validators (`shared/validation/calendar.ts`, the project's own validator core) are the server's authority,
and the form uses a `zod/mini` schema through `useFormSchema`, mirrored by `form-schemas.spec.ts`. The plan said "all
validates with zod"; the server keeps the project convention (shared validators) so client and server rules stay in one
place. `validateSlots` is shared and gives row-level errors to the form.

### D7. "Today" uses the church's time zone
Vercel renders in UTC: in the evening the server's date is already tomorrow, which would hide tonight's service from the
SSR list. `CALENDAR_TIME_ZONE = 'America/Monterrey'` decides only what "today" is; stored dates and hours stay zone-less.

### D8. Range loading and cache
SVAR's dynamic loading is PRO. `useWorkCalendar` asks for whole months, caches them by month key in `useState` and
preloads the previous and next month. After any write it refetches the known months and the upcoming list.

### D9. Material detail
The detail lists up to 50 songs of each attached collection and 50 videos of each playlist, linking to
`/canciones/<songId>` and `/youtube/<videoId>`; a folder links to `/archivos/<folderId>` and lists no files (its contents
are one click away and can be thousands of rows).

### D10. Own layout `calendar`, calendar at 80 % of the height
The dashboard frame (drawer, top bar, toast, side menu, trays and their logic) moves from `layouts/dashboard.vue` to
`app/components/app/AppShell.vue`, with one prop, `fluid`. `layouts/dashboard.vue` is `<AppShell>` and
`layouts/calendar.vue` is `<AppShell fluid>`: `main` drops `max-w-7xl mx-auto` and uses the whole content column with a
smaller padding. Only `/calendario` uses it. The calendar's height is a CSS variable computed from the viewport, not
from its parent: `--calendar-h: max(calc((100dvh - 4rem) * 0.8), 28rem)` (4 rem = the top bar). On short screens the
28 rem minimum wins and the page scrolls. The loading skeleton uses the same variable (no CLS) and `WorkCalendar.vue`'s
root is `h-full` inside that box. The strip above (the other 20 %) holds the title, the switch (D12) and «Agendar día».

*Alternative rejected:* a `fluid` flag in `definePageMeta` read by the dashboard layout: a named layout states the
difference where Nuxt expects it and keeps the dashboard layout free of per-page conditions.

### D11. The form is a page
«Agendar día» and «Editar día» are routes (`/calendario/nuevo`, `/calendario/[id]/editar`, admins only through
`definePageMeta` roles, dashboard layout) that render one component, `WorkDayForm.vue` (the former `WorkDayDialog.vue`
without the `<dialog>`): same fields and rules, two columns from `lg` (data and time ranges; members and material).
`app/pages/calendario.vue` becomes `calendario/index.vue`, otherwise Nuxt would treat it as the parent route of the
folder. Unsaved changes are guarded twice: a `router.beforeEach` registered while the form is mounted (the project's pattern, `usePrayerLeaveGuard`; it does not depend on being the `<RouterView>` component) asks through `useConfirm`, and `beforeunload` covers
reload and tab close; both are off after a successful save. Saving navigates to `/calendario?fecha=<date of the day>`,
which opens the calendar on that month; a failed save stays on the page and focuses the first invalid field. The edit
page loads the day with `server: false` and renders loading, error with retry and «not found» before the form. The
day's detail stays a lazy read-only dialog; its «Editar» navigates to the edit page.

### D12. Calendario / Lista switch in the URL
The calendar and the list share the same 80 % box and only one is shown: `?vista=lista` shows **Próximos días**
(scrolling inside the box), no parameter shows the calendar (also on phones, in the day view). The switch changes the
query with `replace`, so the choice is linkable, survives a reload and renders on the server. `?fecha=AAAA-MM-DD`
(validated; ignored otherwise) sets the visible date, and «Agendar día» links to `/calendario/nuevo?fecha=<visible date>`.

### Route budget
`/calendario` adds only the page, the SSR list and small helpers to the initial JS. SVAR, its CSS and the theme travel in
the lazy chunk of `LazyWorkCalendar` (inside `<ClientOnly>`, behind a skeleton of the same height, so no CLS), and the
detail dialog is `Lazy*` behind `v-if`. The form is no longer in `/calendario` at all: it travels in the chunks of its
own two routes. `performance.spec.ts` audits `/calendario` and `/calendario/nuevo`.

## Risks / Trade-offs

- A young dependency → pinned versions and a one-file boundary.
- Month bars are 22 px tall (SVAR layout): below the 44 px touch target. The list **Próximos días** is the accessible
  and touch-friendly alternative, and the day view (default on phones) has full-size events.
- A month with many days on one date grows that week row (`expand`) instead of hiding events.
- Extracting `AppShell` touches the frame of every dashboard page → `dashboard-layout.spec.ts` passes unchanged and an
  existing page is checked in the browser.

## Migration Plan

`drizzle/0015_work_days.sql` only creates types, tables and indexes. **A person runs it**: `bun run db:migrate` (dev),
`bun run db:migrate:test` (test) and `bun run db:migrate:prod` (production), before deploying the code. Rollback is
dropping the four tables and two types, also by a person.
