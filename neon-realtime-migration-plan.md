# Plan: replace hand-written polling with Neon Realtime (feature 004, isolated branch)

## Context

Cloudy's "realtime" is client polling: the team pulse (`GET /api/realtime/pulse`, every 5 s, 6-statement batch), the guest on `/upload` (`GET /api/public/access/current`, every 5 s), the comment thread (every 5 s with `?since=`), and image-text reads (every 3 s while `reading`). Each poll is one Vercel function invocation plus one Neon round trip. Because a poll lands every 5 s, which is less than Neon's 5-minute suspend timeout, Neon compute **cannot scale to zero while any team tab is visible**.

Neon Realtime (beta) makes a SQL query live. The backend seals a read-only query with `NEON_REALTIME_SECRET`, the browser subscribes over a WebSocket to the Live SQL API, and changes are pushed from the incremental engine inside Postgres.

According to Neon's docs, holding a subscription open neither wakes compute nor uses a DB connection, and the service is free during the beta. The goal is to delete the polling code and move the remaining cost to event-driven work on Neon.

**Decisions taken**
- The migration lives on its **own branch and Spec Kit feature, `004-neon-realtime`**, so it can be dropped or reverted without touching 003.
- Production allows **exact origins only**.
- **Quality bar: ≥ 90 %** for both unit/component coverage and the verification scorecard (see "Quality gates").

## Branch setup (step 0, nothing runs before it)

1. The 003 branch has uncommitted work (constitution, AGENTS.md, `upload.vue`, tests…). **You commit it**, or tell me to, before 004 starts. Nothing is discarded.
2. `git switch -c 004-neon-realtime` from the committed tip of `003-public-photos-upload`. 004 depends on 003's guest-access code. Rebase 004 onto `main` once 003 merges.
3. Write `specs/004-neon-realtime/` through Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks`. That produces `spec.md`, `plan.md` (Constitution Check I–VI and the Complexity Tracking row for `@neon/realtime`), `research.md`, `data-model.md`, `contracts/` and `tasks.md`.
4. Point the "Active feature" line in AGENTS.md at `specs/004-neon-realtime/`.
5. **Rollback if something breaks:** 003 stays untouched. Switch back, or `git revert` the 004 merge. Neon's Realtime config is additive: the code ignores it, and allowed origins can be reset to `*`. No schema migration is involved.
- There is no polling fallback. The fallback is an `ErrorState` with a retry that subscribes again (risk noted below).

**Verified state (read-only)**
- Neon project `produccion` (`spring-voice-56232422`) is in `aws-us-east-2`, a supported region, and logical replication is already on.
- Realtime is **enabled** on all three branches:

  | Branch | Branch id | Endpoint |
  |---|---|---|
  | production | `br-shy-leaf-ae84dgvc` | `ep-dry-mouse-aes3ipg9` |
  | development | `br-lucky-paper-ae1kdk6t` | `ep-wandering-base-ae231eea` |
  | test | `br-patient-wind-aejizcd5` | `ep-rough-art-aevpyj4x` |

- `allowed_origins` is `[]` on all three, which means any origin.
- `NUXT_NEON_REALTIME_URL` and `NUXT_NEON_REALTIME_SECRET` are filled in `.env.development` and `.env.test`. They are mapped in `nuxt.config.ts:25-26` but not used yet.
- Every table involved has a primary key, so it has a stable replica identity.
- The e2e `TRUNCATE` (`test/e2e/setup/global-setup.ts`) leaves the Realtime config intact.

## Design

### 1. Hard constraints from the SDK, and how each is handled

| Constraint | Handling |
|---|---|
| A sealed query lives 60 s and must be renewed about every 50 s. | Each page seals **all** of its queries in **one** POST, so there is one renewal invocation per page per period. Renewal pauses while the tab is hidden or offline. On return, `stale` → renew → `live`. |
| Renewal must not touch Neon, or compute never sleeps. | All `/api/realtime/**` seal endpoints are **session-only**: the signed cookie is read with `getAuthUser`, with no `ensureProfile`. Generalize `DEFERRED_PROFILE` in `server/middleware/session.ts` to `/api/realtime/`. **Authorization moves into the SQL**: `EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = $1 AND me.status = 'active' AND me.role IN (…))`. This also gives live revocation. Sealing is local Web Crypto. |
| Queries must be deterministic, so no `now()`. | Select `expires_at` and `access_expires_at`, and filter in the browser with the server-clock skew. Seal responses carry `serverTime`. The guest keeps the `Date`-header skew. `accessStateOf` (`shared/constants/access.ts:27`) already runs anywhere. |
| The Drizzle adapter needs keys to equal column names, and our schema keys are camelCase. | Use `rawSql` from `@neon/realtime/server` with `$n` placeholders. This also avoids `@neon/realtime-drizzle`, one dependency fewer. |
| There is no Vue binding. | Write our own composable over `client.subscribe()` and our renewal scheduler, with the same timing as the React binding: 10 s early, 1 s retry. |
| Delivery of every change event isn't guaranteed, and a reconnect sends a full `rows` replacement. | Toasts come from an **id-set diff** between snapshots. The first result is skipped. The module-level `announced` Set stays. |
| Sealed queries are bearer tokens. | Return them only in POST bodies. Never in URLs, logs or storage, and never in the SSR payload. |
| The browser needs the WS URL. | The seal response returns `url` from the private `runtimeConfig.neonRealtimeUrl`, so env var names don't change in env files or Vercel. Normalize the URL scheme with `https→wss` only if the Phase 7 spike shows the client requires it. |

### 2. Server (new)

- **`server/utils/realtime.ts`**: the **only** gateway to `@neon/realtime/server`, like `storage.ts`.
  - Lazy `createRealtime({ secret, db })`. Take `db` from the pathname of `NUXT_DATABASE_URL`.
  - Set `debugMode` only in development.
  - Export `sealAll(record)` → `{ url, serverTime, expiresAt, queries }`.
- **`server/utils/live-queries.ts`**: pure builders that return `rawSql<Row>`. `$1` is always the session user id.
  - `teamSubmissionsLive(userId)`: same shape as `readyPendingSubmissionsSql()` (`server/utils/files.ts:214`), with the editor guard and `GROUP BY s.id`. The key is `id`.
  - `teamAccessRequestsLive(userId)`: `status = 'open'` plus `expires_at` and the columns `AccessRequestCard` shows. The expiry filter runs in the browser.
  - `pendingUsersLive(userId)`: `SELECT user_id, created_at FROM profiles WHERE status = 'pending' AND <admin guard>`. Non-admins get 0 rows, and count = length.
  - `guestAccessLive(tokenHash)`: `WHERE token_hash = $1`. It selects only the fields `accessStateOf` needs, never `token_hash`.
  - `fileCommentsLive(userId, fileId)`: mirrors `listComments` (`server/utils/comments.ts:49`) and `commentFileQuery`, with no `since`.
  - `fileTextLive(userId, fileId)` and `submissionFileTextLive(userId, submissionId, fileId)`: the `text_*` columns.
- **Endpoints**: all POST, all with input validated through `shared/validation`.
  - `server/api/realtime/team.post.ts`: seals the 3 team queries.
  - `server/api/realtime/files/[id].post.ts`: comments and text, in one seal.
  - `server/api/realtime/submissions/[id]/files/[fileId]/text.post.ts`
  - `server/api/public/access/live.post.ts`: reads the cookie hash with `readAccessTokenHash`. No cookie → 401. It makes **no DB call**, so it needs no rate limiter; record that in `test/unit/endpoint-guards.spec.ts`.
- Add the Complexity Tracking row for `@neon/realtime` (the only new dependency).

### 3. Client (new)

- **`app/utils/realtime-client.ts`**: one lazy client per app, via dynamic `import('@neon/realtime/client')` to keep it out of the entry chunk (250 KB budget). Recreate it after a connection-level `error`.
- **`app/composables/useLiveQueries.ts`**: `useLiveQueries(sealFn, { enabled })`.
  - It returns per-key `shallowRef` rows, `status` (`connecting|live|stale|error`), `skew` and `retry()`.
  - There is one renewal scheduler for the group, paused with `useDocumentVisibility` and `useOnline`.
  - A 401 on renewal sets a module flag and runs `window.location.reload()` once.
  - `onScopeDispose` unsubscribes.
  - Status → the four UI states: `connecting` → `SkeletonList`; `error` → `ErrorState` with retry, using copy in `app/utils/messages.ts`.
- **`app/composables/useTeamLive.ts`** (replaces `usePulse.ts`): keeps the `useState` keys its consumers read (`pendingCount`, `pendingUsers`, `openAccessRequests`) and adds `live` plus the id lists. It also holds the toast diff and the `announced` Set. It is mounted once in `app/layouts/dashboard.vue`.

### 4. Consumers to rewire

| File | Change |
|---|---|
| `app/pages/index.vue` | Switches from summary to live on `live`, not `cursor`. |
| `app/pages/solicitudes.vue` | `watch(submissionIds, refresh)`: an event-driven refetch, needed because cards need presigned URLs. Drop `refreshPulse()`. Keep the failed-reload retry with its own `RETRY_DELAY_MS`. |
| `app/components/guests/AccessRequestList.vue` / `AccessRequestCard.vue` | Render directly from live rows, filtered by expiry. Decisions stay REST POSTs, and the row leaves through the subscription. Drop `refreshPulse()`. Keep the 30 s countdown. |
| `app/pages/usuarios.vue`, `app/composables/useUserAdmin.ts` | `watch(pendingUserIds, refresh)`. Drop `refreshPulse()`. |
| `app/composables/useGuestAccess.ts` | Keep the SSR first load (`current.get.ts`, the skew from `Date`) and the 1 s local clock. Replace `poll` with a subscription while the state is not terminal (`TERMINAL_ACCESS_STATES`). State = `accessStateOf(row, serverNow)`. |
| `app/composables/useCommentThread.ts` | Subscribe while the thread is visible. Merge your own POST result by id. Drop `since`. |
| `app/composables/useImageText.ts` | Subscribe only while `reading`, then unsubscribe. |

### 5. Delete

- `server/api/realtime/pulse.get.ts`, plus `profileQuery` and `attachProfile` in `server/utils/session.ts`. `requireSessionUser` is reused.
- The `Pulse` type (`shared/types/api.ts:170`).
- `POLL_INTERVAL_MS`, `PULSE_OVERLAP_MS` (`shared/constants/files.ts:44-49`) and `TEXT_POLL_INTERVAL_MS` (`shared/constants/image-text.ts:16`).
- The `since` arguments of `readyPendingSubmissionsSql` and `openAccessRequestsSql`. Both keep serving `/api/dashboard`.
- `since` on `comments.get.ts`, `commentsQuery` and `listComments`. Remove `isoSince` if nothing else uses it.
- `usePulse.ts` and the pulse tests.

### 6. Keep

- `/api/dashboard` (SSR summary) and `current.get.ts` (SSR guest state).
- The `useNow` in `CommentItem`, the countdown in `AccessRequestCard`, and the camera visibility handling.
- The server-clock `created_at` stamping. It is still correct; only the reason in its comment changes.

## Neon platform setup per environment (confirm before running; non-destructive)

1. **Spike (T063)**: install `@neon/realtime`. Confirm against the development branch:
   - the URL scheme the client accepts
   - the real TTL
   - each live SQL statement, via `neon realtime subscribe "<sql>" --branch development` (read-only)
2. **Allowed origins**: `neon realtime enable --allowed-origin …`, which replaces the list.
   - development: `http://localhost:3000`
   - test: `http://localhost:3100` (`E2E_PORT`)
   - production: exact `NUXT_PUBLIC_SITE_URL` domain, plus any preview alias (≤16, no wildcards). **You give the domain at that step.**
3. **Env/branch match check**, printing no values: the realtime URL in `.env.development` must contain `ep-wandering-base`, and in `.env.test` it must contain `ep-rough-art`.
   - Set `NUXT_NEON_REALTIME_URL` and `NUXT_NEON_REALTIME_SECRET` in Vercel Production (`ep-dry-mouse`) and Preview.
   - Add both names to the `.env` production file if you keep one locally.

## Docs and governance (same phase)

- **`specs/004-neon-realtime/research.md`**: the decision "Neon Realtime replaces polling", with SDK constraints, the cost model and alternatives. Add a one-line "superseded by 004" note on 003 B6 and 001 R7.
- **`specs/004-neon-realtime/plan.md`**: the Complexity Tracking row.
- **`specs/004-neon-realtime/contracts/`**: the 4 seal endpoints, plus the removal of the pulse contract.
- **`AGENTS.md`**:
  - L87 (polling/`PULSE_OVERLAP_MS`)
  - L137-138 ("realtime is client polling every 5 s" → Neon Realtime, sealed queries, renewal)
  - L157-158 (realtime vars now used)
  - gotchas: no `now()` in live queries, `rawSql` only, session-only seal routes, origins per branch, the 60 s TTL
  - rule IV: Realtime is accessed only through `server/utils/realtime.ts`
- **`test/unit/architecture.spec.ts`**: `@neon/realtime/server` is imported only from `server/utils/realtime.ts`.

## Phases for `specs/004-neon-realtime/tasks.md`

Each phase is an independent, shippable slice. Each must pass the AGENTS.md definition of done **and** the quality gates below before the next one starts.

| Phase | Work |
|---|---|
| 1. Setup | The spike and the `@neon/realtime` dependency, pinned to an exact version (see the Neon setup section) |
| 2. Foundation | `realtime.ts`, `live-queries.ts`, the seal endpoints, the session-only middleware, `realtime-client.ts`, `useLiveQueries`, and the fake client in `test/nuxt/helpers/fake-realtime.ts` (mocks `@neon/realtime/client`) |
| 3. US1, team live | `useTeamLive`, the dashboard layout, and consumers (Inicio, Solicitudes, Usuarios, `AccessRequestList`/`Card`). Port the pulse tests |
| 4. US2, guest live | Live `/upload` |
| 5. US3, file page | Live comments and image text |
| 6. Polish | Deletions (section 5), architecture test, docs, allowed origins and Vercel env vars, e2e against the real test-branch Realtime, `analyze`, and the Neon measurement |

## Quality gates (≥ 90 %)

**Coverage**
- The project gate in `vitest.config.ts` stays at **92 %** for statements, branches, functions and lines. Do not lower it.
- Every **new** file must reach **≥ 90 % on each metric** on its own: `server/utils/realtime.ts`, `server/utils/live-queries.ts`, the 4 seal endpoints, `app/utils/realtime-client.ts`, `useLiveQueries`, `useTeamLive`, and the rewritten parts of `useGuestAccess`, `useCommentThread` and `useImageText`. Check it in the per-file coverage report.
- Deleting the pulse code must not lower the overall percentage. Port its tests instead of dropping them.

**Required unit tests (`test/unit`)**
- Every live-query builder has the authorization guard, contains no `now()` or `;`, binds the user id as `$1`, and never selects `token_hash`.
- Seal endpoints:
  - return 401 without a session
  - make **no `useDb` call**
  - validate their input
  - return `{ url, serverTime, expiresAt, queries }`
  - set `debugMode` only in development
- `endpoint-guards.spec.ts` classifies the new public endpoint.
- `architecture.spec.ts` checks that `@neon/realtime/server` is imported only from `server/utils/realtime.ts`.

**Required component tests (`test/nuxt`, using the fake client)**
- Renewal 10 s before expiry, with a 1 s retry.
- Renewal paused while hidden or offline, and an immediate renewal on return.
- A 401 triggers exactly one reload.
- `error` → `ErrorState` → `retry()` subscribes again, with a new client after a connection failure.
- The toast diff skips the first snapshot, toasts each new id once, and doesn't repeat after a `rows` replacement or a layout remount.
- Expiry is filtered with the skew.
- Guest state is derived from `accessStateOf`.
- Comments merge your own POST by id.
- The image-text subscription closes once the read is no longer `reading`.

**Verification scorecard**
- Report each check as pass or fail. 004 merges only at **≥ 90 % passed, with zero failures in tests, typecheck, build or authorization**.
- The checks are:
  1. typecheck
  2. build
  3. `test:unit`
  4. `test:nuxt`
  5. `test:e2e`
  6. coverage gate
  7. per-file coverage ≥ 90 %
  8. route ≤ 250 KB gzip (`analyze`)
  9. browser at 360 px, dark
  10. browser at 360 px, light
  11. browser at 1280 px, dark
  12. browser at 1280 px, light
  13. no repeating XHR in Network
  14. no renewal while the tab is hidden
  15. four UI states shown
  16. keyboard focus and console clean
  17. Neon compute measurement within the expected range

## Quantitative summary (usage and cost model)

**Neon baseline, current billing period, read via MCP**

| Branch | Active | Compute time | Egress |
|---|---|---|---|
| production | 17,480 s (4.9 h) | 4,412 s | 13.2 MB |
| development | 74,788 s (20.8 h) | 18,878 s | 79.2 MB |
| test | 74,724 s (20.8 h) | 19,092 s | 460.5 MB |
| **Project** | **167,300 s ≈ 46.5 h** | | |

Compute floor: 0.25 CU, autoscaling to 2, 5-minute suspend.

**Per open, visible tab**

| Workload | Before (polling) | After (Realtime) | Change |
|---|---|---|---|
| Team dashboard, Vercel invocations | 12/min = **720/h** | 1 renewal per ~50 s = **72/h** | **−90 %** |
| Team dashboard, Neon SQL statements | 720 × 6 = **4,320/h** | **0/h** at idle (seal is local crypto; session from the signed cookie) | **−100 %** |
| Team dashboard, Neon compute | Awake **100 %** of the time a tab is visible (5 s < 300 s suspend). One tab × 8 h/day ≈ ≥ 2 CU-h/day ≈ **≥ 44 CU-h/month** at the 0.25 CU floor (22 working days) | Awake only after writes or new subscriptions, ≈ 5 min per burst. E.g. 10 bursts/day ≈ 0.2 CU-h/day ≈ 4.6 CU-h/month | **≈ −90 %** (to verify) |
| Guest `/upload` waiting (≤ 8 min) | ≤ 96 calls + 96 DB lookups | ≤ 1 seal + 9 renewals, **0 DB lookups** | −90 % calls, −100 % DB |
| Guest `/upload` approved window (≤ 30 min) | ≤ 360 calls + 360 lookups | ≤ 36 renewals, 0 lookups | −90 % / −100 % |
| File page comments | 720 calls/h + 720 batches/h | 72 renewals/h, 0 DB | −90 % / −100 % |
| Image-text read (10–45 s) | 3–15 calls (every 3 s) | 1 seal, usually 0 renewals | −67…−93 % |
| Hidden tab | 0 | 0 (renewal paused) | — |

**Costs that remain**
- Realtime itself is **free during the beta**. Its post-GA pricing is not published.
- The initial result plus deltas count as Neon **egress**.
- Starting a subscription wakes compute.
- The engine works on write: a small WAL overhead, and replication is already on.
- I can't see Vercel invocation counts from here. Read them in the Vercel dashboard (Functions → Invocations) before and after.

**Measurement (T072)**
1. Record `compute_time_seconds` and `active_time_seconds` via Neon MCP `list_branches` on `development`.
2. Leave one dashboard tab idle and visible for 30 minutes.
3. Record both values again.

Expected: before, ≈ 1,800 s active; after, ≤ ≈ 300–360 s (one wake, then scale to zero). Report both numbers.

## Risks

- **The beta has no SLA and the protocol is still evolving.** Pin the exact `@neon/realtime` version.
  - If Realtime is down, counts and toasts stop, with an `ErrorState` and retry. Uploads and decisions keep working because they are REST.
- **RLS isn't supported**, but we don't use it.
- **The session-only seal routes trust the signed cookie.** A disabled user keeps renewing, but gets 0 rows because the guard is in the SQL.

## Verification

- `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e` (against the test branch), `test:coverage`, `build`, `analyze`.
- In the browser (`bun run dev`, `.env.development`), with two sessions:
  - A guest asks for access on `/upload`; the team toast and badge appear in under 2 s.
  - Approving shows on the guest side in under 2 s.
  - A comment from user A appears for user B.
  - The image-text status flips without polling.
  - DevTools Network shows **no repeating XHR**, only one WS plus one POST about every 50 s.
  - Hiding the tab shows no renewals.
  - 360 px and 1280 px, dark and light, keyboard focus, console clean.
- Run the Neon compute measurement above, and read Vercel invocations before and after.
