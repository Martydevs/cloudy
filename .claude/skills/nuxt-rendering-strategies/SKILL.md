---
name: nuxt-rendering-strategies
description: Best-practices guide for choosing and configuring rendering strategies in Nuxt 3/4 (prerender/SSG, universal SSR, SPA with ssr:false, ISR, SWR, hybrid rendering with routeRules, edge) and for combining them with component lazy loading and lazy hydration (Lazy prefix, hydrate-on-visible, hydrate-on-idle, ClientOnly, server components, useLazyFetch), with code examples and links to the official documentation. Use this skill whenever the user asks about routeRules, hybrid rendering, SSR vs SPA vs SSG, ISR or SWR, route caching, prerender, when to use ssr:false, defineRouteRules, lazy components, lazy hydration, or when they design or review how to render a Nuxt app (dashboards with login and roles, blogs, e-commerce, landing pages), especially when deploying to Vercel, even if they never say "rendering strategy". También aplica si el usuario pregunta en español sobre renderizado híbrido, ISR, SPA o carga diferida de componentes en Nuxt.
---

# Rendering strategies in Nuxt

This skill helps decide **which rendering mode each route of a Nuxt app should use**, how to **combine it with lazy loading of components**, and how to **apply it with correct code**, always citing the official documentation. Core idea: in Nuxt you do not pick one mode for the whole app, you pick one per route with `routeRules`, and then you tune what JavaScript runs and when at the component level.

Reply in the user's language.

## Workflow

1. **Minimum context.** Find out (or infer from the conversation) the Nuxt version and the deployment platform. If unknown, assume Nuxt 4 and use `/docs/4.x/` links; for Nuxt 3, swap `4.x` for `3.x` in the URLs. The platform matters because `isr` only caches on a CDN where it is supported (Vercel, Netlify), and `swr` depends on where the cache lives.
2. **Route inventory.** List the routes or route groups (public, authenticated, API, editable content). If the user did not provide them, propose a reasonable grouping from what they described and say so in one line.
3. **Classify each group** with the decision tree below.
4. **Add the component layer.** For each page, decide which heavy or non-critical components get `Lazy` loading, lazy hydration, client-only rendering, or lazy data (see `references/lazy-loading.md`).
5. **Deliver** in this order: decision table (route, strategy, why) → `routeRules` block → supporting code (middleware, handlers, revalidation, lazy components) → relevant warnings → official URLs for what was used.
6. **Verify what changes over time.** `routeRules` options and platform support evolve. If the user asks for something not covered here, or there is doubt about an option, consult the official docs (web_search / web_fetch if available) instead of assuming. Do not invent `routeRules` options or hydration props.

## Decision tree (per route)

Answer in order and stop at the first answer that applies:

1. **Does the content depend on the session, cookies, role, or user?**
   - Yes → `ssr: false` (SPA) or SSR without cache. **Never** `prerender`, `isr`, or `swr`: the cache is per URL and you would serve one user's data to another.
2. **Does it need SEO or social previews (Open Graph)?**
   - No, and it is highly interactive (dashboard, back office, editor) → `ssr: false`.
   - Yes → go to 3.
3. **Is the content the same for every visitor?**
   - Never changes between deploys → `prerender: true`.
   - Changes only on edit or publish → `isr: true` + on-demand revalidation (on Vercel).
   - Changes regularly and tolerates seconds or minutes of staleness → `isr: <seconds>` (Vercel/Netlify) or `swr: <seconds>` (self-hosted server).
   - Changes on every request or is real-time → universal SSR without cache (no rule).
4. **Is it an API route?** → nothing to render; decide its caching with headers or `defineCachedEventHandler`, and never cache it if it is private.

## Strategy summary

| Strategy | `routeRules` entry | Best for | Avoid in |
|---|---|---|---|
| Prerender (static) | `{ prerender: true }` | Landing, legal, docs, login/signup | Content that changes without a redeploy; per-user data |
| Universal SSR (default) | no rule | Dynamic content with SEO, per-request personalization | When a cache would do (costs a function call per request) |
| SPA | `{ ssr: false }` | Dashboard, admin, SaaS, logged-in areas | Pages that must be indexed |
| ISR | `{ isr: true }` or `{ isr: 3600 }` | Blog, catalog, detail pages, changing public content | Routes that use sessions or cookies |
| SWR | `{ swr: 60 }` | Self-hosted `node-server`; near-fresh data | Vercel, if you expect a shared cache (use `isr` there) |
| Edge | `vercel-edge` or other preset | Low global latency | Code that needs Node APIs or incompatible DB drivers |

Detail, code, and URLs for each: `references/strategies.md`.
Vercel, logged-in apps with roles, file uploads, and database: `references/vercel-and-auth-apps.md`.
Lazy components and lazy hydration combined with each strategy: `references/lazy-loading.md`.

## Combining routeRules with lazy loading (quick guide)

`routeRules` decide **when and where the HTML is produced** (build, CDN cache, server per request, or browser). Component-level lazy techniques decide **when the JavaScript is loaded and executed**. They are complementary: ISR reduces function invocations, lazy hydration reduces JS work in the browser.

| Route strategy | HTML comes from | `Lazy` prefix + `v-if` (code splitting) | `hydrate-*` props (lazy hydration) | Client-only for user-specific parts |
|---|---|---|---|---|
| `prerender`, `isr`, `swr`, universal SSR | Server or cache | Yes, for modals, drawers, heavy tabs | **Yes**, for below-the-fold or non-critical interactive blocks | Yes, mandatory inside cached pages |
| `ssr: false` (SPA) | Browser only | **Yes**, the main tool here | Not useful: there is no server HTML to hydrate | Not applicable (everything is client) |

Rules of thumb:
- Never lazy-hydrate above-the-fold or critical content.
- A cached page (`prerender`/`isr`/`swr`) is shared by all visitors, so anything user-specific must load on the client from a non-cached API.
- Keep route boundaries meaningful first: Nuxt already splits code per page; do not micro-split before that.

## Golden rules

- **Start with the most static option** and move down only if needed: `prerender` > `isr` > SSR with cache > plain SSR. Each step costs more function executions.
- **Cache = same response for everyone.** Before adding `isr`, `swr`, or `prerender`, confirm the page does not read cookies, session headers, or user data.
- **Security lives on the server.** Route middleware on the client only improves UX; validate session and role in every `server/api` endpoint.
- **Private API routes are never cached.** Consider `headers: { 'cache-control': 'no-store' }` on `/api/**` (or on the private subset).
- **Wildcards matter:** `/blog/**` covers everything under `/blog`; more specific rules take priority over general ones, which is useful for exceptions.
- **Query strings with ISR:** by default Vercel ignores them for the cache key; if the page changes by `?q=`, declare it with `allowQuery` and `passQuery`.
- **Prerender needs data at build time.** If a prerendered page queries the database, the build must be able to reach it; otherwise use ISR instead of prerender.
- **`nuxt generate` does not support hybrid rendering.** To use `routeRules` with ISR or mixed SSR, deploy with `nuxt build` (what Vercel runs by default).
- **With `ssr: false`, add `app/spa-loading-template.html`** so users see something while the app boots.
- **Libraries that use `window`/`document`:** import them only inside components that run on the client (`<ClientOnly>` or `.client.vue`) to avoid SSR errors and hydration mismatches.
- **Lazy hydration has constraints:** it works only in single-file components, props must be written in the template (no `v-bind` object spread), it does not work with direct imports from `#components`, and any prop change on a lazily hydrated component triggers hydration immediately.

## Common anti-patterns

| Anti-pattern | Why it is a problem | Alternative |
|---|---|---|
| Global `'/**': { isr: 60 }` in an app with login | Caches private pages and APIs; risk of leaking data between users | Per-zone rules; `ssr: false` or no rule for private areas |
| `isr` or `swr` on `/dashboard/**` | Same reason | `ssr: false` |
| `swr` on Vercel expecting a shared cache | A serverless function's in-memory cache is not shared across instances | `isr` (CDN) or a cache backed by shared storage |
| Prerendering pages that depend on the user | HTML is frozen at build time | `ssr: false` + `$fetch` to the API |
| Protecting only with client-side middleware | Anyone can call the API directly | Validate session and role in every handler |
| Uploading large files through the function | Functions limit request body size | Signed URL and direct upload to storage |
| `hydrate-never` or `hydrate-on-visible` on above-the-fold interactive content | Delays interactivity of what users see first | Normal hydration for critical content |
| `Lazy` prefix on every component | Creates many small chunks without real gain | Lazy-load only heavy or conditional components |
| Using `nuxt generate` with hybrid `routeRules` | Hybrid rendering is not available there | `nuxt build` |

## Official documentation (sources for this skill)

- Rendering modes and route rules (Nuxt 4): https://nuxt.com/docs/4.x/guide/concepts/rendering
- `defineRouteRules` (page-level rules, experimental): https://nuxt.com/docs/4.x/api/utils/define-route-rules
- `ssr` option in nuxt.config: https://nuxt.com/docs/4.x/api/nuxt-config#ssr
- Prerendering: https://nuxt.com/docs/4.x/getting-started/prerendering
- Components: Lazy prefix, lazy hydration, client and server components: https://nuxt.com/docs/4.x/directory-structure/app/components
- Server components guide: https://nuxt.com/docs/4.x/guide/concepts/server-components
- `<ClientOnly>`: https://nuxt.com/docs/4.x/api/components/client-only
- Data fetching: https://nuxt.com/docs/4.x/getting-started/data-fetching
- `useFetch`: https://nuxt.com/docs/4.x/api/composables/use-fetch
- `useLazyFetch`: https://nuxt.com/docs/4.x/api/composables/use-lazy-fetch
- SPA loading template: https://nuxt.com/docs/4.x/directory-structure/app/spa-loading-template
- Route middleware: https://nuxt.com/docs/4.x/directory-structure/app/middleware
- Deployment: https://nuxt.com/docs/4.x/getting-started/deployment
- Nitro cache (`defineCachedEventHandler`): https://nitro.build/guide/cache
- ISR on Vercel (Nuxt with `routeRules`): https://vercel.com/docs/incremental-static-regeneration/quickstart
- Nitro on Vercel (`isr` options, `bypassToken`): https://vercel.com/docs/frameworks/nitro
- Official example linked from the Nuxt docs (hybrid on Vercel): https://github.com/danielroe/nuxt-vercel-isr
