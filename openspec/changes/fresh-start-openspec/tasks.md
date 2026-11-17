# Tasks

## 1. OpenSpec configuration

- [x] 1.1 Replace `openspec/config.yaml` with the `context` and `rules` drafted in design.md D5; verify with `openspec status --change "fresh-start-openspec" --json` (the config loads, no YAML error) and that the file has no leftover template comments.

## 2. AGENTS.md

- [x] 2.1 Remove the *Governance* paragraph (L7-8) and replace the *Active feature / Previous* block (L10-21) with the pointer-free product summary from design.md D2; verify with `grep -nE "specs/[0-9]{3}|\.specify|constitution" AGENTS.md` showing nothing in those lines.
- [x] 2.2 Rename "Constitution II" (L39, L71) to "principle II", drop "constitution" from the testing rule (L122), fix the layout line `specs/ Spec Kit feature docs` (L68) to a framework-neutral `spec dir` line, and change "Complexity Tracking" references (L39, L339) to the change's design document (or drop them); verify with `grep -nE "Constitution|Complexity Tracking|Spec Kit" AGENTS.md` returning nothing.
- [x] 2.3 Rewrite the *Workflow* section (L353-366) per design.md D4: a framework-agnostic flow (explore → propose → apply → archive) in place of `/speckit-*`, naming no framework, CLI or skill; "phase" = numbered group of the change's task list, Definition of done steps kept as they are; verify by reading the section end to end and with `grep -niE "speckit|openspec|skip_specs|## Phase N|specs/00" AGENTS.md` returning nothing.
- [x] 2.4 Sweep "Known gotchas" for pointers to deleted docs (`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model`, `contracts/`, "amendment at the top of") and the iteration labels (`feature NNN`, `FR-NNN`, `PLAN-*.md`, "amendment" and amendment dates), keeping the behavior text and migration numbers (design.md D3); verify with `grep -nE "[Ff]eature [0-9]{3}|FR-[0-9]+|PLAN-|amendment|spec\.md|plan\.md|research\.md|data-model|contracts/|top of its" AGENTS.md` returning nothing and with a diff review showing no rule or gotcha behavior removed.

## 3. README and code comments

- [x] 3.1 In `README.md`, replace the *Documentación* links (L16-18) with links to `AGENTS.md` and `openspec/`, and change the `specs/` tree line (L95) to `openspec/`; verify that every relative link in the file resolves to an existing path.
- [x] 3.2 Drop the dead path from the first-line comments of `server/db/schema.ts` and `shared/types/api.ts`, keeping their descriptions; verify with `bun run typecheck` passing.

## 4. Spec Kit skills (for a person)

- [x] 4.1 Hand the person the exact command to delete the ten tracked skills, `git rm -r .claude/skills/speckit-analyze .claude/skills/speckit-checklist .claude/skills/speckit-clarify .claude/skills/speckit-constitution .claude/skills/speckit-converge .claude/skills/speckit-implement .claude/skills/speckit-plan .claude/skills/speckit-specify .claude/skills/speckit-tasks .claude/skills/speckit-taskstoissues`, and have them run it (agents do not execute recursive deletes in this project); verify with `git ls-files .claude | grep -c speckit` printing `0`.

## 5. Final check

- [x] 5.1 Run `grep -rIlniE "speckit|\.specify|constitution|specs/[0-9]{3}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.nuxt --exclude-dir=.output --exclude-dir=.data --exclude-dir=openspec .` and verify nothing remains (the change's own artifacts under `openspec/` are excluded because they name the old paths on purpose).
- [x] 5.2 Run `openspec validate fresh-start-openspec` and `bun run typecheck`; verify both pass. UI and browser checks do not apply: no UI or behavior changes.

## Workflow follow-up

- Review the `git diff` of `AGENTS.md` before committing.
- Committing the pending deletions together with these edits is the user's decision.
- Archive the change after the edits are committed.
