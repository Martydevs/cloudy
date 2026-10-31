# Combining hybrid rendering with lazy loading

Contents:
1. Mental model: two layers
2. The five component-level levers
3. Which lever fits each route strategy
4. Patterns with code
5. Rules, caveats, and anti-patterns
6. How to verify
7. Official documentation

---

## 1. Mental model: two layers

| Layer | Question it answers | Tool |
|---|---|---|
| Route layer | When and where is the **HTML** produced? (build, CDN cache, server per request, browser) | `routeRules`: `prerender`, `isr`, `swr`, `ssr: false`, or no rule |
| Component layer | When is the **JavaScript** downloaded and executed? | `Lazy` prefix, `hydrate-*` props, `<ClientOnly>` / `.client.vue`, `.server.vue`, `useLazyFetch` |

They are complementary. ISR cuts function invocations; lazy hydration cuts JavaScript work in the browser. A fast page usually needs both: static or cached HTML for the first paint, and deferred interactivity for everything that is not critical.

Order of work: first get route boundaries right (Nuxt already code-splits per page), then apply component-level techniques only to heavy or non-critical pieces.

---

## 2. The five component-level levers

| Lever | What it does | Syntax |
|---|---|---|
| **Lazy prefix (dynamic import)** | Delays loading the component's JS chunk until it is rendered. Combine with `v-if` so the chunk loads only when needed. | `<LazyMountainsList v-if="show" />` |
| **Lazy hydration** | The component's HTML is still delivered (SSR, prerender, or cache), but hydration is deferred until a trigger. Only one strategy per component. | `<LazyMyComponent hydrate-on-visible />` |
| **Client-only** | The component is not in the server HTML at all; it renders after mount. | `<ClientOnly>`, `Comments.client.vue` |
| **Server components** | Rendered on the server; their libraries stay out of the client bundle. | `HighlightedMarkdown.server.vue` |
| **Lazy data** | Data fetching that does not block navigation or the first paint. | `useLazyFetch`, `lazy: true`, `server: false` |

Hydration strategies (props on a `Lazy` component):

| Prop | Hydrates when |
|---|---|
| `hydrate-on-visible` | The component enters the viewport |
| `hydrate-on-idle` | The browser is idle (optionally pass a max timeout number) |
| `hydrate-on-interaction="mouseover"` | A given event happens (defaults to `pointerenter`, `click`, `focus`) |
| `hydrate-on-media-query="(max-width: 768px)"` | The window matches the media query |
| `:hydrate-after="2000"` | After the delay in milliseconds |
| `:hydrate-when="isReady"` | A boolean condition becomes true |
| `hydrate-never` | Never (purely static content) |

All of them emit `@hydrated` when they finish.

---

## 3. Which lever fits each route strategy

| Route strategy | HTML origin | `Lazy` + `v-if` | `hydrate-*` | Client-only / lazy data for user-specific parts |
|---|---|---|---|---|
| `prerender` | Static file from build | Yes (modals, drawers, tabs) | **Yes**: ideal for below-the-fold interactive blocks | Required if any part is per-user |
| `isr` / `swr` | CDN or server cache, shared by everyone | Yes | **Yes** | **Required**: the cached HTML is the same for all visitors |
| Universal SSR (no rule) | Server, per request | Yes | **Yes** | Optional (SSR can render user data, but then do not cache) |
| `ssr: false` (SPA) | Browser only | **Yes**: the main tool | Not useful: there is no server HTML to hydrate, so there is nothing to defer. Use `Lazy` + `v-if` for code splitting instead | Not applicable: everything is client-side |

Key consequence: **lazy hydration only makes sense where the server (or the build, or a cache) already produced the HTML.** In an SPA zone, reduce JavaScript by splitting chunks, not by deferring hydration.

---

## 4. Patterns with code

### A. Prerendered or ISR content page (blog, landing, catalog)

Static HTML for the first paint; interactive extras hydrate later.

```ts
// nuxt.config.ts
routeRules: {
  '/': { prerender: true },
  '/blog/**': { isr: true },
}
```

```vue
<!-- app/pages/blog/[slug].vue -->
<script setup lang="ts">
const route = useRoute()
const { data: post } = await useFetch(`/api/posts/${route.params.slug}`)
</script>

<template>
  <article>
    <!-- Critical, above the fold: normal hydration -->
    <PostHeader :post="post" />
    <PostBody :post="post" />

    <!-- Interactive but below the fold: hydrate when scrolled into view -->
    <LazyCommentsSection :post-id="post.id" hydrate-on-visible />

    <!-- Not urgent, but should be ready soon: hydrate when the browser is idle -->
    <LazyNewsletterForm hydrate-on-idle />

    <!-- Purely static decoration, no interactivity: never hydrate -->
    <LazyRelatedPostsStatic :items="post.related" hydrate-never />
  </article>
</template>
```

Reserve height for deferred blocks (fixed `min-height` or skeleton) to avoid layout shift when they become interactive.

### B. Cached page with user-specific parts (static shell + client islands)

An `isr`, `swr`, or `prerender` page is shared by all visitors, so it cannot contain data about the current user. Keep the shell cached and load personal parts on the client from a **non-cached** API.

```vue
<!-- app/components/UserMenu.vue -->
<script setup lang="ts">
// Client-only fetch: not part of the cached HTML
const { data: me, status } = useLazyFetch('/api/me', { server: false })
</script>

<template>
  <div v-if="status === 'success' && me">{{ me.name }}</div>
  <NuxtLink v-else to="/login">Log in</NuxtLink>
</template>
```

```ts
// nuxt.config.ts — the endpoint must never be cached
routeRules: {
  '/api/me': { headers: { 'cache-control': 'no-store' } },
}
```

For widgets that should not appear in the server HTML at all (carts, recommendations by user), use `<ClientOnly>` with a `#fallback` of the same size, or a `.client.vue` component:

```vue
<template>
  <ClientOnly>
    <LazyCartDrawer />
    <template #fallback><CartButtonPlaceholder /></template>
  </ClientOnly>
</template>
```

### C. Dashboard as SPA (`ssr: false`): split chunks, keep data lazy

```ts
// nuxt.config.ts
routeRules: {
  '/dashboard/**': { ssr: false, appMiddleware: ['auth'] },
}
```

```vue
<!-- app/pages/dashboard/reports.vue -->
<script setup lang="ts">
const tab = ref<'summary' | 'charts' | 'export'>('summary')
const showEditor = ref(false)

// Non-blocking: navigation completes, skeleton shows while loading
const { data: summary, status } = useLazyFetch('/api/reports/summary')
</script>

<template>
  <section>
    <SummaryCards v-if="status === 'success'" :data="summary" />
    <SummarySkeleton v-else />

    <!-- Heavy chart library: only downloaded when the tab is opened -->
    <LazyReportsChart v-if="tab === 'charts'" />

    <!-- Rich text editor: only downloaded on demand -->
    <button @click="showEditor = true">Edit notes</button>
    <LazyNotesEditor v-if="showEditor" />
  </section>
</template>
```

Why: with `ssr: false` there is no server HTML to defer hydration for, so the savings come from not downloading heavy chunks (charts, editors, maps, export tools, dialogs) until the user asks for them.

### D. Dynamic SSR page: block on what SEO needs, defer the rest

```vue
<!-- app/pages/product/[id].vue (universal SSR, no route rule) -->
<script setup lang="ts">
const route = useRoute()

// Needed for SEO and first paint: fetched on the server, hydrated without refetching
const { data: product } = await useFetch(`/api/products/${route.params.id}`)

// Not SEO-critical: client only, does not block rendering
const { data: reviews, status } = useLazyFetch(
  `/api/products/${route.params.id}/reviews`,
  { server: false },
)
</script>

<template>
  <ProductHero :product="product" />
  <LazyProductGallery :images="product.images" hydrate-on-visible />
  <LazyReviewsList v-if="reviews" :items="reviews" hydrate-on-visible />
  <ReviewsSkeleton v-else-if="status === 'pending'" />
</template>
```

Decide per datum: if search engines should see it (reviews with rich results, for instance), fetch it on the server with `useFetch`; otherwise make it lazy and client-only. Note that awaiting a lazy call still blocks server rendering; on client-side navigation the await resolves immediately.

### E. Server components to keep heavy libraries off the client

```bash
components/
  HighlightedMarkdown.server.vue
```

```vue
<template>
  <!-- Parsing and highlighting libraries stay out of the client bundle -->
  <HighlightedMarkdown :markdown="post.body" />
</template>
```

Server components must have a single root element, and when their props change they trigger a network request to update the HTML. Read the server components guide for island context, slots, caching, and current limitations before using them on cached routes.

---

## 5. Rules, caveats, and anti-patterns

From the official docs:
- Lazy hydration works only in **single-file components** and requires props written **in the template** (not spread with `v-bind`). It does **not** work with direct imports from `#components`.
- **Any prop change** on a lazily hydrated component triggers hydration immediately (even with `hydrate-never`).
- Do not delay hydration of critical, above-the-fold content.
- If a lazy component is behind `v-if="false"`, you likely do not need delayed hydration; a plain lazy component is enough.
- Be careful with shared state (`v-model`) across components: updating the model in one can trigger hydration in all components bound to it.
- Pick each strategy for its intended use: `hydrate-when` for components that may not need hydration, `hydrate-after` for components that can wait a fixed time, `hydrate-on-idle` for components that can hydrate when the browser is idle.
- Avoid `hydrate-never` on anything interactive.
- `.client` components render only after mount; to access their template in `onMounted()`, `await nextTick()` first.
- `.server` components and islands need a single root element.

Practical anti-patterns:

| Anti-pattern | Why | Instead |
|---|---|---|
| `Lazy` prefix on every component | Many tiny chunks, extra requests, little gain | Lazy-load only heavy (charts, editors, maps) or conditional (modals, tabs) components |
| `hydrate-on-visible` on content already in the first viewport | It hydrates immediately anyway and complicates the code | Normal hydration for above-the-fold content |
| Per-user data inside an `isr`/`swr`/`prerender` page rendered on the server | Cached HTML is shared; data would leak or be stale | `useLazyFetch(..., { server: false })` or `<ClientOnly>` fed by a non-cached API |
| Lazy-hydrating components without reserved space | Layout shift when they appear | Fixed `min-height` or skeleton |
| `hydrate-*` props on pages with `ssr: false` | Nothing to hydrate; the props add no value | `Lazy` + `v-if` for code splitting |
| Blocking `await useFetch` for non-critical data | Delays first render for data nobody needs yet | `useLazyFetch` or `lazy: true`, with loading UI |
| Spreading props with `v-bind="props"` on a lazily hydrated component | Not supported by Nuxt's lazy hydration | Write each prop in the template |

---

## 6. How to verify

- **Network tab:** confirm that heavy chunks load only when the tab, modal, or scroll position that needs them is reached.
- **`@hydrated` event:** log it temporarily on lazily hydrated components to confirm when they hydrate.
- **View source / disable JavaScript:** on prerender, ISR, and SSR pages, the HTML of lazily hydrated components should still be present.
- **Anonymous vs. logged-in:** open a cached page in both states and confirm that user-specific parts only appear for the right user after the client fetch.
- **Lighthouse or Web Vitals:** compare JavaScript execution time and INP before and after adding lazy hydration.

---

## 7. Official documentation

- Components (Lazy prefix, delayed hydration, hydration strategies, client and server components): https://nuxt.com/docs/4.x/directory-structure/app/components
- Server components guide: https://nuxt.com/docs/4.x/guide/concepts/server-components
- `<ClientOnly>`: https://nuxt.com/docs/4.x/api/components/client-only
- `<NuxtIsland>`: https://nuxt.com/docs/4.x/api/components/nuxt-island
- Data fetching (`lazy`, `server: false`): https://nuxt.com/docs/4.x/getting-started/data-fetching
- `useFetch`: https://nuxt.com/docs/4.x/api/composables/use-fetch
- `useLazyFetch`: https://nuxt.com/docs/4.x/api/composables/use-lazy-fetch
- Rendering modes and route rules: https://nuxt.com/docs/4.x/guide/concepts/rendering
