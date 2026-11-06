---
title: Canciones (feature 006) — what is left after migrations, coverage and e2e
created: 2026-11-06
cwd: /home/tmdev/dev/cloudy   (repo root; run every command from here)
branch: 006-canciones-lyrics-pptx
previous-handoff: Cloudy App/handoff-canciones-migrations-quality-verification.md
---

# Canciones (feature 006) — pending work

## Goal

Close feature 006 (Letras.com lyrics → `.pptx`). Code, migrations, coverage and the full e2e suite are done. What remains are
two phase DoDs that need manual or seeded checks (T064, T073), and the polish tasks T077–T079.

## State (verified 2026-11-06)

- **Migration `0007_exotic_oracle.sql` applied** to development and test (user approved). T016 `[X]`.
- `bun run typecheck` clean. `bun run test:coverage`: 126 files, 1773 tests, global 97.85 / 92.72 / 95.01 / 98.64. T075 `[X]`.
- `bun run test:e2e` **full suite green in one run**: 21 files, 175 tests, exit 0. T027/T045/T057/T067 `[X]`.
- Browser checks done (agent-browser + `bun run dev`): US1 and US2. T039/T054 `[X]` with notes in `tasks.md`.
- `bun run analyze`: `/canciones` ≈ 132 KiB gzip and `/canciones/[id]` ≈ 129 KiB gzip of initial JS. The tray (1.8 KiB) and dialog (3.2 KiB) are lazy chunks. T076 `[X]`.
- Unchecked in `specs/006-canciones-lyrics-pptx/tasks.md`: **T064, T073, T077, T078, T079**.

## Next steps

1. **T064 (US3 DoD).** Collections in the browser with **two accounts**:
   - An author editor plus a different editor: the other editor can add and remove songs but cannot rename or delete.
   - An admin can rename and delete.
   - The collection's generate button: visible on hover and on focus at ≥ 1280 px, always visible at 360 px. The confirm dialog says how many files will arrive. A failing song does not stop the rest.

   Already checked by hand with one admin account:
   - Create from the song page (toast).
   - "Ya estaba" on a repeat add.
   - Card in the row with "Creada por …".

   `songs-collections.spec.ts` covers the permission matrix with stubs. The user still has to decide between: (a) accepting e2e coverage, (b) seeding dev by SQL plus a role switch, or (c) verifying it themselves.
2. **T073 (US4 DoD).** Not done by hand:
   - History with ≥ 3 songs, most recent first.
   - Select 3 → bar → **Generar selección** → 3 `.pptx` files, one at a time.
   - Removing an entry keeps it in its collection.
   - "Cargar más" with > 24 entries.

   **SC-008** (~5 000 history rows: first page < 2 s, INP < 200 ms) is pending. It needs seeded rows on dev; the user runs the cleanup SQL, since agents never DELETE.

   Already checked by hand:
   - Empty states.
   - One entry with its checkbox and the selection bar ("1 seleccionada / Recibirás 1 archivo").
   - Content scrolls clear of the bar.
3. **T077 (security).** Done:
   - The client bundle has no `apifyApiKey`/`cloudyApiKey`/`apify-client` and no dev or test key values.
   - The browser request log shows only `localhost:3000`, plus inline `data:` SVGs.
   - Logs in `lyrics-crawler.ts`/`cloudy-api.ts` carry only step, status and error `name`.

   **Missing: run `/security-review`** on the branch, then tick T077.
4. **T078 (a11y).** WCAG 2.2 AA audit of `/canciones` and `/canciones/<id>` in `cloudy` and `cloudy-light`:
   - Contrast, checkbox labels, `role="status"`/`role="alert"`, and `prefers-reduced-motion`.
   - Optionally add the Canciones views to `test/nuxt/four-states.spec.ts`.

   Focus rings already confirmed: every song-page control shows a 2 px solid outline when tabbing. The header search box reports `outline: none`; it may draw its ring on the wrapper. It's a pre-existing shared component; check it.
5. **T079 (final).**
   - Quickstart §2–§6 complete, including deploy: in Vercel, set `NUXT_APIFY_API_KEY`, `NUXT_CLOUDY_API_URL` and `NUXT_CLOUDY_API_KEY`, and leave `NUXT_APIFY_BASE_URL` empty. `maxDuration = 120` is already in `nuxt.config.ts`.
   - Merge gates from AGENTS.md.
   - The PR to `main` is opened only if the user asks.

## Decisions & findings from this session

- **The template coverage artifact is accepted by the user.**
  - What happens: `messages`/`pluralize` auto-imported in a `<template>` compile to a ternary whose other arm never runs.
  - Affected files: `SongActions`, `SongLyrics`, `SongSelectionBar` (80 % branches), `SongCollectionRow` (91.2 %) and `pages/canciones/[id].vue` (91.8 %). The pre-existing `YoutubeSelectionBar` has it too.
  - An explicit `import { messages } from '~/utils/messages'` makes it 100 %, but the user chose **not** to change the style.
  - Don't game coverage with mocks.
- **Neon Auth long lockout.**
  - Besides 3 sign-ins per 10 s, many sign-ins in a row return 429 with `retry-after` ≈ 250 s.
  - `signedInAs` (`test/e2e/setup/fixtures.ts`) now signs each account in through the UI once per spec file. After that it reuses the cookies, checked with `GET /api/me`, and signs in again if the session was closed.
  - Documented in AGENTS.md → Known gotchas. Leave about 5 min between login-heavy e2e runs.
- **Test bucket.** `.env.test` pointed at a nonexistent bucket (`produccion-test`). With the user's OK it now says `NUXT_S3_BUCKET=peticiones-test`, and `bun run storage:setup:test` applied CORS. All upload specs pass.
- **e2e fixes:**
  - `songs-collections.spec.ts`: the last test now counts only the two songs that were in the deleted collection.
  - `responsive-theme.spec.ts`: adds `/canciones` and `/canciones/:id` to the route walk, with a seeded song. Canciones is now the last sidebar link.
- **New tests:**
  - SongUrlInput blur.
  - Dialog blur, inactive `addedBy`, and failures that keep it open.
  - `toSongCollection` with a null count.
  - SongHistoryList: sentinel, untick, Abrir, and `songsOf`.
  - Tray: "Descargar de nuevo".
  - The page `key` per route.

## Dev data and local files left behind (tell the user)

- **Dev account** `agente-canciones@cloudy.test`, **active admin**: approved by one SQL UPDATE at the user's request. Its password is in `/tmp/cloudy-browser/pass`, mode 600. Disable it from `/usuarios` when it's no longer needed.
- **Dev rows:** song "De Buenas (part. Josh Gamez)" and collection "Domingo (prueba del agente)".
- **Real Apify crawls:** 4, about $0.007 total.
- **`/tmp/cloudy-env-test.bak`:** full copy of the old `.env.test`, **with secrets**. Delete it.
- **Scratch scripts outside the repo:** `/tmp/cloudy-bucket-check/*.ts`. They read env files and never print values.
- **Downloaded pptx:** `/tmp/cloudy-browser/dl/song.pptx`.

## Constraints

- Agents never run destructive DB/storage commands, even if asked; hand the SQL to the user. Ask before `db:migrate*` and before `bun run test:e2e`; the user approved both for the 2026-11-06 session only.
- Never print or commit `.env*` values. A real crawl costs credit: use few songs.
- DoD per phase (AGENTS.md): typecheck → tests → browser last → report, then tick.

## Instructions for the receiving session

- Read `AGENTS.md` and `specs/006-canciones-lyrics-pptx/tasks.md` first. Treat this file as context, not verified truth.
- Start from "Next steps". Mark tasks `[X]` only after their DoD passes, and state skipped steps with the reason.
