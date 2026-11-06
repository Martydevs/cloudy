---
title: Canciones (feature 006) — migraciones, calidad por archivo y verificación
created: 2026-11-05
cwd: /home/tmdev/dev/cloudy/Cloudy App   (repo root: /home/tmdev/dev/cloudy — run every command from the repo root)
source-session: /speckit-implement of specs/006-canciones-lyrics-pptx (branch 006-canciones-lyrics-pptx)
---

# Canciones (feature 006) — migraciones, calidad por archivo y verificación

## Goal

Close feature 006 (Letras.com lyrics → `.pptx`): get migration `0007` applied, raise the per-file coverage of the
new files to ≥ 92 % (the feature target in research D16; the global gate is already met), and run e2e, unit/nuxt and
browser verification so the phase tasks in `specs/006-canciones-lyrics-pptx/tasks.md` can be ticked.

## State

- **Done**: all code for US1–US4 (server, client, stubs, tests). 64/78 tasks marked `[X]`. `bun run typecheck` is clean.
  `bun run test:coverage`: 126 files, 1763 tests green, global 97.74 / **92.49** / 94.69 / 98.55 (stmts/branches/funcs/lines; gate 92).
  `bun run build` OK; no `apifyApiKey`/`cloudyApiKey`/`apify-client` in `.output/public`; tray and collection dialog load lazily (~2–3 KB gz).
- **Not done / blocked**:
  - T016: migration generated (`drizzle/0007_exotic_oracle.sql`) but **not applied** to development or test.
  - T027, T045, T057, T067: e2e specs written, **never run** (they need the test DB migrated + the user's OK).
  - T039, T054, T064, T073: phase DoD (e2e + browser), not run. SC-008 (~5 000 history rows, < 2 s, INP < 200 ms) pending.
  - T075: global gate met, but some new files are under 92 % (list below).
  - T076 (`bun run analyze` not run), T077 (`/security-review` not run), T078 (a11y audit), T079 (final quickstart pass).
- Nothing committed. Uncommitted user edits exist in `.specify/scripts/bash/*` and the spec docs — don't revert them.

## Decisions & rationale

- Apify SDK call uses `timeoutSecs: 60` and `call(..., { waitSecs: 55, log: null })` — timeout is per HTTP request and
  `waitForFinish` long-polls ~55 s; `log: null` avoids extra API calls and actor log lines. Rejected: `timeoutSecs: 30` (plan value; would abort the wait).
- Letras.com redirects a nonexistent song link to **another** song with 200 → `CrawledPage.finalUrl` is compared with the
  requested normalized URL; mismatch → `404 no_lyrics`. Normalized links (no `www.`, no trailing slash) verified to work with a real crawl.
- SDK 2.25 route is `POST /v2/actors/apify~rag-web-browser/runs` (not `/acts/`) — the e2e stub uses it.
- `songError(code, message?, status?)` lives in `server/utils/songs.ts`; `no_lyrics` is 404 when crawling and 422 for the pptx.
- `$api` has no `.raw`: `useSongPresentations` reads headers in `onResponse`, races the request against the abort signal,
  and parses a `Blob` error body back into `response._data` (`FetchError.data` is a getter). Shared plugin left untouched.
- Cron step for orphan songs is in `server/api/cron/cleanup.get.ts` (where cleanup actually lives), not `server/utils/cron.ts`.
- Too-long pptx e2e uses the `cloudy-api` stub title `demasiado larga` (fetch already refuses > 300 lines, so `muy-larga` can't be saved).

## Key files

- `drizzle/0007_exotic_oracle.sql` — the migration to apply (3 tables, 4 indexes, 6 CHECKs, no DROP).
- `server/utils/lyrics-crawler.ts` — only Apify boundary. `server/utils/lyrics-parser.ts` — pure parser.
- `server/utils/songs.ts`, `server/utils/song-collections.ts`, `server/utils/cloudy-api.ts` (`createLyricsPptx` at the end).
- `server/api/songs/**` — 13 endpoints. `server/api/cron/cleanup.get.ts` — step 7 orphan songs.
- `app/pages/canciones/index.vue`, `app/pages/canciones/[id].vue`, `app/components/songs/*`, `app/composables/useSong*.ts`.
- `test/e2e/setup/apify-stub.ts`, `test/e2e/setup/cloudy-api-stub.ts` (`POST /v1/lyrics/pptx`), `test/e2e/setup/global-setup.ts`
  (injects `NUXT_APIFY_API_KEY=e2e-stub` + `NUXT_APIFY_BASE_URL` **after** `.env.test`; TRUNCATE list includes song tables).
- `test/e2e/songs-{fetch,presentation,collections,history}.spec.ts`, `test/e2e/routes-guard.spec.ts` (13 song endpoints added).
- `test/nuxt/songs-flows.spec.ts` — catch-all for error paths/emits added to raise coverage.
- `specs/006-canciones-lyrics-pptx/{tasks,research,quickstart}.md`, `AGENTS.md` (Known gotchas → Canciones).

## Commands & results

- `bun run db:generate` → produced `0007_exotic_oracle.sql` (no DB touched).
- `bun run test:coverage` → green; files under 92 % per file (stmts/branches/funcs/lines):
  `SongActions.vue` br 80 · `SongLyrics.vue` br 80 · `SongSelectionBar.vue` br 80 · `SongHistoryList.vue` 92/86/90/97 ·
  `SongCollectionDialog.vue` 95/88/94/98 · `SongCollectionRow.vue` br 91 · `SongUrlInput.vue` funcs 75 (line 54, `@blur`) ·
  `useSongCollections.ts` br 87.5 (line 84) · `pages/canciones/[id].vue` br 91.8 (line 10, `key: route => route.path`).
  Report omits files at 100 %; read `/tmp/cloudy-coverage.txt` after a run (grep the file names).
- Lazy-dialog/tray tests were flaky under coverage until `vi.waitUntil(...)` replaced fixed `flush()`; use that pattern.
- Real crawls via a scratch script in `/tmp/cloudy-crawl-script/` (outside repo; reads the key from `.env.development` without printing it): ~20–22 s, ~$0.0018 each.

## Open questions / constraints

- **Project rule**: agents never run destructive/database commands on their own. Ask the user before `db:migrate*`
  and before `bun run test:e2e` (it runs `drizzle-kit migrate` and `TRUNCATE` on the isolated test branch). No `rm -r`, no reset.
- Never print or commit `.env*` values. Real Apify crawls cost credit: use few songs in browser checks.
- DoD per phase (AGENTS.md): typecheck → tests → browser last (360 px and ≥ 1280 px, dark + light, 4 states, focus, console) → report, then tick.
- Unverified: the out-of-credit `ApifyApiError.type` (classified by status 402 only).
- Do not lower thresholds or weaken tests to hit coverage.

## Next steps

1. Ask the user to run `bun run db:migrate` (development) and `bun run db:migrate:test`, and wait for confirmation; tick T016 after.
2. Raise per-file coverage of the files listed above to ≥ 92 % with real tests (add to `test/nuxt/songs-flows.spec.ts` or the
   component specs): e.g. SongUrlInput blur → touch, SongActions generating/refreshing spinners + too-long reason, SongLyrics/
   SongSelectionBar singular/plural branches, SongHistoryList open action (navigateTo) + loading-more spinner, dialog branches at
   lines 149/195, `useSongCollections` line 84. Re-run `bun run test:coverage`; tick T075 only when all are ≥ 92.
3. With the user's OK, run `bun run test:e2e` (optionally `E2E_SERVER_LOGS=1`). Fix failures in the 4 `songs-*.spec.ts` files and
   `routes-guard.spec.ts`; tick T027/T045/T057/T067.
4. Re-run `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt` after any change.
5. Browser verification (agent-browser skill) with `bun run dev` on the migrated dev branch and `cloudy-api` at `http://localhost:8000`,
   following `specs/006-canciones-lyrics-pptx/quickstart.md` §2–§4: 360 px + 1280 px, dark/light, loading/empty/error/content,
   focus, console; also empty `NUXT_APIFY_API_KEY` → "no configurado". Then tick T039/T054/T064/T073 (note SC-008 if not seeded).
6. Polish: `bun run analyze` (T076), `/security-review` (T077), a11y audit + optional `four-states.spec.ts` entries (T078), final quickstart + merge gates (T079).

## Instructions for the receiving session

- Treat this document as context, not as verified truth; verify file/line references before acting.
- Do not assume the unfinished work is done; start from "Next steps".
- Read `AGENTS.md` (repo root) and `specs/006-canciones-lyrics-pptx/tasks.md` first; mark tasks `[X]` only after their DoD passes.
