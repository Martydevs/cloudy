# Design

## Context

See `proposal.md`. Facts that shape the approach:

- Guest uploads are two phases: `createGuestSubmission` (rows `uploading` + presigned PUTs) and the public `complete`
  endpoint (verify size and signature, drop invalid files, stamp `completed_at`). Solicitudes then approves with one batch
  (`UPDATE guest_submissions` + dependent `INSERT … files`). Peticiones lists `files ⋈ guest_submissions` with
  `status = 'approved'`, ordered by `reviewed_at`.
- The team pulse only announces submissions with `status = 'pending' AND completed_at IS NOT NULL`
  (`readyPendingSubmissionsSql`), and Solicitudes lists pending submissions that have `ready` files.
- Every dialog uses `<dialog>.showModal()` (top layer); `AppToast` is mounted by each layout in its content column.
- `generatePrayerImage` sends the template bytes; the OpenRouter model wrapper (`withSignedImageUrls`) already forwards any
  `https://` image URL untouched.

## Goals / Non-Goals

**Goals:** direct, safe manual entry with no duplicated upload/approval logic; toasts usable over any modal with no change
per dialog; bounded model output; smaller generation request and response.

**Non-Goals:** a second upload form; a toast rewrite; server-side image resizing; changing presets.

## Decisions

### D1. Manual requests reuse the guest tables and both extracted cores
`POST /api/peticiones/manual` validates like the guest endpoint but takes only `{ note?, files }`, rejects any non-image
with 415, and calls `createGuestSubmission` with `senderName = profile.name` (fallback: local part of the e-mail) and
`senderKey = manual:<userId>`. `POST /api/peticiones/manual/[id]/complete` answers 404 unless the submission's
`sender_key` is the caller's own manual key (so it can never approve a guest's submission or someone else's upload), runs
`verifyGuestSubmission` (the checks and orphan cleanup of the public endpoint, **without** marking anything ready) and then
`approveSubmission(…, { complete: true })`: one batch that marks the files `ready`, sets
`status = 'approved', reviewed_by, reviewed_at, completed_at` and inserts the `files` rows in the drive root.

*Why one batch:* the submission is never observable as "pending with ready files", so it cannot appear in Solicitudes or in
the pulse (which requires `status = 'pending'`). *Alternative rejected:* a new table or an `origin` column (a migration,
and Peticiones would need a second query).

Activity: `submission.approve` with `details.manual = true` (no new enum value). Rate limit: 60 per hour per person on
creation (`peticiones-manual:<userId>`). An abandoned manual upload is a pending submission with no ready files, already
removed by the daily cleanup like any abandoned guest upload.

### D2. One form, optional props
`GuestUploadForm` gains `fixedName`, `completeUrl`, `imagesOnly`, `hideDone` and `submitLabel`; `useGuestSubmission` gains
`completeUrl(id)` and `imagesOnly`; `DropZone` gains `imagesOnly` (accept attribute and hint). `/upload` passes none of
them and is unchanged. `PrayerManualDialog` is loaded as `LazyPrayerManualDialog` behind `v-if`, so the `/peticiones` route
JS budget (250 KB) is untouched: the form, drop zone and queue chunks load on the first click.

### D3. Toasts teleport into the topmost open dialog
`useOpenModal()` keeps a client-side stack of open dialogs: a `MutationObserver` on `document.body`
(`attributes: ['open']`, `childList`, `subtree`) adds a dialog when it opens and removes it when it closes or leaves the
DOM; the last one is the target. The markup of the stack moves to `AppToastStack`; `AppToast` renders
`<Teleport v-if="target" :to="target"><AppToastStack in-modal /></Teleport>` and `<AppToastStack v-else />`. Inside a
dialog the zero-height wrapper is `fixed` at the top of the viewport and centred, so the modal stays usable around it. The
live region (`role="status"`) is inside the dialog, i.e. inside the non-inert subtree. Only one stack exists at a time.

*Why `v-if` and not `:disabled`:* the first implementation used `<Teleport :to :disabled="!target">`. It worked when
mounted on the client, but after SSR hydration Vue 3.5 records the Teleport's own placeholder as its target anchor
(`hydrateTeleport`, disabled with no target), moves that placeholder into the dialog on the first target change, and
the move back to the layout then throws and leaves the component dead (found by the e2e run). A Teleport that only exists
while a modal is open is never hydrated. *Alternative considered:* `popover="manual"`; rejected because a popover outside
the modal dialog is inert (its buttons could not be clicked).

### D4. Bounded transcript output
`prayerTranscriptOutputSchema.text` becomes `z.string().max(PRAYER_TEXT_MAX_LENGTH)`; `hasText: false` keeps forcing an
empty text in `transcribe.ts` (existing normalization, friendlier than failing the read). `generateText` gets
`maxOutputTokens = PRAYER_TRANSCRIPT_MAX_OUTPUT_TOKENS`. Over-long or truncated output raises `NoObjectGeneratedError` →
`invalid_output`, which the review dialog already handles (re-read / write by hand). The `slice` in
`prayer-transcripts.ts` stays as a safety net.

Two deliberate details:
- The bound is **validated on our side** and stated in the field description, but is not sent as a `maxLength` keyword:
  `@openrouter/ai-sdk-provider` requests `json_schema` with `strict: true`, and several models reject the whole call when
  the schema carries keywords they do not support. The schema sent to the model is a hand-written JSON Schema
  (`jsonSchema(…, { validate })`) whose validator is the bounded zod schema.
- The token cap is 1200, not the ~700 first estimated: 1000 characters of Spanish are roughly 350–500 tokens plus the
  JSON envelope, and on OpenRouter reasoning tokens count against `max_tokens`. The preset's model is chosen in
  OpenRouter and unknown to the code, so the margin avoids cutting every read if it reasons. It is one constant, to be
  tuned after a real call.

### D5. Template by signed URL
A new `server/utils/prayer-template.ts` (it knows nothing about requests, photos or the database; `architecture.spec.ts`
enforces it) memoises the template per instance: bytes, a sha-256 prefix, and the aspect ratio read from the JPEG SOF
header (`jpegSize` in `shared/jpeg.ts`, snapped to the nearest ratio OpenRouter accepts). Before a generation it ensures
`peticiones/plantilla-<hash>.jpg` exists (`head`, else `putObject`; memoised once it succeeded) and signs a 300 s GET URL.
`generatePrayerImage` accepts `template: Uint8Array | URL`. Any storage failure falls back to the bytes: no new failure
mode. The object is small, content-addressed and not touched by the cron (which deletes by `prayer_images` rows).

### D6. `image_config` and metrics
`generatePrayerImage` passes `providerOptions.openrouter.image_config = { aspect_ratio, image_size: '1K' }` (merged into
the request body by `@openrouter/ai-sdk-provider`); models that do not support it ignore it. `createPrayerImage` logs
`[prayer-image] call status=ok|failed ms=… template=url|bytes:…KB texts=… out=…KB` with `console.info` (numbers and
codes only; the existing warn/error lines are unchanged). `maxRetries` stays 1: the AI SDK only retries
retryable API errors (408/409/429/5xx), never a 4xx such as 402, so it does not duplicate a spend on non-retryable errors.

## Risks / Trade-offs

- A photo with more than 1000 characters now fails the read instead of being cut → the dialog offers writing by hand.
- `image_config` support depends on the preset's model → validated once with a real call (with the owner's permission)
  before relying on it; harmless when ignored.
- OpenRouter must be able to fetch the signed template URL (it already fetches guest photos the same way) → the bytes
  fallback covers a storage failure, not a provider-side fetch failure; the metric line shows which path was used.
- Teleporting a live region can make some screen readers re-announce visible toasts → acceptable; they last 4 s.

## Migration Plan

No migration and no preset change. Deploy as usual; rollback is a plain revert (the template object can stay in the bucket).
