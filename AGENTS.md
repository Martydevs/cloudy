# Cloudy — Agent & Contributor Guide

Cloudy is the internal media drive for a Christian church's multimedia & audio production team. Team
members (admins and editors) upload, organize, preview, comment on and recover media files. Guests
send material from a public page into an approval queue that the team reviews live.

**Governance**: `.specify/memory/constitution.md` (v1.2.0) is the source of truth and overrides this
file. Keep this guide aligned with it whenever the constitution is amended.

**Active feature**: `specs/007-peticiones-imagenes/` (Peticiones page: approved guest prayer-request images shown as selectable cards, corrected with the feature-002 text editor and
turned into "prayer requests of the day" images, up to 4 requests per image, by the OpenRouter preset `@preset/pray-requests-image-generation` over a bundled template; no new
dependencies. Amended 2026-11-12: generated images are stored in the bucket (`prayer_images`, migration `0010`), listed in a team-wide history and grouped in named collections, see the
amendment at the top of its `spec.md`). Previous: `specs/006-canciones-lyrics-pptx/` (Canciones page: Letras.com lyrics crawled with the Apify actor `apify/rag-web-browser` through `apify-client`, then
turned into `.pptx` slides by the external `cloudy-api` service; reuses the shape of `specs/005-youtube-downloads/`, whose YouTube page is the previous active feature, and builds on
`specs/001-shared-media-drive/`, `specs/002-note-text-extraction/` and `specs/003-guest-upload-access-code/`; feature 003's access-approval step was later removed, see the
amendment at the top of its `spec.md`). Read `spec.md` (what), `plan.md` + `research.md`
(how), `data-model.md` and `contracts/` (interfaces) before changing related code.

## Stack

| Area | Choice |
|------|--------|
| Framework | Nuxt 4 (Vue 3.5, Nitro 2, h3 1) · TypeScript strict · **Bun** as package manager |
| Database | Neon PostgreSQL · Drizzle ORM (`drizzle-orm/neon-http`) · migrations with `drizzle-kit` |
| Auth & auth emails | Neon Auth via `@neondatabase/auth/server` toolkit + custom h3 adapter (roles/approval live in our `profiles` table) |
| File storage | Neon Object Storage (S3-compatible, path-style) via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| UI | Tailwind CSS 4 + daisyUI 5 (themes `cloudy` dark default, `cloudy-light`) · `@nuxt/icon` with **lucide** only · `@nuxt/fonts` (DM Sans) · plain `<img>` (no `@nuxt/image`: media is private, served by presigned redirects) |
| Utilities | `@vueuse/nuxt` (auto-imported) |
| Forms | Regle (`@regle/schemas`) over zod schemas (`zod/mini`) in `app/utils/form-schemas.ts`, always through `useFormSchema` (`app/utils/form-schema.ts`) · `@regle/nuxt` (auto-imports and its plugin, loaded normally) |
| Tests | Vitest projects `unit` / `nuxt` / `e2e` · `@nuxt/test-utils` · `playwright-core` (Chromium) |
| AI | AI SDK v7 (`generateText` + `Output.object`) · OpenRouter as the only provider via `@openrouter/ai-sdk-provider`, preset `@preset/image-content-extraction` (the preset picks model and routing and carries the system prompt: the code sends only the user prompt in `server/ai/image-text/prompt.ts`) · isolated in `server/ai/` |
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
(client + server) to `.sonda/`. Sonda is off in normal builds; use it to check the 250 KB per-route budget.

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

**I. Performance** — Mobile 4G budgets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, initial JS ≤ 250 KB
gzip per route. Index every filtered/sorted column; no N+1 queries; cursor pagination. **Never stream
file binaries through server functions** (Vercel body limit ~4.5 MB): browsers upload/download
directly with presigned URLs. The bounded exception is the lyrics `.pptx` of feature 006 (see Known gotchas); the generated prayer-request image of feature 007 no longer travels back as a
response: it is born in the server function and uploaded from there to the bucket (≤ 4 MB), then served by presigned redirects like any file. Lazy-load images and non-critical components at the component level (a thumbnail is optional: an image without one loads only near the viewport, inside a fixed-size box) (`Lazy*` behind `v-if` for UI that only appears after an action or a later state, e.g. `LazyItemDialogs`).
Guest upload (feature 003, one step): at `/upload` the guest fills name + optional note + files in one form
(`GuestUploadForm` → `POST /api/public/submissions`, then `POST /api/public/submissions/:id/complete`) and the
submission lands straight in the team's queue; the only approval is staff approving/rejecting the files. No guest
cookies, no access request. Limits: 5 submissions per hour per network (`guest:<hashSender(ip)>`); closing a send
(`complete`) allows 60 per hour per network, since many guests share one Wi-Fi. The team pulse cursor overlaps by
`PULSE_OVERLAP_MS` and the client announces each id once.

**II. Functional & effective** — Deliver user stories as independent, shippable slices. YAGNI. Failed
flows must leave no orphans or half-written rows and must tell the user what to do next.

**III. Mobile first** — Base classes target phones; `sm:`/`md:`/`lg:` only extend. 360 px minimum, no
horizontal scroll. Touch targets ≥ 44 px: default `btn`/`input` (45 px with our theme) are fine;
**never use `btn-sm`/`btn-xs` as the base size** (only `lg:btn-sm`). Nothing discoverable only on
hover. Check every screen at 360 px and ≥ 1280 px.

**IV. Code quality** — `<script setup lang="ts">`, Composition API, small single-purpose components,
logic in composables. No `any` without a justifying comment. Shared rules live once in `shared/`.
Every endpoint validates input and calls the session/role guard server-side — hiding UI is not
authorization. Neon Auth, storage, AI, the `cloudy-api` service (YouTube downloads and lyrics presentations), Apify (lyrics crawling) and background work are
accessed **only** through `server/utils/auth.ts`, `server/utils/storage.ts`, `server/ai/` (via `server/utils/image-text.ts`), `server/utils/cloudy-api.ts`,
`server/utils/lyrics-crawler.ts` (the only importer of `apify-client`) and `server/utils/background.ts`. No demo code, dead code or secrets. Typecheck and build must pass.
Forms validate with a zod schema from `app/utils/form-schemas.ts` through `useFormSchema` — never `useRegle`/`useRegleSchema`
directly (`test/unit/architecture.spec.ts` enforces it). Schemas mirror `shared/validation` (messages and limits come from there);
the server stays the authority and `test/nuxt/form-schemas.spec.ts` checks both agree.

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
`NUXT_OPENROUTER_APIKEY` (empty = no image-text reads), `NUXT_OPENROUTER_BASE_URL` (empty = OpenRouter; e2e only),
`NUXT_CLOUDY_API_URL` + `NUXT_CLOUDY_API_KEY` (YouTube download and lyrics presentation service; empty = the pages answer "not configured"; e2e point the URL
at `test/e2e/setup/cloudy-api-stub.ts`), `NUXT_APIFY_API_KEY` (lyrics crawling; empty = "not configured") + `NUXT_APIFY_BASE_URL` (empty = Apify;
e2e → `test/e2e/setup/apify-stub.ts`), `CRON_SECRET`, `NUXT_RATE_LIMIT_SALT`. `NUXT_NEON_JWKS_URL` is present but intentionally unused in v1. There is no Neon Realtime
config: "realtime" is client polling (`/api/realtime/pulse`).
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
  429); never call the auth API directly from a spec. Many sign-ins in a row also trip a longer lockout (429 with
  `retry-after` ≈ 250 s, too long to wait in a test), so `signedInAs` signs each account in through the UI **once per
  spec file** and reuses its cookies afterwards (checked with `/api/me`; it signs in again if the session was closed).
  Back-to-back e2e runs share that lockout: leave ~5 min between runs that log in a lot.
- The Neon auth client *throws* its own normalized codes (`bad_jwt`, `invalid_credentials`, …), not Better
  Auth's; `useAuthClient` maps what pages need (e.g. a used reset link → `INVALID_TOKEN`).
- AI: OpenRouter is the only provider; there is no fallback. Each image is one call (30 s, 1 retry, 45 s cap). The
  guest pool's per-run breaker stops calling OpenRouter after a 402 (out of credits), 401/403/404 (key, permissions,
  preset) or 3 transient failures in a row; images not started stay pending. With no key nothing is called. E2E run
  against a local chat-completions stub (`test/e2e/setup/openrouter-stub.ts`) through `NUXT_OPENROUTER_BASE_URL`, so
  they never call OpenRouter.
- Regle: `useRegleSchema` only exposes `$validate`/`$pending` at the root (fields keep `$touch`, `$reset`, `$errors`). The plugin
  `@regle/nuxt` registers loads normally, so Regle travels in the shared entry chunk of every route (heaviest route ≈ 158 KiB gzip).
  `zod/mini` keeps the Regle + zod code small.
- The Neon auth client also normalizes `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (sign-up, 422) to `validation_failed` and
  `INVALID_PASSWORD` (change password, 400) to `invalid_credentials`; `useAuthClient` maps both back to Better Auth's codes.
- `useFetch` shares its data by key and `refresh()` runs the *first* instance's options: state every instance must see
  lives in `useState`, not in a local ref.
- Nitro's `event.waitUntil` is not wired on Vercel Node: background work uses `waitUntil` from
  `@vercel/functions`, only through `server/utils/background.ts`.
- `heic-to` only works in the browser: load it with a dynamic `import()` (`app/utils/heic-copy.ts`).
- Nitro auto-imports everything under `server/utils/**`, subfolders included. Code that must stay behind a boundary
  (the AI layer) lives outside it in `server/ai/` and is imported explicitly as `#server/ai`, only from
  `server/utils/image-text.ts`; `test/unit/architecture.spec.ts` enforces it.
- `scripts/storage-setup*` accepts an optional `CORS_EXTRA_ORIGINS` (comma-separated `https://` origins, or
  `http://localhost:*`) to add a preview alias without dropping the site domain.
- Routes (feature 003): guests send files at `/upload` (public, one step); the old `/enviar` link 301-redirects there via
  `routeRules`. The team's queue is `/solicitudes` (the old `/pendientes` 301-redirects there too). The dashboard's
  "Copiar enlace para invitados" copies `/upload`.
- `Permissions-Policy` opens only `camera=(self)` (guest camera, feature 003); everything else stays `()`.
  `getUserMedia` needs a secure context: from a phone in dev use an HTTPS tunnel. `test/e2e/camera.spec.ts` uses
  Chromium's `--use-fake-ui-for-media-stream` / `--use-fake-device-for-media-stream` and forces `(pointer: coarse)`.
- YouTube (feature 005): download jobs live **only** in the `cloudy-api` service (in memory, files for 30 min); the browser
  creates them, polls every 2.5 s and chains batches of `YOUTUBE_MAX_BATCH` one at a time (`useYoutubeDownloads`). The tray
  survives navigation but not a reload. The free Render instance sleeps: `/api/youtube/health` wakes it and the banner retries
  every 5 s. The player is YouTube's official embed (`youtube-nocookie.com/embed/<id>`, `YoutubePlayer`): a thumbnail until Play,
  then the iframe (no 720p copy, no cloudy-api job; `preconnect` on hover/focus). The external player window is a Cloudy page
  (`/youtube/<id>/ventana`) that autoplays the same embed. Cloudy sets no CSP, so no `frame-src` is needed. E2E run against `test/e2e/setup/cloudy-api-stub.ts` (scenario video IDs
  such as `okShortVid1`, `privateVid1`, `tooLongVid1`, `lowResVid01`; `setCloudyStubState('asleep')`) and serve `i.ytimg.com`
  thumbnails from a fixture with `routeYoutubeThumbnails(page)` and the embed iframe from a local page with `routeYoutubeEmbed(page)`.
- cloudy-api routes: the service exposes **unversioned** routes under `/api` (`/api/videos/{id}`, `/api/jobs`, `/api/jobs/{id}`,
  `/api/jobs/{id}/file`, `/api/lyrics/pptx`, `/api/lyrics/pptx/batch`) and `/healthz` at the root; the old `/v1/*` and `/v2/*` answer 404.
  `NUXT_CLOUDY_API_URL` is just the origin (no `/v1` suffix). There is a single download engine (pytubefix): `server/utils/cloudy-api.ts`
  never retries on another prefix and the browser never re-creates failed videos by itself (no `engine` field, no `?engine=`). When the
  service answers a 5xx **with** `detail.code` on a probe or a job creation, the server answers **502**
  `data: { code: 'service_failed', cause: 'botCheck' | 'failed' }`; a 5xx without code (or on polling/cancelling) is the usual **503**
  `waking`. Clients turn `service_failed` into copy with `serviceFailureMessage()` (`app/utils/youtube.ts`), because `serverMessage()`
  ignores the server text on a 5xx. Logs carry only call, status and code (`[cloudy-api] create → 502 (bot_check)`). E2E stub: every
  route lives under `/api`; scenario IDs `botCheckVd1` (502 `bot_check` on probe/create) and `itemBotChk1` (fails inside the job);
  `cloudyStubCalls()` returns `jobsCreated`, `createAttempts` and `probes` as counts.
- YouTube → drive: "Guardar en el drive" (`useYoutubeDriveImport`) moves the file **through the browser** (job in cloudy-api → `fetch` of the signed
  `downloadUrl` → the normal upload flow to the drive root), so the service's `ALLOWED_ORIGINS` must include the Cloudy origin (the e2e stub sends `access-control-allow-origin: *`).
  Files over `MAX_FILE_SIZE` (100 MB) are refused; `POST /api/uploads/:id/complete` takes an optional `source` that tags the `file.upload` activity (no new enum value).
  The action is offered on the video page, the history card menu, the selection bar and each playlist card's ⋯ menu (FR-033). One video uploads directly;
  several (selection or playlist) open `YoutubeDriveDialog` (checkboxes, all ticked) first. `startMany` queues them and they run **one at a time** (each file is
  buffered whole in the browser): the queue is driven by the `youtube-drive-imports` state itself (`pump`), not by module variables, so it can't leak between
  tests or stay stuck behind a hung import. Each import also has an `AbortController` (a module map, not state): API calls time out (`YOUTUBE_IMPORT_REQUEST_MS`), a download or upload with no progress for `YOUTUBE_IMPORT_STALL_MS` is aborted ("La conexión se quedó sin respuesta"), and the tray's **Cancelar** aborts a running import (or drops a queued one) so the queue keeps moving; the service job is always released. Progress lives in a "Guardar en el drive" section of `YoutubeDownloadTray` (the layout mounts the tray for downloads **or** imports).
- Multi-select (Archivos, Usuarios): selection is a `string[]` of ids (`v-model:selected` on `FileGrid`/`FileList`; a local ref in
  `usuarios.vue`) that is pruned to what is on screen and cleared when the folder, search, type filter or page changes. Checkboxes
  are always visible inside a `size-11` label with an `aria-label` naming the item. Their look is the theme default, taken from the
  Peticiones card (`app/assets/css/globals.css`): write `checkbox checkbox-primary` and nothing else, since the theme already makes them
  round, primary-coloured and filled with `base-100` when unchecked, so they read on photos and thumbnails without a backing chip
  (`bg-base-100/80`) or per-use `bg-*` overrides. A selectable **card** marks its selected state with `border-primary ring-2 ring-primary`
  (rows use `bg-primary/10`; a pending account keeps its warning border or row tint), never with a border colour alone (hover/focus already use `border-primary`). The fixed bar is `ui/SelectionBar.vue` (count in
  `role="status"`, "Limpiar", safe-area padding); `FilesSelectionBar` and `UsersSelectionBar` only add their actions. Every selection
  bar (this one, `YoutubeSelectionBar`, `SongSelectionBar`) sits above **both** trays, which can be open on any dashboard page:
  `bottom-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,0px))]` below `md` (the Canciones tray stacks on the YouTube one, `z-40`
  over the bar's `z-30`), then `md:bottom-4 md:right-[26rem]` beside them; write the full class literal (Tailwind only sees whole names).
  While something is selected the page gets bottom padding at least as tall as its bar: `pb-40 sm:pb-24` in Archivos, `pb-56 sm:pb-24`
  in Usuarios (three stacked actions, ~208 px at 360 px); the layout adds the trays' height on top. Bulk endpoints never fail the whole request for one
  item: `POST /api/items/trash` (editor; ≤ 100 ids; one `db.batch`; `{ trashed, skipped }`) reuses `trashFileOps`/`trashFolderOps`
  from the single `DELETE`s, and `POST /api/users/batch` (admin; ≤ 20 ids; `disable` | `remove` | `role`) runs `adminLock()` plus one
  `guardedProfileUpdate` per account in order, so the last-admin guard sees earlier changes of the same batch; it answers
  `{ updated, skipped: [{ id, reason: 'last_admin' | 'not_found' | 'unchanged' }] }` and logs activity only for accounts that changed.
  Confirmation, toast and self-warnings live in `useItemActions().trashMany` and `useUserAdmin().bulk`.
- `useFetch`/`useApiFetch` errors are `NuxtError`s (`statusCode`, and the server's JSON body in `data`), not ofetch `FetchError`s:
  read `error.value.statusCode` / `error.value.data.data.code`. And `serverMessage(error, fallback, byStatus)` only uses
  `byStatus` for 4xx: name a 503 explicitly (e.g. `messages.youtube.service.waking`).
- Canciones (feature 006): a pasted Letras.com link is validated by `parseLetrasUrl` (`shared/validation/songs.ts`, the server-side SSRF guard) and
  normalized to `https://letras.com/<artist>/<song>` (`songs.source_url` is UNIQUE). Only a **new** link or **Volver a obtener la letra** runs the Apify
  actor `apify/rag-web-browser` (it costs credit, ~20 s): `lyrics-crawler.ts` calls it with `timeoutSecs: 60` (the SDK timeout is per HTTP request and
  `waitForFinish` long-polls up to 55 s) and `log: null` (no extra calls, no actor log lines in ours). Letras.com redirects a nonexistent song link to a
  **different** song with `200`: the endpoint compares the crawled `finalUrl` with the requested link and answers `no_lyrics` if they differ. Lyrics are
  stored as `string[][]` (stanzas → lines), **never HTML**; `lyricsToHtml` rebuilds escaped HTML for the service on every generation and the UI shows
  plain text (no `v-html`). The `.pptx` (tens of KB) goes through `POST /api/songs/[id]/pptx` because the service key cannot leave the server: it is
  the **only** bounded exception to "never stream binaries through server functions"; presentations are not stored. Font colour is fixed white
  (`SONG_FONT_COLOR`). The browser generates presentations **one at a time** (`useSongPresentations`, queue in `useState('songs-presentations')`
  driven by `pump`; `AbortController`s and `objectURL`s in module maps; `$api` has no `.raw`, so headers are read in `onResponse`, and a `Blob`
  error body is parsed back into `response._data`). Functions run up to 120 s (`nitro.vercel.functions.maxDuration`); a `504` counts as transient.
  The daily cleanup deletes songs out of the history, in no collection and unchanged for 30 days. E2E run against the Apify stub (scenario slugs
  `sin-letra`, `muy-larga`, `fallo-del-run`, `sin-credito`, `redirige`, `con-tildes`; `letrasUrl(slug)`) and the `cloudy-api` stub's
  `POST /api/lyrics/pptx` (titles containing `vacia`, `demasiado larga`, `respaldo`).
- Peticiones (feature 007): the grid lists **approved** guest images (`files ⋈ guest_submissions`, `status = 'approved'`), ordered and filtered by `guest_submissions.reviewed_at`
  (approval date), keyset cursor, 12 per page; guest photos have **no thumbnail**, so each card sets `src` only when it enters the viewport. Transcript edits reuse
  `PATCH /api/files/:id/text` through `ImageTextPanel` (it now emits `change`). `POST /api/peticiones/imagenes` takes 1–4 file ids, rereads their text on the server (the browser never sends
  text), uploads the generated image to the bucket with `putObject` (`key('peticiones/<id>.<ext>')`, capped at `PRAYER_IMAGE_MAX_BYTES` = 4 000 000), inserts its `prayer_images` row and
  answers **201** with `PrayerGeneratedImage` JSON (no binary in the response); if the insert fails the object is deleted and it answers `502 save_failed`. The call goes
  through the existing OpenRouter client with the preset `@preset/pray-requests-image-generation` + `extraBody.modalities = ['image','text']`; the image arrives in `result.files`. The template
  is `server/assets/peticiones/plantilla.jpg` (Nitro `serverAssets`, `assets:peticiones`): replace the file and redeploy to change it. Only `server/utils/prayer-images.ts` imports `#server/ai`
  for this use case. The browser generates **2 images at a time** (`usePrayerImages`, state in `useState('prayer-images')`, `AbortController`s in a module map; no blobs or objectURLs): a saved
  image leaves the queue and is prepended to the history through `useState(PRAYER_HISTORY_ADDED_KEY)`; only queued/running/failed/canceled items stay in the queue, and the leave guard only
  counts queued/running. **History and collections (amendment, 2026-11-12)**: the page has three sections in this order: the approved requests as **one horizontally scrolling row** (`PrayerGrid`:
  `overflow-x-auto snap-x`, cards `w-72 sm:w-80`, the infinite-scroll sentinel at the end of the row observed with the row as root, «Cargar más» for keyboard, ‹ › buttons from `sm`;
  `PrayerCard :scroll-root` loads each photo near the row's edge), `PrayerCollectionRow` (SSR, fixed min height), and `LazyPrayerHistory hydrate-on-idle` (`#historial`,
  `usePrayerHistory`, `server: false`, keyset of 12, 4 states, the running queue on top; not `hydrate-on-visible`: the queue must be live when «Generar» scrolls there). The row never
  grows downward, so it does not push the sections below (the old `PrayerGrid :auto-load` pinning was removed). History endpoints: `GET /api/peticiones/imagenes`,
  `GET …/imagenes/:id/content` (302 presigned; `?download=1` → `peticiones-AAAA-MM-DD-<6 of id>.<ext>`, UTC date) and `DELETE …/imagenes/:id` (author or admin, `prayers.moderate`;
  row first, then object). Collections mirror `songs/collections` under `/api/peticiones/colecciones/**` (no «Generar»; deleting a collection keeps its images). All their SQL lives in
  `server/utils/prayer-gallery.ts` and `server/utils/prayer-collections.ts` (endpoints never touch drizzle; `architecture.spec.ts`). Retention: the daily cron (step 7) deletes, in batches of
  500, images older than `PRAYER_IMAGE_RETENTION_DAYS` (30) that are in **no** collection (rows, then objects); collections are what the team keeps. Downloads are plain links (no blobs). Limits: 60 generations per hour per person (`peticiones-img:<userId>`) and 120 transcript edits per hour (`text-edit:<userId>` on `PATCH /api/files/:id/text`). **Corregir
  texto** opens `LazyPrayerTextDialog`; `ImageTextPanel` emits `change` only for terminal states, and the page patches the card (`usePrayerRequests.patchText`, an overlay map: reassigning
  `firstPage` would drop the later pages) and the chosen copy (`usePrayerSelection.sync`). Filters live in `usePrayerFilters` (search debounced 300 ms, cleared instantly; approval-date presets in
  the browser's local day sent as ISO instants, `to` exclusive). E2E run against the OpenRouter stub (`test/e2e/setup/openrouter-stub.ts`): generation calls are recognised by the preset or
  `modalities` before the image-text path, answered with `message.images` (a PNG fixture) and recorded apart (`prayerCalls()`: model, modalities, template, `<peticion>` texts); keywords in a
  request's text pick a scenario: `sin-imagen`, `sin-credito` (402), `lento`, `falla-una-vez` (fails the first **two** calls, because the AI SDK retries once by itself).
  **Accepted LCP exception** (plan.md, Complexity Tracking): guest photos have no thumbnail, so the first card's photo is the LCP and can exceed 2.5 s on 4G. Only the first card
  renders its `src` in the SSR (`priority`, `fetchpriority="high"`) and the page adds a `preconnect` to the storage origin; `performance.spec.ts` asserts LCP for the card text
  (photos blocked), CLS and the 250 KB JS budget, and only reports the LCP with photos. Thumbnails were postponed by the team.
  **Dev QA**: a `.env.development` with an OpenRouter key makes «Generar» a real, paid call; mock `POST /api/peticiones/imagenes` with `page.route` in browser QA.
- `guest_submissions.completed_at` is stamped with the server clock, like the pulse cursor: with Postgres' `now()` a
  skew of seconds would drop the live toast.
- The guest access-request layer was removed (migration `drizzle/0008_*`: drops `guest_access_requests`,
  `guest_submissions.origin` / `access_granted_by` and their enums). The `access.approve` / `access.reject` values stay
  in the `activity_action` enum (Postgres cannot drop enum values and old `activity_log` rows use them), and their labels
  stay in `app/utils/activity-labels.ts`.

## Workflow

- Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. Plans must pass the Constitution Check (principles I–VI).
- **Definition of done for every task and every phase** (phases are the `## Phase N` sections of
  the active feature's `tasks.md`, e.g. `specs/003-guest-upload-access-code/tasks.md`). When a task or phase is implemented, run these in order and
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

## Notes

Based in your knowledge, every time you will decide to run a peligrous command like dropping a table or running an mcp database command, ask me and you can't run without my permission.