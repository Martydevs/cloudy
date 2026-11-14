# Plan (draft) — HEIC → JPEG copy gated on Apple devices, and given a purpose

**Drafted**: 2026-11-14 · **For**: a new session · **Branch to create**: `009-heic-apple-uploads`
**Context**: closes the open point §2.4 of `HANDOFF-008-remove-text-extraction.md` in the opposite direction to
"remove it": instead of retiring the HEIC → JPEG copy, it is kept, gated on Apple devices and finally **used**.

> This is a draft. §2 lists four decisions that change the shape of the work; confirm them before writing code.
> The new session can promote this to `specs/009-heic-apple-uploads/` through `/speckit-specify` if the team wants
> the full Spec Kit trail (recommended: it touches an API contract and a migration).

---

## 1. What the user asked for

> "for the jpeg to heic helper, i need to be used in any upload only when an iPhone/iPad or Apple device is
> detected"

Read as: the browser-side HEIC → JPEG conversion must run in **every upload path** (staff drive uploads *and* guest
submissions) and **only when the uploading device is an Apple device** (iPhone, iPad, Mac).

---

## 2. Decisions to confirm before coding

### D1 — What is the copy *for*? (blocking)

Today the copy is produced, validated, stored under `textsrc/<id>.jpg`, recorded in `files.text_source_key` /
`guest_submission_files.text_source_key` — and **read by nobody**. Gating it on Apple devices without giving it a
purpose only changes *when* dead weight is produced.

The purpose is sitting right there in the codebase: **a HEIC in Cloudy is invisible today.**

- `app/utils/thumbnail.ts:2` — `DECODABLE` is `jpeg/png/webp/gif`, so a HEIC gets **no thumbnail** (grid shows an icon).
- `app/components/files/FilePreview.vue:16` — `file.extension !== 'heic'` explicitly refuses to render it, so the
  detail page shows **no preview**.
- Only Safari decodes HEIC; the team works on Windows and Android too.

| Option | What it does | Trade-off |
|---|---|---|
| **A. Companion preview (recommended)** | The HEIC stays the file of record; the JPEG copy becomes what the UI shows (preview + source of the WEBP thumbnail) | A media drive should not silently discard originals. Costs one extra object per HEIC (already the case today) |
| B. Replace the original | Upload the JPEG *as* the file (`foto.jpg`), drop the HEIC | Simplest to consume, nothing extra stored — but the original is lost, and "Cloudy ate my photo" is irreversible |
| C. Status quo + device gate only | Keep producing an unused copy, just gated | Honest only if the team plans to use it soon; otherwise retiring it (handoff §2.4) is the better call |

**Recommendation: A.** B is a data-loss decision the team should make explicitly, not a side effect of a gate change.

### D2 — HEIC arriving from a *non*-Apple device (blocking)

A HEIC AirDropped to a Mac is still Apple, but a HEIC copied to a Windows PC by cable, or re-sent by WhatsApp/email
and uploaded from an Android phone, is not. A strict device gate **stops converting exactly the files the team most
needs converted** (a Windows browser can neither decode it nor convert it).

- **D2a (recommended)**: trigger = *the file is HEIC/HEIF*; the Apple-device check is a **fast pre-filter** that
  short-circuits before the dynamic `import('heic-to')`. On an Apple device nothing changes; on a non-Apple device the
  conversion is still attempted when the file really is HEIC, because `heic-to` is pure wasm/JS and works anywhere.
- **D2b (literal reading of the ask)**: `isAppleDevice() && isHeic(file)` — a HEIC from a Windows PC is uploaded raw
  and stays unviewable.

Worth knowing before choosing: **the device gate buys almost nothing in bundle terms.** `heic-to` (~3 MB) is already
behind a dynamic `import()` that only runs after the extension check (`app/utils/heic-copy.ts:15`), so a non-Apple
user who never picks a HEIC downloads nothing today either.

### D3 — Rename the column and symbols?

`text_source_key`, `textSourceKeyFor`, `checkTextSourceCopy`, `withTextSource`, `MAX_IMAGE_TEXT_BYTES`,
`shared/constants/image-text.ts` all carry the name of a feature that no longer exists.

- **Recommended**: rename the code symbols and the column → `preview_key` / `previewKeyFor` / `checkPreviewCopy` /
  `withPreview`, in a migration `0012`. A column rename preserves data, but **drizzle-kit must be checked by hand**:
  if it emits `DROP COLUMN` + `ADD COLUMN` instead of `ALTER TABLE … RENAME COLUMN`, fix the SQL before running it.
- **Keep the storage prefix `textsrc/<id>.jpg` as is.** Neon Object Storage has **no `CopyObject`**, so renaming the
  prefix would orphan every existing object. It is an internal key; document the mismatch in a comment.
- Cheap alternative: skip the rename, keep `text_source_key`. Zero migration, permanently confusing name.

### D4 — Size policy

`MAX_IMAGE_TEXT_BYTES` (5 MB) was the *vision model's* limit, applied to the **original** file: a 7 MB HEIC gets no
copy at all today (`shared/constants/image-text.ts:13`). For a preview that rule is backwards.

**Recommended**: drop the cap on the original, downscale the copy (max side ~2048 px, quality 0.85 → 0.7 retry) and
cap the **copy** at ~4 MB. Then every HEIC gets a preview, and big ones get a smaller one.

---

## 3. Baseline (verified in the worktree, 2026-11-14)

| Piece | Where | Today |
|---|---|---|
| Conversion + upload of the copy | `app/utils/heic-copy.ts` | `makeTextSourceCopy` (HEIC + ≤ 5 MB) · `uploadTextSourceCopy` never rejects |
| Eligibility rule | `shared/constants/image-text.ts` | `isImageTextEligible`, `MAX_IMAGE_TEXT_BYTES` |
| Staff upload | `app/composables/useUploader.ts:106-124` | computes `withTextSource`, asks for the ticket, converts in parallel with the original, `preparing: true` while it runs |
| Guest upload | `app/composables/useGuestSubmission.ts:17-19, 74-89` | same, per file of the batch |
| Ticket (staff) | `server/api/uploads/index.post.ts:49-57` | re-validates and presigns `textSourceUploadUrl` |
| Ticket (guest) | `server/utils/guest-submissions.ts:51, 71, 94` | same for the batch |
| Validation of the copy | `server/utils/uploads.ts:44-70` | `checkTextSourceCopy`: JPEG signature + size, writes the key or deletes the object |
| Completion hooks | `server/api/uploads/[fileId]/complete.post.ts:52-56` · `server/api/public/submissions/[id]/complete.post.ts:63-69` | call it after the PUTs |
| Lifecycle of the object | `approve.post.ts:51-57` (carried to `files`) · `reject.post.ts:24-28` · `cron/cleanup.get.ts:42-72` · `utils/trash.ts:185-226` | deleted with the original |
| API contract | `shared/types/api.ts:185, 193` · `shared/validation/files.ts:72` · `shared/validation/submissions.ts:12-17` | `withTextSource` in, `textSourceUploadUrl` out |
| Who reads the copy | — | **nobody** |
| Platform detection | — | **does not exist anywhere in the repo** |
| Tests touching it | `test/nuxt/heic-copy.spec.ts`, `useUploader.spec.ts`, `useGuestSubmission.spec.ts`, `UploadQueue.spec.ts`, `composables.spec.ts`, `test/unit/uploads.spec.ts`, `api-{cron,files,submissions,trash}.spec.ts`, `architecture.spec.ts` | — |
| e2e covering HEIC | **none** (`grep heic test/e2e` is empty) | Chromium can't produce HEIC; conversion is covered by component tests + manual QA |

Fixtures available: `test/fixtures/files/nota.heic` (55 KB), `paisaje.heic` (52 KB).

---

## 4. Proposed work (assuming A + D2a + D3 rename + D4)

### Phase 1 — Apple-device detection
- `shared/device.ts`: **pure** `isAppleDevice({ userAgent, platform, maxTouchPoints, uaDataPlatform })`.
  - `/iPhone|iPad|iPod/` on the UA · `navigator.platform` in `iPhone|iPad|iPod|MacIntel|MacIntosh` ·
    `userAgentData.platform === 'macOS'` · **iPadOS 13+ trap**: reports `MacIntel` + `maxTouchPoints > 1`.
  - Pure so it is unit-tested with a table of real UA strings (iOS Safari, iPadOS desktop-mode Safari, macOS Safari,
    macOS Chrome, Windows Chrome, Android Chrome). No DOM, no SSR access to `navigator`.
- `app/utils/device.ts`: thin client wrapper reading `navigator`. Called at upload time (client-only), never in SSR.
- VueUse has no UA/platform composable (checked), so this is new code — justify it in the plan's Complexity Tracking
  if this becomes a Spec Kit feature (Constitution II).

### Phase 2 — The copy helper (`app/utils/heic-copy.ts` → `app/utils/image-preview.ts`)
- `shouldMakePreview(file)` = `isHeic(file)` (+ `isAppleDevice()` as the pre-filter, D2a).
- `makePreviewCopy(file)`: dynamic `import('heic-to')` → downscale to max side 2048 → JPEG 0.85, retry 0.7, cap the
  **copy**; still returns `null` on any failure and **never rejects** (the original must upload regardless).
- Feed the resulting JPEG blob to `makeThumbnail` so HEIC finally gets a WEBP thumbnail too.

### Phase 3 — Client upload paths
- `useUploader.ts` and `useGuestSubmission.ts`: replace the `withTextSource` computation with the new gate; keep the
  `preparing: true` row state and its copy «Preparando…» (`app/utils/messages.ts:77`, reword to drop "texto").
- Thumbnail for HEIC now comes from the copy → `withThumbnail` becomes true for HEIC in both paths.

### Phase 4 — Shared contract + server
- `shared/types/api.ts`, `shared/validation/files.ts`, `shared/validation/submissions.ts`: `withTextSource` →
  `withPreview`, `textSourceUploadUrl` → `previewUploadUrl`.
- `server/api/uploads/index.post.ts`, `server/utils/guest-submissions.ts`: re-validate server-side (**the server never
  trusts the client flag** — it keeps checking `ext === 'heic'` itself, Constitution IV) and presign.
- `server/utils/uploads.ts`: `checkTextSourceCopy` → `checkPreviewCopy`, new size cap, same JPEG-signature check.
- `approve.post.ts`, `reject.post.ts`, `cron/cleanup.get.ts`, `utils/trash.ts`: rename the column references; the
  delete-with-the-original behaviour is already correct and must stay.
- `server/utils/files.ts:15` currently **strips** `textSourceKey` from listed columns — with option A the preview key
  (or a boolean `hasPreview`) must now reach the client. Decide: expose a boolean, not the raw key.

### Phase 5 — Actually show it
- `GET /api/files/:id/preview` → 302 to a presigned GET of the copy (same shape as `content.get.ts`, same
  `requireRole` + `getVisibleFile` guard, `Cache-Control: private, max-age=600`). **No binary through the function**
  (Constitution I).
- `FilePreview.vue`: for `extension === 'heic'`, render the preview URL instead of refusing; keep the `failed`
  fallback for HEIC without a copy (old files, or conversion failed).
- File grid/list: HEIC rows now have a thumbnail like any image.
- Nice follow-up, **out of scope**: the same copy would give Peticiones cards a cheap thumbnail and would soften the
  accepted LCP exception of feature 007 (guest photos have no thumbnail today).

### Phase 6 — Migration `0012` (the user runs it)
`ALTER TABLE files RENAME COLUMN text_source_key TO preview_key` + the same on `guest_submission_files`.
Inspect the generated SQL: a rename must not become DROP + ADD. Hand the commands over; agents don't run migrations.

### Phase 7 — Tests and docs
- Unit: `isAppleDevice` UA table; `checkPreviewCopy` (valid / too big / not JPEG / absent).
- Nuxt: `image-preview.spec.ts` (gate on/off, failure → `null`, never rejects), the two upload composables, the
  preview branch of `FilePreview`.
- e2e: cannot produce a HEIC in Chromium — assert instead that a non-Apple UA with a JPEG never asks for a preview
  ticket, and keep HEIC itself in component tests. Say so explicitly in the test plan.
- `architecture.spec.ts`: it has a guard listing retired symbols — update it, don't let a stale name fail the suite.
- Docs: `AGENTS.md` (the `heic-to` bullet in "Known gotchas", the upload section), and this plan's status block.

---

## 5. Verification (project Definition of Done)

1. `bun run typecheck` → `test:unit` → `test:nuxt` → `test:e2e` → `test:coverage` (gate 92 %).
2. Browser QA last, at 360 px and ≥ 1280 px, dark and light: upload a HEIC and check preview + thumbnail; upload a
   JPEG and check nothing extra is requested; guest `/upload` with a HEIC; a HEIC that fails conversion still uploads.
3. **Only a real iPhone/iPad can prove the main path.** Chromium cannot produce HEIC and cannot be made to "be" an
   iPhone beyond its UA string. Plan one manual pass from a real device against the dev server over an HTTPS tunnel
   (the same setup the camera feature needs, see `AGENTS.md`).

---

## 6. Risks

- **`heic-to` is browser-only** — keep the dynamic `import()`; it breaks SSR if imported statically.
- **UA sniffing rots.** Keep it pure and unit-tested, and never let a wrong answer block an upload: if detection is
  wrong the file must still upload, just without a preview.
- **No `CopyObject` in Neon Object Storage** — don't rename storage prefixes.
- **Old HEICs have no copy.** Everything uploaded before this ships keeps showing an icon; the UI must degrade, not
  error. A backfill is impossible server-side (conversion only runs in a browser).
- **Vercel body limit** — the copy is uploaded straight to the bucket with a presigned PUT, like today. Never through
  a server function.

---

## 7. Open questions for the user

1. **D1**: companion preview (A), replace the original (B), or gate-only (C)?
2. **D2**: should a HEIC uploaded from a non-Apple device still be converted?
3. **D3**: rename the column to `preview_key` (migration `0012`) or keep `text_source_key`?
4. **D4**: downscale big HEICs instead of skipping anything over 5 MB?
5. Does the team want this through Spec Kit as feature `009`, or as a direct branch like feature 008?
