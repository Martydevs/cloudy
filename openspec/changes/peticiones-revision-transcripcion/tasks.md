# Tasks

Every group ends with the AGENTS.md "Definition of done": `bun run typecheck`, the tests that cover the group, and at the end
of the group the full set plus `bun run test:coverage`; groups with UI finish with the browser verification (360 px and
1280 px or wider, dark and light themes, loading/empty/error/content states, keyboard focus, console errors) on
`.env.development` data. Report what ran before ticking a group's last task. Steps marked **(for a person)** are never run by
an agent.

## 1. Shared contracts, schema and migration

- [x] 1.1 Add to `shared/constants/prayers.ts` `PRAYER_TEXT_MAX_LENGTH` (1000), reintroduce the "may not fit" threshold (`PRAYER_LONG_TEXT_CHARS` 600 + `isLongText` in `shared/prayers.ts`), `PRAYER_TRANSCRIPT_MAX_IDS` (40) and the `transcript_unverified` code with its Spanish message in `PRAYER_ERROR_CODES`/`PRAYER_ERROR_MESSAGES`; verify with a unit test of the constants and `isLongText`.
- [x] 1.2 Add `PrayerTranscript` (`fileId`, `text`, `status`, `origin`, `verifiedAt`, `verifiedBy`, `updatedAt`) to `shared/types/api.ts` and the validators `prayerTranscriptIdsQuery`, `prayerTranscriptReadInput` and `prayerTranscriptSaveInput` (non-blank text when `verified`, max length) to `shared/validation/prayers.ts`; verify with `test/unit` validation specs covering each error message.
- [x] 1.3 Add the `prayer_transcripts` table and its status/origin enums to `server/db/schema.ts` (PK and FK `ON DELETE CASCADE` to `files`, length check) and run `bun run db:generate`; verify the generated SQL by reading it and that `bun run typecheck` passes. Do not execute it.
- [ ] 1.4 Run the migration on the development, test and production Neon branches **(for a person)**: `bun run db:migrate`, `bun run db:migrate:test`, `bun run db:migrate:prod`, in that order, before any deploy.
- [x] 1.5 Definition of done for the group: `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`.

## 2. AI layer: transcription use case and text-only generation

- [x] 2.1 Create `server/ai/prayer-transcript/{transcribe,prompt,schemas}.ts` (one `generateText` call with `Output.object` → `{ hasText, text }`, 45 s cap, one retry, never throws, signed-URL photo input) and export it from `server/ai/index.ts`; verify with unit tests for success, `hasText: false`, invalid output, timeout, quota and rejected-key mapping, using a mock model.
- [x] 2.2 Add `OPENROUTER_PRAY_TRANSCRIPTION_MODEL = '@preset/pray-requests-transcription'` and `resolvePrayerTranscriptModel` to `server/ai/providers/openrouter.ts`, sharing the `overrideSupportedUrls` wrapper with `resolvePrayerImageModel`; verify an empty key returns `null` and no call is made.
- [x] 2.3 Change `server/ai/prayer-image/{schemas,prompt,generate}.ts` so the input is `{ texts: string[], template }` and the prompt says "write each given text verbatim, one block per request, in order" (keep the no-numbers/no-labels rule); verify `test/unit/prayer-prompt.spec.ts` and the generate spec assert that no photo is sent and the texts appear in order.
- [x] 2.4 Verify `test/unit/architecture.spec.ts` still passes (only `server/utils/*` imports `#server/ai`, no photo bytes, no names/notes/ids in prompts).
- [x] 2.5 Definition of done for the group: `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`.

## 3. Server: transcripts, endpoints and the verification gate

- [x] 3.1 Create `server/utils/prayer-transcripts.ts` (all SQL: batch load by ids, upsert from the model, save from the editor with `verified_*` stamping, load-verified-for-generation) and the read flow (eligibility via `loadEligibleRequests`, `photoSource`, signed URL, `#server/ai`, abort on disconnect, no rate limit); verify with unit tests that reuse stored text, `force` re-reads, a model row never overwrites a verified one without `force`, and logs carry only codes.
- [x] 3.2 Add `GET /api/peticiones/transcripciones`, `POST /api/peticiones/transcripciones/[fileId]/lectura` and `PATCH /api/peticiones/transcripciones/[fileId]` with `requireRole('editor')`, validation and `no-store`; verify API unit tests for guard (no session / wrong role), validation errors, `request_unavailable`, `unreadable_image`, `not_configured`, `quota_exceeded`, and that no endpoint touches drizzle (`architecture.spec.ts`).
- [x] 3.3 Make `createPrayerGeneration` and `createPrayerImage` require verified transcripts (`409 transcript_unverified` with `data.ids`, zero provider calls) and pass the verified texts in the server-decided order to `generatePrayerImage`, removing photo signing from that path; verify regression tests: unverified → 409 and no provider call, verified → text-only call, text re-saved while queued → latest text used, existing 60-per-hour limit unchanged.
- [x] 3.4 Extend `test/e2e/setup/openrouter-stub.ts` to answer transcription calls (recognised by the preset) with scenarios `sin-texto`, `lectura-falla`, `clave-rechazada`, `sin-credito`, expose `transcriptCalls()`, and make generation calls record `texts`; verify the stub's own unit tests and that unknown calls still get a 400.
- [x] 3.5 Definition of done for the group: `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`, `bun run test:coverage` (92 % gate).

## 4. Review modal

- [x] 4.1 Add the Spanish copy for the modal (states, gating reason, confirmations, errors) to `app/utils/messages.ts` and the dialog's form schema to `app/utils/form-schemas.ts` mirroring `shared/validation`; verify `test/nuxt/form-schemas.spec.ts` shows client and server agree.
- [x] 4.2 Create `app/composables/usePrayerReview.ts`: one `GET` for all ids, then sequential reads in image order with one `AbortController`, per-card state machine, `save`, `setVerified`, `retry`, `writeByHand`, `reread`, stop on `quota_exceeded`/`not_configured`, state in `useState('prayer-review')`; verify nuxt/unit tests for order, reuse, abort on close, failure isolation and persistent-error stop.
- [x] 4.3 Create `app/components/prayers/PrayerReviewDialog.vue` (+ small card/editor subcomponents if needed): daisyUI `<dialog>`, card list with thumbnail/name/verified checkbox, photo beside the textarea, **Save**, **Generar imágenes** gated with a live-region reason, `SkeletonList`/`ErrorState` states, `ConfirmDialog` on dirty switch/close, focus trap and Escape; mobile first (full-screen below `md`, horizontal card strip, ≥ 44 px targets, no `btn-sm` as base); verify `test/nuxt/PrayerReviewDialog.spec.ts` for states, gating, dirty confirm and accessible names.
- [x] 4.4 Wire `app/pages/peticiones/index.vue`: **Generar imágenes** opens `LazyPrayerReviewDialog` behind `v-if`, the old `generate()` becomes the dialog's confirm handler (create generation, enqueue, clear selection, navigate, handle `request_unavailable` and `transcript_unverified`); verify `test/nuxt/pages-peticiones.spec.ts` for open/close keeps the selection, nothing is created until confirm, and the unavailable request leaves the selection.
- [ ] 4.5 Add the e2e flow to `test/e2e/peticiones.spec.ts` (guest-approved photos → select → modal → reads in order → correct/verify → generate → generation page), plus `sin-texto`, `lectura-falla` and the role guard cases; verify `bun run test:e2e` passes (leave ~5 min between runs that sign in a lot).
- [ ] 4.6 Check that `test/e2e/performance.spec.ts` still holds the 250 KB per-route budget for `/peticiones` (the dialog is lazy) and that CLS/LCP assertions are unchanged.
- [ ] 4.8 Follow-up (UI only, no delta specs, design D5): in `PrayerReviewDialog.vue` hide the photo by default behind a **Ver imagen** / **Ocultar imagen** toggle (editor, waiting and failed states; `inert` while hidden; CSS transition, reduced motion respected), give the textarea the freed space inside one integrated box and a fixed modal height from `md`; verify `test/nuxt/PrayerReviewDialog.spec.ts` (hidden by default, toggle, persists across cards, waiting/failed) and the US5 e2e. Done: code, nuxt tests, typecheck, unit, nuxt, coverage. **PENDING (skipped by user request):** a full `bun run test:e2e` run of the updated `test/e2e/peticiones.spec.ts` and the browser verification (360 px / ≥ 1280 px, dark/light).
- [ ] 4.7 Definition of done for the group: `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`, `bun run test:e2e`, `bun run test:coverage`; then browser verification, last: start `bun run dev`, with the OpenRouter call mocked through `page.route` (a real key makes reads paid), exercise every scenario of `specs/prayer-request-review` and `specs/prayer-image-generation` at 360 px and ≥ 1280 px in dark and light themes, checking loading/empty/error/content states, keyboard-only use, focus, contrast and console errors.

## 5. Docs and release

- [x] 5.1 Update `AGENTS.md`: the intro sentence and Known gotchas that say image-text extraction was removed and that the model reads the photos, the Peticiones gotcha (review modal, `prayer_transcripts`, text-only generation, new endpoints and stub scenarios), the "`prayer_images` keeps only `file_ids`" note and the AI row of the stack table; verify by reading it against the final code and that `architecture.spec.ts` still passes.
- [x] 5.2 Write the release checklist in the change notes **(for a person)**: run the three migrations, create `@preset/pray-requests-transcription`, rewrite the system prompt of `@preset/pray-requests-image-generation` so it uses the text in the message, then deploy; verify it matches design.md "Migration Plan".
- [ ] 5.3 Final integration check: full `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:nuxt`, `bun run test:e2e`, `bun run test:coverage`, and `openspec validate peticiones-revision-transcripcion --strict`.

## Workflow follow-up

- Work on a branch named after the change (`peticiones-revision-transcripcion`) and merge into `main` through a PR with the project's review.
- Archive the change after the merge gates in AGENTS.md pass.
