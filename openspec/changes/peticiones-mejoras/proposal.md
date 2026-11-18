# Proposal

## Why

Four rough edges in Peticiones surfaced once the review-before-generating flow shipped:

1. A prayer request the team receives on paper or by chat has to be sent through the public `/upload` page and then approved
   in Solicitudes before it shows up in Peticiones. Editors want to add it directly.
2. Toasts are rendered in the page layout, so they sit **under** every `<dialog>` (top layer). Feedback for an action taken
   inside a modal (saving a transcript, adding to a collection, rejecting a submission) is hidden and cannot be dismissed.
3. The transcription call asks for structured output but puts no bound on it: the model may return (and bill) far more text
   than the 1000 characters a request can hold, which is then silently cut.
4. Every image generation re-sends the 700 KB template as base64 (~935 KB) and asks for an unbounded image, which makes the
   call heavier and slower than it needs to be and produces `too_large` failures.

## What Changes

- **Agregar petición**: a primary button on `/peticiones` opens a lazy dialog with the `/upload` fields (name read-only =
  the signed-in user, optional note, images only, drop zone and camera). When the upload finishes the request is **already
  approved** (it never enters Solicitudes) and appears first in the row. Two editor-only endpoints back it; the server
  ignores any name sent by the client.
- **Toasts above modals**: while a modal `<dialog>` is open, the toast stack is teleported into the topmost open dialog, so
  it is visible, announced and clickable. Without an open modal nothing changes.
- **Bounded transcription output**: the output schema caps `text` at `PRAYER_TEXT_MAX_LENGTH`, forces empty text when
  `hasText` is false, and the call carries `maxOutputTokens`. A photo with more text than fits now fails the read as
  `invalid_output` (the editor re-reads or writes by hand) instead of being silently truncated. The one-line user prompt's
  typo is fixed.
- **Lighter generation call**: the template travels as a signed URL of an object uploaded once to the bucket (bytes remain
  the fallback), the request carries `image_config` (template aspect ratio, 1K) and each call logs duration and sizes as
  numbers only.

### Out of scope

- Thumbnails or any change to how the request cards load their photos.
- **Generar de nuevo** in the history.
- Any edit to the presets inside OpenRouter.
- Database migrations (none are needed: `guest_submissions` and `files` are reused).
- New dependencies or external services (none).

## Capabilities

### New Capabilities

- `prayer-manual-requests`: editors add a prayer request from `/peticiones`, approved on upload.
- `modal-toasts`: toasts stay visible and usable while a modal dialog is open.

### Modified Capabilities

`openspec/specs/` is still empty (the previous change is not archived), so the two deltas below add requirements to the
capabilities that change introduces:

- `prayer-request-review`: bounded transcription output.
- `prayer-image-generation`: template by signed URL, bounded image output, call metrics.

## Impact

- **Server**: `POST /api/peticiones/manual`, `POST /api/peticiones/manual/[id]/complete`; `server/utils/guest-submissions.ts`
  gains `verifyGuestSubmission` / `completeGuestSubmission` (extracted from the public `complete` endpoint) and
  `server/utils/submissions.ts` gains `approveSubmission` (extracted from the Solicitudes `approve` endpoint);
  `server/ai/prayer-transcript/{schemas,transcribe,prompt}.ts`; `server/ai/prayer-image/{generate,schemas}.ts`,
  `server/ai/providers/openrouter.ts`, `server/utils/prayer-images.ts`; `shared/jpeg.ts` (pure JPEG header reader).
- **App**: `PrayerManualDialog` (lazy), `GuestUploadForm` and `useGuestSubmission` gain optional props/options, `DropZone`
  gains `imagesOnly`; `AppToast` + `useOpenModal`; copy in `app/utils/messages.ts`.
- **Tests**: unit, nuxt and e2e per group; the OpenRouter e2e stub recognises the template as a signed URL.
- **Bucket**: one extra object per template version (`peticiones/plantilla-<hash>.jpg`), never deleted by the cron.
