# Plan — Remove AI image-text extraction and rework Peticiones

Branch `008-remove-text-extraction`, worktree `C:/Users/andre.perez/Dev/skykids-produccion-app-008`.

## Goal

Fully remove the OpenRouter vision transcription of uploaded images (feature 002) from staff drive uploads
and from guest submissions, and rework Peticiones (feature 007) so its text comes from a human typing it in
the generation dialog instead of from a stored transcript.

### In scope

- Delete the AI image-text use case, its application/persistence layer, its 5 endpoints and the guest pool.
- Drop the transcript columns from `files` and `guest_submission_files` (migration generated, **not run** by me).
- Rework Peticiones: any approved image is selectable; text is typed per request in a new generation dialog
  and travels with `POST /api/peticiones/imagenes`.
- Remove transcript-derived UI everywhere else (Archivos search by text, Solicitudes panels, guest notices).
- Update tests and docs.

### Out of scope (decided with the user)

- **The HEIC → JPEG copy pipeline stays** (`withTextSource`, `textsrc/<id>.jpg`, `heic-to`, `app/utils/heic-copy.ts`,
  `app/utils/camera.ts`, the cron/trash/reject cleanup). Consequence: the `text_source_key` column on both tables
  **survives** the migration, and `checkTextSourceCopy` / `setTextSourceKey` are relocated out of the deleted files
  into `server/utils/uploads.ts`. The copies are now written and cleaned up but never read — dead by design, kept
  deliberately.
- The prayer-image generation (feature 007's OpenRouter call, preset `@preset/pray-requests-image-generation`) stays,
  as do `NUXT_OPENROUTER_APIKEY`, `NUXT_OPENROUTER_BASE_URL`, `@openrouter/ai-sdk-provider` and `ai`.
- Running the migration against any branch (project rule: I hand over the commands).

## Decisions taken with the user

| # | Decision |
|---|----------|
| D1 | Remove the transcript completely; rework Peticiones rather than keep a manual-only transcript column. |
| D2 | Text is typed **in the generation dialog**, after selecting cards and before generating. |
| D3 | Typed text is **in-memory only** — no localStorage, no DB. Lost on reload; the existing leave guard warns. |
| D4 | Keep the HEIC copy pipeline untouched for now (see "Out of scope"). |
| D5 | Generate the Drizzle migration; the user runs it per branch. |
| D6 | Remove «Generar de nuevo» from the history card (no new `texts` column on `prayer_images`). |
| D7 | Remove the `[ilegible]` machinery (`hasIllegibleMark`, `splitIllegible`, the badge, the bar warning, the second confirm). Keep `isLongText`. |

## Baseline (verified in the worktree, 2026-11-13)

- `bun run typecheck` — clean.
- `bun run test:unit` — 78 files, 1358 tests, all passing.
- `bun run test:nuxt` — 72 files, 935 tests, all passing.
- `bun run test:e2e` — **not run** (needs the test branch, and auth rate limits make repeated runs slow). Will run at the end.

## New Peticiones flow (D2)

1. `GET /api/peticiones` returns requests **without** `text`. Every approved, ready, non-trashed guest image is selectable.
2. Selection bar «Generar imágenes» opens `PrayerComposeDialog` (new; replaces `PrayerSelectionDialog` **and** `PrayerTextDialog`).
3. The dialog lists the selected requests in image order (`orderForImages`), grouped in blocks of `PRAYER_PER_IMAGE`,
   each entry showing the photo, sender, note, a `textarea` and «Quitar». Inline validation per entry: non-empty,
   ≤ `PRAYER_TEXT_MAX_LENGTH`; `isLongText` shows the "puede no caber" hint. The confirm button is disabled until
   every entry has valid text, with the reason in a live region.
4. Confirm → `usePrayerImages.enqueue(groups)` where a group is `{ fileId, text }[]`.
5. `POST /api/peticiones/imagenes` body becomes `{ requests: [{ fileId, text }] }` (1–4, unique ids). The server still
   verifies each id is a visible approved image (`loadEligibleRequests` minus the text conditions) and uses the submitted
   texts. `request_unavailable` keeps its meaning minus "se quedó sin texto".
6. Queue retry/regenerate keep working — the texts live in the queue item.

## Steps

### Phase 0 — Schema and migration
1. `server/db/schema.ts`: delete `imageTextStatus` enum and `imageTextColumns()`; keep only `textSourceKey` on `files`
   and `guestSubmissionFiles`; delete `textEditedBy` / `textEditedAt` and the `files_text_length` /
   `guest_files_text_length` checks and `files_text_trgm_idx`. Keep the `activity_action` value `file.text_edit`
   (Postgres cannot drop an enum value; old `activity_log` rows use it).
2. `bun run db:generate` → `drizzle/0011_*.sql`. Review it by hand; it must drop the FK and the index before the columns
   and drop `image_text_status` last. **Do not run it.**

### Phase 1 — Server: delete the extraction
3. Delete `server/ai/image-text/` (3 files) and `server/ai/breaker.ts`.
4. `server/ai/index.ts`: drop the image-text and breaker exports. `server/ai/providers/openrouter.ts`: drop
   `OPENROUTER_VISION_MODEL` and `resolveImageTextModel`. `server/ai/errors.ts` unchanged.
5. Delete `server/utils/image-text.ts` and `server/utils/image-text-store.ts`, **after** moving `checkTextSourceCopy`
   (and the `text_source_key` write it needs) into `server/utils/uploads.ts`.
6. Delete the 5 endpoints: `server/api/files/[id]/text.{get,post,patch}.ts` and
   `server/api/submissions/[id]/files/[fileId]/text.{get,post}.ts`.
7. `server/api/uploads/[fileId]/complete.post.ts` and `server/api/public/submissions/[id]/complete.post.ts`: drop the
   background extraction (`readFileImage`, `readSubmissionImages`); keep the relocated `checkTextSourceCopy`.
8. `server/api/files/search.get.ts`: drop `text_content` matching and `matchedIn`.
9. `server/api/submissions/[id]/approve.post.ts`: drop the `text_*` columns from the INSERT…SELECT (keep `text_source_key`).

### Phase 2 — Shared
10. Delete `shared/validation/image-text.ts`. Trim `shared/constants/image-text.ts` to what the HEIC copy and the camera
    still need (`IMAGE_TEXT_EXTENSIONS`, `MAX_IMAGE_TEXT_BYTES`, `isImageTextEligible`) with a comment saying why it stays.
11. Move the length limit to `shared/constants/prayers.ts` as `PRAYER_TEXT_MAX_LENGTH` (same value) — `server/ai/prayer-image/schemas.ts`
    imports it from there.
12. `shared/types/api.ts`: delete `ImageText`, `ImageTextStatus`, `ImageTextError`, `SubmissionFile.text`,
    `FileItem.matchedIn`, `PrayerRequest.text`. Keep `UploadTicket.textSourceUploadUrl`.
13. `shared/prayers.ts`: delete `hasIllegibleMark`, `splitIllegible`, `TextChunk`; `isSelectable` disappears
    (everything approved is selectable). Keep `isLongText`, `orderForImages`, `chunkRequests`.
14. `shared/validation/prayers.ts`: `prayerImageInput` becomes `{ requests: [{ fileId, text }] }`.

### Phase 3 — Peticiones server
15. `server/utils/prayer-requests.ts`: drop the `text_*` columns, `toImageText`, `ImageTextDtoRow`; drop `text_content`
    from the search; `loadEligibleRequests` drops the two text conditions.
16. `server/utils/prayer-images.ts`: `createPrayerImage(requests)` uses the submitted texts after verifying the ids.
17. `server/api/peticiones/imagenes/index.post.ts`: new body shape.

### Phase 4 — Peticiones client
18. New `app/components/prayers/PrayerComposeDialog.vue` (lazy). Delete `PrayerSelectionDialog.vue` and `PrayerTextDialog.vue`.
19. `usePrayerSelection`: entries become `{ request, text }`; `toggle` no longer gates on text; `sync` and `unreadable` go;
    add `setText`. `usePrayerRequests`: delete `texts` / `patchText`.
20. `usePrayerImages`: queue items carry `requests: { fileId, text }[]`; delete `regenerateFrom`.
21. `PrayerCard`: drop the transcript block, the `edited`/`toFix`/`long` badges and the «Corregir texto» button.
    `PrayerSelectionBar`: drop the illegible warning. `PrayerHistory*`: drop «Generar de nuevo». `peticiones.vue`:
    drop `fixing` / `onTextChange`, open the new dialog from «Generar».

### Phase 5 — Rest of the client
22. Delete `app/components/files/ImageTextPanel.vue`, `ImageTextEditor.vue`, `app/composables/useImageText.ts`.
23. `app/pages/archivos/ver/[fileId].vue`, `FileExplorer.vue`, `FileList.vue`, `FileCard.vue` («En el texto» badge, search hint).
24. `app/components/guests/SubmissionCard.vue` (text panels) and `GuestUploadForm.vue` (the two notices).
25. `app/utils/messages.ts`: delete the `imageText` block and the prayer copy that referenced it; add the new dialog's copy.
    `app/utils/form-schemas.ts`: replace `imageTextSchema` with the dialog's rule (or drop it if the dialog validates
    against the shared validator directly — see "Open points").
26. Keep `app/utils/activity-labels.ts`'s `file.text_edit` label (old rows still render).

### Phase 6 — Tests
27. Delete: `test/unit/{ai-extract,ai-schemas,ai-breaker,api-image-text,image-text,image-text-store,image-text-pool,image-text-constants,validation-image-text}.spec.ts`,
    `test/nuxt/{ImageTextPanel,ImageTextEditor}.spec.ts`, `test/e2e/image-text.spec.ts`.
    Keep `test/nuxt/heic-copy.spec.ts` (the pipeline stays).
28. Edit the rest listed in the inventory (architecture, nitro helper, api-files, api-submissions, prayer-*, pages-*,
    useUploader, useGuestSubmission, form-schemas, performance, guest-queue, fixtures).
29. `test/e2e/setup/openrouter-stub.ts`: delete the chat-completions text branch and its fixtures; keep the generation
    branch, `imagen.png`, `prayerCalls`, `prayerDelayMs`, `resetStub`.
30. New tests for the new behaviour: compose dialog validation, the new request body, selection without a text gate.

### Phase 7 — Docs
31. `AGENTS.md`: stack AI row, layout, principle IV boundary, env var note, the AI gotcha bullet, the `#server/ai`
    bullet, the feature-007 section, the rate-limit list.
32. `specs/002-note-text-extraction/`: mark the feature as removed (keep the folder as history, add a note at the top of
    `spec.md` like the other amendments). Add an amendment to `specs/007-peticiones-imagenes/spec.md` describing the rework.

## Verification plan

After each phase: `bun run typecheck`, then `bun run test:unit` and `bun run test:nuxt`.
At the end: full set + `bun run test:coverage` + `bun run test:e2e`, then browser verification at 360 px and ≥ 1280 px in
both themes (Peticiones generation flow, Archivos search, Solicitudes queue, guest `/upload`).

## Status (2026-11-13) — all phases implemented

| Check | Result |
|-------|--------|
| `bun run typecheck` | ✅ clean |
| `bun run test:coverage` (unit + nuxt) | ✅ 139 files, 2044 tests — 97.48 % stmts / 93.11 % branches / 95 % funcs / 98.37 % lines (gate 92 %) |
| `bun run build` | ✅ complete |
| `bun run test:e2e` | ⚪ **not run** — the user chose to skip it; its global setup would apply migration `0011` to the test branch. Specs and the OpenRouter stub were updated and typecheck clean, but never executed. |
| Browser verification | ⚪ **not done** — depends on a dev server and on the migration being applied to the development branch. |

Baseline before the change was green too (typecheck clean, unit 1358, nuxt 935), so nothing was already failing.

### Migration — the user runs it

`drizzle/0011_breezy_malcolm_colcord.sql`. **Destructive**: it deletes every stored transcript. Take a Neon branch
snapshot first. Run per environment from the repo root:

```bash
bun run db:migrate        # development branch (.env.development)
bun run db:migrate:test    # test branch (.env.test) — bun run test:e2e does this on its own
bun run db:migrate:prod    # production (.env)
```

It drops `files.text_status/text_content/text_error/text_attempts/text_started_at/text_read_at/text_edited_by/text_edited_at`,
the same six on `guest_submission_files`, the FK, the two CHECKs, the `files_text_trgm_idx` index and the
`image_text_status` type. It **keeps** `text_source_key` on both tables (HEIC copy) and the `file.text_edit` enum value.

### Deviations from the plan

- `checkTextSourceCopy` moved to `server/utils/uploads.ts` as planned, but lost its old tests with
  `image-text.spec.ts`, so `test/unit/uploads.spec.ts` was added (8 cases) to keep `server/utils/**` above the
  constitution's 80 % floor — it is back at 100 % statements/lines.
- `test/nuxt/PrayerComposeDialog.spec.ts` was added for the new dialog (labels, counter, validation, touch targets).
- `shared/constants/image-text.ts` survives, trimmed to `MAX_IMAGE_TEXT_BYTES` + `isImageTextEligible` (the HEIC copy and
  the camera still need them); `IMAGE_TEXT_EXTENSIONS` is no longer exported.
- `app/utils/messages.ts` gained a `prayers.compose` block; `imageTextSchema` was deleted from `form-schemas.ts` and the
  compose dialog validates inline against `PRAYER_TEXT_MAX_LENGTH` instead of going through Regle (a dynamic list of
  textareas does not map onto a named-field Regle form; `architecture.spec.ts` only forbids calling Regle directly).
- `test/unit/architecture.spec.ts` gained a guard that asserts the removed symbols appear nowhere in the tree.

## Risks

- **The migration is destructive and irreversible** (transcripts are deleted). The user runs it; a Neon branch snapshot
  before running is the rollback.
- `drizzle/meta` snapshots: `db:generate` must be run once and its output reviewed, not hand-edited.
- Orphan `textsrc/*.jpg` objects already in the bucket are unaffected (the pipeline stays).
- E2E auth rate limits: leave ~5 min between full e2e runs.

## Open points

- **E2E and browser verification are still owed** (see Status). Run `bun run test:e2e` when ready; leave ~5 min between
  runs that log in a lot (auth rate limits).
- Orphan `textsrc/*.jpg` objects already in the bucket are untouched, by design: the HEIC copy pipeline stays.
