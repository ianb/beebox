---
title: "Procedure migrations converge unattended"
status: implemented
workstream: box-maintenance-no-wedge
issues:
  - ../../../issues/closed/features/2026-09-11-local-boxes-never-converge-on-migrations.md
---
# Procedure migrations converge unattended

A procedure migration is applied by an agent, not a script. Today only a hand-run
`bbx engine migrate --apply` starts that agent, so every box waits for a person.
This plan makes the hourly convergence schedule run procedure migrations, bounds
a failed run to one durable question, and lets a deploy mark a box ready when a
procedure is still pending. It amends
[migration-reliability.md](../plans/migration-reliability.md), which chose to report
procedures as attention items in unattended mode.

**Issues addressed:**
`issues/features/2026-09-11-local-boxes-never-converge-on-migrations.md`. Its
open decisions (when a local pass runs, whether it applies, how a skip shows)
are settled by the hourly schedule from the parent plan plus this plan's
procedure handling; nothing in it remains manual.

## Smallest fix and budget

The smallest fix is one condition in `src/cli/commands/migrate.ts:148`: supply
the procedure runner for `--repair` as well as `--apply`. Alone it retries a
failed procedure's agent every hour forever, which the standing preference
"nothing retries forever" forbids, and it leaves a deploy reporting a pending
procedure as a closed box.

Chosen design, three tracks. Estimate 110 source lines, 90 test lines, plus this
plan and two doc amendments. Not a BIG CHANGE.

1. The hourly sweep runs procedures under the existing repair bound.
2. A deploy treats a pending procedure as ready with a warning.
3. Docs and the parent plan say so.

## Stated preferences this plan trades against

- The boxholder, 2026-09-17, on procedures being applied by hand: "well then
  they shouldn't do that! And... locally they should run migrations pretty
  regularly, like when a migration lands." Asked directly: unattended agent
  runs on production boxes are acceptable; a deploy with a pending procedure
  marks the box ready with a warning; a procedure holding the box exclusive for
  minutes is acceptable.
- `migration-reliability.md:311`: *"Manual mode may execute registered
  procedure migrations; unattended mode reports them as requiring attention."*
  Reversed. The `--repair` mode already spends an agent unattended on a failed
  script (`src/core/migration-repair.ts:78-86`); procedures join that mode.
- `migration-reliability.md:522-524`: the daily re-alert for continued pending
  work is kept. After this plan it fires only for a procedure whose question is
  unanswered.
- "Nothing retries forever": a failed procedure gets one question and no agent
  retry until it is answered, the same bound scripts already have.
- "Arrange context, don't automate judgment": the procedure itself remains an
  agent with a machine gate (`migrate.ts:83-91` refuses a gateless procedure).
  This plan schedules it; it does not replace its judgment.

## What already exists

- **Runner.** `runProcedure` (`src/cli/commands/migrate.ts:94-99`) delegates to
  `bbx procedure run` under the box work environment. `runSweep` supplies it
  only when `options.apply` (`migrate.ts:148`). Reuse; widen the condition.
- **Sweep application.** `applyMigration` (`src/core/migration-sweep.ts`) runs
  a procedure through the same snapshot, commit, and recovery ref as a script.
  It excludes procedures from repair (`!isProcedureMigration(migration)`), so a
  failure returns `failed` with no question. Reuse the surrounding flow; add the
  bound.
- **Bound.** `repairMigration` (`src/core/migration-repair.ts:53-104`) is the
  bound: an unanswered `Migration_<name>-N` question returns without an agent;
  a `refs/bbx/migrations/<name>/repair-started` receipt stops a second agent
  after a run that never finished; success clears the receipt; failure writes
  the next question. Refactor its skeleton into `runBoundedAttempt` so the
  procedure runner and the repair agent share it.
- **Deploy readiness.** `sweepMigrations` under `withinMaintenance` prepares
  the box only for `attention`, `applied`, `current`
  (`migration-sweep.ts:134-139`); `needs-procedure` calls `beginChanges()`.
  The doctest "A joined blocker revokes readiness and leaves deployment
  closed" (`test/core/migration-sweep.doctest.md:311`) asserts that. Change
  both for `needs-procedure`; keep `no-manifest` closed.
- **Schedule.** `schedules/box-convergence/run.ts` already runs
  `--sweep --repair --yield` hourly on local and production boxes. No change.
- **Local trigger.** Local boxes symlink the engine, so `bbx upgrade` never
  runs there (`src/cli/commands/upgrade.ts:288` is the other `--apply` caller).
  The hourly schedule on `main` is the trigger: a migration lands on `main` and
  the next run applies it. No new trigger.
- **Procedure output.** `runMigrationProcess` captures the procedure's output
  through `onOutput` (`migration-sweep.ts`, `run`), so the question can carry
  its tail.

## Prior art (external)

No design decision depends on an external premise. The bound is the repo's own
receipt-and-question pattern.

## Tracks / scope

### 1. The hourly sweep runs procedures under the repair bound

**What.** `--sweep --repair` supplies the procedure runner. A procedure runs
through `runBoundedAttempt`: an unanswered question for the migration returns
`failed` with that question and no run; a stale receipt writes a question
instead of running; otherwise the receipt is written, the procedure runs,
success clears the receipt, and a nonzero exit writes question
`Migration_<name>-<attempt>` with the output tail and the recovery ref.

**Why.** The boxholder rejected hand application. Without the bound an agent
would start every hour after a failure.

**Direction.**
- `migration-repair.ts`: extract
  `runBoundedAttempt(opts: { boxRoot; name; recoveryRef; failure; code; signal?; attempt: (answer: string) => Promise<{ code: number; reason: string; sessionId?: string }> })`
  returning `{ code, question?, sessionId? }`. `repairMigration` becomes a
  caller whose `attempt` invokes the repair agent then `retry()`. The question
  text and directive stay as they are for repairs; the procedure variant's
  directive says the answer authorizes one more procedure run.
- `migration-sweep.ts` `applyMigration`: for a procedure with `opts.repair`,
  `repaired = await runBoundedAttempt({ ..., attempt: async () => ({ code: await opts.runProcedure(...), reason: "The procedure exited nonzero; its output is above." }) })`.
  Without `opts.repair` (manual `--apply`) the direct run stays.
- `migrate.ts:148`: `options.apply || options.repair` supplies the runner. A
  new sweep option `unattended` (true unless `--apply`) selects the bound, so a
  person running `--apply` still gets the procedure run now, even over an
  unanswered question.
- `migrate.ts:176-179`: the `needs-procedure` message drops "not run
  unattended" and says the next `--repair` pass applies it.

**Vocabulary lock-ins.** None new. Question files and the receipt ref keep
their names.

**First implementation chunk.** The refactor, the sweep change, the CLI
condition, and a sweep doctest: a failing fake procedure yields `failed` with a
question; a second sweep runs no procedure while it is unanswered; answering it
and sweeping again runs the procedure once more.

### 2. A deploy marks a box ready when a procedure is pending

**What.** Under `withinMaintenance`, `needs-procedure` prepares the box like
`attention` does. `no-manifest` still keeps it closed.

**Why.** Boxholder decision 2. Serving with a pending migration is already the
steady state, and the hourly pass applies it within the hour.

**Direction.** Add `needs-procedure` to the ready set in `sweepMigrations`. The
CLI exit code stays 1 so the deploy log still prints the warning
(`deploy/deploy.sh:731`). Update the doctest at
`test/core/migration-sweep.doctest.md:334-342` to expect `ready`.

### 3. Docs

Amend `migration-reliability.md:311` and `:522-524`, `docs/migrations.md:40-41`
("`--sweep` permits only deterministic scripts unless `--repair` is explicit"
becomes accurate: `--repair` runs procedures too), and the deploy paragraph.

## Could this be simpler?

The simplest version is the one-line condition in `migrate.ts`. It fails on a
failing procedure: the agent runs every hour forever, per "nothing retries
forever". Reusing the receipt-and-question skeleton is the smallest bound that
exists; a counter or a time limit would be a second mechanism beside it.

Considered and dropped: running procedures inside the deploy. Boxholder
decision 2; it would put an agent inside the deploy window under the
controller's closure.

Considered and dropped: a local trigger on router start or on the registry
changing. The hourly schedule already runs on `main` against local boxes, which
is "when a migration lands" to within an hour.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Procedure exits nonzero | Planned sweep doctest | Question written; no rerun until answered; output under recovery ref | Schedule alert names the question |
| Procedure process is killed mid-run (timeout, laptop sleep) | Planned: receipt present, no question, next sweep | Receipt found, question written without a run, naming the unfinished attempt's snapshot from the receipt | Same alert |
| Procedure agent edits the manifest | Existing `verifyManifest` in `applyMigration` | Manifest restored; invariant | Loud |
| Procedure's commit fails | Existing `commit-failed` path; procedures already excluded from commit repair | Manifest and index restored; recovery ref | Reported |
| Box is in use when the hourly pass arrives | Existing yield deferral | Deferred; next hour | Quiet under a day |
| Deploy marks ready with a pending procedure and the hourly pass never gets to it (box always busy) | Existing daily deferral alert (`results.ts` `deferredDetail`) | Alert after a day of deferral | Clear |
| Question answered, procedure fails again | Planned doctest step | Attempt N+1 question; the chain is bounded by the boxholder answering | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** the question card uses the existing migration
  question shape. ADDRESSED.
- **Stale ref:** the question names the recovery ref of the failed attempt;
  refs are retained. ADDRESSED.
- **Two agents touching the same card:** the procedure runs under the box's
  exclusive closure; chat is paused. ADDRESSED by the existing gate.
- **Hand-edit drift:** a boxholder deleting the question card re-enables one
  run; the receipt still blocks a second. ADDRESSED.
- **Fabricated free-form value:** the machine gate (`validate.shells`,
  `severity: abort`) decides success, not agent prose. ADDRESSED.
- **Validation error UX:** the question prompt carries the output tail. ADDRESSED.
- **Partial migration / transition state:** none; no data shape changes.

## NOT in scope

- Running procedures inside the deploy (decision 2).
- A local trigger other than the hourly schedule.
- Passing an answered question's text into the procedure agent. The repair
  agent gets it; the procedure has its own steps. Revisit if a real answer
  needs to reach a procedure.
- Serve-time checks for pending migrations.
- Changing the schedule's time budgets. A procedure fits the existing
  15-minute execution limit or fails into a question.

## Open design questions

None inside the chunks.

## Knowledge audits

Skipped: infrastructural. Box agents see only the existing question card.

## What will hold this after it ships

`test/core/migration-sweep.doctest.md`: a fake `runProcedure` that fails, the
question chain, the receipt path, and the deploy readiness change. All in the
existing doctest file with real Git fixtures.

## Implementation order

1. Track 1 refactor and sweep change with doctests.
2. Track 2 readiness change and doctest update.
3. Track 3 docs.
4. Cross-model review of the diff.

## Rollout shape

Done when the sweep doctests pass with typecheck and lint. After landing, the
next hourly run on `main` applies `trick-secret-runtime` on the four local
boxes. Production converges on its next hourly run after the deploy; no
maintenance is run against production from this workstream.
