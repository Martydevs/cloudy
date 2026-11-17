# Release checklist (for a person)

Every step below is run by a person, in this order. It follows design.md "Migration Plan". No new environment variables.

## 1. Migrations (before any deploy)

Migration `drizzle/0014_prayer_transcripts.sql` only adds things: two enums (`prayer_transcript_status`,
`prayer_transcript_origin`) and the table `prayer_transcripts`. It changes no existing table. Until it is applied, the new
endpoints (`/api/peticiones/transcripciones/**`) and image generation answer 500 in that environment.

```bash
bun run db:migrate        # development (.env.development)
bun run db:migrate:test   # test (.env.test) — `bun run test:e2e` also applies it by itself
bun run db:migrate:prod   # production (.env)
```

## 2. OpenRouter presets (same release window as the deploy)

1. **Create** `@preset/pray-requests-transcription`: a vision model that supports structured (JSON schema) output. System
   prompt: transcribe the handwritten or printed text of the photo verbatim, keep its line breaks, do not correct,
   summarise, translate or add anything, and say there is no text when nothing is legible. The code asks for
   `{ hasText: boolean, text: string }` and sends one photo per call as a signed URL.
2. **Rewrite the system prompt** of `@preset/pray-requests-image-generation`: it must no longer say that the photos after
   the template carry each request's text. Now the message carries the template image and then one text block per
   request, in order, each between the marks `<peticion>` and `</peticion>`; the model writes each block verbatim on the
   template, one block per request, in the same order, and draws neither the marks nor numbers, labels, names or notes.
   Keep the layout rules (text area, columns, typography, what not to touch).

Until step 2.2 is done the code and the preset disagree (the code sends text, the preset still says "read the photos").
The user prompt in `server/ai/prayer-image/prompt.ts` already states the new instruction, so the window should be short,
not zero.

## 3. Deploy

Deploy the build. Check on production: open `/peticiones`, select a request, **Generar imágenes** opens the review dialog,
the photo is read, verify it and generate one image.

## Rollback

Redeploy the previous build and restore the previous system prompt of `@preset/pray-requests-image-generation`. The table
`prayer_transcripts` can stay (unused). Dropping it is a destructive step for a person:

```sql
DROP TABLE prayer_transcripts;
DROP TYPE prayer_transcript_status;
DROP TYPE prayer_transcript_origin;
```
