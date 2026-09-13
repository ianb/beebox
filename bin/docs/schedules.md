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

`alert` writes the durable record before best-effort macOS notification.
Priorities are `important|normal|backlog|fyi`. Acknowledged alerts leave default
views after 14 days but remain stored. `done` means successful completion with
nothing to report. An agent run with neither record is a bailed run and creates
an important alert.

The CLI is the only writer. Apps invoke `ack`; run scripts use `handoff`,
`alert`, and `done`. Records are Zod-validated and atomically renamed.

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
for staged schedule changes; ticks create one latched important alert per
still-broken schedule.

Root ESLint covers `schedules/**/*.ts` and `bin/**/*.ts`; these are outside the
workspace fan-out, so schedule lint and `pnpm lint:bin` cover them directly.

Background: `beebox/docs/implemented-plans/scheduled-workstreams.md`.
