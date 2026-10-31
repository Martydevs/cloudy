# Handoff: Part 2 of `plan-migracion-proveedor-forms.md` (Regle on the forms)

Context for a fresh session. Base commit: `3374edc`. Nothing is committed yet; all work is uncommitted in the
current tree (no worktree). Part 1 (OpenRouter) was already committed in `0f1d5d0`.

User's goals for this task: keep code quality and the Lighthouse score above 90, run Lighthouse and a browser
check, optimize the code, and enforce tests.

## Done

### Code (server behavior unchanged)
- `shared/validation/{core,auth,files,submissions}.ts`: messages and limits are now exported constants
  (`REQUIRED_MESSAGE`, `minMessage`/`maxMessage`, `EMAIL_MESSAGE`, `EMAIL_RE`, `EMAIL_MAX`,
  `PASSWORD_MISMATCH_MESSAGE`, `NAME_MAX`, `PASSWORD_MAX`, `NAME_PATTERN`, `FORBIDDEN_MESSAGE`,
  `FOLDER_NAME_MAX`, `FILE_NAME_MAX`, `SENDER_NAME_MAX`, `NOTE_MAX`). The server validators use the same
  constants. `check()` and `Infer` were removed because nothing used them anymore.
- `app/regle-config.ts` (new): Regle `setupFile` (`defineRegleNuxtPlugin` + `defineRegleConfig`).
  - Spanish messages for `required`, `minLength`, `maxLength` and `sameAs`.
  - Custom rules: `maxChars` (counts after trim), `safeName` and `validEmail` (same regex as the server).
  - `modifiers: { autoDirty: false }`: errors appear on blur (`$touch`) or on submit (`$validate`).
- `app/utils/form-rules.ts` (new):
  - One rule set per form, form state types, and `FormRules<S>`.
  - `NameRules`, `senderNameRules` and `noteRules`.
  - `externalErrorsFrom(error)`, which turns a 422 response into Regle `externalErrors`.
- Components migrated to `useRegle` (auto-imported):
  - `AuthForm` (generic; prop `validator` became `rules`; it emits data normalized like the server: trimmed,
    email lowercased, password untouched). Pages: `login`, `registro`, `recuperar`, `restablecer`, `perfil`.
  - `NameDialog` (prop `field` became `rules`) and `ItemDialogs`.
  - `CommentThread` and `CommentItem` (a 422 shows through `externalErrors`).
  - `GuestUploadForm` (`applyIf` makes the name required only when it isn't fixed).
  - `pages/upload.vue` and `ImageTextEditor`.
- `nuxt.config.ts`:
  - `regle: { setupFile: '~/regle-config.ts' }`.
  - An inline module that removes the generated `regle-plugin.ts` in **production builds only**. That plugin
    only installs devtools and the config for `useRegleSchema` (which the app doesn't use), but it pulled
    Regle into every route's first-load JS. With it removed, Regle loads only on pages with forms; its chunk
    went from 46 KB to 20.5 KB gzip. In dev the plugin is still active.

### Tests
- `test/nuxt/form-rules.spec.ts` (new):
  - Compares every form's Regle rules against the server validator on the same sample inputs, edge cases
    included. One known, intended difference: a password made only of spaces is rejected by the client.
  - Also tests the global config messages, `autoDirty: false` and `externalErrorsFrom`.
- `test/nuxt/auth-forms.spec.ts`: new `AuthForm` tests (no errors while typing, focus goes to the first
  invalid field, data normalization).
- `test/nuxt/dialogs.spec.ts` (updated to `rules`, plus a max-length test) and `test/nuxt/comments.spec.ts`
  (422 with and without field errors).
- `test/unit/architecture.spec.ts`: new rule that nothing under `app/` imports `useRegle`/`inferRules` from
  `@regle/core`. `test/unit/validation-core.spec.ts`: removed the `check` test.

### Results
| Check | Result |
|---|---|
| `bun run typecheck` | 0 errors |
| `test:unit` | 713/713 |
| `test:nuxt` | all pass (1111 total in the coverage run) |
| `test:e2e` | 101/101, run twice, the second time after the plugin-removal change |
| `test:coverage` | 98.22 % statements · 92.7 % branches (gate is 92 %) |
| `bun run build` | OK |
| Vue warnings in tests | 0 |

**Lighthouse 12.8.2** (local production build behind a gzip proxy, default mobile throttling,
`.env.development`), compared with HEAD built the same way:
| Route | Perf (new) | Perf (HEAD) | LCP | JS gzip new / HEAD |
|---|---|---|---|---|
| /login | 86–87 | 89–91 | ~3.0 s | 167 / 162 KB |
| /registro | 84–89 | 90–92 | ~3.0 s | 154 / 148 KB |
| /recuperar | 91–92 | 88–90 | ~2.5–3.0 s | 154 / 149 KB |
| /upload | 86–89 | 87–92 | ~3.0 s | 157 / 152 KB |

- Accessibility, Best Practices and SEO are **100** on all four routes. CLS is 0.
- Every route is under the 200 KB JS budget. LCP is driven by render delay (hydration of the shared entry chunk).
- Total blocking time is higher and varies between runs (100–300 ms vs 130–180 ms on HEAD).
- Without gzip (raw `node .output/server/index.mjs`), performance is 68–76 on both versions because of missing
  text compression. Vercel compresses responses, so that number doesn't apply to production.

## Left to do
1. **Browser check (task #6, step 2 of the AGENTS.md definition of done)**
   - A `bun run dev` may still be running (PID in `/tmp/dev.pid`); check `http://localhost:3000` or restart it.
   - Use the `agent-browser` skill at 360 px and ≥ 1280 px, in dark and light themes, on the forms above.
   - Check that errors appear only after blur or submit, that focus moves to the first invalid field, the
     comment 422 error, the folder and file name dialogs, the `/upload` request flow, keyboard focus and
     console errors (in dev the Regle plugin is active; confirm there are no Regle warnings).
   - Use `.env.development` data only.
2. **Performance decision**: accept the small TBT/JS cost, or optimize further (for example lazy-load Regle
   on the account pages). Performance over 90 is consistent only on `/recuperar`; HEAD wasn't consistently
   over 90 either.
3. **Cleanup the user must run** (project rule: agents don't delete):
   - `C:\Users\andre.perez\AppData\Local\Temp\cloudy-baseline` is the HEAD build copy, and its `node_modules`
     is a **junction to the real project `node_modules`**. Remove the junction first with
     `rmdir C:\Users\andre.perez\AppData\Local\Temp\cloudy-baseline\node_modules` (no `/s`), then delete the
     folder. Deleting the folder recursively first could wipe the project's packages.
   - Lighthouse reports and helper scripts: `%LOCALAPPDATA%\Temp\lh` and `%LOCALAPPDATA%\Temp\lh-scripts`.
4. **Pending user decisions**:
   - Whether to commit. Commit format: `pi-agent: <mensaje en español>`, one logical change per commit.
   - What to do with `plan-migracion-proveedor-forms.md` (it had local edits before this work), the untracked
     `.pi/tasks/*.json`, and this handoff file.
