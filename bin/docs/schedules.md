# Scheduled work operations

Use `bbx-authoring-schedules` for authoring. This is the runtime contract.

## Store, cadence, and locking

One directory under `schedules/` defines each job. Runtime state lives beside
main in `<parent>/schedule-runs/` (override `BBX_SCHEDULES_ROOT`) and requires
its `.schedule-runs` marker. Never adopt an unmarked directory. All worktrees
share it, so history survives culls and remains outside git.

Per schedule, state tracks last run/outcome and persistent session ID; `runs/`
holds log, handoff, result, and exit records; `alerts/` holds messages. Updates
are read-modify-write under an atomic mkdir lock. Reclaim dead-PID locks and
locks from before boot or beyond maximum run age; PID reuse must not wedge work.

Launchd ticks every 15 minutes. Due-ness derives from `lastRunAt`, cadence, and
the overdue allowance, so sleeping machines catch up; never-run is due, not overdue. An acquired
tick immediately writes root `lastTickAt`/`lastTickExit`. A lock-skipped tick
records separate skip fields without refreshing `lastTickAt`, keeping a hung
child visible. `list`, workstream rows, and `bin/doctor.ts` surface heartbeat
and plist health. Tick exits nonzero only when it cannot write the store.

## Results and writer boundary

`alert` writes the durable record, then delivers by priority: `important`
pops up at once; `normal` and `fyi` wait for the daily digest. `--condition <c>`
names a standing condition: raising it again updates the open record (count,
last seen, latest words) instead of adding one. `resolve` closes conditions the
schedule says have cleared; a failing `run` is the `run-failed` condition the
next non-failing run resolves. Closed alerts record `closedBy` (person, digest,
or schedule), leave default views after 14 days, and remain stored. `done`
means successful completion with nothing to report. An agent run with neither
record is a bailed run and creates an important alert.

The digest runs in the tick before any schedule, at the first tick at or after
09:00 local, stamped in `<store>/digest.json` (not `state.json`, whose strict
schema older checkouts also read). It sends one popup counting every open
`important`, the `normal` alerts seen since the last digest, and each `fyi`
once; an `fyi` closes at the digest after the one that listed it. Popups and
the digest open `/workstreams/alerts`. The `alert-filing` schedule runs
`file-standing` daily: a non-`fyi` condition open for 7 days becomes an issue
in `private-issues/` (alert text names real boxes), the alert keeps its path,
and failures are recorded on the alert and retried for 7 days before the
digest reports them as unfiled. The tick runs `migrate-alerts` first, which
rewrites records from before conditions; any other reader fails on one and
names that command.

The CLI is the only writer. Apps invoke `ack`; run scripts use `handoff`,
`alert`, `resolve`, and `done`. Records are Zod-validated and atomically renamed.

## Headless sessions

`bin/lib/launch-headless.sh` is the sole argv builder. It uses normal create,
liveness, and launch-lease flow, runs without a tab, passes the briefing on
stdin, appends output to the run log, and kills at timeout.

The exact foreground runners are `claude -p` and `codex exec`.
`launch-headless.sh` is sourced by `launch-session.sh`; when executed directly
it prints the argv one element per line. Agent/model/default flag assembly stays
there rather than in individual schedules.

Codex cannot implement Claude's `tools`, `allowedTools`, `disallowedTools`,
`maxBudgetUsd`, or `effort`. A Codex schedule declaring one fails closed. Its
`prompt.md` leads the briefing rather than becoming an appended system prompt.
Worker prompts and `alert`/`done` reporting remain required.

## Validation

`bin/schedules lint [--json]` checks YAML/local schema, executable `run` and
`check` with shebangs, `SCHEDULE_DRY_RUN`, prompt reporting instructions,
shellcheck, and TypeScript lint. It is silent on success. Pre-commit invokes it
for staged schedule changes; ticks keep one important `invalid-schedule`
condition open per still-broken schedule and resolve it once it loads.

Root ESLint covers `schedules/**/*.ts` and `bin/**/*.ts`; these are outside the
workspace fan-out, so schedule lint and `pnpm lint:bin` cover them directly.

Background: `beebox/docs/implemented-plans/scheduled-workstreams.md`.
