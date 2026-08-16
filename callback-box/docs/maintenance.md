# Code Maintenance

Tasks that run periodically rather than continuously — audits, reports, and sweeps that catch drift, dead code, and knowledge gaps. These are deliberately *not* part of the per-commit gate (typecheck and lint already cover that). Run them on a cadence that fits the kind of change you're tracking.

## Why we do this

The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt-builder code, connector rules, procedure templates. Ordinary code changes can quietly invalidate that surface — a refactor renames a method, a schema gains a field, a doc moves — and nothing in the type system or test suite catches it. The audits and reports below exist to keep that surface honest, with humans deciding what's intentional drift vs. regression.

A second category catches the kind of code-health issues that pile up if nobody looks: dead exports, circular dependencies, unused dependencies. These compile and pass tests today, but they make refactors more expensive over time.

## At a glance

| Task | Command | Cadence | Output |
|------|---------|---------|--------|
| Agent SDK release monitor | `bin/update-agent-sdk-scheduled.sh` | Automated (launchd, daily) | Filtered release ledger in root `docs/agent-sdk-notes.md` |
| Agent SDK update | `pnpm update-agent-sdk` (monorepo root) | Automated after the settling window; manual anytime | Bumped `package.json` + lockfile |
| Docling currency watch | `pnpm check-docling-update` (monorepo root) | Automated (rides the SDK-update launchd job); manual anytime | Console (silent when nothing to report) |
| Manual test suite | `bin/manual-tests-scheduled.sh` | Automated (launchd, weekly) | `logs/manual-tests/latest.log`; local issue + notification on failure |
| Knowledge audits | `pnpm knowledge-audit` | After prompt/schema/CLAUDE.md changes; monthly otherwise | Status comments in `knowledge-audits.yaml` |
| Prompt report | `pnpm prompt-report` | After prompt or schema-instruction changes | `docs/prompts.md` |
| Prompt viewer | `pnpm prompt-viewer` | After prompt or schema-instruction changes | `dev/prompts/data.json` + size ledger (browse at `/<worktree>/dev/prompts/`) |
| Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
| Dead-code sweep | `pnpm lint:knip` | Before releases; when code feels accumulated | Console |
| Supplemental lint | `pnpm lint:oxlint` | Periodic | Console |
| Circular deps | `pnpm lint:circular` | After big refactors | Console |
| Security regression scan | `pnpm security:opengrep` (monorepo root) | Before releases; when touching auth/subprocess/temp/prompt boundaries | Console (`--sarif` for a file) |
| Doc images | `pnpm generate:doc-images` | After editing architecture diagrams or prompts | `docs/architecture/images/` |
| Box data migrations | `cb migrate` (per box) | After adding a new migrator to `src/core/migrations.ts` | Box working tree |
| Broken-ref cleanup | `npx tsx scripts/clean-broken-refs.ts <boxRoot>` | One-off; when `cb validate` shows ref errors that pre-date a migration | Box working tree |
| Security report | `/security-report` (skill) | At release boundaries; when the staleness diff (`git diff <generated-at-rev>..HEAD` over the surface map) is non-empty | Draft `SECURITY.md` + `docs/security-report.md` for boxholder review |
| Mobile parity audit | agent procedure (prompt in `docs/implemented-plans/mobile-parity-sync.md` §6) | After a burst of mobile work; quarterly otherwise | Issues filed for contract/matrix drift |

## Tasks

### Agent SDK release monitor

`bin/update-agent-sdk-scheduled.sh --install` (from the **main checkout**, once
per machine) registers a daily launchd job. The job resumes one persistent Opus
session. That session reads each new SDK release, checks it against callback-box's
current SDK imports and runtime behavior, and prepends the result to the root
[`agent-sdk-notes.md`](../../docs/agent-sdk-notes.md). Applied entries stay in the ledger
as evidence for regression diagnosis and future opportunities. The current pin
marks entries as applied or pending.

The monitor includes releases younger than the normal two-day settling window.
It marks callback-box-relevant security, memory, and correctness fixes as
act-now and applies them immediately. Routine stable releases are automatically
bumped after settling for two days. Successful bumps and failures notify the
boxholder on the laptop; uneventful ledger-only checks stay silent. Logs are in
`~/Library/Logs/callback-box-sdk-update.log`.

### Agent SDK update — `pnpm update-agent-sdk` (monorepo root)

Bumps the exact pin of `@anthropic-ai/claude-agent-sdk` to the newest npm
release at least **2 days** old, installs, and typechecks. The SDK bundles the
Claude Code binary every box agent runs (it ignores any system `claude`),
frozen at install time. The SDK rides a faster lane than every other
dependency: the root `.npmrc` excludes the SDK family from the global 7-day
`minimum-release-age` gate, and the script enforces its own 2-day gate — which
is why the pin must stay exact (a caret plus the exclusion would resolve to
minutes-old releases; and historically a `^0.x` caret also silently stopped
crossing 0.x minors, which once left us on a two-month-old agent binary).

**When to run:** automated by the monitor after the settling window, or
immediately when the monitor finds a callback-box-relevant security, memory, or
correctness fix. Manual runs (`--check` to report the newest release that has
cleared the settling window, exiting 1 when the installed version is behind)
work anytime.

**After a bump:** run `pnpm -C callback-box test`, then the steering probe —
`node --import tsx callback-box/scripts/sdk-steering-probe.ts` (real API calls,
~1 min) — which verifies the undocumented mid-turn input semantics the chat
session depends on still hold. Then commit; prod picks the new version up on
the next `main` deploy.

### Docling currency watch — `pnpm check-docling-update` (monorepo root)

Compares the pinned Docling release — `DOCLING_VERSION` in
`src/services/docling-version.ts`, the one place it lives, read by the extractor,
`deploy/setup-server.sh`, and this check — against PyPI. It prints a line only
when the newest release is **both** above the pin and more than **14 days** old;
otherwise it says nothing and exits 0. The settling window keeps us off day-one
releases: Docling ships often, and a regression in a document extractor lands in
stored card content where it is expensive to notice.

**When to run:** automated — the check is appended to
`bin/update-agent-sdk-scheduled.sh`, so it rides that job's daily cadence and
writes into the same log (`~/Library/Logs/callback-box-sdk-update.log`). Manual
runs work anytime.

**It never updates anything, deliberately.** A Docling bump is judgment work:
re-read `docling convert --help` for flag changes (the CLI has moved flags
between releases), bump the constant, then `cb document reanalyze` a sample
document and diff the output. See
`docs/plans/scanner-ingest-docling-decisions.md` (D3).

### Manual test suite — `pnpm --dir callback-box test:manual`

Runs the small explicit allowlist of executable tests that are unsuitable for
every `pnpm test` invocation. The current set includes a real Claude SDK/API
check and a filesystem deadline check with a fixed wall-clock delay. Human-only
`.manual.md` checklists are not part of this command. The weekly runner first
executes its own fake-command integration check; that check is also excluded
from every default suite.

`bin/manual-tests-scheduled.sh --install`, run once from the main checkout,
registers the Sunday 11:17 local-time launchd job. Each run records its exact
Git commit and branch in a separate gitignored file under
`logs/manual-tests/`; `latest.log` points to the newest run. A constrained
Sonnet agent reviews every result. It reads the log and source, diagnoses
failures, and creates or appends to the best matching open issue. A clean run
normally changes nothing, but the agent can append recovery evidence to a
relevant open issue. The agent can only edit open `issues/` Markdown files: it
cannot run commands, edit code, commit, push, fix defects, close issues, or read
private issue data. Private-issue tool paths are denied as an additional guard.
Its changes remain uncommitted for human review. Before triage, the runner saves
a local snapshot of every open issue. An existing issue passes validation only
when the agent appended to its exact prior contents; the snapshot is also the
recovery copy if validation fails. Every scheduled run makes one Sonnet triage
call with a $2 maximum budget, in addition to any API use inside the manual
tests themselves. Failures and issue changes raise a macOS notification that
points to the agent-selected issue and exact run log.
Enrollment is explicit: adding a file under `test/manual/` does not schedule it
until its path is added to the `test:manual` package script.

### Knowledge audits — `npm run knowledge-audit`

Runs YAML-defined tests against a real box agent, checking responses and tool use against expected behavior. The primary mechanism for catching agent-knowledge drift as the system evolves.

**Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).

**When to run:** after touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know. Also on a periodic cadence (monthly is probably enough) to catch slow drift.

### Security report — `/security-report` (skill)

Regenerates the two committed security artifacts: `docs/security-report.md`
(the structured, per-item accounting) and `SECURITY.md` (the readable
synthesis). The skill body is the committed rubric — an ordered inventory
+ evaluation process — so a regeneration is auditable as a process. It
**drafts** for boxholder review and never auto-commits: the provenance
header carries `reviewed-by`, which stays `DRAFT — unreviewed` until a
human signs off.

**When to run:** at any release boundary, and whenever the staleness diff
is non-empty — `git diff <generated-at-rev>..HEAD` scoped to the rubric's
surface map shows whether security surfaces changed since the last report.
Like knowledge audits, treat it as slow-drift maintenance rather than a
per-commit gate. Exploitable, location-precise findings go to
`private-issues/security/`, not the public queue (the rubric's disclosure
rule).

### Prompt report — `npm run prompt-report`

Walks the codebase collecting every prompt, instruction, and rule (system prompts, schema instructions, connector rules, procedure templates, etc.) and writes them into `docs/prompts.md`. Useful for spotting redundancies, contradictions, and prompts that have drifted apart.

**When to run:** after meaningful changes to prompt logic or schema instructions. Periodically to catch drift across the prompt surface.

**Output:** `docs/prompts.md` (committed). Review the diff to see what changed.

### Prompt viewer — `npm run prompt-viewer`

The browsable counterpart to the prompt report. Collects the same static inventory (shared `src/dev/lib/prompt-inventory.ts`) plus the fully assembled chat / chat-thread / reactor contexts for a box, runs a simple duplication scan, and writes `dev/prompts/data.json` (gitignored) for the hand-written `dev/prompts/index.html` page. Every fragment gets a stable kebab-case name so a reviewer can cite prompts precisely. It also appends one line to the tracked `dev/prompts/size-ledger.jsonl` (skipped when the numbers are unchanged) to chart prompt size over time. Browse at `/<worktree>/dev/prompts/`.

**When to run:** after prompt or schema-instruction changes; `--box <path>` targets a specific box, `--no-ledger` skips the ledger append (for one-off experiments against other boxes).

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

### Security regression scan — `pnpm security:opengrep` (monorepo root)

Runs the [OpenGrep](https://opengrep.dev) rulepack at `security/opengrep/precise.yml` — self-incident security-regression guards, one per real past security/isolation bug in our own code. A *separate* engine from ESLint: it matches multi-statement dataflow shapes (`resolve → guard → return`) that per-node lint selectors can't, so it complements the lint gate rather than duplicating it. See `security/opengrep/README.md` for the discipline and how to add a rule.

**When to run:** before releases, and whenever you touch a security-sensitive boundary (auth/allowlists, subprocess spawning, temp-file/symlink handling, prompt construction with untrusted content). `pnpm security:opengrep --error` gates non-zero on findings; `--changed` scopes to files changed vs `origin/main`; `--sarif` writes `.opengrep-out/precise.sarif`. Requires `opengrep` installed (`curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/v1.25.0/install.sh | bash -s -- -v v1.25.0`). Not part of the per-commit gate by decision — see `issues/exploration/2026-07-25-opengrep-self-cve-scanner.md`.

### Doc images — `npm run generate:doc-images`

Regenerates illustrations for the architecture docs. Each image has a `-prompt.json` sidecar caching the prompt hash, so unchanged images skip regeneration.

**When to run:** after editing `docs/architecture/*.md` text that drives image prompts, or after editing `.mmd` Mermaid sources for diagrams. Full pipeline (Gemini + Mermaid restyle) is documented in `docs/architecture/CLAUDE.md`.

## Working with output

Most of these tasks produce artifacts that get committed (the doc graph, the prompt report, regenerated images) or status updated in place (knowledge-audit comments). When you run a task and the output diff is non-trivial:

1. **Triage first, fix second.** Skim the diff and categorize: intended changes (commit), unintended changes you can explain (decide), unintended changes you can't explain (investigate).
2. **Don't reflexively suppress noise.** When a periodic task starts producing diff noise that's hard to triage, that's a signal the task or its inputs need work — fix the upstream cause rather than tuning down the warning.
3. **Status notes are durable; reports are ephemeral.** Knowledge-audit reports live in a gitignored directory; the durable record is the YAML status comment. Same pattern applies if you add new audit-style tasks: prefer a small in-place note over a large report file nobody reads later.
