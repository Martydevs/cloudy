# Handoff: feature 007 (Peticiones), resume `/speckit-implement`

Written 2026-11-12 at the end of an interrupted session. Branch: `007-peticiones-imagenes`. Nothing has been committed
since `2901577`; all of the work below is uncommitted in the working tree.

Read first: `AGENTS.md`, `specs/007-peticiones-imagenes/{tasks.md,plan.md,research.md,data-model.md,contracts/api.md,contracts/ui.md}`.

## Status at a glance

| Phase | State |
|-------|-------|
| 1 Setup (T001–T004) | Done, ticked |
| 2 Foundational (T005–T025) | Done, ticked. Migration `drizzle/0009_striped_photon.sql` (2× `CREATE INDEX`) **applied to development and test** with the user's permission |
| 3 US1 (T026–T043) | Code and tests written; unit and nuxt tests green. **Not ticked**: e2e not run (T033) and browser DoD incomplete (T043) |
| 4 US2 (T044–T061) | Server and client code done, unit and nuxt tests green. **Missing: T050 (OpenRouter stub), T051 (e2e), T061 (DoD)**. Not ticked |
| 5 US3 (T062–T073) | Not started (partial pieces exist, see below) |
| 6 US4 (T074–T081) | Not started |
| 7 Polish (T082–T090) | Not started |

Last full green runs (end of Phase 2): `bun run typecheck`, unit (73 files / 1190 tests) and nuxt (57 files / 665 tests).
After that only the targeted files were run, and all of them were green. **Run the full unit, nuxt and typecheck suites before ticking anything.**

## Files created or changed in this session

**Shared:** `shared/constants/prayers.ts`, `shared/prayers.ts`, `shared/validation/prayers.ts`, `shared/types/api.ts` (`PrayerRequest`).

**Server:**
- New: `server/utils/prayer-requests.ts` (all of the feature's SQL), `server/utils/prayer-images.ts` (the only new `#server/ai` importer), `server/api/peticiones/index.get.ts`, `server/api/peticiones/imagenes.post.ts`, `server/ai/prayer-image/{schemas,prompt,generate}.ts`.
- Changed: `server/ai/index.ts` (new exports), `server/ai/providers/openrouter.ts` (`resolvePrayerImageModel`), `server/db/schema.ts` (2 indexes), `server/utils/image-text.ts` (`toImageText` now takes `ImageTextDtoRow`, type-only), `server/utils/submissions.ts` (adapted to that type).

**App:**
- New: `app/pages/peticiones.vue`, `app/components/prayers/{PrayerCard,PrayerCardSkeleton,PrayerGrid,PrayerSelectionBar,PrayerSelectionDialog,PrayerResults,PrayerResultCard,PrayerImagePreview}.vue`, `app/composables/{usePrayerRequests,usePrayerSelection,usePrayerImages,usePrayerLeaveGuard}.ts`.
- Changed: `app/utils/navigation.ts` (Peticiones entry after Solicitudes) and `app/utils/messages.ts` (`prayers` block; it already includes some US3 and US4 copy).

**Tests:**
- Unit: `prayers-shared`, `validation-prayers`, `prayer-requests`, `api-peticiones`, `prayer-prompt`, `prayer-generate`, `prayer-images`. Updated: `ai-openrouter-client`, `architecture`, `endpoint-guards`, `route-access`, `helpers/nitro.ts` (registers `prayer-requests` and `prayer-images`).
- Nuxt: `PrayerCard`, `usePrayerSelection`, `PrayerSelectionBar`, `PrayerSelectionDialog`, `pages-peticiones`, `usePrayerImages`, `PrayerResultCard` (also covers `PrayerResults`), plus `prayer-fixtures.ts` (shared builders; it lives in `test/nuxt/` and can't be deleted because agents may not delete untracked files). Updated: `four-states`, `AppSidebar`.
- E2E: `test/e2e/peticiones.spec.ts` (US1 block only), `setup/fixtures.ts` (`seedPrayerRequest`, `PrayerSeed`), `routes-guard.spec.ts` (`/peticiones` and `GET /api/peticiones`), `responsive-theme.spec.ts` (`/peticiones`).

## Decisions and deviations from `tasks.md` (keep them, or revisit deliberately)

- **Preset constant:** the code uses the existing `OPENROUTER_PRAY_REQUESTS_MODEL` (added in Phase 1) instead of the `PRAYER_IMAGE_MODEL` named in T022.
- **Keyset ordering:** the listing orders and compares by `date_trunc('milliseconds', gs.reviewed_at), f.id` so the cursor's precision matches, like `pagination.ts` does.
- **Infinite scroll:** `PrayerGrid` uses a sentinel with `useElementVisibility` (rootMargin 400px) plus a **Cargar más** button, instead of `useInfiniteScroll(window)`. This is the pattern the Songs and YouTube lists use, and it's testable. `PrayerGrid` emits `load-more` and `retry-more`.
- **Leave guard:** `usePrayerLeaveGuard` registers a `router.beforeEach` on mount and removes it on unmount, instead of `onBeforeRouteLeave`. `onBeforeRouteLeave` doesn't fire under `mountSuspended`. `beforeunload` is only registered on the client. The page also calls `images.reset()` and `selection.clear()` in `onBeforeUnmount`.
- **PrayerCard layering (a bug already fixed):** the stretched label is `absolute inset-0 z-[5]` and the photo box is **not** `relative`, otherwise the photo covered the radio and swallowed clicks. Anything clickable on the card must be `relative z-10` (Abrir foto today; Corregir texto in US3). **The fix hasn't been checked in the browser yet.**
- **Rate limits:** `POST /api/peticiones/imagenes` turns `hitRateLimit`'s 429 into `prayerError('rate_limited', {retryAfter})`. The order is guard → `readValid` → rate limit → generate. The endpoint aborts generation when `res` closes before it finishes.
- **`usePrayerImages`:**
  - Item keys are `img-<index>`; a new batch continues the numbering.
  - The `objectURL` lives in the item (`url`) and only `AbortController`s go in a module map. A late response from a dismissed or reset item is ignored by checking controller identity.
  - `onUnavailable` is a module-level `createEventHook`.
  - Errors that can't be retried: `quota_exceeded`, `not_configured`, `request_unavailable`.
- **Safe-area padding:** `PrayerSelectionBar` uses the class `pb-[max(0.75rem,env(safe-area-inset-bottom))]`, because happy-dom drops `env()` inline styles.
- **Already present for later stories:**
  - `messages.prayers.sent` is a label (`'Enviada el'`) followed by `<LocalTime>`.
  - `usePrayerSelection.sync()` exists and is tested (part of T072).
  - PrayerCard already renders the illegible marks via `splitIllegible`, and the badges Editada, Texto por corregir and Texto largo (part of T069).
- **Spec Kit pointer:** `.specify/feature.json` still points to `specs/003-guest-upload-access-code`. `check-prerequisites.ps1` therefore reports 003; use 007 (T001 says it should point to 007). Fixing the file is harmless.

## Environment notes

- **Dependencies:** `bun install` was needed (`@regle/nuxt`, `apify-client` and `@openrouter/ai-sdk-provider` were missing from `node_modules`).
- **No OpenRouter key in dev:** `.env.development` has **no `NUXT_OPENROUTER_APIKEY`**, so nothing is read or generated in dev. Generating there answers `503 not_configured`, which is the path T061 needs to verify.
- **No real OpenRouter calls:** the user decided this. Use the e2e stub for the happy path; T088 and T088b are left to the user.
- **Dev QA data** (created through `/upload` and Solicitudes): `QA Ana 2356` (2 approved images; one has `[ilegible]`), `QA Luis 2356` (1 approved) and `QA Pendiente 2356` (still pending). The transcripts were written with `PATCH /api/files/:id/text`.
- **Dev login:** the user shared a dev account in chat. **Ask the user for it again; it was deliberately not stored.**
- **Neon Auth lockout:** too many sign-ins in a row lock you out (429 for about 5 minutes). Log in **once** per QA session and reuse the cookies (save the context cookies to a scratchpad JSON and re-add them, checking `/api/me`). Leave about 5 minutes between e2e runs that log in a lot.
- **Browser QA tooling:** `agent-browser` isn't installed. Use `playwright-core` scripts in the scratchpad that import `file:///C:/Users/tmdev/dev/cloudy/node_modules/playwright-core/index.mjs`.
  - Wait for hydration with `#__nuxt.__vue_app__`.
  - `page.route` can't intercept the SSR fetch. For the empty, error and loading states, navigate client-side (`document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push('/peticiones')` from another page) with the route intercepted.
- **e2e and the dev server:** e2e builds into the same `.nuxt` as `bun run dev` and serves on :3100. **Stop the dev server before `bun run test:e2e`.** A `bun run dev` started in the old session may still be running on :3000; stop it.

## Next steps, in order

1. **Sanity check:** run `bun run typecheck`, `bun run test:unit` and `bun run test:nuxt`.
2. **Finish US1 (T043):** do the browser pass on `/peticiones`.
   - Cover 360 px and 1280 px, `cloudy` and `cloudy-light`, all four states, Tab plus Space on the radio, the **Ver elegidas** dialog and the console.
   - Confirm the radio indicator now shows on top of the photo, and that clicking the photo toggles selection.
   - Check that the selected state shows the `lucide:check` icon legibly over the daisyUI checked radio.
   - Check the contrast of `badge-warning badge-soft` in the light theme.
3. **T050, OpenRouter stub (`test/e2e/setup/openrouter-stub.ts`):** detect generation requests **before** the image-text path. A request is a generation if `body.model === '@preset/pray-requests-image-generation'` or `body.modalities` includes `'image'`.
   - **Response:** a chat completion whose `choices[0].message` is `{ role:'assistant', content:'', images:[{ type:'image_url', image_url:{ url:'data:image/png;base64,…' } }] }`, using `test/fixtures/files/imagen.png`.
   - **Recorded per call:** model, modalities, whether a `data:image/jpeg` template part arrived, the number of `<peticion` tags, and the prompt text (to assert there are no guest names or notes, and that corrected text arrives).
   - **Scenarios**, chosen by a keyword in the petition text:
     - `sin-imagen`: no `images` in the reply, which surfaces as `invalid_output`.
     - `sin-credito`: HTTP 402.
     - `lento`: delayed reply.
     - `falla-una-vez`: the AI SDK retries a 500 once on its own (`maxRetries: 1`). The stub must therefore fail the **first two** calls carrying that keyword so the UI really sees a failure; the user's Reintentar then succeeds.
   - Expose the calls in `fixtures.ts` (extend `StubCalls` or add `prayerCalls()`) and reset them with `resetStub`.
4. **T051, US2 e2e block in `peticiones.spec.ts`**, following the task text:
   - 5 → 2 images; downloads named `peticiones-<fecha>-1.png` and `-2.png`.
   - The `[ilegible]` warning and **Generar de todos modos**.
   - `falla-una-vez` and `sin-credito`.
   - **Generar de nuevo**; trash a chosen request and expect the 409 that removes it.
   - The leave confirmation, and offline behaviour.
   - Also add `['POST', '/api/peticiones/imagenes']` to `routes-guard.spec.ts`.
5. **Run e2e** (dev server stopped): `bunx vitest run --project e2e test/e2e/peticiones.spec.ts test/e2e/routes-guard.spec.ts test/e2e/responsive-theme.spec.ts`, then `bun run test:coverage` (92 % gate on each new file). Then do T061's browser pass: in dev, confirm the confirmation dialog and the `not_configured` error in a result card. Tick T026–T061.
6. **US3 (T062–T073):**
   - `ImageTextPanel` emits `change` (watch the state after an action, not on mount).
   - `PATCH /api/files/:id/text` gets `hitRateLimit(event, \`text-edit:${userId}\`, {limit:120, windowSec:3600})` before saving.
   - Add the **Corregir texto** / **Escribir transcripción** button (`relative z-10`, emits `fix`) to PrayerCard.
   - Build `PrayerTextDialog` (lazy).
   - Add `usePrayerRequests.patchText`.
   - In the page: `fix` opens the dialog, and `change` triggers `patchText`, `selection.sync` and a toast.
7. **US4 (T074–T081):**
   - Build `usePrayerFilters` (`refDebounced` 300 ms; local-day presets) and `PrayerToolbar`.
   - The page passes `filters.query` to `usePrayerRequests` (it already reacts to query changes).
   - Add the filtered empty state with **Quitar filtros**.
   - The filter UI copy still needs adding to `messages.prayers`.
8. **Polish (T082–T090):**
   - Bundle budget with `bun run analyze`.
   - EXPLAIN SQL to hand to the user (agents don't run database commands without permission).
   - Accessibility, `security-review`, and the AGENTS.md and quickstart notes.
   - Full suite plus `bun run build`.
   - T088, T088b and T089 (prod migration) belong to the user.
9. **Commits:** Conventional Commits, only when the user asks.
