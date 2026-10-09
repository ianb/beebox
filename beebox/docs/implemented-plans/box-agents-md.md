---
title: "Boxes author AGENTS.md instead of CLAUDE.md"
status: implemented
workstream: agents-md
issues:
  - ../../../issues/closed/docs-and-chores/2026-09-18-move-to-agents-md-only.md
---
# Boxes author AGENTS.md instead of CLAUDE.md

Box agent instructions move from `CLAUDE.md` files (with `AGENTS.md` symlinks
for Codex) to authored `AGENTS.md` files, through one registered migration.
Claude Code and Codex both read `AGENTS.md`, so one file serves both and the
symlink mirror goes away. The dev repo made the same move on 2026-10-09
(merge `bee88d5d6`).

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

**Smallest fix:** a registered migration renames every box `CLAUDE.md` to
`AGENTS.md`, the engine's writers write `AGENTS.md`, and a lint rejects a new
`CLAUDE.md`. That is the dev repo's shape (rename, remove the mirror, lint).
Two additions make it safe for boxes, which update engine and data at
different times:

- Until a box's migration runs, engine writers write to whichever instruction
  file already exists, so an unconverted box behaves exactly as it does today.
- The migration pre-scans and fails closed on any conflict, converts the root
  file first, and every state an interruption can leave is a valid one: the
  engine reads it correctly and Claude loads it (Track B "Intermediate
  states").

Tracks (below): A writers, the pre-migration name resolver, and the lint;
B the migration; C session settings; D guidance text, docs, and audits;
E the deferred removal of pre-migration support.

Estimate (additions plus deletions): source about 700 lines (migration about
220, resolver, sibling-key rule, and writers about 300, lint and settings
about 80, mirror-pass reduction later in Track E), tests about 750 (migration
and resolver doctests, an integration doctest with every interruption point,
about 25 doctests renaming fixtures), knowledge audits about 80, authored docs
about 250. Total about 1,800. Not a BIG CHANGE, but close: if implementation
passes 2,000 changed lines, stop and ask. Generated output (agent guide
regeneration, `doc-graph`) is separate.

## Stated preferences this plan trades against

- **Human decision (2026-10-09):** *"Seperately we should do the same thing to
  boxes"*, after the repo's move with *"remove the Codex workaround"* and *"We
  should have a CLAUDE.md lint to avoid accidentally creating one"*. So: no
  `CLAUDE.md` stays in a converted box, the symlink mirror goes, and a lint
  rejects new ones.
- **The originating issue** (`2026-09-18-move-to-agents-md-only.md`): *"A
  migration changes files inside every box, so it is a registered migration,
  not an edit."* Followed.
- **Migration conventions** (`docs/cards/migrations.md` "Writing a new
  migration"): idempotent, appended to `MIGRATIONS`, and step 7, *"Defer
  removal of the legacy support"* with a deferred cleanup issue. Followed
  (Track E).
- **"Arrange context, don't automate judgment"** (boxholder memory): two real
  instruction files in one directory are reported, never merged.
- **Minimal concepts:** no new registry, flag, or tier. The migration manifest
  is the only state. One resolver function carries the pre-migration behavior
  and Track E deletes it.

## What already exists

- **Mirror pass** — `beebox/src/core/agent-context-mirrors.ts:100`
  `mirrorClaudeDocs` walks the box (skips at :61: *".git" … "node_modules" …
  ".agents"*, and `_template-updates` at :44) and plants
  `AGENTS.md → CLAUDE.md` symlinks. `ensureAgentsMirror` (:91) is called by
  maps finalize and replaces legacy generated regular `AGENTS.md` files marked
  `GENERATED from Claude guidance` (:15, :95). **Keep** until Track E as
  pre-migration support (Codex in an unconverted box still needs it). The
  migration reuses its walk and its marker test. The `.agents/skills`,
  rule-skill, and `.codex/hooks.json` mirrors in the same file (:118, :202,
  `generateAgentContextMirrors` :248) **stay** for good: Codex cannot read
  `.claude/`.
- **Name constants** — `beebox/src/core/agent-instruction-files.ts:20`
  `CLAUDE_MD`, :23 `AGENTS_MD` (*"Always a symlink to the sibling CLAUDE.md"*),
  :26 `AGENT_INSTRUCTION_FILES`, :29 `isAgentInstructionsFile`. **Reuse**; the
  resolver joins them.
- **Root file writer** — `beebox/src/core/docs-gen/generate/claude-md.ts:15`
  `ensureAgentContext` → `ensureClaudeMdIncludes` (:26) keeps the root file's
  `@.beebox/agent-guide.md` and briefing includes, *"Never overwrite
  hand-edited content"*. **Reuse** through the resolver.
- **Generation order** — `beebox/src/core/docs-gen/generate/core.ts:397`
  `syncTemplatesFromSource` (template installs, including the four tracked
  guides through `syncBoxGuidance`, `guidance-sync/core.ts:74`) runs before
  :437 `ensureAgentContext`. `generateDocs` runs at chat start
  (`chat/session/run/start-run.ts:117`) and every reactor cycle
  (`reactor/engine/cycle.ts:106`).
- **Migration framework** — `beebox/src/core/migrations.ts` (append-only
  `MIGRATIONS`; last live entry `briefing-openers-2026-10`, a `run.ts` +
  `plan.ts` script). Scripts run as `<script> <boxRoot> --apply`; exit 1
  records nothing (`migration-run.ts`). Deploy convergence and the hourly
  `box-convergence` schedule run the sweep, which then refreshes generated
  guidance (`cli/commands/migrate.ts:142`, `migration-sweep.ts:130`). Migration
  runs inside box maintenance, which closes admission and drains accepted work;
  dirty input is accepted and preserved in Git recovery
  (`docs/cards/migrations.md` "Admission, snapshots, and failures",
  "Automatic convergence"). A box whose convergence fails *"stays closed only
  until the controller exits"*, then reopens unconverted. **Reuse.** Precedent
  for moving instruction files: `publication-cards-2026-10` (commit
  `1bdd7e011`): *"Stock CLAUDE.md/NOTES.md are deleted on a shipped hash;
  edited ones are parked or moved and linked."*
- **Guidance registry** — `beebox/src/core/box/guidance-surfaces.ts:85` root
  row (`owned`), :92-95 the four `tracked` guides (`src/schemas/`,
  `src/views/`, `src/tricks/scripts/`, `_config/feedback/`), and the mirror row
  `**/AGENTS.md` (`generated`, `gitTracked: true`). Generated, tracked rows
  feed `TEMPLATE_MANAGED_PATTERNS` (`install-template-file.ts:102`), which
  `generateDocs` auto-commits.
- **Template ledger** — `_config/template-versions.json`, keyed by box path
  (the test box has `src/schemas/CLAUDE.md`, `src/views/CLAUDE.md`,
  `src/tricks/scripts/CLAUDE.md`, `_config/feedback/CLAUDE.md` keys), each
  entry `{sha256, installed-at, stock, pending}`. Parked copies at
  `_config/_template-updates/<relPath>` (`install-template-file.ts:62`
  `parkedUpdatePath`). `installTemplateFile` (:325) writes stock when the
  destination is absent (:348) and merges an edited copy against the recorded
  `stock` before parking. Stock content in `box/templates.ts:34,53,84,96`,
  hashed in `template-stock-hashes.ts` (`pnpm template-stock:update`).
- **Maps** — `beebox/src/core/maps/finalize/core.ts:104`
  `ensureClaudeMdInDir` writes the `MAP_INCLUDE_LINE` include
  (`maps/include-line.ts:8`) into each mapped directory's `CLAUDE.md`, skipping
  tracked guides; `maps/orphans.ts` removes emptied ones;
  `maps/precheck-ignore.ts:94` excludes both names from listings. **Reuse**
  through the resolver.
- **Codex includes** — `agent-context-includes.ts` `expandClaudeIncludes`,
  called with the root `CLAUDE.md` path from `cli/commands/agent-context.ts:23`,
  `agent/codex-run/core.ts:78`, `services/claude-chat/codex-chat.ts:102`.
  **Reuse** through the resolver.
- **Session settings** — `beebox/src/core/agent/box-session-settings.ts:52`
  `ancestorInstructionFiles` lists `CLAUDE.md`, `CLAUDE.local.md`,
  `.claude/CLAUDE.md`, `.claude/rules/**` above the box; :80 `settingSources`.
  **Extend.**
- **Lints** — `claude-md-lint.ts:94` sizes files named `CLAUDE_MD`;
  `cli/validate-hook/command.ts:177` sizes either name on write, as a warning
  only. **Extend** with the filename check.
- **Audit plumbing** — `dev/lib/test-runner/runner/run-test.ts:129-138` stages
  `CLAUDE.md` fixtures and, for Codex, mirrors; `codex-audit.ts:30`
  *"command.replaceAll(AGENTS_MD, CLAUDE_MD)"*. **Rebuild**: delete the
  replacement, rename fixtures.
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
    nested `AGENTS.md` after a Read all load (s1).
  - A nested `AGENTS.md` does **not** load when the agent only Writes into its
    directory (s4). (`CLAUDE.md` loads on Write and Edit too, per the docs.)
  - An ancestor `CLAUDE.md` listed in `claudeMdExcludes` does not turn
    AGENTS.md mode off (s3).
  - An ancestor `AGENTS.md` above the box **loads** unless excluded; adding it
    to `claudeMdExcludes` stops it (s6).
  - A `CLAUDE.md` inside the box below `cwd` loads in addition when read; a
    `CLAUDE.md` **at** `cwd` makes the session ignore every `AGENTS.md` (s5).
  - With `cwd` below a directory, that directory's file's `@` includes are not
    expanded. `CLAUDE.md` behaves the same (control run s0), so this is not a
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
- **Legacy instruction file** — a `CLAUDE.md` (`CLAUDE_MD`, :20) in a box.
  Normal before the box's migration; a lint error after it.
- **Converted box** — a box whose `_config/migrations.jsonl` records
  `agents-md-2026-10`. The existing manifest is the only state; no new flag.
- **Instruction-file name resolver** — `instructionFilePath(boxRoot, dirRel)`:
  the path engine writers use. Returns the directory's existing `CLAUDE.md` if
  there is one, else its existing `AGENTS.md`; for a missing file it returns
  `CLAUDE.md` in an unconverted box and `AGENTS.md` in a converted one.
  `instructionFileName(boxRoot)` gives the box-level name for generated text.
  Pre-migration support; Track E deletes its legacy branches.
- **Sibling key** — during the compatibility period, the template ledger and
  parked copies treat `<dir>/CLAUDE.md` and `<dir>/AGENTS.md` as one entry:
  a lookup for either path finds whichever key exists. Not a new store; a rule
  in the ledger's lookup. Track E deletes it.
- **Instruction-file conflict** — a directory holding a real `CLAUDE.md` and a
  real `AGENTS.md` that is not a marked generated mirror, or a box holding a
  `CLAUDE.local.md` or `.claude/CLAUDE.md`. Reported, never merged.
- Existing names kept: guidance surface / `GUIDANCE_SURFACES`, tracked guide,
  template ledger, parked update, map include, `claudeMdExcludes`, mirror pass.

## Tracks / scope

### Track A — writers, the pre-migration resolver, and the lint (first)

- **What.** Engine writers resolve their target through
  `instructionFilePath`; registry rows name `AGENTS.md`; a lint rejects
  `CLAUDE.md` in converted boxes.
- **Why.** The engine updates before a box's migration runs: dev boxes and
  worktree clones run the new engine's `generateDocs` at chat start, and a
  production box whose convergence fails reopens unconverted. Without the
  resolver, the template sync writes a stock `src/schemas/AGENTS.md` beside an
  edited `src/schemas/CLAUDE.md` (destination absent → stock install,
  `install-template-file.ts:348`), and the root writer creates an `AGENTS.md`
  that Claude ignores because the root `CLAUDE.md` wins. The box gets a
  conflict the engine made.
- **Direction.**
  - `agent-instruction-files.ts`: add `instructionFilePath`; doc comments flip.
  - `docs-gen/generate/claude-md.ts` → `agents-md.ts`;
    `ensureClaudeMdIncludes` → `ensureInstructionIncludes`, root path from the
    resolver.
  - `guidance-surfaces.ts`: root and the four tracked rows name `AGENTS.md`.
    `installTracked` resolves the row path through the resolver
    (`guidance-sync/core.ts:32-35` passes one path to both the stray-include
    cleanup and `installTemplateFile`), so an unconverted box keeps installing
    its legacy path. The `**/AGENTS.md` mirror row stays until Track E.
  - `install-template-file.ts`: ledger and park lookups use the sibling-key
    rule, and writes keep whichever key already exists. `pruneStaleTemplateUpdates`
    (:459) counts a park as live when either sibling original exists.
    `TEMPLATE_MANAGED_PATTERNS` (:102) keeps the four legacy tracked paths
    until Track E, so `generateDocs` still commits a legacy guide it updates
    (`generate/core.ts:275-284` commits only matching paths).
  - Generated text that names the file (agent guide `guide.md:372`, course
    skill `skills-content.ts:98`) uses `instructionFileName(boxRoot)`; both are
    regenerated per box. Stock template texts (`templates.ts:65` *"CLAUDE.md
    <- This file"*) stop naming the file ("this file"), so one stock version
    serves both states.
  - `maps/finalize/core.ts` `ensureClaudeMdInDir` →
    `ensureInstructionMapInclude` through the resolver; `maps/orphans.ts` the
    same.
  - `agent-context-includes.ts` callers (3 sites) take the root path from the
    resolver; rename `expandClaudeIncludes` → `expandInstructionIncludes`.
  - **Lint.** `bbx validate` (full) and the validate hook
    (`cli/validate-hook/command.ts:177`; it already supports error results and
    exit 2 at :242-247) report an **error** for any `CLAUDE.md`,
    `CLAUDE.local.md`, or `.claude/CLAUDE.md` in a converted box. The hook
    checks the filename first and reads the manifest only on a match, through
    a small read-only extraction of `readManifest` (`migration-run.ts:69`,
    whose module imports migration execution). `isAgentInstructionsFile`
    gains `CLAUDE.local.md`. Message:
    *"Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code
    ignore every AGENTS.md."* Unconverted boxes get no finding.
  - `claude-md-lint.ts`: size-lint the resolver's name.
- **Vocabulary lock-ins.** `instructionFilePath`, `expandInstructionIncludes`,
  the lint message.
- **First chunk.** `instructionFilePath` and its doctest (legacy present;
  `AGENTS.md` present; neither, converted; neither, unconverted; both), then
  the root writer through it.

### Track B — the migration `agents-md-2026-10`

- **What.** A script migration at `src/scripts/migrate/agents-md/run.ts` with
  a pure `plan.ts` (the `briefing-openers` shape), appended to `MIGRATIONS`.
- **Direction.**
  1. **Pre-scan, fail closed.** Walk the box with the mirror pass's walk and
     skip list. Exit 1 before writing anything, printing each path with the
     fix, if any of these exist: an instruction-file conflict; a ledger entry
     under both sibling keys whose contents differ; a park under both sibling
     paths whose contents differ. Identical duplicates are not conflicts; the
     migration drops the legacy copy. Nothing is recorded; the box stays
     unconverted and fully working through the resolver; the migration health
     check (`webapp/trpc/routers/health/checks/migrations.ts`) and
     `box-convergence` report it pending.
  2. **Convert parents before descendants**, ordered by path depth, root
     first. (The mirror pass's walk visits children before a directory's own
     file, `agent-context-mirrors.ts:55-65`; the migration collects first, then
     sorts.) Per directory:
     rename `CLAUDE.md` onto `AGENTS.md` (replacing an absent file, a symlink,
     or a marked generated file); then rekey its ledger entry, moving the whole
     entry (`sha256`, `installed-at`, `stock`, `pending`); then move its park.
     The ledger is written once per directory. Each step checks its target
     state first, so a retry continues from wherever the last run stopped.
  3. Invalidate the generation marker, then exit 0. The marker's inputs do not
     include the manifest (`generate/core.ts:165-180`), and the refresh can
     return "current" before generating (`docs-refresh.ts:74-81`), so without
     this the agent guide and course skill keep their legacy wording. The sweep
     then refreshes generated guidance; the resolver returns `AGENTS.md`
     everywhere, and the mirror pass finds no `CLAUDE.md`.
  Dirty files are renamed like clean ones, under the framework's existing
  dirty-input policy (snapshot, then commit).
- **Intermediate states.** The framework leaves partial output in place and
  reopens the box after a failure (`docs/cards/migrations.md`, "stays closed
  only until the controller exits"; `migration-sweep.ts:260-264`). So every
  interruption point must be a state ordinary work handles:
  - Root not yet renamed: nothing has changed.
  - Some directories renamed, always a parent before its descendants: a
    session at any `cwd` finds either a `CLAUDE.md` at or above it (every
    directory below is then still `CLAUDE.md`, so it is in today's state) or
    none (it reads `AGENTS.md` files and still loads a nested `CLAUDE.md` below
    `cwd` when it reads there, probe s5). Every directory's instructions load,
    for root and scoped sessions alike.
  - A directory's file renamed, ledger or park not yet moved: the sibling-key
    rule finds the old key and park, so the sync reads the guide as installed
    and pruning keeps the park.
  - Retry after any of these finishes the conversion.
  This is why the resolver and the sibling-key rule live in Track A and not
  only in the migration.
- **First chunk.** `plan.ts`: the per-directory steps and the pre-scan
  conflict list, doctested with every state including each interruption
  point.

### Track C — session settings

- **What.** `ancestorInstructionFiles` (`box-session-settings.ts:52`) also
  lists `AGENTS.md` and `.claude/AGENTS.md` in each ancestor.
- **Why.** Probe s6: an `AGENTS.md` above the box loads into box sessions once
  the box has no `CLAUDE.md`. Today a box's own `CLAUDE.md` masks that.
- **First chunk.** The list change and the existing doctest's expectation.

### Track D — text, docs, audits

- **What.** Template texts (`templates.ts`), the agent guide (`guide.md:372`,
  `ledger.yaml:717,720`), the course skill (`skills-content.ts:98`), box docs
  (`docs/box-guidance.md`, `docs/box-layout.md`, `docs/box/tricks.md`), the
  `bbx-context` skill, the two `site/docs` pages, knowledge-audit fixtures
  (`CLAUDE.md:` keys at `knowledge-audits.yaml:118,149,243,3601,3634`),
  `run-test.ts:129-138`, `codex-audit.ts:30`, and one line in the `sdk-update`
  schedule prompt: re-run the AGENTS.md probe on every SDK bump.
- **Why.** Text that says `CLAUDE.md` teaches agents to make one.
- **Direction.** Template text changes need `pnpm template-stock:update`; the
  old hash joins `superseded`, so stock copies upgrade, and edited copies merge
  against their recorded `stock` or park. The migration preserves `stock`, so
  that path survives the rename. Hand-written docs (box docs, `bbx-context`,
  site pages) describe the converted state.

### Track F — `bbx create` names the folder's instructions

- **What.** After `bbx create <path>` writes a card, it prints one line per
  instruction file in the card's directory and its ancestors below the box
  root that holds more than include lines: *"Folder instructions:
  `_content/people/AGENTS.md`. Read it before filling in this card."* The root
  file is always loaded and is not named; map-only files (only `@` includes)
  are skipped.
- **Why.** The write-gap audit (2026-10-09, results under Open design
  questions) showed box agents enter folders through Bash (`ls`, then
  `bbx create`, then often `cat > file`), and Bash never triggers nested
  instruction loading under either name. The folder rule was followed 1 of 3
  times with `CLAUDE.md` and 0 of 3 with `AGENTS.md`. `bbx create` is where
  every run entered the folder, so it can point at the file and let the agent
  decide whether to read it.
- **Direction.** Works in both states (it lists whichever names exist, through
  `AGENT_INSTRUCTION_FILES`). Human decision 2026-10-09: *"bbx create could
  also see that an AGENTS.md existed and simply note that to the agent, then it
  could read it if it wanted to."*
- **First chunk.** A pure `folderInstructionNotes(boxRoot, cardPath)` with a
  doctest, then the print in `cli/commands/create.ts`.

### Track E — deferred removal of pre-migration support

- **What.** A deferred issue (`issues/deferred/`, `activate-on` about four
  weeks after ship, `category: code-quality`) naming, with `file:line`: the
  resolver's legacy branches, the sibling-key rule in the ledger, park, and
  pruning lookups, the four legacy patterns in `TEMPLATE_MANAGED_PATTERNS`,
  the mirror pass's `CLAUDE.md → AGENTS.md` symlinks and `ensureAgentsMirror`,
  the `**/AGENTS.md` registry row, the legacy-marker test,
  `instructionFileName`'s legacy branch, and `CLAUDE_MD` in recognizers that no
  longer need it.
  Safe to remove when every box that matters, production included, has
  `agents-md-2026-10` in its manifest.
- **First chunk.** File the issue in the same commit that registers the
  migration.

## Could this be simpler?

The simplest version renames every `CLAUDE.md` in one migration, changes the
writers to `AGENTS.md`, and adds the lint, with no resolver. It fails on one
case: a box that runs the new engine before its migration has run (dev boxes
and worktree clones at chat start; a production box whose convergence failed
and reopened). In that window the template sync writes stock `AGENTS.md`
guides beside edited `CLAUDE.md` guides, and the root writer creates an
`AGENTS.md` that Claude ignores. The resolver is one function that keeps the
old behavior until the migration runs, and Track E deletes its legacy branches.

The sibling-key rule exists for the same reason: the framework reopens a box
after a failed migration, so a half-moved ledger must still read correctly.

Cut from the first draft: a repeating rename pass inside `generateDocs` with no
registered migration. The cross-model review showed it renamed dirty files on
the deploy path (where `commit: false` empties the dirty set,
`generate/core.ts:391`), never re-ran behind the generation cache
(`generate/core.ts:385`), and could not keep the ledger consistent across
interruptions. The lint replaces its job of catching later `CLAUDE.md` files.

Considered and cut: a `PreToolUse` hook that injects a directory's `AGENTS.md`
on Write. See Open design questions.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| New engine, unconverted box: sync installs a stock `AGENTS.md` guide beside an edited `CLAUDE.md` | New: resolver doctest; sync on an unconverted fixture | Resolver keeps legacy paths | Covered by test |
| Migration interrupted at any step, then a session or sync runs before retry | New: integration doctest stops after each step, runs `syncBoxGuidance` and `generateDocs` (commit result too), then retries | Root first; sibling-key rule; retry continues | Covered by test; migration stays pending until done |
| Ledger entry moved without `stock`: later template updates park instead of merging | New: doctest asserts the whole entry moves | Move whole entry | Covered by test |
| Ledger or park present under both sibling keys with different contents | New: pre-scan doctest | Pre-scan conflict, exit 1 | Clear |
| Unconverted box: engine updates a legacy guide but its commit leaves the guide dirty | New: `generateDocs` commit-result case | Legacy patterns kept until Track E | Covered by test |
| A real `CLAUDE.md` and a real `AGENTS.md` in one directory | New: pre-scan doctest | Exit 1, write nothing, report paths | Clear (health check, `box-convergence` alert) |
| A legacy generated regular `AGENTS.md` (marker) is mistaken for authored | New doctest | Marker test reused | Clear if it fails (migration exits 1) |
| An agent writes `CLAUDE.md` in a converted box | New: validate-hook doctest | Lint error at write and in `bbx validate` | Clear |
| An `AGENTS.md` above the box leaks into box sessions | Updated `box-session-settings` doctest | Track C excludes it | Covered by test |
| Remote flag `tengu_agents_md_mod` turned off: no instructions load in converted boxes | No | None | **Silent** |
| A future SDK bump changes the default mode | No | `sdk-update` prompt line re-runs the probe | Silent until the bump review |
| Engine downgrade on a converted box: old engine writes a root `CLAUDE.md`, which wins over every `AGENTS.md` | No | None | Silent |
| Nested `AGENTS.md` not loaded when the agent writes without reading | Knowledge audit asserting tool order | Depends on Open question | Silent |

> **Critical gap:** remote flag or SDK default change — box agents in
> converted boxes would run with no instructions. Accepted as a documented
> risk with one mitigation (the `sdk-update` probe line). A runtime check
> would need a new box hook (`InstructionsLoaded`) for a remote-flag risk.

Engine downgrade is accepted: downgrades are manual and rare
(`bbx engine upgrade` is boxholder-run, `guide.md` "Not yours to edit").

## Agent-flow / user-flow edge cases

- **Wrong name.** An agent writes `CLAUDE.md` in a converted box. ADDRESSED:
  lint error at write and in `bbx validate` (Track A). Before conversion,
  `CLAUDE.md` is still correct and gets no finding.
- **Stale ref.** A card or doc links to `.../CLAUDE.md`. GAP, small: links into
  instruction files are rare (`list-cards.ts:62` excludes them from
  linkables); `bbx validate` reports broken links as today.
- **Two agents.** A chat agent edits `CLAUDE.md` while the migration runs.
  ADDRESSED by the framework: migration runs inside box maintenance, which
  closes admission and drains accepted work.
- **Hand-edit drift.** The boxholder creates `AGENTS.md` in a directory that
  already has `CLAUDE.md`, before conversion. ADDRESSED: pre-scan conflict,
  exit 1, report; they choose.
- **Fabricated value.** Not applicable: no free-form field.
- **Validation error UX.** The lint and conflict messages each name the fix in
  one sentence (Track A, Track B).
- **Partial migration.** ADDRESSED: known conflicts stop the migration before
  any write; an interruption after the first write leaves one of the states in
  Track B "Intermediate states", each handled; the resolver keeps an
  unconverted box on today's behavior.
- **Course chat scope.** A course entry point is a chat scoped to the course
  directory (`skills-content.ts:93-99`). In an unconverted box the course
  skill still names `CLAUDE.md` (Track A generated text), so course files
  match the box's state; the migration converts them with everything else.

## NOT in scope

- **The landmark-chat exclude regression**
  (`issues/bugs/2026-10-09-landmark-chats-exclude-box-root-instructions.md`).
  Track C touches the same function, but what landmark chats load is a product
  decision; fix it separately.
- **Ancestor `@` includes not expanded when `cwd` is below** (probe s0/s2).
  Pre-existing Claude Code behavior for both names.
- **Renaming `.claude/rules`, skills, or the Codex skill mirror.** Unchanged;
  Codex still needs `.agents/skills`.
- **Merging conflicting instruction files.** Reported for a person or agent to
  resolve.
- **Renaming `templates.ts` constants** (`SCHEMAS_CLAUDE_MD_V2` …) and the
  `claude-md-lint.ts` file name. Cosmetic; only if the lines already change.

## Open design questions

- **The Write-without-Read gap — decided 2026-10-09: accept, plus Track F.**
  Audit (3 runs per state, test box clone, real box run options): agents
  reached the folder through Bash in every run; the people-folder rule was
  followed 1/3 with `CLAUDE.md` (the one run that used the Write tool) and 0/3
  with `AGENTS.md`. The schema task read the schema docs 3/3 in both states,
  driven by the root agent guide. Original question: In a converted
  box, a nested `AGENTS.md` loads when the agent reads in that directory, not
  when it only writes there (probe s4). Today a nested `CLAUDE.md` loads on
  Write too. Affected: map includes and the four tracked guides, for example
  the schemas guide's instruction to read the docs before writing
  (`templates.ts:36`). Options: (a) accept, and measure with the audit below;
  (b) add a box `PreToolUse` Write/Edit hook that emits the target
  directory's instruction chain. `bbx agent-context --hook` emits only the
  root's includes (`cli/commands/agent-context.ts:23`), so (b) is new code.
  Lean: (a), with the audit; (b) if the audit fails.
- **Should the boxholder be told?** Lean: no notice. Nothing they see changes;
  their edited instruction files keep their content.

## Knowledge audits

- New: `agents-md-course-entry` — an agent asked to set up a course's entry
  point names the editable file `AGENTS.md`. Exercises the course skill text.
- New: `agents-md-write-only-dir` — an agent adds a card to a directory whose
  `AGENTS.md` carries a distinctive rule. The audit asserts the first tool call
  touching that directory is a Write (so the gap is exercised) and records
  separately whether the rule was followed. A run where the agent reads first
  is inconclusive, not a pass.
- Existing fixtures move from `CLAUDE.md:` to `AGENTS.md:` keys and are re-run
  (`pnpm knowledge-audit run --box ~/src/boxes/test1 --filter <id>`) for both
  engines, with the status comment recorded.

## What will hold this after it ships

- Doctest tier, pure functions: `instructionFilePath` (resolver states) and the
  migration's `plan.ts` (directory states, ledger merge rule, pre-scan
  conflicts, every interruption point).
- One integration doctest: on a temp box with a ledger, a parked copy, an
  edited tracked guide, and a map include, run the migration, then
  `syncBoxGuidance`; assert no new park, no stock overwrite, `stock` preserved,
  and no `CLAUDE.md` left. A second case runs `syncBoxGuidance` on the same box
  **before** the migration and asserts nothing is written at `AGENTS.md`. A
  third stops the migration after each step, runs `syncBoxGuidance` and
  `generateDocs` (checking the commit's paths), and asserts the box state is
  one Track B lists as valid, then that a retry completes it. A fourth runs
  the migration on a box whose generation marker is current and asserts the
  regenerated agent guide and course skill name `AGENTS.md`.
- Existing doctests (`guidance-sync`, `maps/finalize`, `maps/orphans`,
  `agent-context-mirrors`, `claude-md-lint`, `run.box-context`,
  `cli/commands/agent-context`, `codex-audit`) change fixtures and gain an
  unconverted-box case where behavior differs.
- `template-stock-hashes.doctest.md` enforces the stock-hash update.
- Native SDK loading is not a doctest; the `sdk-update` probe line holds it.
  No new test tier.

## Implementation order

1. Track A resolver and `instructionFileName` + doctest; root writer through
   it.
2. Track A sibling-key rule in the ledger, park, and pruning lookups, and the
   kept legacy patterns, with doctests.
3. Track A remaining writers (tracked rows, maps, orphans, includes callers,
   size lint, generated text) with unconverted-box cases in their doctests.
4. Track B `plan.ts` + doctest; `run.ts`; registry entry; integration doctest;
   Track E deferred issue in the same commit.
5. Track A lint (validate hook and `bbx validate`), keyed on the manifest.
6. Track C exclude list.
7. Track D template texts + `pnpm template-stock:update`; box docs;
   `bbx-context` skill; site docs; `sdk-update` line.
8. Audit plumbing, fixture renames, the two new audits, runs for Claude and
   Codex on `~/src/box-worktrees/agents-md/test1`.
9. End-to-end on that clone: run `bbx engine migrate`; confirm every
   `CLAUDE.md` became `AGENTS.md`, ledger keys moved with `stock` intact, no
   new parks, a chat session loads the guide, and `bbx validate` is clean.
   Then add a `CLAUDE.md` and confirm the lint error.

## Rollout shape

Tests first per chunk (each pure function's doctest before its caller). Done
when: the resolver and migration doctests pass, the integration doctest
passes, renamed fixture doctests pass, the two new audits are run on both
engines, and step 9 shows a clean converted test box.

Migration approach: a scripted, registered migration. Known conflicts stop it
before any write; after that, every interruption point is a valid state and a
retry completes it. Production boxes convert during
deploy convergence; local boxes through `box-convergence` or
`bbx engine migrate`; worktree clones by hand. Unconverted boxes keep today's
behavior through the resolver until Track E. The plan ships as one piece, only
when the boxholder says so.
