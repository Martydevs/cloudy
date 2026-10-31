# Vercel and apps with authentication, roles, files, and database

Contents:
1. How rules map to Vercel
2. `routeRules` template for a dashboard with a public area
3. Security: session and roles on the server
4. Uploading media files
5. Database in serverless
6. Forms
7. Pre-deploy checklist

For lazy components and lazy hydration in these pages, see `lazy-loading.md`.

---

## 1. How rules map to Vercel

- Whenever possible, Nuxt applies route rules to the platform's native rules (Vercel and Netlify are supported). Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#route-rules
- `isr` is deployed as Incremental Static Regeneration on Vercel's CDN. Docs: https://vercel.com/docs/incremental-static-regeneration/quickstart
- `prerender` produces static files served by the CDN.
- `ssr: false` delivers the SPA shell; data arrives through `/api`.
- With no rule, the route is rendered by a serverless function on every request.
- Use `nuxt build` (Vercel's default command for Nuxt). Hybrid rendering is not available with `nuxt generate`.

## 2. `routeRules` template for a dashboard with a public area

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: 'latest',

  nitro: {
    vercel: {
      // Only if you use on-demand revalidation
      config: { bypassToken: process.env.VERCEL_BYPASS_TOKEN },
    },
  },

  routeRules: {
    // Static public pages
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/login': { prerender: true },
    '/signup': { prerender: true },
    '/legal/**': { prerender: true },

    // Public pages with changing content
    '/blog': { isr: 3600 },
    '/blog/**': { isr: true },          // + on-demand revalidation when publishing

    // Authenticated: SPA, no cache
    '/dashboard/**': { ssr: false, appMiddleware: ['auth'] },
    '/admin/**': { ssr: false, appMiddleware: ['auth'] },
    '/profile/**': { ssr: false, appMiddleware: ['auth'] },

    // Private API: never cache
    '/api/**': { headers: { 'cache-control': 'no-store' } },
  },
})
```

Adjust this template to the real routes. If some public endpoints should be cached (for example `/api/catalog`), use a more specific rule or `defineCachedEventHandler` in that handler (see `strategies.md`, section 6).

**Non-SPA alternative for private areas:** if you prefer the server to redirect to login before sending HTML, or you need server-rendered data, remove `ssr: false` from those zones and leave SSR uncached. It costs more function invocations but is valid.

## 3. Security: session and roles on the server

App middleware does not protect data. Validate in every handler:

```ts
// server/utils/auth.ts
import type { H3Event } from 'h3'

export async function requireRole(event: H3Event, roles: string[]) {
  const { user } = await requireUserSession(event) // example with nuxt-auth-utils; adapt to your library
  if (!roles.includes(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return user
}
```

```ts
// server/api/admin/users.get.ts
export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin'])
  return await listUsers() // your query
})
```

Rules:
- Every private route under `/api` requires a session; public ones are an explicit, short list.
- Roles are checked on the server even if the client already hides buttons or routes.
- Never put `isr`, `swr`, or `prerender` on a route that reads the session.

## 4. Uploading media files

Vercel's serverless functions limit the request body size. Check the current value in Vercel's documentation before deciding; in practice, passing large images or video through your API fails. The recommended pattern is **direct upload to storage with a signed URL**:

1. The client asks your API for permission to upload (declared type and size).
2. The API validates session, role, MIME type, and maximum size, and returns a short-lived signed URL or upload token.
3. The browser uploads the file directly to storage (Vercel Blob, S3, Cloudflare R2, etc.).
4. The client notifies the API with the object key; the API stores the reference in the database.

```ts
// server/api/uploads/sign.post.ts
import { z } from 'zod'

const MAX_BYTES = 50 * 1024 * 1024
const schema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  size: z.number().int().positive().max(MAX_BYTES),
})

export default defineEventHandler(async (event) => {
  const user = await requireRole(event, ['admin', 'editor'])
  const body = await readValidatedBody(event, schema.parse)

  // Implementation depends on your provider (S3, R2, Vercel Blob...)
  const { url, key } = await createSignedUpload({
    userId: user.id,
    contentType: body.contentType,
    maxBytes: body.size,
  })
  return { url, key }
})
```

Good practices: validate the type again after upload, generate unpredictable object keys, and do not trust the original file extension.

## 5. Database in serverless

- Use a **connection pooler** (for example Neon's or Supabase's pooler, PgBouncer, or an ORM proxy). Each invocation may open new connections and exhaust the limit.
- Put the functions in a **region close to the database** to reduce latency.
- Do not query the database inside `prerender` pages unless the build has access; for database content that changes, `isr` is safer.
- Cache public, expensive data with `defineCachedEventHandler`, not private responses.

## 6. Forms

- Always validate on the server with a schema (Zod, Valibot, etc.) even if you already validate on the client.
- If you use session cookies, protect mutations against CSRF: `SameSite=Lax` or `Strict` plus `Origin` header verification.
- `/login` and `/signup` forms can live on `prerender` pages: the HTML is static and submission goes through `$fetch` to the API.

## 7. Pre-deploy checklist

- [ ] No route that uses a session or cookies has `isr`, `swr`, or `prerender`.
- [ ] Private `/api/**` is not cached and validates session and role in every handler.
- [ ] `isr` routes that depend on query params declare `allowQuery`.
- [ ] `app/spa-loading-template.html` exists if you use `ssr: false`.
- [ ] The build can reach whatever the `prerender` pages need.
- [ ] If you use on-demand revalidation, `VERCEL_BYPASS_TOKEN` is set as an environment variable in Vercel and the endpoint that triggers it requires an admin role.
- [ ] File uploads go directly to storage.
- [ ] The database uses a pooler and the functions' region is close to it.
- [ ] Below-the-fold interactive components on cached pages use lazy hydration, and user-specific parts of cached pages load on the client from non-cached APIs.
- [ ] You tested a preview deployment with an authenticated user and an anonymous one to confirm responses are not mixed.

Docs: https://vercel.com/docs/frameworks/nitro · https://vercel.com/docs/incremental-static-regeneration/quickstart · https://nuxt.com/docs/4.x/getting-started/deployment
