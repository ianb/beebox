---
title: "Engine docs move out of the box and into the package"
status: active
workstream: launch-docs
issues:
  - ../../../issues/docs-and-chores/2026-07-20-day-to-day-usage-docs.md
---
# Engine docs move out of the box and into the package

**Status:** in progress 2026-09-05. Decided with the boxholder: the docs about
beebox itself should not be regenerated into every box; they should live in the
installed package at one stable path the agent always knows, and the box keeps
only what is compiled from the box's own content. Revised after a Codex plan
review (2026-09-05): runtime-ensured rather than build-time, built-in-only
generator inputs, an override policy, and visible failure paths.

## Problem

`generateDocs` (`src/core/docs-gen/index.ts`) writes ~68 markdown files into
`_content/docs/generated/` on `bbx init`, wakeup, chat start, `bbx migrate`, and
`bbx docs refresh`. Sorted by what they depend on:

| File | Input | Box-dependent |
|---|---|---|
| `bbx-commands.md`, `connectors.md`, `views.md`, `chat-voice.md`, `narration-mode.md`, `reducing-claude-md.md`, `procedures.md`, `triage.md`, `python-tools.md` | engine source only | no |
| `card-<type>.md` for the ~50 built-in schemas | the schema's `instructions` | no |
| `card-<type>.md` for box-local schemas (`src/schemas/*.ts`) | the box | yes |
| `<name>-guide.md`, `chat-<connector>-<slug>-guide.md`, `personality-<name>.md`, `speaking-voice.json` | guide, personality, briefing cards | yes |
| `.beebox/agent-guide.md` | engine text plus the box's procedures, personality, shape | partly |

Roughly 60 of the 68 are engine text with no box input. The directory is
gitignored in the box, so this is not history churn; it is a regeneration
dependency. The docs exist only if something ran the generator since the engine
last changed, and the generator's triggers are all activity, which is why
`bbx docs refresh` exists (three production boxes sat on stale rules for weeks).
Engine text that lives in the package cannot be stale relative to the engine.

Two agent harnesses read these. Claude loads `.claude/rules/card-<type>.md`
(the same `instructions` text) on a path match; Codex has no rules and sees
them only as generated `.agents/skills/beebox-rule-<type>` wrappers. Both need
the `card-<type>.md` files as navigable documents; the doc twin is not
redundant.

## Design

### One directory in the package

`beebox/box-docs/` holds every engine doc. It is derived output, gitignored,
and it is **ensured at runtime**: every `generateDocs` run (the same triggers as
today) computes the engine docs in-process, compares a content hash against
`box-docs/.hash`, and rewrites the directory atomically (temp dir, rename) when
they differ. That covers the dev checkout (any edit to a schema's
`instructions` propagates on the next `bbx` activity, no build step involved)
and the deploy checkout (writable). The release tarball gets the directory from
`scripts/build-box-docs.ts`, which `scripts/release.ts` runs before `pnpm pack`;
`box-docs` is added to `package.json` `files`. The Docker image installs the
box from that tarball, so `node_modules/beebox/box-docs/` is present there too.

Why not `build-cli.ts` (the first draft): `bin/bbx`'s self-heal keys on the CLI
bundle's staleness only, so a missing or stale docs directory beside a fresh
bundle would never be rebuilt, and a failed build falls back to `tsx` without
touching docs. Ensuring from `generateDocs` has no such gap.

Why not committed to git: the content is a pure function of the source, so a
committed copy is a second source that can drift and a diff on every schema
edit.

**When the directory cannot be written** (a read-only install with a pack that
dropped it): `generateDocs` logs a `console.error` naming the path and the fix,
and the box health check `package-docs` (in `runHealthChecks`,
`src/webapp/trpc/routers/health.ts`) reports it on the dashboard, so the agent
guide's pointers are never silently dangling. `pnpm smoke`
(`scripts/smoke-external-box.ts`) asserts the directory and its index exist in
the scaffolded box, so a bad `files` allowlist fails the release check.

From a box, the path is `node_modules/beebox/box-docs/<file>`. Every current
install path puts the engine there: `bbx init` symlinks `node_modules/beebox` at
`PACKAGE_ROOT` (`src/core/box/package.ts`), Docker installs the tarball there.

### What the directory contains

Built-in inputs only, never ambient registry state:

- The nine static docs listed above, unchanged in content.
- `card-<type>.md` for every schema in `cardSchemas` (the built-in array) with
  `instructions`, with the `contains:` appendix for searchable types.
- `bbx-commands.md` lists templates registered by the engine (owner
  `builtin` in `src/schemas/templates-registry.ts`; a `getBuiltinTemplates()`
  is added beside `getAllTemplates()`), not whatever boxes have registered in
  the process.
- `README.md`: an index, one line per doc: filename and a one-line "read this
  when". The agent guide points at this file.

Package docs carry no DOCID marker. DOCID is per-box debug state
(`.beebox/docid-debug`) for tracing what reaches a prompt; the package docs
are read by the agent through a file-read tool whose call already names the
path. The agent guide and the box-compiled docs keep their markers.
`docs/prompt-logging.md` says so.

### What stays in the box

`_content/docs/generated/` keeps only what is compiled from the box: guide
compilations, personality and `speaking-voice.json`, and `card-<type>.md` for
box-local schemas. `.beebox/agent-guide.md` stays. `.claude/rules/` and
`.claude/skills/` stay (they are the path-triggered and invocable forms, and the
Codex mirrors depend on them). `bbx docs refresh` keeps its job for all of that.

**Override policy.** A box-local schema may shadow a built-in type
(`createCardSchemaMap`: last write wins). The guide's card-type list is
deduplicated by type with the box-local schema winning, and a shadowed type
points at the box doc. Box-local templates are listed in the agent guide's
box-specific commands section, not in the package `bbx-commands.md`.

On every `generateDocs` run, the engine-doc filenames (the same list the
package generator emits) are unlinked from the box's `_content/docs/generated/`
if present, so an upgraded box does not carry a stale copy beside the live one.

### How the agent finds them

- `src/core/docs-gen/shared.ts` gains `BOX_PACKAGE_DOCS = "node_modules/beebox/box-docs"`.
  Every reference that today writes `_content/docs/generated/<engine doc>` is
  built from that constant. Box-compiled docs keep `DOCS_DIR`.
- The agent guide gets a short "Where the docs are" paragraph near the top:
  the directory, its `README.md` index, and the rule "read the doc before
  answering about a mechanism". The paragraph is generated per box at runtime,
  so it can also say where the engine source is when it is present
  (`PACKAGE_ROOT/src` exists in a checkout; a packed install ships `dist`
  only). The packaged README never makes that claim.
- The card type list (`src/core/agent-guide/cards.ts`) points each built-in
  type at the package path and each box-local (or shadowing) type at the box
  path.

### Reference sweep, by how each rolls out

- **Generated per run** (change takes effect on the next `generateDocs`):
  `src/core/agent-guide/*.ts`, `src/core/chat/session/prompts.ts`,
  `src/schemas/personality-compile.ts`, `src/schemas/intake-job.tsx`,
  `src/core/claude-md-lint.ts` (a lint message), `src/cli/commands/init.ts`
  (its summary line), the doc generators themselves
  (`views/doc.ts`, `narration-mode-doc.ts`, `python-tools-doc.ts`,
  `reducing-claude-md-doc.ts`, `chat/voice-doc.ts`, `docs-gen/bbx-commands*.ts`).
- **Managed skills** (`src/core/box/skills-content.ts`): overwritten by
  `generateSkills` on every run past the cache, no stock hash.
- **Stock templates with tracker hashes** (`src/core/box/templates.ts`:
  the schemas guide and views guide): editing their text requires
  `pnpm template-stock:update`, or boxes park the update.
- **Ignore lists** that skip `_content/docs/generated/` at any depth
  (`link-repair`, `maps/precheck-ignore`, `validation-ignore`, `list-cards`,
  `search/walk`, `views/link-migration`, `sdk-hooks`, `install-validation-hooks`,
  `validate-markdown`) stay: box-compiled docs still live there, and
  `node_modules` is already skipped.
- **Repo docs and skills**: `docs/{adding-schemas,box-layout,knowledge-taxonomy,landmark-curation,migrations,prompt-surface-review,prompt-logging,testing,image-transforms}.md`,
  `.claude/skills/{bbx-context,bbx-migration}/SKILL.md`,
  `templates/procedures/process-retrospective.procedure.card`,
  `src/dev/knowledge-audits.yaml` (`should_read_any` paths).
- **Tests**: `test/core/{docs-refresh,agent-guide-card-types}.doctest.md`,
  `test/core/search/search-index.doctest.md`, `test/cli/lib/box-layout-spec.doctest.md`,
  `test/cli/commands/validate-markdown.doctest.md`, `test/dev/lib/{audit-checks,codex-audit-behavior}.doctest.md`.

## Work

1. **Generator.** `src/core/docs-gen/package-docs.ts`: `engineDocs()` returns
   `{filename, content}[]` (nine static docs, built-in card docs, README
   index) and `ensurePackageDocs()` writes them to `PACKAGE_ROOT/box-docs/`
   when the content hash differs, atomically; returns `current | written |
   unwritable`. `scripts/build-box-docs.ts` calls the same writer for
   `release.ts`. `.gitignore` and `files` updated. `getBuiltinTemplates()`.
2. **generateDocs.** Calls `ensurePackageDocs()` (logs on `unwritable`);
   `writeStaticDocs` writes only the agent guide and box-local card docs;
   prunes engine filenames from the box dir.
3. **Agent guide.** New constant, "Where the docs are" paragraph, per-type doc
   paths with the override policy, box-local templates listed, every pointer
   rebuilt from the constant.
4. **Sweep**, per the categories above, including `pnpm template-stock:update`.
5. **Visibility.** `package-docs` health check; smoke assertion.
6. **Verify.** Doctests: index present and complete; box dir holds no engine
   docs after a run; a shadowing box schema points at the box doc; `unwritable`
   path logs. `pnpm typecheck`, `pnpm lint:changed`, the touched doctests. On
   test1: `bbx init` then confirm the box dir shrank and the guide's paths
   resolve. Knowledge audit: a card-type question under Claude and under Codex,
   watching that the agent opens the package doc.
7. **Docs.** `docs/box-layout.md`, `docs/knowledge-taxonomy.md`,
   `docs/prompt-logging.md` describe the new tier; this plan moves to
   `implemented-plans/` at finish.

## Questions

1. Directory name: `box-docs/`. Alternatives: `agent-docs/`, `docs-for-boxes/`.
2. Box-compiled docs stay at `_content/docs/generated/` (this plan) or move to
   `.beebox/` beside the guide. Staying is the smaller change; the directory's
   meaning narrows to "compiled from this box".
