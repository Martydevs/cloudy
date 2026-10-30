# Plan: OpenRouter as the only AI provider + Regle for form validation

## Summary
1. **AI**: remove the OpenAI and Gemini adapters, the provider candidates and the fallback loop. Image-text extraction makes **one call to OpenRouter**, using the preset `@preset/image-content-extraction`. The per-run breaker stays, so the guest pool stops calling OpenRouter during an outage or when credits run out. The e2e suite gets a local stub that speaks OpenRouter's chat-completions format, wired through a new `NUXT_OPENROUTER_BASE_URL`.
2. **Regle**: the hand-written form state in the UI (touched flags, computed errors, `check()`) is replaced by `useRegle` with `@regle/rules`. The Spanish messages come from one global Regle config. **Server validation does not change**: `shared/validation/*` with `readValid`/`queryValid` keeps returning 422 `{ errors }`. Rule limits and message texts move to shared constants so each number and each string exists once, and a parity test checks that the client and server rules agree. All Regle code is written following the Regle skills already installed in the project (see "Installed skills" in Part 2).

Work happens in the current tree, because the uncommitted OpenRouter changes there are the starting point.

---

## Part 1: OpenRouter only

### Config and dependencies
- Run `bun remove @ai-sdk/openai @ai-sdk/google`. `@openrouter/ai-sdk-provider` and `ai` stay.
- `nuxt.config.ts` `runtimeConfig`: keep `openrouterApikey` and add `openrouterBaseUrl: ''`.
- `.env.example`: add `NUXT_OPENROUTER_BASE_URL=""`, with a comment that empty means the real OpenRouter and only e2e sets it.
- Manual step for the user (secret files are not touched): remove `NUXT_OPENAI_*` and `NUXT_GOOGLE_APIKEY` from `.env.development`, `.env.test`, `.env` and Vercel, and make sure `NUXT_OPENROUTER_APIKEY` is set in every environment.

### `server/ai/` changes
- **Delete** `providers/openai.ts`, `providers/google.ts` and `providers/candidates.ts`.
- **`providers/openrouter.ts`**:
  - Use `import type { RuntimeConfig }`.
  - Remove the commented example.
  - Export `OPENROUTER_DEFAULT_MODEL` (unchanged).
  - Export `openrouterClient(config)`, which calls `createOpenRouter({ apiKey: config.openrouterApikey, baseURL: config.openrouterBaseUrl || undefined })`.
  - Export `resolveImageTextModel(config): LanguageModel | null`. It returns `null` when the key is blank, so no call is made.
- **`breaker.ts`**: a single-provider breaker with `isOpen()`, `recordFailure(persistent): boolean` (true when this failure just opened it) and `recordSuccess()`. The threshold stays at 3. `exhausted(candidates)` and the per-provider maps are removed.
- **`errors.ts`**:
  - `ClassifiedError` becomes `{ code, persistent }`; the `fallback` field is dropped.
  - Remove the OpenAI and Gemini markers (`insufficient_quota`, `billing_hard_limit_reached`, `FAILED_PRECONDITION`, `API_KEY_INVALID`, `PERMISSION_DENIED`).
  - Mapping:

    | Error | Code | Persistent |
    |---|---|---|
    | 402 (OpenRouter out of credits) | `quota_exceeded` | yes |
    | 401 / 403 / 404 | `provider` | yes |
    | 429 | `rate_limited` | no |
    | Timeout | `timeout` | no |
    | Other 4xx/5xx, network | `provider` | no |
    | `NoObjectGenerated` / `NoOutputGenerated` | `invalid_output` | no |
    | `LoadAPIKeyError` | `provider` | yes |

  - `RetryError` is still unwrapped to its last error.
- **`image-text/extract.ts`**:
  - Options become `{ image, model?, breaker?, abortSignal?, maxRetries? }`. `model` defaults to `resolveImageTextModel(useRuntimeConfig())`.
  - Flow: invalid image → `invalid_input`. No model, or `breaker.isOpen()` → `failed/provider` without calling.
  - One `generateText` call with timeout 30 s, `maxRetries ?? 1`, the overall 45 s cap combined with the caller's signal, the same instruction, prompt and `Output.object` schema, and the image as a `file` part. The `openai.imageDetail` provider option is removed.
  - `content-filter` → `failed/provider`, recorded as a transient breaker failure.
  - On success: `breaker.recordSuccess()`, the output goes through the second Zod pass, and the result is `ready` or `empty`.
  - On a caught error: an aborted signal → `timeout`. Otherwise the error is classified; every code except `invalid_output` counts as a breaker failure. Log `[image-text] openrouter failed (<code>)`, using `console.error` when persistent and `console.warn` otherwise, plus `[image-text] breaker open (<code>)` when the breaker opens.
  - Remove `PRIMARY_TIMEOUT_MS`, the candidate loop, the fallback logs, `ImageTextProvider` and the `usedProvider` field from `ImageTextResult`.
- **`index.ts`**: stop exporting `resolveImageTextCandidates` and `ImageTextCandidate`; export `resolveImageTextModel`. The rest is unchanged.
- **`server/utils/image-text.ts`**: the pool resolves the model once and stops when `breaker.isOpen()` is true (it no longer calls `exhausted(candidates)`). It passes `{ model, breaker, abortSignal }` to the reads. A run that never starts (no key) leaves the images pending, as today. The `server/ai` boundary and `test/unit/architecture.spec.ts` rules don't change.

### E2E stub
- Rename `test/e2e/setup/openai-stub.ts` to `openrouter-stub.ts` and `startOpenAIStub` to `startAiStub`.
- It serves `POST /chat/completions` and returns a chat completion: `{ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }], usage }`.
- It keeps the hash-based fixture matching on the first `data:image/...;base64` in the body, plus `/__stub/mode|reset|calls`, `fail` (500 with an OpenRouter-style `{ error: { code, message } }`), `delayMs` and `NOTE_TEXT`.
- `global-setup.ts`:
  - Set `NUXT_OPENROUTER_BASE_URL` to the stub URL.
  - Set `NUXT_OPENROUTER_APIKEY` to `'sk-or-e2e-stub'`.
  - Remove the `NUXT_OPENAI_*` variables.
  - Rename the provided key to `aiStubUrl`. Update `fixtures.ts` and the imports in `image-text.spec.ts` and `guest-queue.spec.ts`.

### Docs
- `AGENTS.md`: update the AI stack row (OpenRouter preset through `@openrouter/ai-sdk-provider`, single provider), the env list (replace the OpenAI/Google variables with `NUXT_OPENROUTER_APIKEY` and `NUXT_OPENROUTER_BASE_URL`), the AI gotcha (no fallback; the breaker stops the guest pool after 402/401/403/404 or 3 transient failures) and the e2e stub note.
- `specs/` is left unchanged as history.

---

## Part 2: Regle on the forms (server untouched)

### Installed skills (already in the repo, no install needed)
The project already has five Regle skills, in `.agents/skills/` and `.claude/skills/` (registered in `skills-lock.json`, source `victorgarciaesgi/regle`, skill version 1.27.0). The installed packages are `@regle/core|rules|nuxt|schemas ^1.29.5`, so a skill describes the pattern and the installed `.d.ts` files (or the Regle MCP, see below) have the final word on exact signatures.

| Skill | Used for | Where in this plan |
|---|---|---|
| `regle` | `useRegle`, the `r$` object, `$errors`/`$error`/`$invalid`/`$touch`/`$validate`/`$reset`, modifiers (`autoDirty`, `silent`, `$debounce`) | Every component below, the dirty/touched strategy |
| `regle-rules` | Built-in rules, `createRule` (custom rules, reactive params), wrappers (`withMessage`), operators (`applyIf`, `assignIf`, `pipe`, `not`) | `regle-config.ts`, `form-rules.ts`, `GuestUploadForm` (`applyIf`), password rules |
| `regle-advanced` | `defineRegleConfig` (global messages, global modifiers), `externalErrors` (server 422), `$reset` options | `regle-config.ts`, `CommentThread`/`CommentItem`, `NameDialog` |
| `regle-typescript` | `inferRules`, `RegleComputedRules`, `InferSafeOutput`, typed `$validate()` result, `RegleFieldStatus` | Typing of the rule factories, `AuthForm` generics and emitted data |
| `regle-schemas` | Zod/Valibot/ArkType via `useRegleSchema` | **Not used.** The project has no schema library and the server validators stay as they are (native rules chosen, see Assumptions) |

Supporting skills that apply to the Regle work: `vue-best-practices` / `vue` (`<script setup lang="ts">`, `defineModel`, watchers), `nuxt` (auto-imports, module config), `typescript-advanced-types` (generic `AuthForm<T>`), `accessibility` and `daisyui` (error markup, `aria-invalid`, `aria-describedby`, focus on the first invalid field), and `vitest` (component and parity tests).

**Regle MCP**: `.mcp.json` now declares `regle` (`npx -y @regle/mcp-server`). When a session has it loaded, use it first to confirm APIs against the installed version. If it isn't loaded, read the types in `node_modules/@regle/core/dist/*.d.ts` and `@regle/rules`. Don't guess signatures.

**Working rule**: before writing or changing any Regle code, load `regle`, `regle-rules`, `regle-advanced` and `regle-typescript`, and follow the requirements below. These are the checks for the code generated in this app:

1. **Use the config-aware composables.** With `setupFile`, the module auto-imports `useRegle`, `inferRules`, `useScopedRegle`, `useCollectScope` and the `RegleFieldStatus` type from the setup file's `defineRegleConfig` result. Components call the auto-imported `useRegle`; they never `import { useRegle } from '@regle/core'`, because that bypasses the Spanish messages and global modifiers.
2. **Import rules explicitly.** Only `withMessage`, `withParams`, `withAsync`, `withTooltip` (from `@regle/rules`) and `createRule`, `defineRegleConfig`, `extendRegleConfig`, `createVariant`, `narrowVariant` (from `@regle/core`) are auto-imported. `required`, `minLength`, `maxLength`, `sameAs`, `applyIf`, `pipe`, `isFilled` come from `@regle/rules` with an explicit `import` (in `form-rules.ts` and `regle-config.ts`).
3. **Messages live in one place.** No `withMessage` on a field for a message the global config already defines. Per-field `withMessage` only for a message that is specific to one field.
4. **Rules are optional by default.** A rule only runs when the value is filled, so required-ness is always an explicit `required`. Custom rules (`createRule`) start with `if (!isFilled(value)) return true`, use `Maybe<string>` for the value type and never `any`.
5. **Match the server's trimming.** Regle's `required` already trims whitespace, like the server's `str()`. `minLength`/`maxLength` do not trim, so trimmed fields (names, comments, notes, image text) use the custom `maxChars`, and non-trimmed fields (passwords) use the built-in `minLength`/`maxLength`.
6. **State is the single source.** Bind `v-model="r$.$value.field"`; don't keep a parallel `ref` for the same field. Read errors with `r$.$errors.field[0]` (first message only) and the state with `r$.field.$error`.
7. **Dirty strategy is global.** `modifiers: { autoDirty: false }` is set once in `defineRegleConfig`, so a field is marked dirty by `r$.field.$touch()` on blur and by `r$.$validate()` on submit, never while typing. Per-form overrides are the exception and need a reason in a comment.
8. **Dynamic rules** use a getter (`() => ({ ... })`) or `computed` with `inferRules`, never a plain object that captures a stale value.
9. **Typed end to end.** Rule factories are typed with `RegleComputedRules<typeof state>` (or the scoped `inferRules`). Submit handlers use the typed result of `$validate()` (`{ valid, data }`, `InferSafeOutput<typeof r$>` when a type is needed), not casts.
10. **Server errors go through `externalErrors`**, typed as `RegleExternalErrorTree<typeof state>`, with `clearExternalErrorsOnChange` left at its default (`true`). The mapping from the API's 422 `{ errors }` to that tree lives in one helper.
11. **Reset on reopen.** A dialog form calls `r$.$reset({ toState: ... })` when it opens, so old errors and values never leak between uses.
12. **Out of scope on purpose**: `useRegleSchema`/Zod, `$each` collections, variants, `useScopedRegle`, `mergeRegles` (no form in the app needs them). Don't add them.
13. **Accessibility and UI rules still apply** (Constitution VI): daisyUI semantic classes for the error state, `aria-invalid` bound to `r$.field.$error`, `aria-describedby` pointing at the message, labeled controls, visible focus.

### Setup
- `nuxt.config.ts`: add `regle: { setupFile: '~/regle-config.ts' }`.
- New `app/regle-config.ts`, placed outside `utils/` to avoid auto-import clashes. The module requires the file to **default-export the object returned by `defineRegleConfig`** (it reads `useRegle`, `inferRules`, `useCollectScope`, `useScopedRegle` and `__config` from it). The config has:
  - `rules: () => ({ ... })` with `withMessage(required, ...)` etc. The texts are not typed here: they are imported from `shared/validation/core.ts` (see Shared constants), so the client and the server use the same strings:

    | Rule | Message |
    |---|---|
    | `required` | `Este campo es obligatorio` |
    | `minLength` | `Debe tener al menos ${n} caracteres` |
    | `maxLength` | `Debe tener como máximo ${n} caracteres` |
    | `sameAs` | `Las contraseñas no coinciden` |

  - Custom `createRule` rules registered in the same `rules` so they autocomplete in the scoped `inferRules`:
    - `maxChars(n)`: measures `value.trim().length`, same message as `maxLength`.
    - `safeName`: uses the server's `NAME_PATTERN` and `FORBIDDEN_MESSAGE`.
    - `validEmail`: uses the server's `EMAIL_RE` and `EMAIL_MAX` (trim + 254 characters) and the message `Escribe un correo electrónico válido`. It replaces the built-in `email` rule, whose regex is not the server's, so the client never accepts or rejects an address the server judges differently.
  - `modifiers: { autoDirty: false }` (rule 7 above).
- `@regle/schemas` is in `package.json` but nothing uses it (the module only auto-imports it when present). See the open question in Assumptions.

### Shared constants (numbers and texts live once, used by the server validators and the Regle rules)
- `shared/validation/core.ts`: export the message texts the server already uses (`REQUIRED_MESSAGE`, `minMessage(n)`, `maxMessage(n)`, `EMAIL_MESSAGE`, `PASSWORD_MISMATCH_MESSAGE`), plus `EMAIL_RE` and `EMAIL_MAX = 254`. `str()`, `email()` and `sameAs()` use them, so no string is written twice.
- `shared/validation/auth.ts`: export `NAME_MAX = 80` and `PASSWORD_MAX = 128` next to `PASSWORD_MIN`.
- `shared/validation/files.ts`: export `FOLDER_NAME_MAX = 120`, `FILE_NAME_MAX = 200`, `NAME_PATTERN` and `FORBIDDEN_MESSAGE`.
- `shared/validation/submissions.ts`: export `SENDER_NAME_MAX = 80` and `NOTE_MAX = 500`.
- `COMMENT_MAX_LENGTH` and `MAX_IMAGE_TEXT_LENGTH` already exist.
- The server validators switch to these constants. Their behavior doesn't change.

### Rule sets: `app/utils/form-rules.ts` (auto-imported)
- Typed form state types plus rule factories. Each factory returns `RegleComputedRules<State>` (rule 9), imports its rules explicitly from `@regle/rules` (rule 2) and is used as a getter so it stays reactive (rule 8):
  - Account forms: `registerRules(state)` (uses `sameAs(() => state.password)`), `loginRules`, `forgotRules`, `resetRules(state)`, `changePasswordRules(state)`, `profileNameRules`.
  - Files: `folderNameRules`, `fileNameRules`.
  - Comments and image text: `commentRules`, `imageTextRules`.
  - Guests: `senderNameRules`, `noteRules` (optional field: `maxChars` only, no `required`).
- Each one mirrors its server validator: required, min/max length (`maxChars` for trimmed fields, built-in `minLength`/`maxLength` for passwords), `validEmail`, forbidden characters, matching passwords.
- One helper here maps the API's 422 `{ errors: Record<string, string> }` to `RegleExternalErrorTree` (`{ field: [message] }`), used wherever a server error must show on a field.

### Components
- **`AuthForm.vue`**:
  - The `validator` prop becomes `rules: (state) => RegleRules`. Generic: `T extends Record<string, string>`.
  - Uses `useRegle(values, () => props.rules(values))` (`autoDirty: false` comes from the global config). A field is touched on blur with `r$.field.$touch()` and its first error is shown. Submit runs `$validate()` and focuses the first invalid field.
  - The `rules` prop type is `(state: T) => RegleComputedRules<T>`, not a loose `RegleRules`.
  - It emits normalized data from the typed `$validate()` result (`{ valid, data }`): fields that aren't passwords are trimmed, and `email` fields are also lowercased, matching what `email()` produced before.
  - No new field component is extracted (YAGNI). If one is ever needed, its prop is `RegleFieldStatus` (auto-imported, config-aware).
  - Markup, ARIA and the disabled logic stay the same.
- **Pages** `login`, `registro`, `recuperar`, `restablecer`, `perfil`: pass the matching rules and type `onSubmit` with the form types from `form-rules.ts` (`Infer` is no longer used).
- **`NameDialog.vue`**: the `field: Field<string>` prop becomes `rules`. Same touched/blur behavior. Emits the trimmed value. `ItemDialogs.vue` passes `folderNameRules` or `fileNameRules`. It calls `r$.$reset({ toState: { name: initialName } })` every time the dialog opens (rule 11).
- **`CommentThread.vue` / `CommentItem.vue`**:
  - Use `useRegle({ body }, commentRules, { externalErrors })`.
  - A 422 from the server goes into `externalErrors` for `body` through the shared helper. It clears when the text changes (`clearExternalErrorsOnChange`, default `true`), replacing the `fieldError` ref.
  - CommentThread keeps the "touch on blur only if not empty" behavior. The counters stay as they are.
- **`GuestUploadForm.vue`**: the name uses `applyIf(() => !fixedName, ...)` so it isn't validated when it's fixed. The note uses `noteRules`, and a note error still appears in the existing banner. The inline name error and its clear-on-edit behavior stay.
- **`pages/upload.vue`**: the access-request name uses `senderNameRules`.
- **`ImageTextEditor.vue`**: `canSave` becomes `!r$.$invalid && !saving` with `imageTextRules`. The counter is unchanged.
- Out of scope (unchanged): the reject reason textarea in `SubmissionCard.vue` (no rules today, only `maxlength`), the topbar search, and `checkUploadFile` in the uploaders (file checks, not form fields).

### Cleanup
- Remove `check()` and the `Infer` type from `shared/validation/core.ts` (they become unused), and remove their unit tests. The `Field`/`Validator` types stay for the server.

---

## Tests and verification
**Unit**
- `ai-breaker`: single-provider open, reset and threshold.
- `ai-errors`: drop the OpenAI and Gemini marker cases; add OpenRouter 402 → `quota_exceeded`, persistent.
- `ai-extract`:
  - Dropped: the fallback cases.
  - Kept: ready/empty/invalid output, invalid input, timeout and abort, content-filter.
  - Added: the image is sent as a file part without OpenAI options; no key → `provider` with no call; open breaker → no call; `invalid_output` doesn't count as a breaker failure.
- New `ai-openrouter-client.spec.ts`: the base URL is respected, empty → `undefined`, the key is passed through, and the model resolves to `null` without a key.
- Delete `ai-openai-client.spec.ts` and `ai-provider.spec.ts`.
- `image-text-pool`: a 402 on the first image means OpenRouter is called once and the rest stay pending; 3 timeouts in a row open the breaker and a success in between resets the count; two runs don't share state.
- `image-text.spec`: remove `usedProvider`.
- `validation-*`: the constants refactor must not change any result.

**Nuxt (component)**
- Async flows: after `await r$.$validate()` the tests also `await nextTick()` and `await flushPromises()` before asserting (as the `regle-advanced` skill recommends for server-error flows).
- `AuthForm`: errors after blur, not while typing; on submit the first invalid field gets focus; password mismatch; emitted email trimmed and lowercased.
- `NameDialog` / dialogs: forbidden characters and max length.
- `CommentThread`: a server 422 shows inline and clears on edit.
- `GuestUploadForm` (fixed name vs free name) and `ImageTextEditor` (empty/too long disables Save).
- New `form-rules.spec.ts` **parity test**: run each Regle rule set and its matching shared validator on the same samples (empty, spaces only, exactly the limit, limit + 1, bad email, email with 255 characters, forbidden characters, mismatched passwords) and check they agree on valid/invalid and on the Spanish message. The "exactly the limit" sample also confirms that the built-in `maxLength` is inclusive in the installed version, so the password limits match the server.
- Config test: the auto-imported `useRegle` returns the Spanish messages (proves the `setupFile` is wired and no component bypasses it). An architecture-style check in `test/unit/architecture.spec.ts` fails if any file under `app/` imports `useRegle` or `inferRules` from `@regle/core` (rule 1).

**E2E**: `image-text.spec.ts` and `guest-queue.spec.ts` run against the new stub (call counts, fail and delay modes unchanged). The auth, comments, folders and upload specs must pass without changes.

**Gates** (AGENTS.md definition of done):
1. `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e`, then `test:coverage` (92 % gate).
2. `bun run build`, plus `bun run analyze` to confirm the routes with forms stay ≤ 200 KB gzip.
3. Browser check with agent-browser on the dev server: login, registro, perfil, rename/new folder, comments, `/upload` and the image-text editor, at 360 px and ≥ 1280 px, in dark and light themes. Check error display, focus and the console. Make one real image-text read against OpenRouter in development.

## Assumptions and defaults
- The OpenRouter preset decides the model and routing. The extraction instruction, prompt and JSON output schema still travel in the request from code.
- No key means no call: reads fail with `provider` and guest images stay pending, as before.
- Server validators, the 422 shape and the API contracts don't change. The duplicated form rules are accepted per your choice and kept in sync by the parity test.
- Error timing in forms stays the same (on blur and on submit, not while typing).
- No commits until you ask. The old env variables are removed by you, not by the agent.
- Native `@regle/rules` is used instead of schemas. Open question: `@regle/schemas` is declared in `package.json` but unused. Constitution II (no dependencies without a justification) suggests `bun remove @regle/schemas`; the default in this plan is to leave it until you decide.
- The Regle skills are version 1.27.0 and the packages are ^1.29.5. Where they could differ (for example the `maxLength` boundary, replacing the built-in `email`), the type definitions or the Regle MCP decide, and the parity test confirms the behavior.
