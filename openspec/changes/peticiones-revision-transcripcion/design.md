# Design

## Context

See `proposal.md` for the motivation and `specs/` for the behavior. Current state that shapes the approach:

- `POST /api/peticiones/generaciones` stores the groups; `POST /api/peticiones/imagenes` takes `{ fileIds, generationId? }`,
  signs a 600 s URL per photo (`photoSource` in `server/utils/prayer-images.ts`) and `generatePrayerImage` sends the template
  and those URLs to the preset `@preset/pray-requests-image-generation`. The model reads the text itself.
- `server/ai/` isolates OpenRouter (`providers/openrouter.ts`, one folder per use case, `index.ts` is the only public API,
  imported as `#server/ai` only by `server/utils/prayer-images.ts`; enforced by `test/unit/architecture.spec.ts`).
- The browser queues image requests in `usePrayerImages` (2 at a time, `pump`, `AbortController`s in a module map, state in
  `useState`). The selection lives in `usePrayerSelection`. `app/pages/peticiones/index.vue#generate` creates the generation
  and navigates to `/peticiones/generaciones/:id`.
- A previous transcription feature (stored in `files.text_*`, background pool, circuit breaker) was removed in migration
  `0011`. This change is **not** a revival: reads are on demand, only for the photos a person selected, and stored in their
  own table.
- Guest photos have no thumbnail; they are served by presigned redirect (`PrayerRequest.previewUrl`). Vercel functions run
  up to 120 s. HEIC photos are converted in the browser; only old HEICs carry a JPEG copy (`preview_key`).

## Goals / Non-Goals

**Goals:**
- A human-verified text is the only thing the image model writes.
- The server is the authority on both the text and the verified state; the browser can't smuggle text or skip verification.
- Reuse the queue, selection, error-code and AI-layer patterns already in the repo; no new dependency.

**Non-Goals:**
- No batching of several photos into one vision call (sequential and per-photo was the requirement; it also keeps each
  call inside the function timeout and lets the first result appear early).
- No realtime co-editing: two editors on the same photo get last-write-wins (see Risks).
- No history of edits, no diff view of model vs corrected text.

## Decisions

### D1. New table `prayer_transcripts`, one row per photo
`file_id uuid PK → files(id) ON DELETE CASCADE`, `text text NOT NULL` (length check), `status` (`draft` | `verified`,
pg enum), `origin` (`model` | `manual`), `verified_by text → profiles(user_id)` and `verified_at` (both null while draft),
`updated_by`, `created_at`, `updated_at`. The primary key is the only index needed (every lookup is by `file_id`; the
batch read is `file_id = ANY($1)`).
- "Empty read" = a `model` row with `text = ''` and `draft`. "Failed read" = no row (nothing to persist; the card shows
  the error and the editor retries or types by hand, which creates a `manual` row).
- Photos are team-wide, so the key is the photo and not the person.
- *Alternative:* a column on `files`. Rejected: it recreates the `files.text_*` coupling that migration `0011` removed and
  widens a hot table for one page's data. *Alternative:* in-memory only. Rejected by the team (credit re-spent on reload).
- Purging a photo deletes its row through the FK; no cron step is needed. Retention beyond that is unnecessary.
- One Drizzle migration (`bun run db:generate`). **Running it on dev, test and prod is for a person.**

### D2. Three endpoints under `/api/peticiones/transcripciones`
All `requireRole(event, 'editor')`, input validated in `shared/validation/prayers.ts`, SQL only in the new
`server/utils/prayer-transcripts.ts` (`architecture.spec.ts` keeps endpoints away from drizzle).
- `GET ?ids=<uuid,…>` (1–40): the stored transcripts for those ids (`PrayerTranscript[]`). Missing ids are simply absent.
  One query, no N+1, `Cache-Control: no-store`.
- `POST /:fileId/lectura { force?: boolean }`: if a row exists and `force` is not set, returns it without calling the
  model (idempotent: a double click or a second editor costs nothing). Otherwise re-checks the photo is a visible approved
  image (`loadEligibleRequests`, `request_unavailable`), resolves `photoSource` (`unreadable_image`), signs a URL, calls
  `#server/ai`, and upserts with `INSERT … ON CONFLICT (file_id) DO UPDATE` as a `draft`/`model` row. Duplicate concurrent
  reads can both bill; accepted, the ON CONFLICT keeps the data consistent. No rate limit (decision with the team); abort
  when the client disconnects, like `imagenes/index.post.ts`.
- `PATCH /:fileId { text, verified }`: validates length, requires non-blank text when `verified`, requires the photo to be
  an eligible request, upserts as `manual` when there was no row or the text changed, stamps `verified_*` when `verified`
  and clears them otherwise. It is how Save, the manual checkbox and "write by hand" all work.
- Errors reuse `PrayerErrorCode`/`prayerError` and add `transcript_unverified` (409, `data.ids`).

### D3. New AI use case `server/ai/prayer-transcript/`, same shape as `prayer-image/`
`transcribe.ts` (never throws; one `generateText` call with `Output.object` → `{ hasText, text }`, a hard cap of
~45 s and one retry), `prompt.ts`, `schemas.ts`; exported from `server/ai/index.ts`; only `prayer-transcripts.ts` imports
`#server/ai` for it. The photo goes as a signed URL through the same `wrapLanguageModel` + `overrideSupportedUrls` wrapper
(`resolvePrayerImageModel` is generalised so both resolvers share it), so no photo bytes cross the function. The prompt
carries no names, notes or ids. Errors map through the existing `classifyProviderError`, including `quota_exceeded` and
`rejected` → `not_configured`.
- **Preset, not a hard-coded model:** `@preset/pray-requests-transcription`, created in OpenRouter by a person, so the
  model and routing change without a deploy (the pattern the project already chose). The system prompt (read verbatim,
  keep line breaks, don't correct, say if nothing is legible) lives there; the in-repo prompt is the short user message.
  *Alternative:* a model id in code. Rejected: it needs a deploy to change and the project has no other model id in code.
- **No new dependency or external service:** `ai`, `@openrouter/ai-sdk-provider` and the OpenRouter key already exist. The
  new thing is one more preset in the same account.
- No circuit breaker (it was removed with the old feature): the client reads sequentially and stops on a persistent error.

### D4. The server supplies the text to the image model; the generation endpoints keep taking ids
`createPrayerGeneration` and `createPrayerImage` load the transcripts for their ids and throw `409 transcript_unverified`
(with the ids) unless every one is `verified` with non-blank text. `createPrayerImage` no longer signs photo URLs or resolves
`photoSource`; it passes the texts, in the server-decided order `(reviewed_at, created_at, id)`, to `generatePrayerImage`,
whose input becomes `{ texts: string[], template }` and whose prompt tells the model to write each text verbatim, one
block per request, in order, with no numbers or labels (the rules already in `prompt.ts` stay). The history and the
generation page are untouched.
- Because the body is unchanged, `usePrayerImages`, retries, «Generar las faltantes» and the leave guard need no change.
- *Alternative:* send `{ requests: [{ fileId, text }] }` like the removed version. Rejected: it trusts the client for the
  one thing this change exists to protect and doubles the payload on every retry.
- The OpenRouter preset `@preset/pray-requests-image-generation` must be edited **together with the deploy** (its system
  prompt says the photos after the template carry the text). Until it is, the code and the preset disagree; the release
  note must say so (see Migration Plan).

### D5. Review modal: `LazyPrayerReviewDialog` + `usePrayerReview`
- `app/pages/peticiones/index.vue` opens the dialog (`v-if`, lazy) instead of calling `generate()`; the existing `generate()`
  body becomes the dialog's confirm handler (it still creates the generation, enqueues, clears the selection, navigates, and
  keeps the `request_unavailable` handling).
- `usePrayerReview(requests)` owns one entry per request: `{ status: 'loading' | 'waiting' | 'reading' | 'draft' | 'verified' | 'empty' | 'failed', text, saved, error, retryable }`.
  On open it does a single `GET` for all ids, then reads the missing ones **one at a time in image order** with a plain loop
  and one `AbortController`, aborted on close. The active card is **not** reprioritised (simple and predictable); an editor
  can open a still-waiting card and write by hand, which cancels nothing and just creates a `manual` row.
- State lives in `useState('prayer-review')` keyed by `fileId` so closing and reopening the modal in the same session does not
  refetch; the server is the source of truth after a reload.
- Layout (mobile first): below `md`, a full-screen modal with a horizontally scrollable strip of cards, then the active
  photo, the textarea, **Save** and **Generar imágenes**; from `md`, the sketch's two columns (editor left, card list right).
  The photo is shown next to the text so the editor can compare; the card thumbnail is lazy like `PrayerCard`.
  *Follow-up (UI only, no delta specs):* the textarea gets most of the space, so the photo is **optional**: hidden when the
  dialog opens and toggled with **Ver imagen** / **Ocultar imagen** (in the editor, waiting and failed action rows,
  `aria-expanded`/`aria-controls`). One choice for the whole dialog, not per card, not persisted. CSS-only transition (rows
  0fr → 1fr on phones, width 0 → 2/5 on the left from `lg`; none with reduced motion); hidden, the panel is `inert`. From
  `md` the modal has a fixed height so toggling does not resize it; the editor is one bordered box (label, borderless
  textarea, hint/counter footer) whose border shows focus and errors.
  The verified indicator is a real checkbox (`checkbox checkbox-primary`, labelled with the request's name) that the editor can
  tick, and that **Save** also sets. Dirty text prompts through `ConfirmDialog` before switching card or closing.
- Text limits: `PRAYER_TEXT_MAX_LENGTH = 1000` (server-enforced) and the existing "may not fit" hint above
  `PRAYER_LONG_TEXT_CHARS = 600`; both in `shared/constants/prayers.ts`. These are tunable.
- Copy lives in `app/utils/messages.ts`; API errors only through `serverMessage()`.
- **Performance:** the dialog, its composable and the textarea are behind `v-if` and a `Lazy*` import, so `/peticiones`
  initial JS does not grow; `test/e2e/performance.spec.ts` keeps asserting the 250 KB budget.

### D6. Tests and stubs
Unit: transcribe (schema, `hasText`, failure mapping), prompt privacy, the three endpoints and the new 409, validation.
Component: `PrayerReviewDialog` (states, gating, dirty confirm, keyboard) and `usePrayerReview` (sequential order, reuse,
abort). e2e: extend `peticiones.spec.ts` for the full path. The OpenRouter stub learns to answer transcription calls
(recognised by the preset) with scenarios `sin-texto`, `lectura-falla`, `clave-rechazada`, `sin-credito`, and records them in a
`transcriptCalls()` helper; generation calls now assert the `texts` and that no photo URL is sent. Regression test: a
generation with an unverified id is a 409 and calls the provider zero times.

## Risks / Trade-offs

- **Release ordering with the preset** → the generation preset still tells the model to read the photos while the code now
  sends text. Mitigation: edit the preset in OpenRouter in the same release window; the prompt in code already says what to do.
  Before the migration is applied the new endpoints fail with 500: apply migrations first (Migration Plan).
- **Last write wins between two editors** → one overwrites the other's edit. Mitigation: low likelihood on a small team; the
  card refreshes on `GET` when the modal opens, and editing a verified text drops it to draft. Optimistic `updated_at` checks
  are a future option, not built (YAGNI).
- **Credit spend is unlimited by design** → a stuck loop or repeated **Volver a leer** burns credit. Mitigation: reads are
  idempotent (stored text is reused unless `force`), sequential, abort on close, and stop on `quota_exceeded`/`not_configured`.
- **Up to 40 sequential reads** (~5–30 s each) → the editor waits for the tail. Mitigation: the first results are usable at
  once and the generate button explains how many remain.
- **Transcript text is untrusted input** (handwriting could carry instructions) → it goes to the image model as text.
  Mitigation: a person verifies every text first, it is length-capped, and it never reaches code paths other than the prompt;
  rendered as plain text, never `v-html`.
- **Verification revoked mid-queue** → an already created generation can contain a request whose text was edited after.
  Mitigation: the image endpoint re-checks and fails that image with a clear message instead of using a stale text.

## Migration Plan

1. `bun run db:generate` creates the migration (agent). **A person runs** `bun run db:migrate` (development),
   `db:migrate:test` and `db:migrate:prod`, in that order, before the code is deployed.
2. A person creates the OpenRouter preset `@preset/pray-requests-transcription` and rewrites
   `@preset/pray-requests-image-generation` so its system prompt says the text arrives in the message.
3. Deploy. No new environment variables.
4. Rollback: redeploy the previous build and restore the previous generation preset text; the new table can stay (unused).
   Dropping it is a destructive step for a person.

## Open Questions

- Final values of `PRAYER_TEXT_MAX_LENGTH` and the "may not fit" threshold, once real requests are measured.
- Whether the history should later offer **Generar de nuevo** now that the verified text is stored (separate change).
