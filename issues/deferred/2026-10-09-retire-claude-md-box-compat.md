---
title: "Retire the box CLAUDE.md compatibility code after agents-md-2026-10"
workstream: unattached
activate-on: 2026-11-06
category: code-quality
area: beebox
design: ../../beebox/docs/implemented-plans/box-agents-md.md
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — registering the agents-md-2026-10 migration (plan Track E)
---

The `agents-md-2026-10` migration renames every box `CLAUDE.md` to
`AGENTS.md`. The engine updates before a box's migration runs, and the
framework reopens a box whose migration stopped partway. So the engine keeps
code that serves a box still on `CLAUDE.md`, or one between steps. That code
has no use once every box is converted. Remove it then; until then it is
required.

## Safe to remove when

Every box that matters has `agents-md-2026-10` in its
`_config/migrations.jsonl`. That includes production boxes and any local box
or worktree clone where nobody has run `bbx engine migrate`. A green local
sweep does not prove this. Check the production boxes' manifests, and check
that the `migrations` health check reports nothing pending.

## What breaks if it is removed early

An unconverted box fails quietly. No load error occurs.

- Without the resolver's legacy branches, the template sync installs a stock
  `src/schemas/AGENTS.md` beside an edited `src/schemas/CLAUDE.md`, and the root
  writer creates an `AGENTS.md` that Claude Code ignores, because the root
  `CLAUDE.md` wins.
- Without the sibling-key rule, a box whose migration stopped after a rename
  reads its guide as uninstalled. The sync then overwrites or parks it, and
  pruning deletes the park.
- Without the mirror pass, Codex in an unconverted box loses every
  instruction file.
- The migration's pre-scan reports a conflict when it finds two real
  instruction files in one directory. Such a box stays unconverted until a
  person resolves the conflict. Check for it before removal.

## Code that exists only for the old shape (paths under `beebox/`)

Resolver and name helpers (`src/core/agent-instruction-files.ts`):

- `:81-86` `instructionFilePath`: the existing-`CLAUDE.md` branch (`:83`), and
  the symlink test on `AGENTS.md` (`:84`; a symlink there is the old mirror).
  When the legacy branches are gone, every caller can use
  `<dir>/AGENTS.md` directly.
- `:89-91` `instructionFileName`: the `CLAUDE.md` branch. Its callers
  (`src/core/docs-gen/generate/core.ts:419`,
  `src/core/agent-guide/box-inputs.ts:24`,
  `src/core/box/guidance-sync/skills/core.ts:100`) and the `instructionFile`
  parameters they feed (`src/core/agent-guide/guide/core.ts:34,87`,
  `{{instruction_file}}` at `src/core/agent-guide/guide.md:372`,
  `src/core/box/guidance-sync/skills/content.ts:15`) can become the literal
  `AGENTS.md`.
- `:53-60` `instructionSiblingPath`; `:62` `isAgentsMdBox` (keep it only if
  the lint below still needs it).
- `:26` `CLAUDE_MD` and its place in `AGENT_INSTRUCTION_FILES` (`:35`) can go
  once no recognizer below needs it.

Sibling-key rule (ledger, parks, pruning):

- `src/core/template-sibling-key.ts` (whole file): `ledgerKey`,
  `instructionSiblings`, `existingSiblingPath`, `LEGACY_INSTRUCTION_PATTERNS`.
- `src/core/install-template-file.ts:52` import; `:108,114`
  `LEGACY_INSTRUCTION_PATTERNS` in `TEMPLATE_MANAGED_PATTERNS`; `:271`
  `removeParkedMirror` clearing both siblings; `:311,365,379,390` `ledgerKey`
  lookups; `:425` park path through `existingSiblingPath`; `:499`
  `pruneStaleTemplateUpdates` counting either sibling as the live original.
- `src/core/template-update.ts:10` import; `:48-49` file and park lookups;
  `:61,73,89` `ledgerKey` lookups.
- `src/core/box/guidance-sync/core.ts:34-38` `trackedRowPath`: the tracked rows
  can install at their registry path.

Mirror pass and registry (`src/core/agent-context-mirrors.ts`,
`src/core/box/guidance-surfaces.ts`):

- `agent-context-mirrors.ts:15-20` the legacy marker
  `GENERATED from Claude guidance` and `isLegacyGeneratedAgentsFile`; `:64-78`
  `findClaudeDocs`; `:98-105` `ensureAgentsMirror`; `:107-121`
  `mirrorClaudeDocs` and its call at `:258`. The `.agents/skills`, rule-skill,
  and `.codex/hooks.json` mirrors in the same file stay: Codex cannot read
  `.claude/`.
- `guidance-surfaces.ts:119-121` the `**/AGENTS.md` mirror row, and `:145-156`
  `guidanceSurfaceFor`'s mapping of a legacy `CLAUDE.md` to its sibling's row.
- `docs-gen/generate/core.ts:280` `isAuthoredAgentsMd` and its use in
  `commitTemplateSyncChanges`: it keeps authored `AGENTS.md` files out of the
  template commit only because the mirror row above still matches them.
  Remove it with that row.

Maps (`src/core/maps/`):

- `finalize/core.ts:24` import and `:120-123` planting a mirror beside a new
  `CLAUDE.md`.
- `orphans.ts:72-84` removing the mirror symlink beside a deleted
  `CLAUDE.md`.
- `precheck-ignore.ts:88-94` the comment that explains both names.

Recognizers that list `CLAUDE.md` only for unconverted boxes:

- `src/shared/box-root-vocabulary.ts:34` (`CLAUDE.md`) and the `:36-39`
  comment that calls `AGENTS.md` a symlink.
- `src/core/legacy-instruction-lint.ts:42,58`: the `isAgentsMdBox` gate. After
  removal, the lint can apply to every box.

The migration itself:

- `src/scripts/migrate/agents-md/` (plan and runner) imports
  `isLegacyGeneratedAgentsFile` and `INSTRUCTION_WALK_SKIP_DIRS`. Point the
  `agents-md-2026-10` entry in `src/core/migrations.ts` at
  `src/scripts/migrate/retired.ts` and delete the script and its two doctests
  (`test/scripts/migrate/agents-md*.doctest.md`) in the same change.
- `test/helpers/doctest-helpers.ts` `makeTmpBox`'s `legacyInstructions`
  option and the doctests that use it (`grep -rn legacyInstructions test`).

Keep: `CLAUDE_MD` and `.claude/CLAUDE.md` in the ancestor exclude list
(`src/core/agent/box-session-settings.ts:59,62`). It describes directories
above the box, not box files.
