# Code Maintenance

Tasks that run periodically rather than continuously — audits, reports, and sweeps that catch drift, dead code, and knowledge gaps. These are deliberately *not* part of the per-commit gate (typecheck and lint already cover that). Run them on a cadence that fits the kind of change you're tracking.

## Why we do this

The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt-builder code, connector rules, procedure templates. Ordinary code changes can quietly invalidate that surface — a refactor renames a method, a schema gains a field, a doc moves — and nothing in the type system or test suite catches it. The audits and reports below exist to keep that surface honest, with humans deciding what's intentional drift vs. regression.

A second category catches the kind of code-health issues that pile up if nobody looks: dead exports, circular dependencies, unused dependencies. These compile and pass tests today, but they make refactors more expensive over time.

## At a glance

| Task | Command | Cadence | Output |
|------|---------|---------|--------|
| Agent SDK update | `pnpm update-agent-sdk` (monorepo root) | Automated (launchd, weekdays); manual anytime | Bumped `package.json` + lockfile |
| Knowledge audits | `pnpm knowledge-audit` | After prompt/schema/CLAUDE.md changes; monthly otherwise | Status comments in `knowledge-audits.yaml` |
| Prompt report | `pnpm prompt-report` | After prompt or schema-instruction changes | `docs/prompts.md` |
| Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
| Dead-code sweep | `pnpm lint:knip` | Before releases; when code feels accumulated | Console |
| Supplemental lint | `pnpm lint:oxlint` | Periodic | Console |
| Circular deps | `pnpm lint:circular` | After big refactors | Console |
| Doc images | `pnpm generate:doc-images` | After editing architecture diagrams or prompts | `docs/architecture/images/` |
| Box data migrations | `cb migrate` (per box) | After adding a new migrator to `src/core/migrations.ts` | Box working tree |
| Broken-ref cleanup | `npx tsx scripts/clean-broken-refs.ts <boxRoot>` | One-off; when `cb validate` shows ref errors that pre-date a migration | Box working tree |
| Accepted security gaps | — | Review when touching auth/OAuth boundaries | `docs/todo-security.md` |

## Tasks

### Agent SDK update — `pnpm update-agent-sdk` (monorepo root)

Bumps `@anthropic-ai/claude-agent-sdk` to the newest npm release that clears
the pnpm `minimumReleaseAge` guard, installs, and typechecks. The SDK bundles
the Claude Code binary every box agent runs (it ignores any system `claude`),
frozen at install time — and its `^0.x` caret never crosses 0.x minors, so
plain `pnpm update` does NOT keep it current (this is how we once shipped a
two-month-old agent binary without noticing).

**When to run:** automated — `bin/update-agent-sdk-scheduled.sh --install`
(from the **main checkout**, once per machine) registers a launchd job that
runs the check weekdays at 12:04 machine-local. Up to date → exits silently;
behind → spawns a headless Claude session that does the full flow below and
commits to `main` (or files an issue on failure). Logs:
`~/Library/Logs/callback-box-sdk-update.log`. Manual runs (`--check` to just
report, exit 1 when behind) work anytime.

**After a bump:** run `pnpm test`, then the steering probe —
`node --import tsx scripts/sdk-steering-probe.ts` (real API calls, ~1 min) —
which verifies the undocumented mid-turn input semantics the chat session
depends on still hold. Then commit; prod picks the new version up on the next
`main` deploy.

### Knowledge audits — `npm run knowledge-audit`

Runs YAML-defined tests against a real box agent, checking responses and tool use against expected behavior. The primary mechanism for catching agent-knowledge drift as the system evolves.

**Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).

**When to run:** after touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know. Also on a periodic cadence (monthly is probably enough) to catch slow drift.

### Prompt report — `npm run prompt-report`

Walks the codebase collecting every prompt, instruction, and rule (system prompts, schema instructions, connector rules, procedure templates, etc.) and writes them into `docs/prompts.md`. Useful for spotting redundancies, contradictions, and prompts that have drifted apart.

**When to run:** after meaningful changes to prompt logic or schema instructions. Periodically to catch drift across the prompt surface.

**Output:** `docs/prompts.md` (committed). Review the diff to see what changed.

### Doc graph — `npm run doc-graph`

Walks every `.md` file, extracts cross-references, and writes a graph of incoming/outgoing links plus an orphan report and broken-reference list to `docs/doc-graph.md`.

**When to run:** after restructuring docs, splitting/merging files, or noticing the graph is stale. Output is byte-stable across consecutive runs.

**Output:** `docs/doc-graph.md` (committed). Look at the "Issues" section first — orphans and broken references are usually accidental.

### Box data migrations — `cb migrate`

Per-box command. Applies any data migrations in `src/core/migrations.ts` that haven't been recorded in the box's `config/migrations.jsonl` yet. Run after pulling a callback-box update that adds a migrator; the per-box pre-commit hook will otherwise complain about stale shapes.

**Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` helper, register it, document it; production rollout history; rollback).

### Broken-ref cleanup — `scripts/clean-broken-refs.ts`

Ad-hoc data-hygiene tool, not a migration. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites relative person refs to absolute form. Idempotent; safe to re-run. Useful after migrating an older box where ref integrity drifted before validation existed.

```bash
npx tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
npx tsx scripts/clean-broken-refs.ts <boxRoot> --apply   # write
```

### Dead-code sweep — `npm run lint:knip`

Detects unused files, exports, and dependencies. Knip can have false positives for entry-point scripts that aren't imported (CLI tools, dev scripts) — those go in `knip.json`'s `entry` array or get registered as `npm run` scripts in `package.json`.

**When to run:** before a meaningful release, or whenever the code feels accumulated. Don't include in pre-commit — the run is too slow and the false-positive resolution is judgment-based.

**Output:** console list of unused files / exports / deps. Triage each: real dead code → delete; legitimate entry point → register; deferred/in-progress → leave with a comment explaining why it's currently unused.

### Supplemental lint — `npm run lint:oxlint`

Catches patterns ESLint misses (ambiguous constructors, useless spreads, identical ternary branches, etc.). Faster than ESLint but with overlapping coverage; run periodically rather than on every commit.

### Circular dependency check — `npm run lint:circular`

Madge-based detection of cyclic imports. Type-only cycles (`import type`) are acceptable; value cycles are not.

**When to run:** after large refactors that move shared code around. A new value-import cycle is almost always a sign that a module needs to be split.

### Doc images — `npm run generate:doc-images`

Regenerates illustrations for the architecture docs. Each image has a `-prompt.json` sidecar caching the prompt hash, so unchanged images skip regeneration.

**When to run:** after editing `docs/architecture/*.md` text that drives image prompts, or after editing `.mmd` Mermaid sources for diagrams. Full pipeline (Gemini + Mermaid restyle) is documented in `docs/architecture/CLAUDE.md`.

## Working with output

Most of these tasks produce artifacts that get committed (the doc graph, the prompt report, regenerated images) or status updated in place (knowledge-audit comments). When you run a task and the output diff is non-trivial:

1. **Triage first, fix second.** Skim the diff and categorize: intended changes (commit), unintended changes you can explain (decide), unintended changes you can't explain (investigate).
2. **Don't reflexively suppress noise.** When a periodic task starts producing diff noise that's hard to triage, that's a signal the task or its inputs need work — fix the upstream cause rather than tuning down the warning.
3. **Status notes are durable; reports are ephemeral.** Knowledge-audit reports live in a gitignored directory; the durable record is the YAML status comment. Same pattern applies if you add new audit-style tasks: prefer a small in-place note over a large report file nobody reads later.
