# Tasks

Every group ends with the AGENTS.md "Definition of done": `bun run typecheck`, the tests that cover the group, and for UI
groups the browser verification (360 px and 1280 px or wider, dark and light themes, states, keyboard focus, console
errors) on `.env.development` data, with OpenRouter calls mocked through `page.route`. No migration and no destructive step
exists in this change.

## 1. Agregar petición (manual prayer request)

- [x] 1.1 Extract `verifyGuestSubmission` / `completeGuestSubmission` into `server/utils/guest-submissions.ts` and `approveSubmission` into `server/utils/submissions.ts`; the public `complete` and the Solicitudes `approve` endpoints call them with unchanged behavior (existing `api-submissions.spec.ts` stays green).
- [x] 1.2 Add `manualPrayerInput` to `shared/validation/prayers.ts` and the endpoints `POST /api/peticiones/manual` and `POST /api/peticiones/manual/[id]/complete` (editor guard, images only → 415, 60/hour per person, creator-only completion, approved in one batch, activity); unit tests for guards, validation, name from profile, ownership, one-batch approval and no pulse exposure.
- [x] 1.3 `useGuestSubmission` (`completeUrl`, `imagesOnly`), `DropZone` (`imagesOnly`) and `GuestUploadForm` (`fixedName`, `completeUrl`, `imagesOnly`, `hideDone`, `submitLabel`); nuxt tests; `/upload` unchanged.
- [x] 1.4 `PrayerManualDialog` (lazy) + primary **Agregar petición** button in the header and the empty state of `app/pages/peticiones/index.vue`; copy in `app/utils/messages.ts`; nuxt tests for the dialog and the page.
- [x] 1.5 E2E in `test/e2e/peticiones.spec.ts`: editor adds a photo and sees it first with their name; a PDF is refused; guards on both endpoints; guest `/upload` still lands in Solicitudes.
- [x] 1.6 Definition of done for the group.

## 2. Toasts above modals

- [x] 2.1 `app/composables/useOpenModal.ts` and the `<Teleport>` in `AppToast.vue`; nuxt tests (open, close, stacked dialogs, removed dialog).
- [x] 2.2 E2E: a toast shown over the collection dialog, the review dialog, a `ConfirmDialog` and the Solicitudes reject dialog is the element at its own centre (`elementFromPoint`) and closes on click.
- [x] 2.3 Definition of done for the group.

## 3. Bounded transcription output

- [x] 3.1 Bound `prayerTranscriptOutputSchema`, add `maxOutputTokens`, fix the prompt typo; unit tests for the schema and for `transcribe.ts` with a mock model.
- [x] 3.2 E2E: a read whose stub text exceeds the limit shows the failed read with **Escribir a mano**.
- [x] 3.3 Definition of done for the group.

## 4. Lighter generation call

- [x] 4.1 `shared/jpeg.ts` (`jpegSize`, `nearestAspectRatio`) with unit tests.
- [x] 4.2 `generatePrayerImage` accepts `Uint8Array | URL` and sends `image_config`; `prayer-images.ts` memoises the template, uploads it once, signs the URL, falls back to bytes and logs metrics; unit tests for URL/bytes choice, fallback, body and log.
- [x] 4.3 OpenRouter e2e stub recognises the template as a signed URL and records `imageConfig`; existing generation e2e stay green.
- [x] 4.4 One real call per use case with the development OpenRouter key (approved by the owner; photo and template copy in the test bucket). Read: served by an OpenAI model with `strict: true`, 3.7 s, 1 KB request, 69 completion tokens (38 of them reasoning), `finish: stop`, text read correctly. Generation: template sent as signed URL (request of about 2 KB instead of about 915 KB of base64), result 1376 × 768 (16:9), 683 KB JPEG, text drawn verbatim; read plus generation took about 25 s together. The per-call figures of the generation were not captured, and the output size equals the template's, so this does not prove on its own that the model honours `image_config`.
- [x] 4.5 Definition of done for the group.

## 5. Docs and closing

- [x] 5.1 Update `AGENTS.md` (Peticiones, toasts and AI gotchas).
- [ ] 5.2 Full `bun run typecheck`, `bun run build`, `test:unit`, `test:nuxt`, `test:e2e`, `test:coverage`, `openspec validate peticiones-mejoras --strict`. Status: typecheck, `nuxi build`, unit, nuxt, coverage (97.6 / 93.7 / 95.3 / 98.5) and strict validation green. The full e2e ran once: 216 of 218 passed; the two failures (`files.spec` HEIC selector, fixed in the test because the toast now lives inside the dialog; `/peticiones` text LCP 2580 ms vs 2500, 2452 ms on the re-run) passed when re-run, together with `peticiones`, `routes-guard` and `guest-queue` after the last fixes. One uninterrupted full e2e run is still owed before merging. Browser verification ran against the test branch (no development credentials were available), not `.env.development`.
