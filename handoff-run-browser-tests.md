---
title: Fix the 5 failing e2e tests and run the browser verification
created: 2026-11-10
cwd: C:\Users\andre.perez\Dev\skykids-produccion-app
source-session: ca103681-1121-4023-bedb-f0ae259e362b
---

# Fix the 5 failing e2e tests and run the browser verification

## Goal

Finish the definition of done (`AGENTS.md` → Workflow) for the work on `development` (commits `21d2758..25edf6b`:
YouTube `/v2` engine with `/v1` fallback, multi-select in Archivos and Usuarios, `UserAvatar` in `/perfil`, selection bars
above the Canciones tray): make the full e2e suite green, then do the browser verification (step 2), which was never done
for the engine fallback, Archivos multi-select or the avatar.

## State

- **Done** (all pushed to `origin/development`, not merged, no PR):
  - `6a3cdd4` fix(ui): `SelectionBar` and `YoutubeSelectionBar` sit above both trays
    (`bottom-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,0px))]`). Regression: nuxt class assertions + e2e in
    `responsive-theme.spec.ts` at 360 / 700 / 1280 px (verified to fail with the old class).
  - `25edf6b` fix(users): Usuarios page uses `pb-56 sm:pb-24` while something is selected (the stacked bar is ~208 px at
    360 px; `pb-40` left 24 px of the last account under it). Regression: nuxt + e2e.
  - `bun run typecheck` clean · `test:unit` 1178/1178 · `test:nuxt` 759/759 · `test:coverage` 1937/1937, gate passed
    (statements 97.99 · branches 93.24 · functions 95.65 · lines 98.81).
  - Browser check of the tray fix on dev data (dark + light, 360 / 700 / 1280 px, Usuarios): no overlap, bar buttons 45 px
    and on top, no horizontal scroll, no console errors.
- **Failing**: full `test:e2e` → 183 passed, **5 failed** (see "Failures"). Not investigated beyond reading the code.
- **Not done**: browser verification of the engine fallback, Archivos multi-select (dev Archivos is empty), the YouTube
  selection bar (dev YouTube history is empty) and the `/perfil` avatar.

## Failures (full e2e run, 2026-11-10; diagnoses unverified)

1. `performance.spec.ts` › `/ con 50 archivos recientes` (LCP 3112 ms) and `/archivos/<carpeta> con 200 elementos`
   (LCP 3856 ms) vs the 2500 ms budget. `bun run test:coverage` was running at the same time (TTFB up to 3.4 s on
   localhost) → probably CPU contention. Re-run alone before touching code.
2. `youtube-download.spec.ts:289` › `bothBotChk1`: `probes` is `['v2','v1','v2','v1']`, expected `['v2','v1']`. The video
   page probes twice when both engines bot-check. Find out why (second fetch on hydration? the page's auto-retry? a
   `useFetch` refresh?) and decide whether the code or the expectation is wrong. Probably production code.
3. `youtube-download.spec.ts:332` › `bothItemFl1`: strict-mode violation. `tray(page).getByText('No se pudo descargar')`
   also matches the tray's `sr-only` live region ("Falla dentro de los dos: No se pudo descargar"). Test selector bug:
   target the visible row text (for example the `span` with "Audio MP3 · No se pudo descargar"). `:298` (`bothBotChk1`)
   uses the same selector and may hit the same problem once #2 is fixed.
4. `users.spec.ts:117` › multi-select: the third `select()` (before "Eliminar") never shows "2 seleccionados". It runs
   right after the self-deactivation step that the last-admin guard skips. Likely the admin's own row stays selected
   (`usuarios.vue` clears `selected` only when `admin.bulk` returns truthy), so the bar shows "3 seleccionados". Decide:
   should the page clear the selection after a fully skipped batch, or should the test press "Limpiar" first?

## Decisions & rationale

- Behaviour the tests assert on purpose (do not "fix" as test bugs): both engines fail with no service code → **503**
  `waking` (`code: 'engines_failed'`, `cause: 'waking'`); bot-check / engine failures → **502** `engines_failed`;
  `cause` ∈ `botCheck | engineFailed | waking`; per-video engine retries stay in the same download group; v1 jobs never
  retry; `POST /api/users/batch` skip reasons `last_admin | not_found | unchanged`; bulk disable / role apply only to
  active accounts.
- Archivos keeps `pb-40 sm:pb-24`; only Usuarios needed `pb-56` (its bar stacks three actions).

## Key files

- `test/e2e/performance.spec.ts:171` — LCP assertion.
- `test/e2e/youtube-download.spec.ts:280-340` — `bothBotChk1` / `bothItemFl1`.
- `test/e2e/setup/cloudy-api-stub.ts` — `probes`, `createAttempts`, `jobsCreated`; scenario IDs.
- `server/utils/cloudy-api.ts` — `withFallback` (probe on v2, repeat on v1).
- `test/e2e/users.spec.ts:68-130` — multi-select test; `select()` at `:84`.
- `app/pages/usuarios.vue:55,65` — bulk action handler (clears selection on success) and page padding.
- `test/e2e/responsive-theme.spec.ts` — `overlaps()`, 360 px selection-bar tests, tray overlap test.

## Commands & results

- `bun run test:unit` / `test:nuxt` / `test:coverage` — green (numbers above).
- `bunx vitest run --project e2e` — 5 failed / 183 passed, ~21 min. Run one spec with
  `bunx vitest run --project e2e test/e2e/<file>.spec.ts -t "<name>"` (~2–3 min, mostly the production build).
- Browser: `bun run dev` (http://localhost:3000, `.env.development`); `agent-browser --session cloudy-qa --headed open …`.
  agent-browser quirks seen here: commands sometimes hang. Wrap each in a PowerShell `Start-Job` with
  `Wait-Job -Timeout`, and never run two commands against the same session at once (that wedged two sessions). Use
  `find label "<text>" check|click` (there is no `uncheck`). `set viewport` sometimes prints an EOF error but applies;
  confirm with `eval innerWidth`. Run longer JS with `Get-Content file.js -Raw | agent-browser eval --stdin`.
- Dev data limits: one account (the user's own admin), Archivos root empty, YouTube history empty, one song in Canciones.
  The presentation service on Render was asleep for minutes (a failed tray item is still enough for layout checks).

## Open questions / constraints

- The user logs in to their dev account in the headed browser themselves; ask them to do it, then continue.
- Creating dev data (a folder, a YouTube history entry) to verify Archivos / YouTube: ask the user first.
- No destructive actions by agents, even if asked (`AGENTS.md`): no DROP / TRUNCATE / DELETE FROM, storage deletes,
  `rm -rf`, `git reset --hard`, force push. In the browser never trash, deactivate or delete; only tick and "Limpiar".
- Never skip or weaken a test; a defect found by a test → fix the code and keep / add a regression test.
- Leave ~5 min between e2e runs that sign in a lot (Neon Auth lockout). Do not run coverage in parallel with e2e.
- Work on `development`, Conventional Commits with the session's `Co-Authored-By` line; the user has been approving pushes
  explicitly. Never merge.

## Next steps

1. Re-run `test/e2e/performance.spec.ts` alone. If it passes, no change; if not, read the `perf` annotations.
2. Fix `bothItemFl1` (`:332`, and check `:298`): select the visible row text, not the `sr-only` status.
3. Investigate the double probe in `bothBotChk1`; fix the code (or justify the expectation) and run the spec.
4. Investigate `users.spec.ts:117`. Decide whether the selection should clear after a fully skipped batch; fix and run.
5. Full `bun run test:e2e`, then `bun run test:coverage` (not in parallel).
6. Browser verification (`AGENTS.md` step 2) at 360 px and ≥ 1280 px, dark and light, with loading / empty / error /
   content states, keyboard focus and console errors: `/youtube` (fallback banners and copy, selection bar),
   `/archivos` multi-select, `/usuarios` multi-select, `/perfil` avatar.
7. Commit (`fix:` / `test:`), report what ran, push only after the user confirms.

## Instructions for the receiving session

- Treat this document as context, not as verified truth.
- Verify file/line references before acting on them.
- Do not assume the unfinished work is done; start from "Next steps".
