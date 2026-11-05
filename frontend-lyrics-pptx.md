# Lyrics → PowerPoint: frontend requirements (Nuxt)

What the Cloudy Nuxt app must implement to use `POST /v1/lyrics/pptx` from this API.
Backend behaviour and internals are in the [README](../README.md#lyrics-to-powerpoint).

## Flow

```
Browser ──(Letras URL)──▶ Nuxt server route ──(lyrics HTML + X-API-Key)──▶ Cloudy API
   ▲                            │  1. validate URL        POST /v1/lyrics/pptx
   │                            │  2. scrape page         ◀── .pptx bytes + headers
   └────── .pptx bytes ◀────────┘  3. extract lyrics HTML
```

- The **browser never calls the Cloudy API**. The API key must stay on the Nuxt server, and
  the API's CORS only allows `GET`.
- The Cloudy API does **no scraping**: it receives HTML and returns the file.

## 1. Configuration

Same private runtime config as the YouTube feature (env vars `NUXT_CLOUDY_API_URL` and
`NUXT_CLOUDY_API_KEY`); nothing new is needed.

```ts
// nuxt.config.ts
runtimeConfig: {
  cloudyApiUrl: '',  // NUXT_CLOUDY_API_URL, e.g. https://cloudy-api.onrender.com
  cloudyApiKey: '',  // NUXT_CLOUDY_API_KEY (private: never put it under `public`)
}
```

## 2. API contract

`POST {cloudyApiUrl}/v1/lyrics/pptx`

Headers: `X-API-Key: <key>`, `Content-Type: application/json`

Body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `html` | string | yes | 1 to 500,000 chars. The lyrics container (`.lyric-original`) is enough; a whole page also works. Max 300 lyric lines. |
| `title` | string | no | ≤ 200 chars. Names the file and the document. Defaults to the page's `<h1>`, then `lyrics`. |
| `font_color` | string | no | `RRGGBB` or `#RRGGBB`. Default `000000`. |

Success: `200`, body is the `.pptx` (binary).

| Response header | Value |
|---|---|
| `Content-Type` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `Content-Disposition` | `attachment; filename="Song.pptx"; filename*=UTF-8''Song.pptx` (`filename*` keeps accents) |
| `X-Slide-Count` | number of slides |
| `X-Lyrics-Arranged-By` | `llm`, or `fallback` when the LLM was unavailable or returned an unusable plan |

Errors:

| Status | Body | Meaning | Suggested UI |
|---|---|---|---|
| `401` | `{detail: {code: "unauthorized", …}}` | Wrong/missing API key | Generic error; log server-side |
| `422` | `{detail: {code: "no_lyrics", message}}` | HTML has no lyrics | "No lyrics found at that URL" |
| `422` | `{detail: {code: "lyrics_too_long", message}}` | More than 300 lines | "That doesn't look like a song" |
| `422` | `{detail: [ … ]}` (a list) | Malformed body (bad `font_color`, empty `html`, …) | Treat as a frontend bug |
| `5xx` / timeout | — | API down or waking up | "Try again" |

## 3. Nuxt server route

Create e.g. `server/api/lyrics/pptx.post.ts`. It must:

1. **Validate the input URL** before fetching (SSRF guard): `https:` only, host exactly
   `letras.com` or `www.letras.com`, no credentials in the URL. Reject anything else with `400`.
2. **Scrape the page** with your scraping service/fetch and extract the lyrics HTML
   (`.lyric-original`) and, if available, the song title from `<h1>`. Sending the whole page
   also works, but keep it under 500,000 chars.
3. **POST to the Cloudy API** with `X-API-Key` and the JSON body above.
4. **Return the bytes to the browser** and copy `Content-Type`, `Content-Disposition`,
   `X-Slide-Count` and `X-Lyrics-Arranged-By`.
5. **Map errors**: forward `422` codes as `4xx` with a message the UI can show; turn `401`
   and `5xx` into a generic `502` (don't leak the upstream body or key).

```ts
// server/api/lyrics/pptx.post.ts (sketch)
export default defineEventHandler(async (event) => {
  const { url, fontColor } = await readBody<{ url: string; fontColor?: string }>(event)
  const letras = parseLetrasUrl(url) // throws createError({ statusCode: 400 }) if not https://(www.)letras.com/...
  const { html, title } = await scrapeLyrics(letras) // your scraping step

  const { cloudyApiUrl, cloudyApiKey } = useRuntimeConfig(event)
  const upstream = await fetch(`${cloudyApiUrl}/v1/lyrics/pptx`, {
    method: 'POST',
    headers: { 'X-API-Key': cloudyApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, title, font_color: fontColor }),
    signal: AbortSignal.timeout(90_000), // cold start on Render Free
  })

  if (!upstream.ok) {
    const detail = upstream.status === 422 ? await upstream.json().catch(() => null) : null
    throw createError({
      statusCode: upstream.status === 422 ? 422 : 502,
      statusMessage: detail?.detail?.message ?? 'Could not generate the presentation',
      data: { code: detail?.detail?.code },
    })
  }

  for (const name of ['content-type', 'content-disposition', 'x-slide-count', 'x-lyrics-arranged-by']) {
    const value = upstream.headers.get(name)
    if (value) setResponseHeader(event, name, value)
  }
  return Buffer.from(await upstream.arrayBuffer())
})
```

## 4. Client page

- A form with a Letras URL input and a "Generate" button (optionally a font color picker that
  sends `fontColor`). Validate the URL client-side too, for fast feedback only; the server
  route is the real check.
- Request the file as a blob and trigger a download with the filename from `Content-Disposition`:

```ts
const res = await $fetch.raw<Blob>('/api/lyrics/pptx', {
  method: 'POST',
  body: { url, fontColor },
  responseType: 'blob',
})
const disposition = res.headers.get('content-disposition') ?? ''
const filename =
  decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? '') ||
  /filename="([^"]+)"/i.exec(disposition)?.[1] ||
  'lyrics.pptx'

const href = URL.createObjectURL(res._data!)
Object.assign(document.createElement('a'), { href, download: filename }).click()
URL.revokeObjectURL(href)
```

- Show a loading state; the request can take several seconds (LLM call), longer on a cold start.
- Optional: if `x-lyrics-arranged-by` is `fallback`, show a note such as "Slides were grouped
  automatically (AI arrangement unavailable)". The file is still valid.
- Optional: show `x-slide-count` ("12 slides generated").

## 5. Operational notes

- **Cold start:** Render Free sleeps after 15 minutes idle (about a minute to wake). Call
  `GET {cloudyApiUrl}/healthz` (no auth) when the page opens, and use a server timeout of
  60 to 90 seconds. `/healthz` may answer `503` while some YouTube dependencies are missing;
  for waking the service any response is enough.
- **Size:** the generated file is small (tens of KB), well under Vercel's response limits.
- **Transparent slides:** the text box and slide background have no fill. PowerPoint still
  shows a white slide; the transparency matters for tools that import the text over a
  background. If the text will go over a dark background, send `fontColor: "FFFFFF"`.
- **Don't retry on `422`:** it is deterministic. Retry only on timeouts and `5xx`.

## 6. Testing checklist

- [ ] Non-Letras URLs, `http://` URLs, and look-alike hosts (`letras.com.evil.test`) are rejected before any fetch.
- [ ] `https://www.letras.com/musiko/de-buenas-part-josh-gamez/` downloads a `.pptx` that opens in PowerPoint.
- [ ] A song title with accents downloads with the correct filename.
- [ ] A URL with no lyrics shows the "no lyrics" message.
- [ ] The API key never appears in browser network traffic or the client bundle.
- [ ] Cold-start request (service asleep) still succeeds within the timeout.
