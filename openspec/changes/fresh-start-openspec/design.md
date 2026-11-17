# Design

## Context

See `proposal.md` for the motivation. Current state, as verified in the working tree:

- `AGENTS.md` (374 lines) is loaded by `CLAUDE.md` (`@AGENTS.md`). Spec Kit dependencies in it: the *Governance* paragraph (L7-8), the *Active feature / Previous* block (L10-21), "Constitution II" (L39, L71), the `specs/` line of the layout (L68), a "constitution" mention in the testing rule (L122), the "Accepted LCP exception (plan.md, Complexity Tracking)" note (L339) and the *Workflow* section (L353-366: `/speckit-*`, `## Phase N`, `tasks.md`, `specs/003-…/tasks.md`).
- The principles I–VI, the "no destructive actions by agents" rule and the platform constraints already live in `AGENTS.md`; the constitution file added only the amendment history.
- Nothing in code, tests or build reads `specs/` or `.specify/` (checked: `architecture.spec.ts`, `vitest.config.ts`, `nuxt.config.ts`, `package.json`, `scripts/`).
- `openspec/` holds an empty `config.yaml` (template comments only), empty `specs/` and `changes/archive/`.
- The OpenSpec skills (`openspec-explore`, `-propose`, `-apply-change`, `-archive-change`, `-sync-specs`, `-update-change`) are installed at user level, not in this repo.
- Project rule: agents never run `rm -r`, `Remove-Item -Recurse`, `git clean`, or discard work; a hook enforces it.

## Goals / Non-Goals

**Goals:**
- After this change, no tracked file tells an agent or a contributor to use Spec Kit, the constitution, or a `specs/NNN` folder.
- `AGENTS.md` stays the single source of project rules, with its "Known gotchas" intact.
- `openspec/config.yaml` carries only what an agent cannot infer from the code.

**Non-Goals:**
- Reconstructing history inside OpenSpec (no baseline specs, no "archived" copies of features 001–008).
- Rewording rules, budgets or gotchas beyond removing dead pointers.
- Shipping repo-local OpenSpec skills or running `openspec init`.

## Decisions

**D1 — `AGENTS.md` is the only rulebook (chosen by the user, option 1).**
The "constitution is the source of truth and overrides this file" sentence is removed, and "Constitution II" becomes "principle II". Alternative considered: move the rules into `openspec/config.yaml` `rules`. Rejected: it would split one set of rules across two files and only applies when writing OpenSpec artifacts, not when coding or reviewing.

**D2 — Replace the *Active feature / Previous* block with a pointer-free product summary.**
A few lines naming the areas that exist today (drive, guest uploads and approval queue, YouTube, Canciones, Peticiones, users/roles) and stating that new work goes through changes in the repo's spec framework (named generically, see D4). No `specs/00X` paths and no mention of `spec.md`/`plan.md`/`research.md`/`data-model.md`/`contracts/`. Alternative: delete the block entirely. Rejected: a one-paragraph orientation is cheap and the stack table does not say what the product does.

**D3 — Keep "Known gotchas" verbatim; only cut dead pointers.**
It is the single durable record of how the product behaves. Edit only phrases that send the reader to deleted files ("see the amendment at the top of its `spec.md`", "plan.md, Complexity Tracking") and iteration labels that only identify a spec iteration: `feature NNN` (replaced by the area name, e.g. "Canciones", or dropped), `FR-NNN`, `PLAN-*.md`, "amendment" and amendment dates. Migration numbers (`0011`) are kept: they are database facts, not spec iterations. Done with a grep sweep for `[Ff]eature [0-9]{3}|FR-[0-9]+|PLAN-|amendment|spec.md|plan.md|tasks.md|research.md|data-model|contracts/|Complexity Tracking|specs/[0-9]` so nothing is missed.

**D4 — Workflow section: spec-framework-agnostic flow, same Definition of done.**
Replace the Spec Kit chain with explore → propose (proposal, design, tasks) → apply → archive, **without naming any framework, CLI, skill or slash command**: the repo's installed framework provides the exact commands, so `AGENTS.md` does not need editing if the framework changes. (First drafted as an OpenSpec-specific flow; changed at the user's request.) The same applies to the *Rules* paragraph, the layout line (`spec dir`) and the branch example. `skip_specs: true` becomes "a tooling or docs change states that it has no deltas". "Plans must pass the Constitution Check" becomes "proposals and designs must respect the principles in this file". The Definition of done keeps its three steps (typecheck + tests, browser verification last, report before ticking) but ticks tasks in the change's task list, and a "group" is a numbered section of it. "Justification in the feature plan's Complexity Tracking" becomes "justification in the change's design document". OpenSpec stays named only in `README.md` and `openspec/config.yaml`.

Alternative: keep naming OpenSpec in `AGENTS.md` (`openspec-*` skills, `openspec` CLI, `skip_specs`). Rejected by the user: it ties the rulebook to one tool.

**D5 — `openspec/config.yaml`: short `context`, three `rules`.**
Proposed content (to be written during apply):

```yaml
schema: spec-driven
context: |
  AGENTS.md is the source of project rules (performance budgets, mobile first, UX
  consistency, testing gates, security). Artifacts must respect it, not restate it.
  Artifacts are written in English; the product UI copy is Spanish.
  Agents never execute destructive actions (see "No destructive actions by agents" in
  AGENTS.md); any step that needs one is handed to a person as an exact command.
  Schema changes only through Drizzle migrations; there is one Neon branch and one env
  file per environment.
rules:
  proposal:
    - State what is out of scope.
    - Flag any new dependency or external service and justify it (AGENTS.md principle II).
  design:
    - Justify every new dependency or external service, with the alternative considered.
    - When a route changes, say how the 250 KB per-route JS budget is kept.
  tasks:
    - End each group with the verification AGENTS.md "Definition of done" requires.
    - UI tasks include browser checks at 360 px and 1280 px or wider, in both themes.
    - Mark migrations to dev/test/prod and any destructive step as "for a person".
```

Alternative: leave the file empty. Rejected: the destructive-action rule and the "dependencies need justification" rule are exactly the constraints OpenSpec artifacts would otherwise miss.

**D6 — Deleting the `speckit-*` skills is handed to a person.**
They are tracked, so the deletion is recoverable, but it is ten directory removals and the project rule bans agents from executing recursive deletes. Apply prepares the exact command (`git rm -r .claude/skills/speckit-analyze …`) and the person runs it. Everything else in this change is plain edits.

**D7 — Leave comments that are labels.**
`feature 005, research D12`-style comments are history labels, not paths, and rewriting them is churn. Only the two comments with a literal dead path (`server/db/schema.ts:1`, `shared/types/api.ts:1`) change; they lose the path and keep the description.

## Risks / Trade-offs

- [Removing iteration labels and dates from the gotchas loses "which iteration introduced this"] → That provenance stays in git history; each gotcha keeps its behavior and its area name.
- [Contributors lose the per-feature spec/plan documents] → They stay in git history and the old feature branches; "Known gotchas" keeps the behavior that matters. `openspec/specs/` will grow from real changes instead.
- [Rewriting `AGENTS.md` drops a rule by accident] → Edits are limited to the listed sections; the grep sweep above plus a diff review before finishing.
- [`config.yaml` rules drift from `AGENTS.md`] → Rules only point to `AGENTS.md` sections instead of copying numbers; the 250 KB budget is the one literal and is already stated there.
- [The `speckit-*` deletion is left undone] → It is a listed task; until then the skills are inert (no `.specify/` behind them) but still advertised to agents.
- [Setup instructions lived in `specs/001/quickstart.md`] → README already covers requirements, environment variables, deploy and commands, so nothing is lost.

## Migration Plan

1. Edit `AGENTS.md`, `README.md`, `openspec/config.yaml` and the two comments.
2. A person runs the `git rm -r` for the ten `speckit-*` skills.
3. Verify with a repo-wide grep that no tracked file still mentions Spec Kit, `.specify`, the constitution or `specs/NNN` paths (code labels excepted), then `bun run typecheck` for the two touched `.ts` files.
4. Committing the pending deletions together with these edits is a separate decision for the user.

Rollback: every touched file is tracked, so `git revert` of the commit restores the previous state; nothing runs at runtime.

## Open Questions

- Whether to add repo-local OpenSpec skills (via `openspec init`) so teammates without the user-level skills get the same workflow. It can be decided later without touching this change's tasks.
- Whether artifacts should stay in English or switch to Spanish. English is the working default (it matches `AGENTS.md`); changing it only affects future artifacts.
