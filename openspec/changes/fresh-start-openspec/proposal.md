# Proposal

## Why

The repo is half-migrated from Spec Kit to OpenSpec. `specs/001…007`, `.specify/` (including the constitution), `.pi/prompts`, the `PLAN-*`/`HANDOFF-*` files are deleted from the working tree but still referenced: `AGENTS.md` names a constitution and a `specs/008-…` folder that no longer exist, `README.md` links to deleted files, ten `speckit-*` skills still ship in `.claude/skills/`, and two source files carry comments pointing at dead paths. `openspec/` exists but is empty. Agents and contributors get contradictory instructions, so the migration has to be closed now, before any new feature is specified.

## What Changes

This is a **fresh start**: the historical Spec Kit docs (specs 001–008, plans, research, tasks, handoffs, the constitution file) are **not** migrated into OpenSpec. They remain recoverable from git history and from the old feature branches.

- **Remove** the ten tracked `.claude/skills/speckit-*` skills (analyze, checklist, clarify, constitution, converge, implement, plan, specify, tasks, taskstoissues).
- **Rewrite `AGENTS.md`** so it stops depending on Spec Kit:
  - Drop the *Governance* paragraph that makes `.specify/memory/constitution.md` the source of truth; `AGENTS.md` becomes the single source of project rules (the principles I–VI and the "no destructive actions" rule already live in it).
  - Replace the *Active feature / Previous* block with a short description of the current product, and no pointers to `specs/00X` folders or their `spec.md`/`plan.md`/`research.md`/`data-model.md`/`contracts/`.
  - Rename "Constitution II/…" references to plain principle references, and replace "Complexity Tracking in the feature plan" with "the change's design document".
  - Replace the Spec Kit workflow (`/speckit-*`) with a **spec-framework-agnostic** flow (explore → propose → apply → archive) that names no framework, command or skill, and adapt the *Definition of done* to the change's task list instead of `## Phase N` sections. `AGENTS.md` must not hard-code any spec framework; `README.md` and `openspec/config.yaml` are where OpenSpec is named.
  - Remove every spec-iteration label from the file (`feature 003/005/006/007`, `FR-NNN`, `PLAN-*.md`, "amendment" and amendment dates), keeping only the behavior they described.
  - Keep the "Known gotchas" content: it is the only durable record of how the product behaves today.
- **Update `README.md`**: remove the links to the deleted constitution and `specs/001…`, point to `AGENTS.md` and `openspec/`, and change the `specs/` line of the folder tree.
- **Fix dead-path comments** in `server/db/schema.ts:1` and `shared/types/api.ts:1`.
- **Fill `openspec/config.yaml`** with a short `context` (what an agent cannot infer from the code) and a few per-artifact `rules`; no stack description, no copy of `AGENTS.md`.

Out of scope: migrating any historical spec into `openspec/specs/` (it will start empty and grow with real changes), committing the already-deleted files, `.mcp.json` (the removed `apify-webcrawler` entry), and the "feature NNN / research DNN" comments in source code, which are labels rather than paths.

## Capabilities

### New Capabilities
<!-- None: tooling and documentation only. -->

### Modified Capabilities
<!-- None: no product behavior changes. The change sets `skip_specs: true` in `.openspec.yaml`. -->

## Impact

- **Files**: `AGENTS.md`, `README.md`, `openspec/config.yaml`, `server/db/schema.ts` and `shared/types/api.ts` (one comment line each), and the deletion of `.claude/skills/speckit-*`.
- **No** runtime, API, database, dependency or test behavior changes. `test/unit/architecture.spec.ts` does not read `specs/` or `.specify/`.
- **Risk**: low. The old docs stay in git history; the only loss is discoverability, mitigated by keeping "Known gotchas" intact.
- **Follow-up for a person**: committing the pending deletions and this change is a separate step.
