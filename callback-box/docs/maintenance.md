# Code Maintenance

Tasks that run periodically rather than continuously — audits, reports, and
sweeps that catch drift, dead code, and knowledge gaps. They are deliberately
*not* part of the per-commit gate (typecheck and lint already cover that).

The system carries a lot of agent-facing surface: CLAUDE.md and rule files,
schemas with embedded `instructions`, prompt-builder code, connector rules,
procedure templates. Ordinary code changes can quietly invalidate that surface —
a refactor renames a method, a schema gains a field, a doc moves — and nothing in
the type system or test suite catches it. A second category catches the
code-health issues that pile up if nobody looks: dead exports, circular
dependencies, unused dependencies.

## What runs on its own: schedules

A **schedule** is one directory, `schedules/<name>/` at the monorepo root: a
`schedule.yaml` (cadence, and the agent to start if there is work), an executable
`run` script, a `prompt.md` when the schedule can start a workstream, and an
optional `check`. One launchd tick drives all of them, due-ness is computed from
persisted state (so a laptop that slept catches up once rather than piling up),
and each run's report is a durable alert record rather than a notification nobody
can read back.

**`bin/schedules list` is the catalog.** It is the answer to "what is scheduled,
when did it last run, and is anything overdue" — this document does not keep a
second copy of it. `bin/schedules logs <name>` reads a run's output;
`bin/schedules install` registers the tick, once per machine, from the main
checkout.

The four enrolled today are the SDK release monitor, the Docling currency watch,
the weekly manual test suite, and the weekly knip sweep.

**Writing one:** the `cb-authoring-schedules` skill — when a task should be a
schedule at all, what a `run` script owes (exit 0 in silence, hand off only when
there is work, keep its own baseline so "new since last time" is real), what
belongs in `prompt.md`, and how to rehearse with `bin/schedules run <name>
--dry-run`. Design: `docs/plans/scheduled-workstreams.md`.

## Not yet enrolled

Periodic tasks that still wait for someone to remember them. Each needs its own
`run` design before it can become a schedule
(`issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md`).

| Task | Command | Cadence it wants |
|------|---------|------------------|
| Knowledge audits | `pnpm knowledge-audit` | After prompt/schema/CLAUDE.md changes; monthly otherwise. Guide: `docs/knowledge-audits.md` |
| Security overview regeneration | `/security-report` (skill) | At release boundaries, and when the staleness diff over the surface map is non-empty |
| Doc / prompt refresh | `pnpm prompt-report`, `pnpm prompt-viewer`, `pnpm doc-graph` | The standing tension in `issues/docs-and-chores/2026-07-04-doc-refresh-cadence.md` |
| Feedback collection | `feedback-review/collect.ts` | `issues/docs-and-chores/2026-07-14-feedback-collection-cadence.md` — items rot before review |
| CSP violation review | runbook: `docs/scheduled/csp-violation-review.md` | An agent analyzes new violations and *proposes* the harden flip; a human flips it |

## Run when you touch the thing

Not cadence tasks — tools you run because of a change you just made.

| Task | Command | When |
|------|---------|------|
| Agent SDK update | `pnpm update-agent-sdk` (monorepo root) | Anytime; the `sdk-update` schedule does it automatically after the settling window |
| Dead-code sweep | `pnpm lint:knip` (monorepo root) | Before a release, or when code feels accumulated. Triage each finding: real dead code → delete; legitimate entry point → register it in `knip.ts` with a comment naming who reaches it |
| Supplemental lint | `pnpm lint:oxlint` | Weekly through `schedules/supplemental-lint`; also after broad lint-sensitive changes. Catches what ESLint misses (ambiguous constructors, useless spreads, identical ternary branches) |
| Circular deps | `pnpm lint:circular` | Weekly through `schedules/supplemental-lint`; also after big refactors. Type-only cycles are fine; a new *value* cycle means a module needs splitting |
| Security regression scan | `pnpm security:opengrep` (monorepo root) | Before releases, and when touching auth/subprocess/temp-file/prompt boundaries. Discipline and how to add a rule: `security/opengrep/README.md` |
| Doc images | `pnpm generate:doc-images` | After editing architecture-diagram text or `.mmd` sources. Pipeline: `docs/architecture/CLAUDE.md` |
| Box data migrations | `cb migrate` (per box) | After adding a migrator to `src/core/migrations.ts`. Author guide and rollout history: `docs/migrations.md` |
| Broken-ref cleanup | `npx tsx scripts/clean-broken-refs.ts <boxRoot>` | One-off, when `cb validate` shows ref errors that pre-date a migration. Dry-run by default; `--apply` to write |
| Mobile parity audit | agent procedure (`docs/implemented-plans/mobile-parity-sync.md` §6) | After a burst of mobile work; quarterly otherwise |

## Working with output

Most of these produce artifacts that get committed (the doc graph, the prompt
report, regenerated images) or status updated in place (knowledge-audit
comments). When the output diff is non-trivial:

1. **Triage first, fix second.** Skim the diff and categorize: intended changes
   (commit), unintended changes you can explain (decide), unintended changes you
   can't explain (investigate).
2. **Don't reflexively suppress noise.** When a periodic task starts producing
   diff noise that's hard to triage, that's a signal the task or its inputs need
   work — fix the upstream cause rather than tuning down the warning.
3. **Status notes are durable; reports are ephemeral.** Knowledge-audit reports
   live in a gitignored directory; the durable record is the YAML status comment.
   Prefer a small in-place note over a large report file nobody reads later.
