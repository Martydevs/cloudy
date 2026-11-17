# Proposal

## Why

Today the prayer-image model reads the guests' photos and writes whatever it understood straight onto the template. Nobody
sees that text before it is drawn, so a misread word or a grammar slip only shows up in the finished image, and fixing it
means paying for another generation. The team wants a human checkpoint: read each photo first, let an editor correct and
approve the text, and only then spend credit on the image.

## What Changes

- Clicking **Generar imágenes** on `/peticiones` no longer creates the generation straight away. It opens a **review modal**
  listing the selected requests (sidebar of cards with photo, name and a verified/not-verified indicator) next to the
  active request's photo and an editable text area.
- Opening the modal reads, **one photo at a time and in order**, every selected photo that has no saved transcript yet,
  using a vision model through OpenRouter. Already-read photos cost nothing: their saved text is reused.
- Per request the editor can correct the text, **Save** it (which marks it verified), or tick/untick "Verificada" by hand
  when the model's text was already right. Failed or empty reads offer **Reintentar** and **Escribir a mano**.
- The modal's **Generar imágenes** button stays disabled until every selected request is verified. It then creates the
  generation and queues the images exactly as today.
- Transcripts and their verification state are **stored per photo** and shared by the team.
- The image model now receives the **template plus the verified text only** (no guest photos). The server loads the verified
  texts itself; the browser never sends text to the generation endpoints. A request that is not verified is rejected.
- **BREAKING (internal)**: the prayer-image prompt and the OpenRouter preset `@preset/pray-requests-image-generation` change
  from "read the text in the photos" to "write the given text". The preset is edited in OpenRouter, by a person, and must
  be updated together with the deploy.
- No Cloudy-side limit on transcription reads (OpenRouter credit is the only brake). The existing 60-per-hour limit on image
  generation stays.

### Out of scope

- Bringing back **Generar de nuevo** in the history (the stored text would allow it, but it is a separate change).
- Transcribing photos outside Peticiones (drive uploads, guest submissions) or any background/automatic reading.
- Text edits to already generated images; editing a verified transcript only affects future generations.
- Rate-limiting or quotas on reads, and any new AI provider (OpenRouter stays the only one).
- Running the migration against any Neon branch (handed to a person).

## Capabilities

### New Capabilities

- `prayer-request-review`: reading prayer-request photos with a vision model, persisting the transcript per photo, and the
  review modal where an editor corrects and verifies each one.
- `prayer-image-generation`: what Peticiones generation requires and consumes (verified text only), replacing the
  "model reads the photos" behavior. No spec exists yet for this area, so it is introduced as a new capability.

### Modified Capabilities

None (`openspec/specs/` is empty).

## Impact

- **Database**: new table `prayer_transcripts` (one row per `files.id`, `ON DELETE CASCADE`); one Drizzle migration, run per
  Neon branch by a person. No change to `prayer_images`.
- **Server**: new AI use case `server/ai/prayer-transcript/` (same shape as `prayer-image/`, exported from `#server/ai`);
  new application layer and SQL in `server/utils/` (`prayer-transcripts.ts`); new endpoints under
  `/api/peticiones/transcripciones/**`; `server/utils/prayer-images.ts`, `server/ai/prayer-image/{generate,prompt,schemas}.ts`
  and `POST /api/peticiones/generaciones` now require and use verified text; OpenRouter stub extended for e2e.
- **App**: new lazy `PrayerReviewDialog` and its composable (queue, state per card); `app/pages/peticiones/index.vue` opens
  it instead of calling `generate()` directly; messages in `app/utils/messages.ts`; `shared/` constants, types and validation.
- **External services / dependencies**: none new. Uses the existing OpenRouter client and `ai`; adds a **second OpenRouter
  preset** (`@preset/pray-requests-transcription`), created in OpenRouter by a person, and rewrites the existing generation preset.
- **Docs**: `AGENTS.md` ("image-text extraction was removed", the Peticiones gotcha and "`prayer_images` keeps only `file_ids`")
  must be updated.
- **Performance**: the modal is lazy-loaded behind `v-if`, so the `/peticiones` route budget (250 KB gzip) is untouched.
