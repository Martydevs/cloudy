# Cloudy — Agent & Contributor Guide

Cloudy is the internal media drive for a Christian church's multimedia & audio production team. Team
members (admins and editors) upload, organize, preview, comment on and recover media files. Guests
send material from a public page into an approval queue that the team reviews live.

**Governance**: `.specify/memory/constitution.md` (v1.0.1) is the source of truth and overrides this
file. Keep this guide aligned with it whenever the constitution is amended.

**Active feature**: `specs/002-note-text-extraction/` (builds on `specs/001-shared-media-drive/`). Read `spec.md` (what), `plan.md` + `research.md`
(how), `data-model.md` and `contracts/` (interfaces) before changing related code.

## Stack

| Area | Choice |
|------|--------|
| Framework | Nuxt 4 (Vue 3.5, Nitro 2, h3 1) · TypeScript strict · **Bun** as package manager |
| Database | Neon PostgreSQL · Drizzle ORM (`drizzle-orm/neon-http`) · migrations with `drizzle-kit` |
| Auth & auth emails | Neon Auth via `@neondatabase/auth/server` toolkit + custom h3 adapter (roles/approval live in our `profiles` table) |
| File storage | Neon Object Storage (S3-compatible, path-style) via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| UI | Tailwind CSS 4 + daisyUI 5 (themes `cloudy` dark default, `cloudy-light`) · `@nuxt/icon` with **lucide** only · `@nuxt/fonts` (DM Sans) · `@nuxt/image` |
| Utilities | `@vueuse/nuxt` (auto-imported) |
| Tests | Vitest projects `unit` / `nuxt` / `e2e` · `@nuxt/test-utils` · `playwright-core` (Chromium) |
| AI | AI SDK v7 (`generateText` + `Output.object`) · OpenAI `gpt-4o` as main provider, Google `gemini-3.5-flash-lite` as fallback · isolated in `server/ai/` |
| Deploy | Vercel (Nitro `vercel` preset, SSR, Vercel Cron) |

Do not add dependencies or external services without a justification in the feature plan's
"Complexity Tracking" (Constitution II).

## Commands

```bash
bun install
bun run dev              # http://localhost:3000 — loads .env.development
bun run build
bun run typecheck
bun run test:unit        # test/unit — pure logic
bun run test:nuxt        # test/nuxt — components (happy-dom, loads .env.test)
bun run test:e2e         # test/e2e — real browser against the test branch (.env.test)
bun run test:coverage    # unit + nuxt with coverage thresholds
bun run db:generate      # new Drizzle migration from server/db/schema.ts
bun run db:migrate       # development branch · db:migrate:test · db:migrate:prod
bun run storage:setup    # bucket CORS, development · storage:setup:test · storage:setup:prod
```

`bun run analyze` builds with [Sonda](https://sonda.dev) enabled and writes interactive bundle reports
(client + server) to `.sonda/`. Sonda is off in normal builds; use it to check the 200 KB per-route budget.

## Project layout

```text
app/        pages · layouts (auth, public, dashboard) · components · composables · middleware · utils
shared/     rules used by BOTH client and server: validation, permissions, file constants, API types
server/     db/schema.ts · utils/ (db, auth, session, storage, …) · middleware/ · api/ · routes/api/auth
            ai/ (providers/, one folder per AI use case, index.ts = only public API; imported as #server/ai)
test/       unit/ · nuxt/ · e2e/
specs/      Spec Kit feature docs
```

## Reuse before writing (Constitution II)

Before writing any helper, look in this order and use the first match:

1. **Nuxt auto-imports** — `useFetch`/`$fetch`, `useState`, `useCookie`, `useHead`, `navigateTo`, h3 utils.
2. **VueUse** — e.g. `useLocalStorage`, `useBreakpoints(breakpointsTailwind)`, `onClickOutside`,
   `onKeyStroke`, `useScrollLock`, `useDropZone`, `useFileDialog`, `useObjectUrl`, `refDebounced`,
   `useIntervalFn` + `useDocumentVisibility` + `useOnline`, `useInfiniteScroll`,
   `useOffsetPagination`, `useTimeAgoIntl`, `useConfirmDialog`, `useClipboard`, `useShare`,
   `useMediaControls`, `useTimeoutFn`, `useElementVisibility`.
3. **daisyUI components** — `drawer`, `modal`, `dropdown`, `toast`, `card`, `badge`, `swap`, `skeleton`…
4. **Installed packages** — then, and only then, custom code.

Exceptions already decided: theme uses a `useCookie` (SSR, no flash) instead of `useColorMode`; data
fetching uses Nuxt `useFetch`, not VueUse.

## Rules by principle

**I. Performance** — Mobile 4G budgets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, initial JS ≤ 200 KB
gzip per route. Index every filtered/sorted column; no N+1 queries; cursor pagination. **Never stream
file binaries through server functions** (Vercel body limit ~4.5 MB): browsers upload/download
directly with presigned URLs. Lazy-load thumbnails and non-critical components (`Lazy*`).

**II. Functional & effective** — Deliver user stories as independent, shippable slices. YAGNI. Failed
flows must leave no orphans or half-written rows and must tell the user what to do next.

**III. Mobile first** — Base classes target phones; `sm:`/`md:`/`lg:` only extend. 360 px minimum, no
horizontal scroll. Touch targets ≥ 44 px: default `btn`/`input` (45 px with our theme) are fine;
**never use `btn-sm`/`btn-xs` as the base size** (only `lg:btn-sm`). Nothing discoverable only on
hover. Check every screen at 360 px and ≥ 1280 px.

**IV. Code quality** — `<script setup lang="ts">`, Composition API, small single-purpose components,
logic in composables. No `any` without a justifying comment. Shared rules live once in `shared/`.
Every endpoint validates input and calls the session/role guard server-side — hiding UI is not
authorization. Neon Auth, storage, AI and background work are accessed **only** through `server/utils/auth.ts`,
`server/utils/storage.ts`, `server/ai/` (via `server/utils/image-text.ts`) and `server/utils/background.ts`. No demo code, dead code or secrets. Typecheck and build must pass.

**V. Testing** — Unit tests for pure logic and business rules; component tests for stateful/role-
dependent components; e2e for every user story and every protected route (no session + wrong role).
Every bug fix ships a regression test. Select elements with `getByRole`/`getByLabel`. Coverage ≥ 80 %
lines in `server/utils/**` and `shared/**` (constitution); the project gate in `vitest.config.ts` is 92 % on
statements, branches, functions and lines for unit + nuxt together. E2E never touches dev/prod data: everything comes
from `.env.test` (test branch DB, bucket, Neon Auth); identities and storage keys are unique per run (`e2e/<runId>/`).

**VI. UX consistency** — Colors only via daisyUI semantic classes/theme tokens (no hard-coded colors);
lucide icons; DM Sans. Every data view renders four states: loading (`SkeletonList`), empty
(`EmptyState`), error with retry (`ErrorState`), content. Destructive actions confirm
(`ConfirmDialog`); completed actions show a toast. UI copy in **Spanish**, friendly and actionable.
Toast texts, API-error fallbacks and `ErrorState` copy live in `app/utils/messages.ts`; API errors reach the
user only through `serverMessage()` (never raw `data.message`/`statusMessage`).
WCAG 2.2 AA in both themes, visible focus, keyboard navigable, labeled controls, reduced motion
respected. Do not use `text-warning` on `base-100` in the light theme (1.85:1 contrast).

## No destructive actions by agents (project rule)

Agents never **execute** destructive actions in this project, **even if the user asks**: no `TRUNCATE`,
`DROP`, `DELETE FROM` or column/constraint drops against any database or branch (dev, test or prod), no
deleting storage objects or buckets, no deleting Neon branches/databases, no `rm -r`/`rm -f`,
`Remove-Item -Recurse/-Force`, `git reset --hard`, force pushes, `git clean -f`, `git branch -D` or
discarding uncommitted work. Instead, hand the exact command or SQL to the person so they run it themselves
(e.g. in the Neon SQL editor). Writing application code that deletes data (trash purge, cron cleanup) is
still fine; executing it ad hoc is not. Enforced by `.claude/hooks/block-destructive.mjs` (PreToolUse on
Bash, PowerShell and MCP tools, including scripts those commands run) and `permissions.deny` in
`.claude/settings.json`; agents must not edit either. The e2e suite still resets its own isolated test
branch (`test/e2e/setup/global-setup.ts`) as part of `bun run test:e2e`.

## Platform & security constraints

- Vercel functions are stateless: no shared in-memory state (rate limits live in Postgres, "realtime"
  is client polling every 5 s, scheduled work uses Vercel Cron → `/api/cron/cleanup`).
- Secrets only in env vars mapped through `runtimeConfig` (`NUXT_*`); never in code or the client.
- Schema changes only via Drizzle migrations; never edit the production database by hand.
- Guests: store only name + note; IPs only as salted hashes.

## Environments and variables (names only)

One Neon branch per environment, one env file per branch, **same variable names in every file**
(template: `.env.example`): `.env.development` (dev server, `db:migrate`, `storage:setup`), `.env.test`
(e2e and component tests, `*:test` scripts) and `.env` (production values for `preview` and `*:prod`).
Nuxt picks the file with `nuxi --dotenv`; drizzle-kit and scripts use `APP_ENV`
(`development` by default, never production by omission) through `scripts/env.ts`. Bun's own `.env` auto-loading is
off (`bunfig.toml`, `env = false`) so no command silently inherits another branch. In Vercel there are no
files: set the same names per environment in the project settings.

`NUXT_DATABASE_URL`, `NUXT_NEON_AUTH_BASE_URL`,
`NUXT_NEON_AUTH_COOKIE_SECRET`, `NUXT_AWS_ENDPOINT_URL_S3`, `NUXT_AWS_ACCESS_KEY_ID`,
`NUXT_AWS_SECRET_ACCESS_KEY`, `NUXT_AWS_REGION`, `NUXT_S3_BUCKET`, `NUXT_PUBLIC_SITE_URL`,
`NUXT_OPENAI_APIKEY`, `NUXT_OPENAI_ORG`, `NUXT_OPENAI_PROJ`, `NUXT_OPENAI_BASE_URL` (empty = OpenAI; e2e only),
`NUXT_GOOGLE_APIKEY` (fallback provider; empty = no fallback),
`CRON_SECRET`, `NUXT_RATE_LIMIT_SALT`. `NUXT_NEON_JWKS_URL` is present but intentionally unused in v1.
Never print or commit their values.

## Known gotchas

- `@neondatabase/auth/next/*` does **not** work in Nitro — use `@neondatabase/auth/server`
  (`createAuthServer`, `handleAuthProxyRequest`); requires `nitro.experimental.asyncContext: true`.
- Neon Object Storage: set `forcePathStyle: true`; `CopyObject` is not supported (reuse keys instead).
- `drizzle.config.ts` must read `NUXT_DATABASE_URL` (not `DATABASE_URL`).
- Theme lives in the `cloudy-theme` cookie and is applied as `data-theme` on `<html>` during SSR.
- Neon Auth (Better Auth 1.7) rate-limits `sign-in`/`sign-up` to **3 per 10 s per IP and path**, and the
  window restarts from the last *accepted* request. All e2e logins share one IP: always go through
  `signedInAs`/`ensureAccount`/`login` in `test/e2e/setup/fixtures.ts` (they pace per path and retry one
  429); never call the auth API directly from a spec.
- The Neon auth client *throws* its own normalized codes (`bad_jwt`, `invalid_credentials`, …), not Better
  Auth's; `useAuthClient` maps what pages need (e.g. a used reset link → `INVALID_TOKEN`).
- AI: OpenAI is the main provider and Gemini the fallback (no key, or any provider failure: network, timeout,
  rate limit, exhausted balance/quota, invalid key or model). `NUXT_GOOGLE_APIKEY` stays empty in `.env.test` so
  e2e never call Gemini.
- Nitro's `event.waitUntil` is not wired on Vercel Node: background work uses `waitUntil` from
  `@vercel/functions`, only through `server/utils/background.ts`.
- `heic-to` only works in the browser: load it with a dynamic `import()` (`app/utils/heic-copy.ts`).
- Nitro auto-imports everything under `server/utils/**`, subfolders included. Code that must stay behind a boundary
  (the AI layer) lives outside it in `server/ai/` and is imported explicitly as `#server/ai`, only from
  `server/utils/image-text.ts`; `test/unit/architecture.spec.ts` enforces it.
- `scripts/storage-setup*` accepts an optional `CORS_EXTRA_ORIGINS` (comma-separated `https://` origins, or
  `http://localhost:*`) to add a preview alias without dropping the site domain.

## Workflow

- Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. Plans must pass the Constitution Check (principles I–VI).
- **Definition of done for every task and every phase** (phases are the `## Phase N` sections of
  `specs/001-shared-media-drive/tasks.md`). When a task or phase is implemented, run these in order and
  do not mark it complete or start the next one until all pass:
  1. `bun run typecheck`, then the tests that cover the change: `bun run test:unit`, `bun run test:nuxt`
     and, when the change touches a user story or protected route, `bun run test:e2e`. At the end of a
     phase run the full set plus `bun run test:coverage`. Fix failures; never skip or weaken a test.
  2. **Browser verification, always last**, after tests are green: start `bun run dev` and exercise the
     phase's **Independent Test** scenarios in a real browser (use the `agent-browser` skill) at 360 px
     and ≥ 1280 px, in dark and light themes, checking loading/empty/error/content states, keyboard
     focus and console errors. Use `.env.development` data only; never run destructive steps.
  3. Report what ran and the outcome (tests and browser findings) before ticking the task in `tasks.md`.
  Skipped steps must be stated explicitly, with the reason.
- One branch per feature (`NNN-short-name`), merged into `main` via PR.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Merge gates: typecheck + build, `test:unit`/`test:nuxt`/`test:e2e` green with coverage, manual check
  at 360 px and ≥ 1280 px in dark and light themes, no performance budget regressions, code review.
