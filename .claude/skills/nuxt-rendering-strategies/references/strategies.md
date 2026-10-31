# Rendering strategies: when to use them and how to apply them

Contents:
1. Prerender (static)
2. Universal SSR (default)
3. SPA with `ssr: false`
4. ISR
5. SWR
6. Handler-level cache (Nitro)
7. Other useful `routeRules`
8. Edge-side rendering
9. Page-level rules with `defineRouteRules`

Base documentation for this whole file: https://nuxt.com/docs/4.x/guide/concepts/rendering

For lazy components and lazy hydration inside each strategy, see `lazy-loading.md`.

---

## 1. Prerender (static)

**What it does.** Generates the HTML at build time and serves it as a static file.

**Use it when** the content is the same for everyone and only changes with a new deploy: home page, pricing, legal pages, docs, login and signup (the form is handled on the client).

**Avoid it when** content changes without a redeploy, depends on the user, or the build cannot reach the data sources.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/login': { prerender: true },
    '/legal/**': { prerender: true },
  },
})
```

Dynamic routes that are not discovered automatically (for example `/docs/[slug]`):

```ts
export default defineNuxtConfig({
  nitro: {
    prerender: {
      crawlLinks: true,           // follow links found in prerendered pages
      routes: ['/docs/start'],    // extra routes to generate
    },
  },
})
```

**Notes.** With prerender, the page is stored as a static file at build time. Use `nuxt build` (not `nuxt generate`) if you need server endpoints or hybrid rules.

Docs: https://nuxt.com/docs/4.x/getting-started/prerendering

---

## 2. Universal SSR (default)

**What it does.** On every request the server renders the full HTML and the browser hydrates it. This is Nuxt's default mode, with no rule needed.

**Use it when** the page needs SEO and its content is dynamic per request or cannot be cached: search results, detail pages with real-time stock, pages with highly variable parameters.

**Avoid it when** a cache (`isr`) would serve just as well: every request consumes a function invocation.

```vue
<!-- app/pages/product/[id].vue -->
<script setup lang="ts">
const route = useRoute()
const { data: product } = await useFetch(`/api/products/${route.params.id}`)

if (!product.value) {
  throw createError({ statusCode: 404, statusMessage: 'Product not found', fatal: true })
}

useSeoMeta({
  title: () => product.value?.name,
  description: () => product.value?.summary,
  ogImage: () => product.value?.image,
})
</script>
```

Code that uses browser APIs (`window`, `document`) or libraries with side effects:

```vue
<template>
  <ClientOnly>
    <InteractiveMap />
    <template #fallback><div class="skeleton" /></template>
  </ClientOnly>
</template>
```

Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#universal-rendering · https://nuxt.com/docs/4.x/api/components/client-only

---

## 3. SPA with `ssr: false`

**What it does.** The server delivers a shell and the page renders only in the browser.

**Use it when** the area is highly interactive, private, and has no SEO needs: dashboard, administration, editor, back office. It is also the safe choice for anything that depends on the session.

**Avoid it when** the page must be indexed or shared with a preview.

By zone (hybrid):

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/dashboard/**': { ssr: false },
    '/admin/**': { ssr: false },
    // Exception: one specific route inside the zone goes back to SSR
    // '/admin/public-report': { ssr: true },
  },
})
```

Whole app as an SPA:

```ts
export default defineNuxtConfig({ ssr: false })
```

Loading template while the app boots:

```html
<!-- app/spa-loading-template.html -->
<div class="loading">Loading…</div>
```

Access control in the app (improves UX, does **not** replace server-side validation):

```ts
// app/middleware/auth.ts  (example with nuxt-auth-utils; adapt to your library)
export default defineNuxtRouteMiddleware(() => {
  const { loggedIn } = useUserSession()
  if (!loggedIn.value) return navigateTo('/login')
})
```

```ts
// app/middleware/role.ts
export default defineNuxtRouteMiddleware((to) => {
  const { user } = useUserSession()
  const roles = (to.meta.roles as string[] | undefined) ?? []
  if (roles.length && !roles.includes(user.value?.role ?? '')) {
    return navigateTo('/403')
  }
})
```

```vue
<!-- app/pages/admin/users.vue -->
<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'role'], roles: ['admin'] })
</script>
```

Per-zone alternative with `appMiddleware` in `routeRules` (middleware applied to the Vue app pages, not to Nitro routes):

```ts
routeRules: {
  '/dashboard/**': { ssr: false, appMiddleware: ['auth'] },
}
```

**Bundle note.** Nuxt excludes from the server bundle the pages covered only by `ssr: false` rules, as long as they can be resolved at build time.

**Lazy loading in SPAs.** Since nothing is server-rendered, `Lazy` + `v-if` is the main lever for smaller bundles; see `lazy-loading.md`.

Docs: https://nuxt.com/docs/4.x/api/nuxt-config#ssr · https://nuxt.com/docs/4.x/directory-structure/app/spa-loading-template · https://nuxt.com/docs/4.x/directory-structure/app/middleware

---

## 4. ISR (Incremental Static Regeneration)

**What it does.** Like `swr`, but the response is stored in the CDN cache on supported platforms (Vercel, Netlify). With `isr: true` the content persists until the next deploy; with a number, it is revalidated after that time (serves the previous version and regenerates in the background).

**Use it when** content is public, the same for everyone, and changes with some frequency: blog, catalog, detail pages, editable marketing pages.

**Avoid it when** the route depends on cookies, session, or role.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/blog': { isr: 3600 },        // listing: revalidate hourly
    '/blog/**': { isr: true },     // posts: generated once, kept until the next deploy
    '/products/**': { isr: 300 },  // catalog: every 5 min
  },
})
```

Advanced options on Vercel (`expiration`, `allowQuery`, `passQuery`):

```ts
routeRules: {
  '/products/**': {
    isr: {
      expiration: 300,        // seconds; false = never expires
      allowQuery: ['q'],      // query params cached independently
      passQuery: true,        // pass the query string to the function
    },
  },
}
```

By default, query params are ignored for the cache unless you list them in `allowQuery`.

**On-demand revalidation (Vercel).** Useful when someone publishes or edits content and the page must update right away:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    vercel: {
      config: { bypassToken: process.env.VERCEL_BYPASS_TOKEN },
    },
  },
})
```

It is triggered with a GET or HEAD request to the route carrying the header `x-prerender-revalidate: <token>`:

```ts
// server/api/revalidate.post.ts
export default defineEventHandler(async (event) => {
  await assertAdmin(event) // your own session and role validation

  const { path } = await readBody<{ path: string }>(event)
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' })
  }

  await $fetch(path, {
    method: 'HEAD',
    baseURL: getRequestURL(event).origin,
    headers: { 'x-prerender-revalidate': process.env.VERCEL_BYPASS_TOKEN! },
  })
  return { ok: true }
})
```

**Notes.** Routes with `isr` or `swr` also generate `_payload.json` files: client-side navigation loads those cached payloads instead of fetching the data again.

Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#route-rules · https://vercel.com/docs/incremental-static-regeneration/quickstart · https://vercel.com/docs/frameworks/nitro

---

## 5. SWR (stale-while-revalidate)

**What it does.** Adds cache headers and stores the response on the server or a reverse proxy for the TTL; when it expires, it responds with the stored version and regenerates in the background. With `swr: true` only the `stale-while-revalidate` header is added, without `max-age`. Nitro's `node-server` preset can cache the full response.

**Use it when** you deploy to your own server (Node, container, VPS) and want near-fresh data without rendering on every request.

**On Vercel, prefer `isr`**: it is the variant that goes to the CDN cache. A serverless function's in-memory cache is not shared across instances.

```ts
routeRules: {
  '/products': { swr: true },
  '/products/**': { swr: 3600 },
}
```

Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#route-rules · https://nitro.build/guide/cache

---

## 6. Handler-level cache (Nitro)

**When.** You want to cache **data** (an expensive query, a public response) without caching the whole route or page.

```ts
// server/api/catalog.get.ts
export default defineCachedEventHandler(
  async () => {
    return await getPublicCatalog() // your DB query
  },
  {
    maxAge: 60,          // seconds
    swr: true,           // serve the stored value while revalidating
    name: 'catalog',
    getKey: () => 'public',
  },
)
```

**Important.** Never include private data in a cached handler without a `getKey` that depends on the user; for private responses, do not cache.

In serverless, the default cache is local to the instance. If you need a shared cache, configure external storage for the `cache` mount:

```ts
// nuxt.config.ts (check driver options in the unstorage docs)
export default defineNuxtConfig({
  nitro: {
    storage: {
      cache: { driver: 'redis', url: process.env.REDIS_URL },
    },
  },
})
```

Docs: https://nitro.build/guide/cache

---

## 7. Other useful `routeRules`

| Rule | Use |
|---|---|
| `redirect: string` | Server-side redirects |
| `proxy: string \| object` | Forward requests to another URL |
| `cors: boolean` | Adds CORS headers (customizable with `headers`) |
| `headers: object` | Per-zone headers (for example `cache-control` on assets or `no-store` on private APIs) |
| `noScripts: boolean` | Removes Nuxt scripts and resource hints from a section (purely informational pages) |
| `appMiddleware` | Vue app middleware per zone |

```ts
routeRules: {
  '/old-page': { redirect: '/new-page' },
  '/api/public/**': { cors: true },
  '/api/private/**': { headers: { 'cache-control': 'no-store' } },
  '/proxy/**': { proxy: 'https://api.example.com/**' },
}
```

Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#route-rules

---

## 8. Edge-side rendering

It is not a new mode but a **deployment target**: HTML is generated on the CDN's edge servers, closer to the user. It is enabled with the platform's Nitro preset (for example `NITRO_PRESET=vercel-edge` on Vercel according to the Nuxt docs) and can be combined with `routeRules`.

**Caution:** the edge runtime does not support every Node API; many database drivers, SDKs, and libraries do not work. Validate compatibility before adopting it, and do not suggest it by default for apps with a traditional database.

Docs: https://nuxt.com/docs/4.x/guide/concepts/rendering#edge-side-rendering

---

## 9. Page-level rules with `defineRouteRules`

Experimental: you must enable `experimental.inlineRouteRules` in `nuxt.config`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  experimental: { inlineRouteRules: true },
})
```

```vue
<!-- app/pages/index.vue -->
<script setup lang="ts">
defineRouteRules({ prerender: true })
</script>
```

It translates to `routeRules: { '/': { prerender: true } }`. A rule in `pages/foo/[id].vue` applies to `/foo/*`. If the route cannot be converted to a pattern (params with a regex like `/:id(\d+)`, partial segments like `/prefix-:id`, repeatable params like `/:slug+`), the rule is not applied and Nuxt warns during the build: define the rule in `routeRules` (or `nitro.routeRules`) in `nuxt.config` instead.

**Recommendation:** since it is experimental, for teams and production apps it is clearer and more traceable to centralize everything in `nuxt.config.ts`.

Docs: https://nuxt.com/docs/4.x/api/utils/define-route-rules
