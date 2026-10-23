---
title: "Knowledge audits with plugins enabled"
status: draft
workstream: knowledge-audit-refresh
issues:
  - ../../../issues/code-quality/2026-10-22-knowledge-audits-with-plugins-enabled.md
---
# Knowledge audits with plugins enabled

A knowledge audit can name plugins that the box under test must have active.
The runner activates them before it regenerates the box's guidance and
removes them after the audit. The courseware audits move to that mechanism,
and the ones that test the wrong thing are rewritten or cut.

**Issues addressed:** `issues/code-quality/2026-10-22-knowledge-audits-with-plugins-enabled.md`.
Searched the queue for "plugin" and "knowledge audit": the closed runner bugs
(`2026-09-28-knowledge-audit-later-tests-lose-generated-guidance`,
`2026-09-28-knowledge-audit-resets-preexisting-box-edits`) shape the reset
rules below; no open duplicate.

## Design

No design section: this changes dev test tooling and audit entries, not what
a person meets in a box.

## Smallest fix and budget

Smallest fix: set `plugins: ["recipe", "courseware"]` in test1 for good. That
breaks `plugins-discover` and `plugins-activate`, which need courseware off,
and it changes test1 for every other use. Rejected.

Chosen: one runner track and one audit track.
- Runner: a `plugins` field in the suite schema; a function that activates
  plugins in a box and commits; the audit loop calls it before docs
  generation and resets after. About 80 source lines and 60 test lines.
- Audits: about 13 entries edited or removed in `knowledge-audits.yaml`.
- Docs: a paragraph in `docs/testing/knowledge-audits.md` (Writing one).

## Stated preferences this plan trades against

- Root `AGENTS.md`, knowledge-audit guidance: "When fixing failures, prefer
  changing docs/prompts to changing the test" (`docs/testing/knowledge-audits.md`).
  Cutting the recall-only courseware audits removes tests. The trade: they test
  recall of card docs, which core card types already cover (for example
  `chat-thread-structure`), and a course is a narrow example of that skill. The
  boxholder said so on 2026-10-22: "then courses are a bad example".
- Memory, minimal concepts: reuse the platform mechanism. The runner writes the
  same `box.json` key and stub files the plugin README tells a boxholder to
  write; it does not invent an audit-only activation path.

## What already exists

- Activation is `box.json` `plugins` plus stub files:
  `src/core/box/config.ts:213` `activePluginNames` reads
  `(await loadBoxConfig(boxRoot)).plugins`. Reuse: the runner writes that key.
- Stub paths: `src/core/plugins/active.ts:91` `pluginStubs` derives each
  schema stub at `${rel.schemasDir}/${type}.ts` from `plugin.schemas` and each
  view stub from `plugin.views`. Reuse its path logic (export a small helper);
  do not hard-code `src/schemas/`.
- Stub contents exist only in prose: `src/plugins/courseware/README.md`
  (Setup) gives `cardSchema("course", courseware.schemas["course"])`. No code
  writes stubs. The runner writes the schema stub text the README shows.
- Plugin skill mirroring: `src/core/box/guidance-sync/skills/core.ts:144`
  builds skills from `activePlugins(boxRoot)`; `syncBoxGuidance` runs it.
  Verify in chunk 1 that `generateDocs` reaches it (the audit loop already
  calls `generateDocs(boxRoot, { force: true })`, `src/dev/lib/box-audits.ts:34`).
- Reset: `runTest` records `headBefore` after setup and ends with
  `git reset --hard ${headBefore}` and `git clean -fd`
  (`src/dev/lib/test-runner/runner/run-test.ts`). Activation must happen, and
  be undone, outside that window.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **Audit plugin list** (`plugins` on an audit entry): plugin names the box must
  have active for this audit. Not a fixture; not written by the agent. Points at
  registry names (`src/plugins.ts`, `pluginNames()`).
- **Active plugin** (existing): a name in `box.json` `plugins` known to the
  registry (`activePluginNames`).
- **Schema stub** (existing, `PluginStub`, `src/core/plugins/active.ts:18`).
No other new nouns.

## Tracks / scope

### Track 1: runner support

- **What:** an audit entry may declare `plugins: [courseware]`.
- **Why:** a fixture cannot activate a plugin, because fixtures are written
  after docs generation (`run-test.ts`, `writeFixtures` after `generateDocs`
  in `box-audits.ts`).
- **Direction:**
  - `test-suite-schema.ts`: `plugins: z.array(z.string()).optional()`, box-only
    (add to `BOX_ONLY_FIELDS`). Unknown names fail at load, checked against
    `pluginNames()`.
  - `src/dev/lib/box-audits/plugins.ts`: `activateAuditPlugins(boxRoot, names)`.
    It adds the names to `_config/box.json` `plugins` (keeping other keys and
    entries) and writes each missing schema stub. It does not commit: the
    changes stay in the working tree and in the setup status that
    `runTest` already accepts exactly (`cliSetupStatus`, `run-test.ts:116-126`).
    After a crash the box is dirty, and the next run's
    `assertCleanAuditBox` stops it visibly. It then calls
    `invalidateBoxSchemas(boxRoot)` (`src/schemas.ts:194`): `generateDocs`
    reads the process-wide schema cache, so new stubs are invisible without it.
  - Readiness: after `generateDocs`, `listPlugins(boxRoot)` must show each
    requested plugin active with every schema stub `effective`; otherwise the
    audit fails with the stub path. An already-active plugin is checked the
    same way, not assumed ready.
  - `box-audits.ts`: `assertStandaloneBox` before any write. For an entry with
    `plugins`, record HEAD, activate, `generateDocs`, check readiness, then
    `runTest`; in a `finally` around all of it, `git reset --hard` to the
    recorded HEAD, `git clean -fd`, and `invalidateBoxSchemas` again.
  - View stubs are not written. This is a guidance-only setup: card docs and
    the plugin skill load, but the plugin's views do not render. The docs
    paragraph says so.
- **Vocabulary lock-ins:** the YAML field name `plugins`.
- **First chunk:** schema field, `activateAuditPlugins`, the loop change, and
  tests. No open questions.

### Track 2: courseware audits

- **What:** move plugin knowledge to `plugins: [courseware]`, cut recall-only
  entries, fix the two entries that test the wrong thing.
- **Direction:**
  - Keep under `plugins: [courseware]`: `courseware-material-convention`,
    `courseware-run-a-course`, `courseware-concept-map-cycles`,
    `courseware-build-a-course`. Restore build-a-course's `probe|courseware`
    check and a read of the courseware skill; restore cycles' read of the
    generated `card-concept-map.md`.
  - Tighten two kept checks: `concept-map-cycles` accepts "valid", which also
    matches "invalid"; `run-a-course` accepts "tutoring" without the scoped
    chat or its `AGENTS.md`.
  - Replace the eight recall entries with the same question on a core card
    type that has no audit (the boxholder: "it should be another type"):
    course composition → briefing parts; concept-map edge type → judgment
    question type; progress evidence → recording a place (`bbx location mark`);
    exposition-plan purpose → glink purpose; lesson-plan location →
    procedure-run record; lesson vs exposition → gdoc vs glink; good concept
    map → well-written judgment; Bloom depth + kind → todo-view defaults.
    Each expected answer comes from that type's `box-docs/card-*.md`.
  - `agents-md-course-entry`: rewrite without a course. A project directory's
    scoped chats must load `WATERING.md`; the answer is that directory's
    `AGENTS.md` with an `@`-import of `WATERING.md`, not a `CLAUDE.md`. (A generic "add a
    rule" prompt would also admit a directory briefing.) Rename to
    `agents-md-scoped-directory`.
  - `plugins-discover`, `plugins-activate`: unchanged; they need courseware off.
- **First chunk:** the YAML edits, after Track 1 lands.

## Could this be simpler?

Simplest: a second test box with courseware on, passed with `--box`. No runner
code. It fails on upkeep: one more box to keep current with templates, and every
run must split the suite by box, as this rerun's shard scripts did by hand.
The per-entry field keeps one box and one command.

Simpler still: cut all courseware audits. It leaves the plugin skill mirror
untested by any agent, and plugins are how boxes gain card types.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Activation leaks into the next audit | New: two audits, second sees no plugin | `finally` reset, clean, and schema-cache reset | Silent without the test |
| Stale schema cache hides new types | Covered by the readiness check | `invalidateBoxSchemas` after writes and reset | Clear (readiness fails) |
| `box.json` rewrite drops other settings | New: keys preserved | Read-modify-write of parsed JSON | Silent without the test |
| A stub already exists with other content | New: existing file untouched | Write only when missing | Clear (plugins list shows it) |
| Typo in a plugin name | New: load fails | Schema refinement | Clear |
| Docs generation does not mirror the skill | Checked in chunk 1 by running one audit | None needed if it does | Clear (audit fails its read) |

## Agent-flow / user-flow edge cases

- Wrong field: an author puts `plugins` in `fixture`. ADDRESSED: the docs
  paragraph says fixtures cannot activate plugins.
- Partial state: the run crashes between activation and reset. ADDRESSED:
  activation is uncommitted, so the next run's `assertCleanAuditBox` refuses
  the dirty box.
- Other cases (stale ref, two agents, hand-edit drift, fabricated values,
  validation UX) do not apply: no card or agent-written state changes.

## NOT in scope

- A `bbx plugins activate` command for boxholders. Considered: it would give
  the runner a function to call. Not now: no product request, and the plugin
  README is the current activation path.
- View stubs in audits: views do not change agent guidance.
- Codex runs of plugin audits: same runner path; not run here.
- The recipe plugin's audits: it is already active in test1.

## Open design questions

None. Cross-model plan review (codex gpt-6-sol, 2026-10-22) changed the
activation to uncommitted, added the schema-cache reset and readiness check,
and replaced the plan to cut the recall audits with per-type replacements.

## Knowledge audits

The plan changes audits. The kept courseware entries and the rewritten
`agents-md-scoped-directory` land run, with status comments.

## What will hold this after it ships

Unit tests on `activateAuditPlugins` (temp box from `makeTmpBox`): activates,
preserves keys, skips existing stubs, idempotent. A test on the loop's reset:
two audits, the second without `plugins`, sees no active plugin. These are
`.test.ts` files with `t.check` beside the existing runner tests.

## Implementation order

1. Track 1 with its tests; run one courseware audit to confirm the skill and
   card docs appear.
2. Track 2 YAML edits; run the kept and rewritten entries twice.
3. Docs paragraph; report updates; close the issue.

## Rollout shape

Done when: the new runner tests pass; `test/dev/lib/test-runner/runner/*.test.ts`
and `test/dev/lib/audit-checks.test.ts` pass; the four kept courseware audits
and `agents-md-scoped-directory` pass on the worktree's test1 copy; a
`plugins-discover` run after a courseware audit in the same run still sees
courseware off. No data migration.
