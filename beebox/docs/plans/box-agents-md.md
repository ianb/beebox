---
title: "Boxes author AGENTS.md instead of CLAUDE.md"
status: draft
workstream: agents-md
issues:
  - ../../../issues/docs-and-chores/2026-09-18-move-to-agents-md-only.md
---
# Boxes author AGENTS.md instead of CLAUDE.md

Box agent instructions move from `CLAUDE.md` files (with `AGENTS.md` symlinks
for Codex) to authored `AGENTS.md` files. Claude Code and Codex both read
`AGENTS.md`, so one file serves both and the symlink mirror goes away. The dev
repo made the same move on 2026-10-09 (merge `bee88d5d6`).

**Issues addressed:** `issues/docs-and-chores/2026-09-18-move-to-agents-md-only.md`
(the box half; the repo half is done). Related, not resolved here:
`issues/bugs/2026-10-09-landmark-chats-exclude-box-root-instructions.md`
(filed while planning; see NOT in scope). Searched the queue for "landmark …
CLAUDE.md", "claudeMdExcludes", and "agent creates CLAUDE.md"; the closed
`2026-08-22-agents-md-missing-from-claude-md-special-cases` and
`2026-09-26-generated-guidance-families-without-pruning` are the history of the
mirror this plan removes.

## Design

No design section: the boxholder sees no new surface. Instruction files keep
their place and content; only the filename changes. Two boxholder-facing docs
(`site/docs/13-making-it-yours.md`, `site/docs/uses/teaching-it-your-preferences.md`)
change the name they tell people to use.

## Smallest fix and budget

**Smallest fix:** rename every box `CLAUDE.md` to `AGENTS.md` once, and change
the engine's writers to write `AGENTS.md`. That fails on two cases: a
`CLAUDE.md` an agent or boxholder makes later (models write `CLAUDE.md` by
habit, and one at or above a session's `cwd` turns off every `AGENTS.md`), and
boxes whose data lags the engine. So the rename runs as a repeating
normalization pass, replacing the mirror pass that already runs on every
`generateDocs`.

Tracks (below): A engine writers and recognizers; B the normalization pass;
C session settings; D guidance text, docs, and audits.

Estimate (additions plus deletions): source about 500 lines, tests about 600
(roughly 25 doctests rename fixtures, one new normalizer doctest), knowledge
audits about 80, authored docs about 250. Total about 1,400. Not a BIG CHANGE.
Generated output (`agent-guide/guide.md` regeneration, `doc-graph`) is
separate.

## Stated preferences this plan trades against

- **Human decision (2026-10-09):** *"Seperately we should do the same thing to
  boxes"*, after the repo moved to AGENTS.md only, with *"remove the Codex
  workaround"*. So no `CLAUDE.md` stays in a box, not even as a stub.
- **The originating issue's lean** (`2026-09-18-move-to-agents-md-only.md`):
  *"A migration changes files inside every box, so it is a registered
  migration, not an edit."* This plan does not use a registered migration;
  see Track B and *Could this be simpler?* for why. The precedent it follows
  instead is the mirror itself: `agent-context-mirrors.ts:15` replaced legacy
  generated `AGENTS.md` files inside the repeating pass
  (*"GENERATED_AGENTS_MARKER … Kept only to recognize and replace those
  files"*), with no migration.
- **"Arrange context, don't automate judgment"** (boxholder memory): when a
  directory holds both a real `CLAUDE.md` and a real `AGENTS.md`, the engine
  does not merge them. It reports the conflict and leaves it.
- **Minimal concepts:** the pass reuses the existing walk, skip list, and
  commit; no new registry or tier.

## What already exists

- **Mirror pass** — `beebox/src/core/agent-context-mirrors.ts:100`
  `mirrorClaudeDocs` walks the box (skips at :61: *".git" … "node_modules" …
  ".agents"*, and `_template-updates` at :44) and plants
  `AGENTS.md → CLAUDE.md` symlinks; `ensureAgentsMirror` (:91) is called by
  maps finalize. **Rebuild** in place as the normalization pass (same walk).
  The `.agents/skills`, rule-skill, and `.codex/hooks.json` mirrors in the same
  file (:118, :202, `generateAgentContextMirrors` :248) **stay**: Codex still
  cannot read `.claude/`.
- **Name constants** — `beebox/src/core/agent-instruction-files.ts:20`
  `CLAUDE_MD`, :23 `AGENTS_MD` (*"Always a symlink to the sibling CLAUDE.md"*),
  :26 `AGENT_INSTRUCTION_FILES`, :29 `isAgentInstructionsFile`. **Reuse**;
  flip which name is authored. Keep both names in the recognition list, since
  a `CLAUDE.md` can exist until the next pass.
- **Root file writer** — `beebox/src/core/docs-gen/generate/claude-md.ts:15`
  `ensureAgentContext` → `ensureClaudeMdIncludes` (:26) keeps the root file's
  `@.beebox/agent-guide.md` and briefing includes, *"Never overwrite
  hand-edited content"*. **Reuse**, pointed at `AGENTS.md`.
- **Generation order** — `beebox/src/core/docs-gen/generate/core.ts:397`
  `syncTemplatesFromSource` (template installs, including the four tracked
  guides) runs before :437 `ensureAgentContext`. `generateDocs` runs at chat
  start (`chat/session/run/start-run.ts:117`) and every reactor cycle
  (`reactor/engine/cycle.ts:106`); deploy convergence runs
  `bbx migrate --sweep`, which *"handles deterministic migrations and generated
  guidance"* (`beebox/docs/server/deploying.md:21`).
- **Guidance registry** — `beebox/src/core/box/guidance-surfaces.ts:85` root
  row (`owned`), :92-95 the four `tracked` guides (`src/schemas/`,
  `src/views/`, `src/tricks/scripts/`, `_config/feedback/`), and the mirror row
  `**/AGENTS.md` (`generated`, `gitTracked: true`). Generated, tracked rows
  feed `TEMPLATE_MANAGED_PATTERNS` (`install-template-file.ts:102`), which
  `generateDocs` auto-commits.
- **Template ledger** — `_config/template-versions.json` keyed by box path
  (test box has `src/schemas/CLAUDE.md`, `src/views/CLAUDE.md`,
  `src/tricks/scripts/CLAUDE.md`, `_config/feedback/CLAUDE.md` keys); parked
  copies at `_config/_template-updates/<relPath>`
  (`install-template-file.ts:62` `parkedUpdatePath`). Stock content in
  `box/templates.ts:34,53,84,96`, hashed in `template-stock-hashes.ts`
  (`pnpm template-stock:update`).
- **Maps** — `beebox/src/core/maps/finalize/core.ts:104`
  `ensureClaudeMdInDir` writes the `MAP_INCLUDE_LINE` include (`maps/include-line.ts:8`) into each
  mapped directory's `CLAUDE.md`, skipping tracked guides; `maps/orphans.ts`
  removes emptied ones; `maps/precheck-ignore.ts:94` excludes both names from
  listings. **Reuse**, retargeted.
- **Codex includes** — `agent-context-includes.ts` `expandClaudeIncludes`,
  called with the root `CLAUDE.md` path from `cli/commands/agent-context.ts:23`,
  `agent/codex-run/core.ts:78`, `services/claude-chat/codex-chat.ts:102`.
  **Reuse**, pointed at `AGENTS.md`.
- **Session settings** — `beebox/src/core/agent/box-session-settings.ts:52`
  `ancestorInstructionFiles` lists `CLAUDE.md`, `CLAUDE.local.md`,
  `.claude/CLAUDE.md`, `.claude/rules/**` above the box; :80 `settingSources`.
  **Extend** with `AGENTS.md` and `.claude/AGENTS.md`.
- **Lints** — `claude-md-lint.ts:94` sizes files named `CLAUDE_MD`;
  `cli/validate-hook/command.ts:177` sizes either name on write. **Reuse**.
- **Audit plumbing** — `dev/lib/test-runner/runner/run-test.ts:129-138` stages
  `CLAUDE.md` fixtures and, for Codex, mirrors; `codex-audit.ts:30`
  *"command.replaceAll(AGENTS_MD, CLAUDE_MD)"*. **Rebuild** (delete the
  normalization, rename fixtures).
- **Agent-facing text naming `CLAUDE.md`** — `agent-guide/guide.md:372`
  (*"A `CLAUDE.md` under each says what to read before writing there"*),
  `box/guidance-sync/skills-content.ts:98` (course skill: *"A thin, editable
  `CLAUDE.md`"*), the four template texts, `docs/box-guidance.md`,
  `docs/box-layout.md`, `.claude/skills/bbx-context/SKILL.md`.

## Prior art (external)

Adopted premises, all verified on 2026-10-09 with SDK probes
(`scratch/agents-md-sdk-probe.ts`, not committed) running
`@anthropic-ai/claude-agent-sdk` 0.3.292 (bundles Claude Code 2.1.292, pinned
at `beebox/package.json:119`) with box settings (`settingSources: ["project"]`,
`claudeMdExcludes` from `ancestorInstructionFiles`):

- AGENTS.md support is a built-in plugin (`cc-plugin-agents-md`), default
  mode *"a project with no CLAUDE.md of its own gets its AGENTS.md files
  instead, loaded exactly where and how CLAUDE.md would be"* (string in the
  2.1.296 binary; docs: https://code.claude.com/docs/en/memory.md). Requires
  2.1.277+; on by default behind a remote flag `tengu_agents_md_mod` whose
  default is true.
- Probe results:
  - AGENTS-only box, `cwd` = box root: root `AGENTS.md`, its `@` includes, and a
    nested `AGENTS.md` after a Read all load.
  - A nested `AGENTS.md` does **not** load when the agent only Writes into its
    directory. (`CLAUDE.md` loads on Write and Edit too, per the docs.)
  - An ancestor `CLAUDE.md` listed in `claudeMdExcludes` does not turn
    AGENTS.md mode off.
  - An ancestor `AGENTS.md` above the box **loads** unless excluded; adding it
    to `claudeMdExcludes` stops it.
  - A `CLAUDE.md` inside the box below `cwd` loads in addition when read; a
    `CLAUDE.md` **at** `cwd` makes the session ignore every `AGENTS.md`.
  - With `cwd` below a directory, that directory's file's `@` includes are not
    expanded. `CLAUDE.md` behaves the same (control run), so this is not a
    regression.
- Codex 0.160 reads `AGENTS.md` natively (unchanged from today, where it reads
  the symlink).

Evaluated-only: Claude Code's `claude-md-and-agents-md` mode (load both). Not
used; it exists for repos that keep both files, which this plan ends.

No ACKNOWLEDGEMENTS entry: nothing is copied or adapted.

## Ontology

- **Instruction file** — a file an agent harness loads as project
  instructions. After this plan its authored name is `AGENTS.md`
  (`AGENTS_MD`, `agent-instruction-files.ts:23`). Not a card;
  `list-cards.ts:62` already excludes it.
- **Legacy instruction file** — a `CLAUDE.md` (`CLAUDE_MD`, :20) in a box. Only
  the normalization pass and the recognizers name it after this plan.
- **Normalization pass** — new name for what `mirrorClaudeDocs` does: per
  directory, turn a legacy instruction file into an `AGENTS.md`, or report a
  conflict. Function: `normalizeInstructionFiles(boxRoot)`. Not a registered
  migration; not recorded in `_config/migrations.jsonl`.
- **Instruction-file conflict** — a directory holding a real `CLAUDE.md` and a
  real (non-symlink) `AGENTS.md`. Reported, never merged.
- Existing names kept: guidance surface / `GUIDANCE_SURFACES`, tracked guide,
  template ledger, parked update, `MAP.md` include, `claudeMdExcludes`.

## Tracks / scope

### Track B — the normalization pass (first: everything else assumes it)

- **What.** Replace `mirrorClaudeDocs` with `normalizeInstructionFiles`, and run
  it at the start of `generateDocs`, after the skip check and before
  `syncTemplatesFromSource` (`generate/core.ts:397`).
- **Why.** The template sync installs the tracked guides at their new
  `AGENTS.md` paths. If the legacy `CLAUDE.md` is still there, the sync writes
  a stock `AGENTS.md` beside an edited `CLAUDE.md`, and the box ends up with a
  conflict the engine made itself. Running first prevents that. Running on
  every pass also catches a `CLAUDE.md` made later.
- **Direction.** For each directory in the existing walk:
  1. `CLAUDE.md` is a regular file and `AGENTS.md` is absent or a symlink:
     skip if `CLAUDE.md` has uncommitted changes (it is someone's work in
     progress; retry next pass). `generateDocs` already reads that set before
     its first write (`dirtyBefore`, `generate/core.ts:391`). Otherwise `rename(CLAUDE.md, AGENTS.md)`,
     which replaces the symlink. If the path is a template-ledger key, rekey
     the ledger entry (hash unchanged, so the sync then reads it as installed)
     and move a parked copy under `_config/_template-updates/`.
  2. Both are regular files: record an instruction-file conflict; change
     nothing.
  3. A dangling `AGENTS.md` symlink: remove (existing behavior).
  4. `CLAUDE.local.md` or `.claude/CLAUDE.md`: record a conflict (both disable
     AGENTS.md mode; neither is created by the engine).
  Return `{ renamed: string[], conflicts: string[] }`. `generateDocs` adds
  `renamed` (both sides of each rename) to the paths its single commit takes:
  `commitTemplateSyncChanges` (`generate/core.ts:265`, today
  `{ keepUncommitted }` only) gains an `alsoCommit` path list, so the rename
  lands as a git rename.
  Conflicts surface through `bbx validate` (Track A).
- **Vocabulary lock-ins.** `normalizeInstructionFiles`; conflict message text.
- **First chunk.** The pure decision per directory
  (`instructionFileAction({claude, agents, dirty, ledgerKey})` → rename / skip /
  conflict / remove-link) with a doctest of every case, then the walk and the
  `generateDocs` call.

### Track A — engine writers and recognizers

- **What.** Every engine writer writes `AGENTS.md`; recognizers keep both names.
- **Why.** Otherwise the engine recreates `CLAUDE.md` after the pass renames it.
- **Direction.**
  - `docs-gen/generate/claude-md.ts`: rename file to `agents-md.ts`,
    `ensureClaudeMdIncludes` → `ensureAgentsMdIncludes`, path `AGENTS.md`.
  - `guidance-surfaces.ts`: root row and the four tracked rows to `AGENTS.md`;
    delete the `**/AGENTS.md` mirror row (an authored file must not be swept
    into template commits).
  - `maps/finalize/core.ts`: `ensureClaudeMdInDir` → `ensureAgentsMdInDir`;
    drop the `ensureAgentsMirror` call. `maps/orphans.ts`: operate on
    `AGENTS.md`; drop symlink cleanup.
  - `agent-context-includes.ts` callers (3 sites) read root `AGENTS.md`;
    rename `expandClaudeIncludes` → `expandInstructionIncludes`.
  - `claude-md-lint.ts`: size-lint `AGENTS.md` (keep thresholds).
  - `cli/validate-hook/command.ts`: a Write of a file named `CLAUDE.md` gets
    the message *"Name instruction files AGENTS.md; a CLAUDE.md turns off every
    AGENTS.md in this session."* `bbx validate` reports instruction-file
    conflicts from Track B.
  - `agent-instruction-files.ts`: doc comments flip; constants stay.
- **First chunk.** The root writer and registry rows, with their doctests.

### Track C — session settings

- **What.** `ancestorInstructionFiles` (`box-session-settings.ts:52`) also
  lists `AGENTS.md` and `.claude/AGENTS.md` in each ancestor.
- **Why.** Probe: an `AGENTS.md` above the box loads into box sessions once the
  box itself has no `CLAUDE.md`. Today a box's own `CLAUDE.md` masks that.
- **First chunk.** The list change and the existing doctest's expectation.

### Track D — text, docs, audits

- **What.** Template texts (`templates.ts`) and the agent guide
  (`guide.md:372`, `ledger.yaml:717,720`), the course skill
  (`skills-content.ts:98`), box docs (`docs/box-guidance.md`,
  `docs/box-layout.md`, `docs/box/tricks.md`), the `bbx-context` skill, the two
  `site/docs` pages, knowledge-audit fixtures (`CLAUDE.md:` keys at
  `knowledge-audits.yaml:118,149,243,3601,3634`), `run-test.ts:129-138`, and
  `codex-audit.ts:30` (delete the normalization).
- **Why.** Text that says `CLAUDE.md` teaches agents to make one.
- **Direction.** Template text changes need `pnpm template-stock:update`; the
  old hash joins `superseded`, so stock copies upgrade and edited copies park
  (existing behavior, `installTemplateFile`, `install-template-file.ts:325`).

## Could this be simpler?

The simplest version is a registered one-shot migration that renames every
`CLAUDE.md`, plus the writer changes. It gets snapshots and a manifest record
from the migration framework. It fails on three cases:
- a `CLAUDE.md` made after the migration (course skill habit, model habit), which
  silently turns off every `AGENTS.md` for sessions started at or below it;
- a dev or local box that runs the new engine's `generateDocs` before anyone
  runs `bbx migrate`, where the template sync then installs stock `AGENTS.md`
  guides beside edited `CLAUDE.md` guides;
- it is a second mechanism next to a repeating pass that must exist anyway for
  the first case.
The repeating pass covers all three with one mechanism, and the rename is
lossless (content moves; git records a rename), so the migration framework's
recovery snapshot buys little. The cost: no per-box manifest record that the
conversion happened. `bbx validate` conflicts plus "no `CLAUDE.md` left" are
the observable end state instead.

Considered and cut: a `PreToolUse` hook that injects a directory's `AGENTS.md`
on Write, to close the Write-does-not-load gap. See Open design questions.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Template sync runs before the pass and installs stock `AGENTS.md` beside an edited `CLAUDE.md` guide | New: normalizer doctest on a box with an edited legacy guide | Pass runs first (Track B) | Would be clear (conflict reported) |
| Pass renames a `CLAUDE.md` with uncommitted edits, and the commit sweeps up work in progress | New doctest | Skip dirty files | Silent if missed; covered by test |
| Ledger key not rekeyed: sync treats the renamed guide as unknown and parks a stock copy | New doctest (ledger before/after) | Rekey in pass | Clear (a park appears) |
| A `CLAUDE.md` at a landmark chat's `cwd` turns off all `AGENTS.md` | Validate-hook doctest for the message | Pass renames it on next `generateDocs`; validate hook warns at write | Clear at write; silent until next pass otherwise |
| Remote flag `tengu_agents_md_mod` turned off: no instructions load | No | None | **Silent** |
| A future SDK bump changes the default mode | No | `schedules/sdk-update` reviews changelogs | Silent until noticed |
| Engine downgrade on a migrated box: old engine writes a root `CLAUDE.md`, which wins over every `AGENTS.md` | No | None | Silent |
| Nested `AGENTS.md` not loaded when the agent writes without reading | Knowledge audit (Rollout) | None (accepted, see Open questions) | Silent |

> **Critical gap:** remote flag or SDK default change — box agents would run
> with no instructions and nothing would say so. Accepted as a documented risk
> with one mitigation: Track D adds a line to the `sdk-update` schedule prompt
> to re-run the AGENTS.md probe on every SDK bump. A runtime check (start of
> session, assert the guide loaded) was considered and not chosen: the SDK
> exposes no "instructions loaded" signal short of an `InstructionsLoaded`
> hook, which is a new box hook for a remote-flag risk.

Engine downgrade is accepted: downgrades are manual and rare
(`bbx engine upgrade` is boxholder-run, `guide.md` "Not yours to edit").

## Agent-flow / user-flow edge cases

- **Wrong name.** An agent writes `CLAUDE.md`. ADDRESSED: validate-hook message
  at write (Track A); rename on the next pass (Track B).
- **Stale ref.** A card or doc links to `.../CLAUDE.md`. GAP, small: links into
  instruction files are rare (`list-cards.ts:62` excludes them from
  linkables). `bbx validate` reports broken links as it does today.
- **Two agents.** The chat agent edits `CLAUDE.md` while the reactor's pass
  renames it. ADDRESSED partly: a dirty file is skipped; a race inside one
  pass can leave both names, which becomes a reported conflict. No loss.
- **Hand-edit drift.** The boxholder creates `CLAUDE.md` in a folder. ADDRESSED
  by the pass. If they also made `AGENTS.md` there: reported conflict.
- **Fabricated value.** Not applicable: no free-form field.
- **Validation error UX.** The conflict and write messages name the fix in one
  sentence each (Track A text).
- **Partial migration.** A box with some `CLAUDE.md` left: in Claude Code's
  default mode a `CLAUDE.md` at or above `cwd` turns `AGENTS.md` off for that
  session, and one below `cwd` only replaces that directory's file. The pass
  runs on the first `generateDocs` after the engine update (chat start,
  reactor, or deploy convergence), before any session of that chat starts.

## NOT in scope

- **The landmark-chat exclude regression**
  (`issues/bugs/2026-10-09-landmark-chats-exclude-box-root-instructions.md`).
  Track C touches the same function, but changing what landmark chats load is
  a product decision; fix it separately.
- **Ancestor `@` includes not expanded when `cwd` is below** (probe s0/s2). This
  is pre-existing Claude Code behavior for both names; it affects landmark
  chats, which are blocked by the regression above anyway.
- **Renaming `.claude/rules`, skills, or the Codex skill mirror.** Unchanged;
  Codex still needs `.agents/skills`.
- **A registered migration.** See *Could this be simpler?*
- **Renaming `templates.ts` constants** (`SCHEMAS_CLAUDE_MD_V2` …) and the
  `claude-md-lint.ts` file name. Cosmetic; do it only if the touched lines are
  already changing.

## Open design questions

- **The Write-without-Read gap.** Lean: accept it. Map stubs (one-line map includes) and
  the four tracked guides load when an agent reads in that directory, which
  agents almost always do before writing. Measure with the audit below; if it
  fails, add a `PreToolUse` Write hook that emits the directory's `AGENTS.md`
  (Codex already has `bbx agent-context --hook`, `cli/commands/agent-context.ts`).
- **Should the boxholder be told?** Lean: no notice. Nothing they see changes,
  and their edited instruction files keep their content.

## Knowledge audits

- New: `agents-md-course-entry` — an agent asked to set up a course's entry
  point names the editable file `AGENTS.md`. Exercises the course skill text.
- New: `agents-md-write-only-dir` — an agent asked to add a card to a
  directory whose `AGENTS.md` carries a distinctive rule, with a task that does
  not need reading, follows the rule. Measures the Write gap.
- Existing fixtures move from `CLAUDE.md:` to `AGENTS.md:` keys and are re-run
  (`pnpm knowledge-audit run --box ~/src/boxes/test1 --filter <id>`) for both
  engines, with the status comment recorded.

## What will hold this after it ships

- Doctest tier (pure decision function): `instructionFileAction` covers every
  directory case; one integration doctest runs `normalizeInstructionFiles` on a
  temp box with a ledger and a parked copy.
- Existing doctests (`guidance-sync`, `maps/finalize`, `maps/orphans`,
  `agent-context-mirrors`, `claude-md-lint`, `run.box-context`,
  `cli/commands/agent-context`, `codex-audit`) change fixtures from `CLAUDE.md`
  to `AGENTS.md`.
- `template-stock-hashes.doctest.md` enforces the stock-hash update.
- The SDK behavior (native loading) is not covered by a doctest; the
  `sdk-update` schedule probe line holds it. No new test tier.

## Implementation order

1. Track B decision function + doctest.
2. Track B walk, ledger rekey, parked-copy move, `generateDocs` placement and
   commit paths; integration doctest.
3. Track A writers and registry rows (root, maps, orphans, includes callers,
   lint, validate hook); update their doctests.
4. Track C exclude list.
5. Track D template texts + `pnpm template-stock:update`; agent guide; course
   skill; box docs; `bbx-context` skill; site docs; `sdk-update` prompt line.
6. Audit plumbing (`run-test.ts`, `codex-audit.ts`), fixture renames, the two
   new audits, runs on `~/src/box-worktrees/agents-md/test1` for Claude and
   Codex.
7. End-to-end on the worktree's test box clone: run `bbx docs refresh` (or
   start a chat) and confirm every `CLAUDE.md` became `AGENTS.md` in one commit,
   template ledger keys moved, no parks, and a chat session loads the guide.

## Rollout shape

Tests first per chunk (the decision doctest before the walk). Done when: the
normalizer doctests pass, the renamed fixture doctests pass, the two new audits
run green on both engines, and step 7 shows a clean converted test box.

Migration approach: scripted and repeating (the normalization pass), atomic per
directory (one `rename`), gradual per box (each box converts on its first
`generateDocs` after the engine update; production boxes convert during deploy
convergence). The plan ships as one piece, only when the boxholder says so.
