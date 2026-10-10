---
title: "Box guidance: one delivery class per surface, one home per fact"
status: implemented
workstream: doc-structure
issues:
  - ../../../issues/closed/docs-and-chores/2026-09-21-tricks-claude-md-missing-commit-and-process-model-docs.md
---
# Box guidance: one delivery class per surface, one home per fact

> **Naming note (2026-10-09):** agent instruction files in this repository and in boxes were renamed from `CLAUDE.md` to `AGENTS.md`. This document predates that and keeps the old name.


Phase two of the doc-structure workstream. Phase one applied the
[organizing principles](../README.md#organizing-principles) to the engine's
developer docs. This plan applies them to the guidance a **box agent** reads:
the generated agent guide, the box `CLAUDE.md` family, path rules, managed
skills, package docs, template-tracked guides, and compiled box docs. It has
two halves that must land together:

1. **Delivery.** Every guidance surface gets exactly one delivery class, and
   one code path installs every surface on every sync. Today the same kind of
   file is copied on `bbx engine init` only, or on every sync, or created once
   and never refreshed, depending on which installer happened to be written
   for it.
2. **Organization.** Every engine fact about a subject has one home across
   the tiers. Today views guidance has three homes and calendar guidance has
   five.

The boxholder's framing (2026-09-26): "we are midway through box guidance
refactoring, where it's copied in sometimes but not always, and I'd rather it
be a cleaner system. So if we're going to be moving it around we should be
sure to move it around properly."

**Issues addressed:**
[tricks CLAUDE.md missing commit and process model](../../../issues/closed/docs-and-chores/2026-09-21-tricks-claude-md-missing-commit-and-process-model-docs.md)
(Track 2 gives tricks an engine-fact home and the missing facts go there).
Related but not closed by this plan:
[knowledge budget for always-loaded context](../../../issues/closed/exploration/2026-06-12-knowledge-budget-always-loaded-context.md)
and [instruction surface size budget](../../../issues/closed/docs-and-chores/2026-07-04-instruction-surface-size-budget.md)
(Track 3 sets and measures a target; the enforcing lint they ask for stays
open),
[template parks recurrence check](../../../issues/docs-and-chores/2026-07-19-template-parks-recurrence-check.md)
(Track 1 rewrites tracked guides, which is exactly the park-inducing event that
issue watches for),
[box docs reference node_modules](../../../issues/docs-and-chores/2026-07-07-box-docs-reference-node-modules.md)
and [docs generated map](../../../issues/docs-and-chores/2026-05-21-docs-generated-map.md)
(package docs already answer the first; the remaining `_content/docs/generated/`
tree is box-compiled, not a copy, and is out of scope here).

## Smallest fix and budget

**Smallest fix.** Add the two init-only installers to the sync path and widen
the rule pruner. About 30 source lines and one doctest:

- `syncTemplatesFromSource` (`src/core/docs-gen/index.ts:264-288` (moved to `beebox/src/core/docs-gen/generate/core.ts`)) runs
  `installSchemasGuide`, `installViewsGuide`, `installFeedbackGuide`,
  `generateRules`, `generateSkills`. It does not run
  `installPublicationsGuidance` or `installTricksFiles`, which run only from
  `initBox` (`src/core/box/index.ts:207 (moved to `beebox/src/core/box/structure/core.ts`),214`). Test box `test1` has no
  `src/publications/CLAUDE.md` today because it was initialized before that
  template existed.
- `generateRules` prunes only `card-*` and `connector-*`
  (`src/core/init-rules.ts:81`); `test1` still carries the retired
  `cb-validate-ignore.md` beside the live `bbx-validate-ignore.md`.

This fixes the observed symptom and leaves the cause: there is no single list
of guidance surfaces, so the next surface is installed however its author
remembers to install it.

**Chosen design, four tracks.**

| Track | What | Source + test lines | Prose lines |
|---|---|---|---|
| 1 Registry and one sync path | a `GUIDANCE_SURFACES` registry; `initBox` and sync call one `syncBoxGuidance`; manifest-based pruning; marker line on generated files | ~500 | 0 |
| 2 One home per subject | for each subject, name the home tier; other tiers become pointers or same-source renders | ~150 | ~900 moved, ~200 new |
| 3 Agent guide axis and demotion | section registry gets an axis; on-demand-sized sections move to package docs | ~200 | ~1,200 moved |
| 4 Measurement and review | audits for every moved fact; before/after find-the-fact on a box; a line in the weekly agent-docs-refresh checklist | ~100 | ~150 |
| 5 Search reaches the docs | `bbx search` indexes `box-docs/` as kind `engine-doc` | ~150 | ~10 |

Source and test: about 950 lines. Authored prose moved or written: about
2,450 lines, most of it moved verbatim. Counted together this is a
**BIG CHANGE**; the size is prose moves, and Track 3 is the half of it. The
boxholder asked for phase two and for the delivery cleanup in the same breath;
Track 3 is the only track that could be dropped without leaving the system
half-refactored, and it is listed last so it can be.

## Stated preferences this plan trades against

- **Organizing principles** (`docs/README.md`, "Organizing principles"): one
  home per fact; a pointer says where, not what; marked restatement only.
  Track 2 is these rules applied across tiers instead of across files.
- **`bbx-context` router** (`.claude/skills/bbx-context/SKILL.md`): "route by
  how eagerly it loads"; "pointers, not copies"; the always-on tier is an
  attention budget. This plan adopts the router's tier axis as the ontology
  and does not invent a second one.
- **Consolidate over blast-radius fear** (boxholder, standing): Track 1
  unifies installers even though it touches every box's tracked
  `.claude/` tree.
- **Scope anchored to the incident** (boxholder, 2026-09-10): the smallest
  fix above is named and is the first commit of Track 1. The registry is the
  size the ask implies ("a cleaner system"), not resilience beyond it.
- **Arrange context, do not automate judgment** (boxholder, standing):
  Track 3 demotes sections by a stated rule and a measurement; nothing
  auto-trims a guide.
- **Nothing retries forever / fail closed** (`code-style.md`, Defensiveness):
  a generated file that a box has edited is overwritten, not merged; the
  tracker's park is the only merge policy and it stays for the tracked class.
- **Prompt surface cleanup evaluation** (`docs/plans/prompt-surface-cleanup-evaluation.md`,
  status active): its Track 3 (calendar and drive out of the always-loaded
  guide) shipped as managed skills; its Track 5 (per-section trims) is still
  the nearest precedent for editing the guide. This plan's Track 3 changes the
  guide's *loading model* by section and leaves wording trims to that plan.

## What already exists

Reuse, cited:

- **Template tracker** `src/core/install-template-file.ts:1-35` (header
  comment): hash-tracked install, park to `_config/_template-updates/` on
  local edit, `priorStockHashes` for rewritten stock. Reuse as the one
  mechanism for the tracked class. `TEMPLATE_MANAGED_PATTERNS`
  (`:79-104`) lists tracked paths for the sync commit; it lists
  `src/tricks/scripts/CLAUDE.md` and not `src/publications/CLAUDE.md`, a
  second symptom of the missing list.
- **Managed stock templates** `src/core/box/templates.ts:264-273`
  (`MANAGED_STOCK_TEMPLATES`): the five nested `CLAUDE.md` guides and the
  briefing seed, with stock-hash history. Reuse as the tracked-class rows of
  the registry.
- **Rule generator** `src/core/init-rules.ts:71-140`: rewrites `card-<type>.md`
  from schema `instructions` and connector rules on every sync. Reuse; add
  manifest pruning.
- **Skill generator** `src/core/box/skills.ts:73-90` (moved to `beebox/src/core/box/guidance-sync/skills.ts`): "Idempotent overwrite"
  of ten managed skills; never prunes. Reuse; add manifest pruning.
- **Package docs** `src/core/docs-gen/package-docs.ts:57-175` (moved to `beebox/src/core/docs-gen/package-docs/core.ts`): `STATIC_DOCS`
  (ten generated docs with `readWhen`), `proseDocs` (seven `docs/box/*.md`
  with `read-when:` frontmatter), `builtinCardDocs` (62 `card-<type>.md`), and
  the README index with one read-when line per doc. This is already the
  on-demand tier's "names are the search path". Reuse as the home for engine
  facts that are not always needed.
- **"Where the docs are"** `src/core/agent-guide/where-docs.ts:14-20` (moved to `beebox/src/core/agent-guide/guide/where-docs.ts`): the
  guide's one pointer to the package docs. Reuse as the model for every
  pointer this plan writes.
- **Codex mirrors** `src/core/agent-context-mirrors.ts:67-110,145-161`:
  symlinked `AGENTS.md` beside every `CLAUDE.md` (`:67`), symlinks from
  `.agents/skills/<name>` to each managed skill (`:85`, ensured and never
  pruned), `.agents/skills/beebox-rule-*` renders of rules (`:145-161`, with a
  generated marker and manifest pruning), and `.codex/hooks.json` (`:106`).
  The rule renders are the one generator that already prunes by manifest;
  Track 1 generalizes that pattern to the other three.
- **`CLAUDE.md` include management** `src/core/docs-gen/claude-md.ts:14-88` (moved to `beebox/src/core/docs-gen/generate/claude-md.ts`):
  owns only the `@`-include lines; the body is the box's.
- **MAP shims** `src/core/maps/finalize.ts:91` (moved to `beebox/src/core/maps/finalize/core.ts`): one-line MAP-include
  `CLAUDE.md` files in content directories. Generated; already consistent.
- **Measurement**: `pnpm agent-context chat --box <box>` (`src/dev/agent-context.ts`)
  renders each layer's word count (test1 today: always-loaded 16,029 words;
  box `CLAUDE.md` plus includes 11,634). The knowledge-audit ledger
  (`src/dev/context-history.yaml`) records `initial` context tokens per audit
  (test1 about 22k). `src/dev/knowledge-audits.yaml` has 340 audits, including
  `what-are-tricks`, eight `source-*`, and two `views-*`.
- **Phase-one tooling**: `scratch/doc-structure/section-hash.py` (verbatim-move
  check) and `find-the-fact-protocol.md` (name-only navigator walk). Reuse
  both; the navigator starts at a box root instead of `docs/`.

Rebuild with reason:

- The `installX` helpers in `src/core/box/defaults.ts` (moved to `beebox/src/core/box/structure/defaults.ts`) and `templates.ts` each
  hard-code one path and one call site. They become rows in the registry; the
  helper bodies collapse into one `installTracked(row)`. Reason: the bug this
  plan fixes is that the list of surfaces exists only as scattered call sites.

Searched and found nothing: no doc in `docs/` describes which box files the
engine owns. `docs/box-layout.md:65-68` draws `CLAUDE.md`, `.claude/`,
`AGENTS.md`, `.agents/` in the tree with one-line labels and does not say who
writes them or when.

## Prior art (external)

The design depends on host behaviors, verified 2026-09-26 against vendor docs
where a page exists:

- Claude Code, [How Claude remembers your project](https://code.claude.com/docs/en/memory):
  "Files in subdirectories load on demand when Claude reads files in those
  directories"; "CLAUDE.md files can import additional files using
  `@path/to/import` syntax. Imported files are expanded and loaded into
  context at launch"; path-scoped rules "load only when Claude works with
  matching files". Two facts that bear on Track 3: "target under 200 lines
  per CLAUDE.md file. Longer files consume more context and reduce
  adherence", and "If one of your instruction files is over the recommended
  length, you see a warning at startup". The root box `CLAUDE.md` imports the
  1,034-line agent guide, so every box session starts over that line.
- Codex, [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md):
  "Starting at the project root ... Codex walks down to your current working
  directory. In each directory along the path, it checks for
  `AGENTS.override.md`, then `AGENTS.md`". That page does not mention
  `.agents/skills/`; the skills page returned 404, so the `.agents/skills/`
  mirror rests on the code's existing reliance
  (`src/core/agent-context-mirrors.ts:85`), not on a vendor page.
- Neither host loads `node_modules/beebox/box-docs/` on its own; the agent
  reads a path on instruction. Relied on by `where-docs.ts`.

No external pattern covers "one registry for files an engine plants in a
user's repo"; the nearest is a package manager's `files` manifest, which is the
shape the registry takes.

## Ontology

Nouns the design uses. Names in code already exist where cited.

- **Surface**: one file or file family an agent reads, identified by its
  box-relative path (or path pattern for families such as `card-<type>.md`).
  Not a section; a surface is what the host loads or the agent opens.
- **Tier** (loading eagerness, from the `bbx-context` router): `always`
  (loaded every turn: root `CLAUDE.md` and its `@`-includes), `situational`
  (loaded by path: nested `CLAUDE.md`, `.claude/rules/`), `invoked` (loaded
  by name on demand: skills, procedures), `on-demand` (opened by path on
  instruction: package docs, compiled box docs). A surface has exactly one
  tier.
- **Delivery class** (who owns the bytes; new vocabulary, four values):
  - `package`: lives in `node_modules/beebox/box-docs/`; never in the box
    tree; a box can only point at it. Exists: `package-docs.ts`.
  - `generated`: rendered from engine code or box data; rewritten on every
    sync; carries a first-line marker; pruned by manifest; a box must not edit
    it. Exists without the marker or manifest: rules, skills, agent guide,
    `_content/docs/generated/`, MAP shims, Codex mirrors.
  - `tracked`: seeded from an engine template; the box may edit; the tracker
    parks upstream changes on local edits. Exists: `install-template-file.ts`.
  - `owned`: the box writes it; the engine never writes it, except
    `ensureAgentContext` maintaining include lines in the root `CLAUDE.md`.
  A surface has exactly one class. The class is decided by who writes the
  bytes, not where the facts come from: the engine rewrites the file on every
  sync → `generated` (this includes `_content/docs/generated/`, rendered from
  the box's own guide cards, `box-docs.ts:17`); the engine seeds it and the
  box may edit it → `tracked`; the engine ships it outside the box tree →
  `package`; the box writes it → `owned`.
- **Scaffold**: a create-if-missing file the engine seeds once
  (`writeFileIfMissing`, `templates.ts:230`). Kept for code (`package.json`,
  `types.d.ts`); retired for guidance. `src/publications/NOTES.md`
  (`templates.ts:325`) is guidance and moves to `tracked` or is dropped.
- **Home**: the one surface that states an engine fact. Other surfaces may
  point at it, or restate it only when rendered from the same source (a
  `generated` copy of a `generated` home is one source, so it is not drift).
- **Subject**: a thing an agent works on that guidance is grouped by (views,
  tricks, schedules, calendar, drive, email, publications, schemas, feedback,
  procedures, cards, provenance). The `docs/box/` read-when index is the
  subject list for the on-demand tier.
- **Registry**: `GUIDANCE_SURFACES`, one row per surface: path or pattern,
  tier, class, generator or template, pruning manifest membership, tracked in
  git (yes/no). New; `MANAGED_STOCK_TEMPLATES` and `TEMPLATE_MANAGED_PATTERNS`
  become derived from it.

The registry is the inventory that already exists as prose in the
`bbx-context` skill's router table and in this plan's inventory below, with
the engine reading it instead of an author remembering it.

### Inventory (test1, 2026-09-26)

| Surface | Tier | Class today | Installed by | Refreshed on sync? | Tracked in box git? |
|---|---|---|---|---|---|
| `CLAUDE.md` root body | always | owned | box | n/a | yes |
| `CLAUDE.md` include lines | always | generated | `ensureAgentContext` | yes | yes |
| `.beebox/agent-guide.md` (11,081 words) | always | generated | `agent-guide/index.ts` | yes | no (ignored) |
| `_content/briefing.md` | always | generated from tracked card | `docs-gen` | yes | yes |
| `_content/MAP.md` and the one-line `CLAUDE.md` include shims for it (11 on test1) | always / situational | generated | `maps/finalize.ts` | on map run | yes |
| `src/schemas/CLAUDE.md` (1,007 words) | situational | tracked | init + sync | yes | yes |
| `src/views/CLAUDE.md` (265) | situational | tracked | init + sync | yes | yes |
| `_config/feedback/CLAUDE.md` (167) | situational | tracked | init + sync | yes | yes |
| `src/tricks/scripts/CLAUDE.md` (328) | situational | tracked | **init only** | **no** | yes |
| `src/publications/CLAUDE.md` | situational | tracked | **init only** | **no**; absent on test1 | not in managed patterns |
| `src/publications/NOTES.md` | situational | scaffold | init only | no | yes |
| `.claude/rules/card-<type>.md` (62, 20,673 words) | situational | generated | `generateRules` | yes | yes |
| `.claude/rules/connector-*.md`, `bbx-validate-ignore.md`, `guides-for-*.md`, `exposition-*.md` | situational | generated | three generators | yes | yes; `cb-validate-ignore.md` orphan not pruned |
| `.claude/skills/<name>/` (10, 180-2,291 words each) | invoked | generated | `generateSkills` | yes | yes; never pruned |
| `_config/procedures/*.procedure.card` (10) | invoked | tracked | init + sync | yes | yes |
| `_config/*.guide.card`, `_config/schedules/` | invoked | tracked | init + sync | yes | yes |
| `_config/main.personality.card`, `_content/briefing.briefing.card` | always (compiled) | tracked | init + sync | yes | yes |
| `node_modules/beebox/box-docs/` (79 files: 10 static, 7 prose, 62 card, README) | on-demand | package | package build; `ensurePackageDocs` at runtime | yes | n/a |
| `_content/docs/generated/` (guides, personality, 1,569 words) | on-demand | generated from tracked cards | `box-docs.ts` | yes | no (ignored) |
| `AGENTS.md` symlinks beside every `CLAUDE.md` | mirrors | generated | `agent-context-mirrors.ts:67` | yes | yes |
| `.agents/skills/beebox-rule-*` (68 renders) | mirrors | generated | `agent-context-mirrors.ts:145` | yes | yes; pruned by manifest |
| `.agents/skills/<managed-skill>` (10 symlinks) | mirrors | generated | `agent-context-mirrors.ts:85` | yes | yes; never pruned |
| `.codex/hooks.json` | mirrors | generated | `agent-context-mirrors.ts:106` | yes | yes (`install-template-file.ts:102`) |

Findings the table makes visible:

1. Two tracked guides are init-only and one is missing on the primary test
   box.
2. `generated` surfaces are split between tracked in git (rules, skills,
   mirrors, shims) and ignored (agent guide, compiled docs) for no stated
   reason.
3. Of the four generated families that can leave orphans (rules, skills,
   Codex rule renders, Codex skill symlinks), one prunes by manifest, one
   prunes by name prefix, and two never prune.
4. Card instructions render to two surfaces from one source (rule and package
   doc) with different content: the package doc adds "The `contains:` field"
   and "Templates" sections the rule lacks.

### Subject homes today

| Subject | Surfaces that state engine facts | Words |
|---|---|---|
| views | skill, `src/views/CLAUDE.md`, package `views.md` | 247 + 265 + 4,023 |
| tricks | skill, `src/tricks/scripts/CLAUDE.md`; no package doc | 180 + 328 |
| calendar | skill, `connector-calendar.md` rule, `_config/calendar.guide.card` (tracked), compiled `calendar-guide.md`, package `connectors.md` | 308 + rule + guide + 481 |
| drive, email | skill, package `connectors.md`, guide "External Tools" | 627 / 279 + 481 |
| schedules | skill, package `bbx-commands.md`, guide "Key Commands" | 224 + part |
| procedures | package `procedures.md`, guide "Procedures" (generated list) | 1,634 + 138 |
| schemas | `src/schemas/CLAUDE.md`, guide CARD_TYPES, package `card-*.md` | 1,007 + 1,482 |
| provenance | guide DIRECT_QUOTES + PROVENANCE, eight `source-*` audits | 1,207 |
| publications | `src/publications/CLAUDE.md` (absent), `NOTES.md`, package `publishing.md` | 2,609 |

## Tracks / scope

### Track 1: the registry and one sync path

**What.** A `GUIDANCE_SURFACES` registry in `src/core/box/guidance-surfaces.ts`
that lists every surface with its tier, class, and generator or template. One
function `syncBoxGuidance(boxRoot)` walks the registry; `initBox` and
`syncTemplatesFromSource` both call it. Generated surfaces get a first-line
marker and manifest pruning. Scaffold is no longer a class a guidance surface
can have.

**Why this needs to change.** Findings 1 to 3 above. Each is a symptom of the
list living in call sites: an author who adds a surface picks an installer,
and whether it runs on sync depends on which function they edited.

**Direction.**

```ts
type GuidanceTier = "always" | "situational" | "invoked" | "on-demand";
type GuidanceClass = "generated" | "tracked" | "package" | "owned";

interface GuidanceSurface {
  path: string;                 // box-relative; may contain <type>
  tier: GuidanceTier;
  class: GuidanceClass;
  /** tracked: the stock template name in MANAGED_STOCK_TEMPLATES */
  template?: string;
  /** generated: renders every file under `path`; the returned names are the prune manifest */
  generate?: (boxRoot: string) => Promise<string[]>;
  gitTracked: boolean;
}
```

- `TEMPLATE_MANAGED_PATTERNS` is derived from the rows with
  `class === "tracked"` plus the rows with `class === "generated" && gitTracked`.
- Every `generate` output begins with the existing DOCID marker
  (`withDocId`, `src/core/docs-gen/shared.ts:37-45`, today emitted only when
  `.beebox/docid-debug` exists), made unconditional for the generated class
  and extended with the overwrite notice:
  `<!-- DOCID:<path>; GENERATED by beebox, edits are overwritten -->`. No
  second marker vocabulary. Rule, skill, and mirror generators prune any file
  under their `path` that carries the marker and is not in the returned
  manifest, the way `agent-context-mirrors.ts:159-161` already does for rule
  renders. A file without the marker is left alone (a box's hand-authored
  rule survives). Symlink families (managed-skill mirrors) prune dangling
  links instead, since a symlink has no first line.
- `installTricksFiles` and `installPublicationsGuidance` become rows; the
  create-if-missing calls that remain (`package.json`, `types.d.ts`) stay in
  `initBox` as code scaffolds, outside the registry.
- A doctest walks a fresh box after `initBox` and after `generateDocs` and
  asserts the on-disk set of guidance surfaces equals the registry; a second
  doctest plants an orphan marked rule and a hand-authored rule and asserts
  one is pruned and one survives.

**Vocabulary lock-ins.** `GuidanceTier`, `GuidanceClass`, the marker line
text, the registry name.

**First implementation chunk.** The smallest fix, as one commit: add the two
installers to `syncTemplatesFromSource`, add `src/publications/CLAUDE.md` to
`TEMPLATE_MANAGED_PATTERNS`, and prune `cb-validate-ignore.md` by name in
`generateRules`. Doctest: a box initialized without the publications guide
gains it on the next `generateDocs`. Then the registry commit replaces these
edits.

### Track 2: one home per subject across tiers

**What.** For each subject in the table above, name the home surface and turn
every other surface into a pointer, a trigger, or a same-source render.

**Why this needs to change.** Views facts are stated three times at three
sizes; a change to the view API must be made in three files in two classes
(package and tracked), and the tracked copy parks on boxes that edited it. The
tricks issue exists because tricks has no engine-fact home: the tracked nested
`CLAUDE.md` is the only surface, and the facts it lacks (auto-commit after
exit, staged tree, tsx parent) belong to the engine, not to a box.

**Direction.** One rule for the whole table: **engine facts about a subject
live in the package doc for that subject; a tracked nested `CLAUDE.md` holds
box conventions and a pointer; a skill holds the trigger, the first three
commands, and a pointer.** Concretely:

| Subject | Home (package) | Nested `CLAUDE.md` becomes | Skill becomes |
|---|---|---|---|
| views | `views.md` (exists) | pointer + "this box's views" conventions; drop the API quick reference | trigger + pointer (already) |
| tricks | new `tricks.md` (execution model, auto-commit, parent process, deps, from the issue) | pointer + box conventions | trigger + pointer |
| publications | `publishing.md` (exists) | pointer + box conventions; `NOTES.md` folded in | none |
| schemas | `card-<type>.md` family plus a new `schemas.md` (box-local schema authoring, moved from the 1,007-word nested guide) | pointer + box-local schema list | none |
| calendar, drive, email | `connectors.md` split into `connectors/<name>.md`, one per connector, mirroring phase one's `docs/connectors/` | n/a | trigger + pointer; connector rule stays a same-source render |
| schedules, procedures | `procedures.md`, `bbx-commands.md` (exist) | n/a | trigger + pointer |
| feedback | `_config/feedback/CLAUDE.md` stays tracked (it is box workflow, not engine fact) | unchanged | unchanged |

The `card-<type>.md` rule and package doc render from one function so the
rule is a same-source copy, marked. Which of the two is the home is decided in
Direction, not left open: the package doc, because it is the complete one and
the read-when index points at it; the rule states "(rendered from the same
schema as box-docs/card-<type>.md)".

The compiled `_content/docs/generated/*-guide.md` files are box-compiled from
tracked guide cards, so they are the box's facts and keep their class.

**Vocabulary lock-ins.** `box-docs/tricks.md`, `box-docs/schemas.md`,
`box-docs/connectors/<name>.md`, the marked-render sentence.

**First implementation chunk.** Tricks, because it has the open issue and the
fewest surfaces: write `docs/box/tricks.md` with `read-when:`, move the
engine facts out of `TRICKS_CLAUDE_MD_V2`, bump the stock template with
`priorStockHashes`, point the skill at the doc. Knowledge audit
`tricks-auto-commit` at `knows_about` with `should_read: box-docs/tricks.md`,
run on test1.

### Track 3: the agent guide gets an axis and loses its on-demand sections

**What.** `src/core/agent-guide/index.ts:74-100` (moved to `beebox/src/core/agent-guide/guide/core.ts`) assembles 22 sections in a
list with no stated axis. Give the list an axis (the aspects of "working in
this box"), group the section registry by it, and move sections whose facts
are needed on some runs to package docs with a pointer left behind.

**Why this needs to change.** The guide is 11,081 words (1,034 lines) and
loads every turn through the root `CLAUDE.md` import; Claude Code's own
guidance targets 200 lines per instruction file and warns at startup past it
(Prior art above).
Phase one's rule "a parent is an index plus whole facts" says an always-loaded
surface should carry what every run needs and point at the rest. PROVENANCE
(832 words) and DIRECT_QUOTES (375) are needed on runs that write quoted
material; TODOS (878) on runs that touch todos; CARD_TYPES (1,482) is a
catalog derived from schemas, which the on-demand `card-*.md` docs already
are. The `bbx-context` skill's attention-budget argument is the reason: past a
few thousand tokens, added rules cost compliance on the rules that remain.

**Direction.** Axis, in order: **laws → how to speak → cards → where things
are → how to act → how to cite → where to record → who you are**. Each section
sits under one of those. Sections to demote to package docs (pointer stays,
one sentence each): PROVENANCE and DIRECT_QUOTES → `box-docs/provenance.md`;
TODOS mechanics → `box-docs/todos.md` (the one-paragraph "what a todo is"
stays); CARD_TYPES → keep the type list with one line each, drop per-type
prose that `card-<type>.md` already holds; Git History → `bbx-commands.md`.
Target after demotion: guide at or under 7,000 words, always-loaded layer on
test1 at or under 12,000 words (from 16,029). The target is a decision for the
boxholder; see open questions.

Coordination: `prompt-surface-cleanup-evaluation.md` Track 5 owns wording
trims of what remains. This track moves sections; it does not edit sentences.

**Vocabulary lock-ins.** `box-docs/provenance.md`, `box-docs/todos.md`, the
axis names as section-group comments in `sections.ts`.

**First implementation chunk.** PROVENANCE + DIRECT_QUOTES → `provenance.md`,
verbatim (section-hash check), pointer in the guide's "how to cite" group.
Re-run the eight existing `source-*` audits on test1 with `expected_level`
moved from `knows_directly` to `knows_about`; the pressure audits among them
must still pass. If any fails, the demotion is reverted and the finding
recorded; this is the gate for demoting anything else.

### Track 4: measurement and periodic review

**What.** Before/after numbers for every track and a standing check.

**Direction.**

- Before: `pnpm agent-context chat --box test1` and the audit ledger
  `initial` for the 0-read audits, recorded in this plan.
- Find-the-fact on a box: the phase-one navigator protocol with a fresh
  Sonnet navigator starting at the box root, name-only walk, 15-step cap.
  Ten questions written before the work, five per half: "what happens after a
  trick exits", "how do I give a card type an interface", "where does calendar
  sync state live", "what is a `{% source %}` tag for", "how do I add a
  box-local schema" and five more from the subject table. Same navigator and
  questions after.
- Every moved fact gets or keeps a knowledge audit; audits land run.
- The weekly `agent-docs-refresh` schedule's checklist gains one line: list
  guidance surfaces changed in the last week and check each against the
  registry's class rule. This is the "periodic review" the boxholder accepted
  in phase one, applied to boxes.

### Track 5: `bbx search` reaches the package docs

**What.** The box search index covers `node_modules/beebox/box-docs/` so an
agent's ordinary `bbx search <terms>` finds an engine doc by content, not
only by the README's read-when line. Boxholder decision 2026-09-26: "I'm
wondering if the search command should be able to search those docs. I
think it should."

**Why this needs to change.** Tracks 2 and 3 move facts out of the
always-loaded guide into package docs. The only route to them today is the
guide's pointer plus the README index, which works when the agent knows the
subject name and fails when it knows only a term (`x-bbx-`, `rendersCardTypes`,
"auto-commit"). Search by content is the route that does not depend on
guessing the filename.

**Direction.** The walker already indexes standalone `*.md` files with a
heading fragment per section (`src/core/search/walk.ts:39-73`,
`markdown-sections.ts:51`) and skips `node_modules` by name
(`walk.ts:19`). Add the package docs directory as a second walk root with
its own kind:

- Hits carry `kind: "engine-doc"`, `path` box-relative
  (`node_modules/beebox/box-docs/views.md`), and the section `fragment`, so a
  hit prints as a path the agent can open with the same Read it uses for a
  card.
- `--kind engine-doc` restricts to docs; a plain search ranks docs with
  cards. Semantic mode embeds them like any markdown file (about 80 files).
- Refresh keys on the package docs' content hash, which `ensurePackageDocs`
  already rewrites on a version change, so a deploy re-indexes the docs on
  the next search without `--rebuild`.
- `_content/docs/generated/` stays excluded (`walk.ts:27`): it is compiled
  from guide cards that are themselves indexed.
- The guide's "Where the docs are" gains one clause: "`bbx search` finds
  them by content."

**Vocabulary lock-ins.** `engine-doc` as a search kind.

**First implementation chunk.** The walk root and kind, a doctest that
indexes a fixture box with a two-file `box-docs/` and finds a term that
appears only in a doc, and the guide clause. Knowledge audit
`search-finds-engine-doc` (`knows_about`): ask for a term that lives only in
a package doc and expect a `bbx search` call before the answer.

## Could this be simpler?

**Simplest version:** the smallest fix (two installers on the sync path, one
orphan pruned) plus Track 2 for tricks only. About 60 source lines and one
new package doc. It closes the filed issue and the observed inconsistency.

**What the fuller plan buys, per principle.** The simple version fails the
next time a surface is added: nothing says which installer to use, so the
"copied sometimes" state returns with the next template. The registry is the
one-home-per-fact rule applied to the list of surfaces itself (organizing
principle 1). Track 2 beyond tricks is the same rule applied to subjects with
three to five homes; without it, a view API change still edits three files.
Track 3 is the only track that is a budget decision rather than a consistency
fix, and it is the one the boxholder can cut.

Over-builds rejected: a `bbx guidance` CLI to print the registry (the doctest
and the reference doc cover it; the CLI is not a user surface); a merge policy
for edited generated files (overwrite is the class definition); generating the
nested `CLAUDE.md` guides instead of tracking them (they hold box conventions,
so a box must be able to edit them).

## Subplans

none. The one design question with a decision table (git tracking of the
generated class) is small enough to live in Open design questions.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Rewritten stock guides (views, tricks, schemas) park on every box that edited them | tracker doctests | `priorStockHashes` accepts prior stock; a locally edited file parks; `bbx status` and the `template-updates` health check report parks (`PARKED_TEMPLATE_RESOLUTION`) | clear on boxes that run health; silent on a box nobody looks at (memory: prod template rollout parks silently) |
| Manifest pruning deletes a box's hand-authored rule | new doctest (Track 1) | only marked files are pruned | clear |
| A generated file edited by an agent is overwritten on the next sync | new doctest | marker line says so; the `bbx-context` skill routes durable guidance elsewhere | clear |
| A managed skill is renamed or removed and its `.agents/skills/<name>` symlink dangles | new doctest (Track 1) | none today (`agent-context-mirrors.ts:85` only ensures) | silent: Codex lists a skill whose body is gone |
| A demoted guide section is no longer followed | existing `source-*` and `todo` audits, re-leveled | revert rule in Track 3 first chunk | clear (audit fails) |
| Package doc pointer names a doc that does not exist in an older installed beebox | `box-docs` README is generated with the docs, so index and files match | `ensurePackageDocs` writes at runtime | clear (missing file on read) |
| `initBox` and sync diverge again because a new surface is added outside the registry | registry-equals-disk doctest | none needed; the test is the handling | clear |
| Registry says `gitTracked: false` for rules but a box already tracks them (transition) | migration doctest | one-time `git rm --cached` migration, if the open question resolves that way | clear |
| Codex mirrors render rules that now say "rendered from the same schema" and point at a path Codex sessions can read | none | mirrors copy rule bodies verbatim | silent but harmless: the pointer resolves in both hosts |

> **Critical gap:** none unresolved. The park-silently case is accepted as a
> documented risk: it is the tracker's existing behavior, the parks recurrence
> issue already watches it, and Track 1 ships with a one-line note in
> `docs/server/operations.md` to check parks after the deploy that carries
> the rewritten guides.

## Agent-flow / user-flow edge cases

- **Wrong tier for a fact** (the agent adds a paragraph to the root
  `CLAUDE.md`): ADDRESSED by the `bbx-context` router, which the reference doc
  in Track 1 cites; unchanged here.
- **Stale pointer** (a package doc renamed under a nested `CLAUDE.md`
  pointer): ADDRESSED: package docs and the nested guides ship in the same
  package build; a doctest asserts every `box-docs/` path named in
  `skills-content.ts` and `templates.ts` exists in the generated docs.
- **Two writers on one file** (a boxholder edits `src/views/CLAUDE.md` while
  sync installs the rewrite): ADDRESSED by the tracker's park; the box copy
  wins.
- **Hand-edit drift** in a generated file: ADDRESSED by the marker line and
  overwrite; the agent is told in the marker where the source is.
- **Fabricated free-form value**: not applicable; no new fields.
- **Validation error UX**: not applicable; no new validation.
- **Partial migration / transition state**: a box between deploys has the old
  nested guides and the new package docs, or the reverse. DEFERRED to the
  open question on git tracking; with tracking unchanged, the only transition
  is the tracker's park, which is the existing state.

## NOT in scope

- **Chat and reactor system prompts** (`src/core/chat/session/prompts.ts`,
  `src/core/reactor/prompts.ts`): owned by the prompt-surface plan's Track 4.
- **Wording trims inside surviving guide sections**: that plan's Track 5.
- **Schema `instructions` text** (the source of `card-<type>.md`): content
  review belongs to the schema owner; this plan changes only how it renders.
- **Personality, briefing, guide-card, and procedure content**: box workflow,
  tracked class, unchanged.
- **Box-owned content** (root `CLAUDE.md` body, `CLAUDE_SCANS.md`, the "Box
  persona" leftover on test1): the box's.
- **`_content/docs/generated/` and the MAP for it**: box-compiled from box
  cards; the docs-generated-map issue stays open.
- **A size lint that fails sync when the guide exceeds a budget**: the two
  budget issues ask for it; Track 3 supplies the number and the measurement,
  and enforcement is a separate decision.
- **The Codex mirror design**: mirrors follow whatever the registry says.
- **Retiring `bbx-validate-ignore.md`'s duplicate generator paths** beyond
  the orphan prune.
- **An environment variable naming the package docs directory** (raised
  2026-09-26). The path is fixed and box-relative
  (`node_modules/beebox/box-docs/`), the guide already spells it in full on
  every card-type line and in "Where the docs are", and an agent cannot count
  on the same environment across hosts (Claude Code, Codex, a procedure run
  from a hook). A second name for one fixed path is the "two tiers of
  anything" smell; Track 5 makes the docs reachable by content instead.

## Open design questions

1. **Git tracking of the generated class.** Today rules, skills, mirrors,
   and `.codex/hooks.json` are tracked and committed by
   `commitTemplateSyncChanges`; the agent guide and compiled docs are ignored
   (`test1/.gitignore`: `.beebox/`, `/_content/docs/generated/`). Options:
   (a) keep the split and state its rule; (b) track every generated surface;
   (c) ignore every generated surface, so box history stops carrying engine
   renders, at the cost that a clone must run `bbx engine init` before an
   agent session. Lean: **(a) with the rule "tracked if the host reads it
   without `bbx` running (rules, skills, mirrors, hooks); ignored if the
   engine regenerates it at session start (agent guide, compiled docs)"**.
   The one file that breaks the rule is the agent guide: the root `CLAUDE.md`
   imports it, so a bare clone has a dangling import until the first
   `generateDocs`, which chat start and wakeup both run
   (`src/core/chat/session/start-run.ts:117` (moved to `beebox/src/core/chat/session/run/start-run.ts`), `src/core/reactor/cycle.ts:106` (moved to `beebox/src/core/reactor/engine/cycle.ts`)).
   That is today's behavior and stays. (c) is a migration across every box
   for a gain nobody asked for; (b) adds an 11k-word render to every sync
   commit.
2. **Track 3's target.** 7,000 guide words and 12,000 always-loaded words are
   the plan's proposal. The boxholder may want a smaller or larger number, or
   to cut Track 3 entirely.
3. **`card-<type>.md` rule as full render or pointer.** Lean: full render,
   because a rule loads when the file is in play and a pointer there costs a
   read on every card edit.
4. **Where `docs/box-guidance.md` sits in the developer docs.** Lean: a new
   subject parent `docs/box-guidance.md` with the registry table and the class
   rule, and `docs/box-layout.md` pointing at it for the four agent-config
   lines it draws today.

## Knowledge audits

- `tricks-auto-commit`, `tricks-parent-process`: `knows_about`,
  `should_read: box-docs/tricks.md` (Track 2, first chunk).
- `views-api-home`: `knows_about`, `should_read: box-docs/views.md`, prompt
  asks for the `ViewProps` shape (Track 2).
- The eight `source-*` audits re-leveled to `knows_about` with
  `should_read: box-docs/provenance.md`; the pressure variants must still
  pass (Track 3 gate).
- `guidance-generated-marker`: `knows_directly`, asks the agent where to put a
  durable rule when it notices a marked file; expects the `bbx-context`
  routing answer (Track 1).
- All run on test1 with `pnpm knowledge-audit run --box ~/src/boxes/test1
  --filter <id>`; status comments recorded in the yaml.

## What will hold this after it ships

- **Registry equals disk** doctest under `test/core/box/`: fresh `initBox`,
  then `generateDocs`, then a diff of the guidance surfaces on disk against
  the registry. Cheap; runs in the box fixture tier that
  `install-template-file` tests already use.
- **Prune doctest**: marked orphan pruned, unmarked survivor kept.
- **Pointer-resolves doctest**: every `box-docs/<name>` string in
  `skills-content.ts`, `templates.ts`, and `agent-guide/` matches a generated
  package doc filename.
- **Knowledge audits** above, run weekly by the existing schedule.
- **Reference doc** `docs/box-guidance.md` with the class rule; the doc-check
  suite keeps its links live.
- The find-the-fact walk is not a regression anchor; it is the before/after
  measurement, recorded in this plan when it moves to implemented-plans.

## Implementation order

1. Track 1 smallest fix (one commit; lands the missing installers and the
   orphan prune).
2. Track 1 registry, marker, pruning, doctests, `docs/box-guidance.md`
   (two to three commits).
3. Track 2 tricks (one commit; closes the issue), then views, publications,
   schemas, connectors, schedules (one commit each; each is a verbatim move
   with the section-hash check, then a rewrite commit).
4. Track 3 provenance (gate), then todos, card types, git history.
5. Track 5 search kind and guide clause (one commit; independent of 3 and
   4, so it can land right after Track 1 if wanted).
6. Track 4 after-measurement and the weekly checklist line.

Each commit gets a Codex diff review; the plan ships as one piece when the
boxholder says so.

## Codex plan review (2026-09-26)

`codex exec -s read-only -m gpt-5.5` reviewed the draft; the sandbox blocked
the sibling review file, so the findings are recorded here. All seven were
adopted: two wrong line citations (`templates.ts`, `agent-guide/index.ts`)
fixed; the inventory gained the managed-skill symlinks and `.codex/hooks.json`;
the claim that mirrors prune was narrowed to rule renders and the
never-pruned symlinks became a failure mode; the class rule now classifies by
who writes the bytes (box-compiled docs are `generated` from box facts); the
marker reuses `withDocId` instead of a second vocabulary; open question 1 was
restated with the deciding rule; the prior-art premises were verified against
vendor pages, with the Codex skills page recorded as unreachable.

## Implementation record (2026-09-26)

All five tracks landed in the worktree in nineteen commits
(`f745215bb..9ff085407`), each with typecheck, `lint:changed`, doc-check,
and `test:changed` green (6,241 of 6,241 at the last full selection). Size:
source and tests 1,649 added / 1,014 deleted; authored docs 872 lines. Three
Codex diff reviews ran (Tracks 1, 2, 3); every accepted finding is fixed in a
follow-up commit and the rejected ones are listed below.

### What shipped

- **Track 1.** `GUIDANCE_SURFACES` (`src/core/box/guidance-surfaces.ts`),
  `syncBoxGuidance` called from `initBox` and `syncTemplatesFromSource`,
  `TEMPLATE_MANAGED_PATTERNS` derived from the registry, the DOCID marker
  always on (`withDocId`; the debug-only flag is gone), manifest pruning for
  rules, skills, and Codex mirrors, `docs/box-guidance.md`, and the doctests
  `box-guidance-sync` and `box-docs-pointers`. Two decisions differ from the
  plan text: `initBox` skips the rule and skill generators because `bbx init`
  runs `generateDocs(force)` right after, and running them inside `initBox`
  polluted the process-wide schema cache in neighbor tests; and
  `src/publications/NOTES.md` is `owned` (seeded once), not `tracked`,
  because the tracker would park a stock copy on every box that used it.
- **Track 2.** New package docs `tricks.md` and `schemas.md`; the nested
  guides for tricks, views, publications, and schemas are pointers plus
  conventions (397→82, 265→82, 75→25, 1,007→50 words); `connectors.md` points
  at the guide's secrets section and gained calendar and Telegram entries
  that point at the skill and rule holding their facts.
- **Track 3.** `provenance.md` and `todos.md`; the guide keeps one pointer
  section each. CARD_TYPES and the secrets section point at `schemas.md` and
  `tricks.md`. The section list carries axis comments; no section moved.
- **Track 5.** `bbx search` indexes `box-docs/` as kind `engine-doc`.
- **Track 4.** Below.

### Measurement

| Layer (test1 clone, `agent-context chat`) | Before | After |
|---|---|---|
| Agent guide | 11,285 words / 1,036 lines | 9,402 / 806 |
| Box `CLAUDE.md` with includes | 11,682 | 9,799 |
| Always-loaded total | 16,077 | 14,194 |

The plan's targets (7,000 guide words, 12,000 always-loaded) were not
reached. What remains large is ABOUT_CARDS (2,137 words) and the generated
CARD_TYPES list (1,420); demoting either is a boxholder decision (open
question 2).

**Knowledge audits.** 31 run on the clone box, 31 pass after four stale
fixtures were repaired (a retired `_config/schemas` answer, a past due date,
a substring gate that failed a correct answer, the renamed `usage`
attribute). Re-leveled to `knows_about`: four `source-*`, seven `todo-*`,
`secrets-adhoc-use`, `create-new-card-type`; each read the doc it points at.
New: `search-finds-engine-doc`, `tricks-auto-commit`, `views-api-home`.

**Find-the-fact, after** (name-only walk from the box root, fresh Sonnet
navigator, 15-step cap; no before walk exists because the before state has no
clone with the old package docs and new engine, so the before measure is the
subject-homes table above: views three homes, calendar five):

| Question | Steps | Cited | Name failures |
|---|---|---|---|
| trick auto-commit and trailer | 5 | `tricks.md` | none |
| view export that attaches to a type | 6 | `views.md` | none |
| `{% source %}` `usage` | 5 | `provenance.md` | none |
| add a box-local schema | 5 | `schemas.md` | none |
| agent's own todo attributes | 4 | `todos.md` | none |
| narration mode | 5 | `narration-mode.md` | none |
| delete a calendar event | 8 | calendar skill | `connectors.md` promised calendar and had no entry: fixed (`73ff81061`) |
| mount a Drive folder | 10 | `bbx-commands.md` | guide's connectors bullet named Drive without saying where authoring lives: fixed (`195621aa1`) |
| scheduled script gets a granted key | 17, gave up on the access level | guide secrets + `tricks.md` | fact lived only under `connectors.md` Credentials with nothing always-loaded pointing there: fixed (`9ff085407`) |
| file the engine overwrites | 7 | guide line 1 marker | partial: found the marker, answered "guide card" for the durable rule |

### Codex adjudication

- Track 1 (six findings): three name-family prunes (`card-`, `connector-`,
  `exposition-`, `beebox-rule-*`) delete unmarked files; accepted as the
  engine-owned namespaces they always were, documented in `box-guidance.md`.
  `.codex/hooks.json` cannot carry the marker (JSON); documented exception.
  Legacy `_config/schemas/CLAUDE.md` left the managed patterns; nothing
  writes it, accepted. Stale `docid-debug` mentions in implemented plans:
  history, left.
- Track 2 (five): tricks.md auto-commit caveat, `summarize` is a hook not an
  import, the loopback resolve request restored, default-to-frontmatter rule
  in `schemas.md`: fixed (`688910e7f`). "box-layout.md ships into boxes":
  rejected, it is a developer doc.
- Track 3 (one): three stale audit comments naming `quotesSection`: fixed.

### Deviations and residuals

- The weekly review line went into `docs/box-guidance.md` instead of the
  `agent-docs-refresh` schedule, whose corpus is the public site.
- `quote-*` audits stayed `knows_directly`: THE_LAW_OF_QUOTING already
  states the verbatim rule, so nothing moved for them.
- `todo-application-capture-in-passing` needs its due date rolled forward
  again when it passes.
- The `.agents/skills/<managed-skill>` symlinks prune dangling links only;
  `guides-for-*` rules and dangling `AGENTS.md` symlinks are still not pruned.
- `pnpm lint:circular` reports one pre-existing cycle
  (`services/cloudflare-provisioning.ts` ↔ `-domains.ts`), unrelated.

## Rollout shape

Tests first: the registry-equals-disk doctest is written before the registry,
against the current installers, and fails on `src/publications/CLAUDE.md`;
the smallest fix makes it pass. Done-when for Track 1: that doctest, the prune
doctest, and the pointer-resolves doctest pass, and `pnpm test:changed` is
green. Done-when for Tracks 2 and 3: section-hash check reports zero missing
bodies per move; the named audits pass on test1. Migration: none for data;
the rewritten stock guides roll out through the tracker with
`priorStockHashes`, and the deploy that carries them is followed by a parks
check on the prod boxes (`docs/server/operations.md`).
