# Tasks

Every group ends with the AGENTS.md "Definition of done": `bun run typecheck`, the tests that cover the group and, for UI
groups, the browser verification (360 px and 1280 px or wider, dark and light themes, loading/empty/error/content, keyboard
focus, console errors) on `.env.development` data. Migration `0015` is **for a person** in dev, test and production; no
destructive step exists in this change.

**Status of verification (2026-11-18):** typecheck, production build, `test:unit`, `test:nuxt` and `test:coverage`
(97.6 / 93.7 / 95.2 / 98.4) are green. By the owner's instruction, **`test:e2e` and every browser verification were not
run and stay pending**; the e2e code below is written but has never been executed. They need migration `0015` applied
first.

## 1. Spike and dependencies

- [x] 1.1 Install the four pinned `@svar-ui/*` packages (run by the agent with the owner's approval).
- [x] 1.2 Check the six spike points on the installed package by reading its code; results in `design.md` D2.
- [ ] 1.3 Confirm in a browser the spike points that need one: icons and toolbar, 24 h labels, week start, focus ring,
      lazy loading of the calendar CSS. **Pending (browser).**
- [x] 1.4 Write this change (proposal, design, tasks, spec).

## 2. Data

- [x] 2.1 Tables and enums in `server/db/schema.ts`; migration `drizzle/0015_work_days.sql` generated.
- [ ] 2.2 **For a person:** run `bun run db:migrate`, `bun run db:migrate:test` and `bun run db:migrate:prod`.
- [x] 2.3 SQL layers `server/utils/work-days.ts` and `server/utils/work-day-materials.ts`.
- [x] 2.4 Typecheck and unit tests of the group.

## 3. API and permissions

- [x] 3.1 `calendar.manage` (admin only) in `shared/permissions.ts`.
- [x] 3.2 Shared constants, validators (`validateSlots`, `usualWorkDay`, range query) and API types.
- [x] 3.3 The seven endpoints under `server/api/calendario`.
- [x] 3.4 Unit tests: validators, permissions, endpoint guards (editor 403, no session 401), every endpoint with
      `fake-db` (create, edit, status, delete, missing material, inactive member), architecture rules.

## 4. Theme and calendar

- [x] 4.1 `app/assets/css/svar-calendar-cloudy.css`.
- [x] 4.2 `WorkCalendar.vue` (only importer of `@svar-ui/*`), `WorkCalendarEvent.vue`, `app/utils/work-calendar.ts`.
- [x] 4.3 Range loading with a month cache (`useWorkCalendar`).
- [x] 4.4 Unit and component tests (SVAR mocked).
- [ ] 4.5 Browser verification of the group, including AA contrast of events, today, hover and focus in both themes.
      **Pending (browser).**

## 5. Form and detail

- [x] 5.1 `WorkDayDialog.vue` with `workDaySchema`, time-range repeater, members and material tabs.
- [x] 5.2 `WorkDayDetailDialog.vue`.
- [x] 5.3 Component tests and `form-schemas.spec.ts` parity.
- [ ] 5.4 Browser verification of the group. **Pending (browser).**

## 6. Page, list and menu

- [x] 6.1 `app/pages/calendario.vue`, `UpcomingWorkDays.vue`, menu entry.
- [x] 6.2 Page tests by role and state; `route-access.spec.ts`.
- [ ] 6.3 Browser verification of the group. **Pending (browser).**

## 7. E2E, performance and docs

- [x] 7.1 `test/e2e/calendar.spec.ts`, routes in `routes-guard.spec.ts`, `/calendario` in `performance.spec.ts`, new
      tables in the e2e reset list. Written, **never run**.
- [ ] 7.2 Run `bun run test:e2e` and fix what it finds. **Pending.**
- [x] 7.3 Update `AGENTS.md` (product areas, stack, gotchas).
- [ ] 7.4 `bun run analyze` report for the route (the plain build measured the calendar chunk: 40.1 KB gzip JS,
      17.7 KB gzip CSS). **Pending.**
- [ ] 7.5 Final gate: full e2e, browser checks and `openspec validate calendario-dias-de-trabajo --strict` (the CLI was
      not available in this session). **Pending.**
