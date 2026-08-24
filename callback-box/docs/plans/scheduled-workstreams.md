---
title: "Scheduled workstreams: one scheduler, a run script as the head, alerts as durable records"
status: draft
workstream: scheduled-task-voice
issues:
  - ../../../issues/features/2026-08-12-monitor-message-queue.md
  - ../../../issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md
---

# Scheduled workstreams

Recurring jobs in this repo (SDK release monitor, weekly manual tests, the
knip sweep, Docling currency) each hand-roll a launchd plist, a log location,
and a way to tell the developer something. This plan replaces that with one
`schedules/` directory, one `bin/schedules` CLI and one launchd tick, an alert
record store outside git, a "Scheduled" section in the workstream browser, and
an authoring skill. A schedule's head is a plain script; a workstream (with an
agent) starts only when the script says there is work or when it fails.

## Job to be done

- When a weekly knip sweep finds twelve new unused exports, I want to learn
  that once, in a place I check anyway, with the list attached, so I can
  resume the `knip-exports` workstream and have the agent remove them.
- When the SDK monitor sees a release that changes hook semantics, I want an
  issue filed and a short alert, so the change is a known event and not a
  mystery when a worker session breaks days later.
- When a scheduled job silently stops running (laptop asleep for a week, the
  agent bailed, the plist was never reinstalled), I want the browser to say
  "overdue" without any job having to report its own death.
- When I add a new periodic task, I want to write one directory and run one
  command, so enrolling a task is cheaper than remembering to do it by hand.
- When the laptop was asleep at the scheduled time, I want the job to run at
  the next wake, once, and not pile up.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md:37` — *3. Validate at
  boundaries and during parsing*; `:44` *"Config is untrusted content too."*
  Every `schedule.yaml`, state file, and alert record is Zod-parsed.
- `:49` — *4. Resilient AND never silent*. The whole plan exists because
  four jobs were resilient and silent.
- `:75` — *6. Right-sized defensiveness*. Locks and overdue detection exist
  for failures that happened; no handling for states the types exclude.
- `:87` — *7. Hierarchy is a discoverability contract*. `schedules/<name>/`
  is where a schedule lives; `bin/schedules` is the only CLI.
- `:95` — *8. One way to do each thing*. One tick, one alert command, one
  log root; the four bespoke `notify()` copies go away.
- `:141` — *12. The maintainer is usually an agent*. Scripts, YAML, and a
  skill — no harness-specific mechanism; Codex-launched schedules work.
- `callback-box/code-style.md:42` — *"console.log — CLI user-facing output
  ONLY"*; `:88-89` no default parameters, max 2 positional params.
- `callback-box/CLAUDE.md:107` — *"Don't guess file formats … Read the
  schema, read the existing code."*
- Root `CLAUDE.md`: no `.js`; TypeScript for logic; treat noisy output as a
  bug; never weaken a lint rule.
- Shipped precedents, denser than docs: the exhibits store
  (`bin/lib/exhibits-store.sh`, store-beside-checkout with a marker file),
  the comments CLI (`bin/comments.ts`, "the CLI is the only writer"), and
  the session registry (`bin/lib/session-registry.sh`).
- Boxholder decisions from the 2026-08-24 design discussion, recorded here
  because they are not derivable from code: scheduled workstreams are sticky
  (never removed) and shown in their own browser section; exhibits are not
  the message channel; the run script is the head and may exit clean without
  any agent; logs live outside git; the alert command is schedule-specific
  (`bin/schedules alert`), not a generic `bin/alert`; priorities reuse the
  issue vocabulary plus `fyi`; a per-schedule "did it work" check is
  optional; `--dry-run` is a convention worth keeping; the skill is
  `cb-authoring-schedules`.

## What already exists

Reused:

- **Store-beside-checkout convention.** `bin/lib/worktree-paths.sh:72`
  `WT_PARENT=$(dirname "$WT_MONO")`; `:76`
  `WT_EXHIBITS_ROOT="${CALLBACK_EXHIBITS_ROOT:-$WT_PARENT/workstream-exhibits}"`;
  `:82` the same shape for comments. This plan adds
  `WT_SCHEDULES_ROOT="${CALLBACK_SCHEDULES_ROOT:-$WT_PARENT/schedule-runs}"`
  with the same marker-file discipline (`bin/lib/exhibits-store.sh:15-38`).
- **Registry records without a worktree.** `bin/workstreams:668-712` renders
  registry entries whose directory is absent (`path:null`,
  `runtime:{state:"absent"}`); `bin/workstreams:447-459` `resume` recreates a
  worktree from such a record. A scheduled workstream is a record with one
  more field; resume needs no new path.
- **Record writes.** `bin/lib/session-registry.sh:250`
  `session_registry_merge()`, `:254` `session_registry_begin_launch()`.
- **Routing derivation.** `bin/lib/workstream-routing.sh:21`
  `workstream_routing_json(exists, agent_state, record, tip_epoch, dir_epoch,
  now_epoch)` — one new branch for `scheduled` records.
- **Browser sections.** `workstreams-app/src/frontend/pages/WorkstreamsPage.tsx:71`
  `SECTION_ORDER` and `:20-31` `workstreamStateFor`; row schema
  `workstreams-app/src/shared/workstreams.ts:47-71`. The app is fully
  downstream of `bin/workstreams list --json`
  (`workstreams-app/src/server/workstreams-command.ts:72`), so a new row field
  flows through one schema change.
- **Headless session launch.** `bin/update-agent-sdk-scheduled.sh:113-128`:
  `claude -p --brief --name … --model opus --permission-mode
  bypassPermissions` with `--session-id`/`--resume`. The runner reuses this
  invocation shape.
- **Idempotent worktree creation.** `bin/workstreams create <name>`
  (`bin/workstreams:173-192`, "Idempotent").
- **Liveness guard.** `bin/lib/worktree-teardown.sh:94` `wt_other_agent_live`
  — the runner must not start a session in a workstream whose agent is live.
- **YAML parsed by Zod.** `callback-box/src/dev/knowledge-audits.yaml` and
  its loader are the precedent for `schedule.yaml`.
- **The constrained triager.** `bin/manual-tests-scheduled.sh` — the
  Sonnet agent with `--tools Read Grep Glob Edit Write` and
  `--allowedTools Edit(issues/<cat>/**)`; its prompt becomes
  `schedules/manual-tests/prompt.md`.
- **Test runner for `bin/`.** `package.json:23` `"test": "node --import tsx
  --test bin/*.test.ts"`.
- **`--dry-run` spelling.** `callback-box/src/cli/commands/relink.ts:41-47`;
  no `--dry` short form exists anywhere — this plan uses `--dry-run`.

Rebuilt (and why):

- The two `install_job()` functions (`bin/update-agent-sdk-scheduled.sh:50-79`,
  `bin/manual-tests-scheduled.sh:141-173`) and their plists. Replaced by one
  `bin/schedules install` and one plist, per principle 8.
- The three local `notify()` copies (`deploy.sh:55-58`,
  `manual-tests-scheduled.sh:~30-36`, `update-agent-sdk-scheduled.sh:36`) and
  the agent-side `PushNotification` calls. Replaced by `bin/schedules alert`
  writing a record, with the macOS notification as one delivery of that
  record.
- `logs/manual-tests/` inside the checkout
  (`bin/manual-tests-scheduled.sh:14-27`). Moved to the store; the boxholder
  asked for logs outside git.

Not reused: the box scheduler (`callback-box/src/core/schedule/scheduler.ts`)
and its health alerts (`core/schedule/health-alert.ts`). That is a per-box,
prod-facing mechanism for card-defined tasks. This plan is the dev-repo,
laptop-local layer; the box scheduler is a *candidate schedule* (a `run`
script that checks box health) but not a substrate.

## Prior art (external)

- **Missed-run semantics on macOS.** `StartCalendarInterval` jobs missed
  during sleep fire once on wake (coalesced); jobs missed while powered off
  do not fire. `StartInterval` firings during sleep are simply missed
  ([launchd.plist(5)](https://leancrew.com/all-this/man/man5/launchd.plist.html),
  [Apple forums thread](https://developer.apple.com/forums/thread/815034)).
  Consequence: the runner, not launchd, computes due-ness — one
  `StartInterval` tick and a persisted `lastRunAt` per schedule.
- **anacron** — the model for the above: elapsed-time-since-last-run with
  timestamp files, so a machine that is not always on catches up on boot
  ([anacron guide](https://oneuptime.com/blog/post/2026-03-02-how-to-use-anacron-for-scheduling-on-systems-that-are-not-always-on/view)).
  **systemd timers `Persistent=true`** is the same semantics
  ([Fedora Magazine](https://fedoramagazine.org/systemd-timers-for-scheduling-tasks/)).
- **Directory-per-job**: cron.d/run-parts (executables, no catch-up), Airflow
  `dags/` (per-DAG `catchup`), GitHub Actions `.github/workflows/` (no
  catch-up; per-workflow `concurrency:` groups). This plan takes
  directory-per-job from run-parts, catch-up from anacron, and per-job
  concurrency from Actions.
- **Single-instance locking on macOS** (no `flock`): `mkdir` as the atomic
  primitive, PID inside, stale-check by PID liveness
  ([reference](https://rednafi.com/misc/run-single-instance/)). Node
  implementation: `fs.mkdirSync` with `EEXIST` handling.
- **Linting.** yamllint has no schema validation
  ([issue #37](https://github.com/adrienverge/yamllint/issues/37)); parse +
  Zod is the standard path. shellcheck is pinnable via the
  [`shellcheck` npm package](https://www.npmjs.com/package/shellcheck).
- **Agent schedulers and alerting.** Codex scheduled tasks do not notify on
  failure; the documented workaround is "post an issue on failure" — a durable
  record, which is this plan's alert
  ([guide](https://prompts.ninja/guides/openai-codex-scheduled-tasks-setup-guide/)).
  Claude Code Routines are cloud-hosted and not applicable to laptop-local
  jobs that need the checkout
  ([docs](https://code.claude.com/docs/en/scheduled-tasks)). No named pattern
  for "agent scheduler with a durable alert store" was found.

## Vocabulary lock-ins

- **Schedule** — one directory `schedules/<name>/`. `<name>` is also the
  workstream name and the registry key.
- **Run** — one execution of a schedule's `run` script. Identified by a
  run id `<YYYYMMDD-HHMMSS>`.
- **Handoff** — a Markdown file `run` writes to `$SCHEDULE_HANDOFF` to say
  "start the workstream with this briefing". Absent handoff + exit 0 = nothing
  to do.
- **Scheduled workstream** — a registry record with `scheduled: true`. Sticky:
  `remove`/`sweep` cull its worktree, never its record. Routing state
  `scheduled`.
- **Alert** — a record written by `bin/schedules alert`: workstream, title,
  message (one short paragraph), details (Markdown, optional), priority.
  States `open` → `acknowledged`.
- **Priority** — `important | normal | backlog | fyi`. The first three match
  `issues/CLAUDE.md` `priority:`; `fyi` means "something new, nothing to do".
- **Overdue** — derived: `now - lastRunAt > cadence + grace`. Never stored.
- **Tick** — the one launchd job: `bin/schedules tick`, every 15 minutes.

## Tracks / scope

Ordered by dependency, then size.

### Track A — The schedule directory and its schema

**What.** `schedules/<name>/` at the monorepo root, tracked in git:

```
schedules/<name>/
  schedule.yaml     # required
  run               # required, executable
  prompt.md         # required when the schedule can start a workstream
  check             # optional, executable
```

`schedule.yaml`:

```yaml
description: "Weekly dead-export sweep"        # required, one line
cadence: 7d                                     # required: <n>h | <n>d | <n>w
grace: 1d                                       # optional; default 25% of cadence
enabled: true                                   # optional; default true
workstream:                                     # optional; absent = run-only schedule
  agent: claude                                 # claude | codex
  model: opus                                   # passed through to the agent CLI
  worktree: true                                # false = session runs in the main checkout
```

**Why this needs to change.** Today the catalog (`docs/maintenance.md`
"At a glance" table) is hand-maintained prose and the two runnable jobs each
embed their own cadence in a plist. Nothing lists what is scheduled.

**Direction.** A Zod schema `scheduleYamlSchema` in `bin/lib/schedules.ts`
(new). `cadence` parses to milliseconds; `grace` defaults are computed in the
body, not as parameter defaults (`code-style.md:88`). `workstream.worktree:
false` exists for schedules that must run in the main checkout and push
(the SDK updater). Environment for `run` and `check`, set by the runner:
`SCHEDULE_NAME`, `SCHEDULE_DIR`, `SCHEDULE_RUN_ID`, `SCHEDULE_STATE_DIR`
(the schedule's store dir), `SCHEDULE_HANDOFF` (a path; the file does not
exist until `run` creates it), `SCHEDULE_DRY_RUN=1` when dry-running.

Per-machine enablement: `enabled` is tracked; a gitignored
`schedules/<name>/local.yaml` (same schema, partial) overrides it, so a
laptop can disable a schedule without a commit. Both files are parsed with
the same Zod schema (`.partial()` for local).

**First implementation chunk.** `bin/lib/schedules.ts`: the schema, cadence
parser, directory loader (`loadSchedules(root)` → discriminated result per
directory: `ok | invalid` with the Zod issues), and `bin/schedules.test.ts`
covering cadence parsing, missing `run`, non-executable `run`, missing
`prompt.md` when `workstream` is set, `local.yaml` override.

### Track B — The store and the runner (`bin/schedules tick`, `run`)

**What.** `<parent>/schedule-runs/<name>/`:

```
state.json                 # { lastRunAt, lastRunId, lastExit, lastOutcome }
runs/<run-id>.log          # stdout+stderr of run (and check, and the session)
runs/<run-id>.handoff.md   # copy of the handoff, if any
alerts/<alert-id>.json     # Track C
lock/                      # mkdir lock while a run or session is in flight
```

`bin/schedules` is a shim (`exec node --import tsx bin/schedules.ts`, the
`bin/comments` shape). Verbs: `list [--json]`, `tick`, `run <name>
[--dry-run] [--force]`, `logs <name> [--run <id>]`, `alert …` (Track C),
`ack <alert-id>`, `lint`, `install | uninstall`.

**Why this needs to change.** Missed-run and catch-up semantics are
launchd's and undocumented; the deploy trap never fired
(`deploy.sh:741-748`); `demo-daily-rumination` ran broken for six weeks.
Due-ness must be computed from persisted state by code that is itself
observable.

**Direction.**

- `tick`: load schedules; for each enabled one with `now - lastRunAt >=
  cadence` (or never run), call the same path as `run <name>`. Skips a
  schedule whose lock is held (logged, not alerted — the *next* tick's
  overdue derivation is the signal). One tick lock too, so two ticks never
  overlap.
- `run <name>`: take the lock; execute `run` with the env above, streaming
  to `runs/<id>.log`; on exit:
  - `0`, no handoff → `lastOutcome: "clean"`.
  - `0`, handoff present → `lastOutcome: "handoff"`; start the workstream
    (below) with the handoff as briefing.
  - non-zero → `lastOutcome: "failed"`; write an `important` alert with the
    last 40 log lines as details; if the schedule has a `workstream`, start
    it with the log tail as briefing.
  - `--dry-run`: execute `run` with `SCHEDULE_DRY_RUN=1`, print the
    would-be outcome and the handoff to stdout, write nothing to state.
    `run` scripts must honor the variable (the skill and `lint` say so:
    the lint greps for `SCHEDULE_DRY_RUN`).
  - `--force`: ignore due-ness.
- Starting a workstream: `bin/workstreams create <name>` (idempotent) unless
  `worktree: false`; write/merge the registry record with `scheduled: true`;
  refuse if `wt_other_agent_live` says an agent is live there (alert
  `normal`: "work waiting, session already live"). Launch
  `claude -p --brief --name "<name>" --model <model> --permission-mode
  bypassPermissions --append-system-prompt-file schedules/<name>/prompt.md
  "<briefing>"` (Codex equivalent via the launcher's existing `--agent codex`
  path) in the worktree, output to the same run log. Sessions are fresh each
  start; durable memory belongs in tracked docs (the SDK ledger) or the
  store, not in a resumed transcript. The briefing ends with the standing
  instruction: *finish by running `bin/schedules alert` or `bin/schedules
  done`*.
- After the session exits: if `check` exists, run it; non-zero → `important`
  alert. If the session exited without writing an alert or calling `done`
  for this run id → `important` alert "session ended without reporting".
- `list`: name, cadence, enabled, last run, outcome, next due, **overdue**,
  open alerts. `--json` is what the browser consumes.
- `install`: one plist `com.callback-box.schedules`, `StartInterval 900`,
  `ProgramArguments` = the main checkout's `bin/schedules tick`; refuses to
  install from a worktree (the precedent at
  `bin/update-agent-sdk-scheduled.sh:52-54`).

**First implementation chunk.** `bin/schedules.ts` with `list`, `run
--dry-run`, and `tick` over run-only schedules (no workstream start); the
store with marker file; lock; `bin/schedules.test.ts` for due-ness (never
run, due, not due, disabled, lock held), outcome classification, and dry-run
writing nothing. Workstream start is the second chunk.

### Track C — Alerts (`bin/schedules alert`)

**What.** `bin/schedules alert --title <t> --message <m> [--details @file|-]
[--priority important|normal|backlog|fyi] [--workstream <name>]`. Workstream
defaults from `SCHEDULE_NAME`; `--workstream` is for a session that lost the
env (a resumed tab). Writes
`<store>/<name>/alerts/<id>.json`:

```json
{ "id": "20260824-220102-3f2a", "workstream": "knip-exports",
  "runId": "20260824-220100", "title": "12 new unused exports",
  "message": "…", "details": "…markdown…", "priority": "normal",
  "createdAt": "…", "state": "open", "acknowledgedAt": null }
```

Delivery is a separate step inside the same command: a macOS notification
(`osascript`, best effort, swallowed if absent) whose body is the title and
message. Nothing else reads notifications; the record is the truth.

`bin/schedules done` writes `{ runId, doneAt }` to state — the "I finished
and there was nothing to say" marker that distinguishes a clean session from
a bailed one.

`bin/schedules ack <id>` sets `acknowledged`. Acknowledged alerts leave the
default `list` and browser views after 14 days; records are kept.

**Why this needs to change.** The four channels in the issue table; none is
readable later.

**Direction.** Zod `alertSchema`; the CLI is the only writer (the comments
precedent, `bin/CLAUDE.md` "The CLI is the only writer"). Priority guidance
per schedule lives in its `prompt.md`; the CLI does not validate
appropriateness, only the enum.

**First implementation chunk.** `alert`, `done`, `ack`, `list` showing open
alert counts; tests for record shape, default workstream from env, `--details
-` from stdin, and the 14-day fade.

### Track D — Registry and browser

**What.** A `scheduled: true` field in the session registry record; routing
state `scheduled` with action `resume-with-briefing`; a "Scheduled" section
in the workstream browser listing each schedule with cadence, last run,
outcome, overdue, and open alerts, with the alert details expandable.

**Why this needs to change.** A scheduled workstream with no worktree today
renders as `uncertain / investigate` (`workstream-routing.sh:57-58`, the
final `else`). The boxholder wants these in their own section.

**Direction.**

- `workstream_routing_json`: before the `removed_at` branch, `if
  scheduled == true and agent_state != live → state=scheduled,
  action=resume-with-briefing`. A live agent in a scheduled workstream is
  `live / manual-forward` as today.
- `bin/workstreams remove`/`sweep`: cull the worktree; keep the record
  (`removed` is not set on a scheduled record; the worktree simply is not
  there). `archive` is refused for scheduled records ("disable it in
  `schedule.yaml` instead").
- `routingStateSchema` gains `scheduled`; `workstreamsCliRowSchema` gains
  `schedule: { cadence, lastRunAt, lastOutcome, overdue, openAlerts } | null`
  populated by `bin/workstreams list` from `bin/schedules list --json`.
- `WorkstreamsPage.tsx`: `SECTION_ORDER` gains `"Scheduled"` after
  `"Launching"`; rows in it render the schedule fields and an overdue badge.
  Alert details render as Markdown; an "Acknowledge" button shells out to
  `bin/schedules ack` (the app never writes the store itself).

**First implementation chunk.** Registry field + routing branch + a
`bin/workstreams list` row field, with `bin/router-*.test.ts`-style tests
for the routing table. The React section is the second chunk.

### Track E — Lint (`bin/schedules lint`)

**What.** One command that validates every `schedules/<name>/`:
`schedule.yaml` against the Zod schema (including `local.yaml`); `run` and
`check` are executable, have a shebang, and mention `SCHEDULE_DRY_RUN`;
shell scripts pass shellcheck (the npm `shellcheck` package, pinned in the
root `package.json`); TypeScript scripts are covered by the root lint once
`eslint.config.mjs:1-10` stops being a stub for `schedules/**` — this plan
wires the `personal-vibe-check` preset for `schedules/**/*.ts` only, and
leaves `bin/` as it is (a separate decision). `prompt.md` present when
`workstream` is set, and the prompt contains the words `bin/schedules alert`
(the reporting contract).

**Why this needs to change.** A schedule that fails lint is a schedule that
fails at 03:00 on a Sunday with nobody watching; the check has to happen at
commit time.

**Direction.** Pre-commit runs `bin/schedules lint` when anything under
`schedules/` is staged (the `dev-apps-typecheck` precedent in root
`CLAUDE.md`). `tick` also runs lint first and alerts `important` on an
invalid schedule rather than skipping it silently.

**First implementation chunk.** `lint` over the Track A loader plus the
executable/shebang/dry-run checks; the pre-commit hook; shellcheck wired.

### Track F — Migrate the existing jobs

**What.** Enroll:

| Schedule | `run` | Workstream | Notes |
|---|---|---|---|
| `sdk-update` | query npm for versions newer than the ledger's last entry; handoff lists them | claude/opus, `worktree: false` (pushes to main per prompt) | prompt.md = today's prompt, plus: file `issues/` items for releases the code must account for; end with `alert` |
| `docling-update` | today's `bin/check-docling-update.ts`; handoff on a settled newer release | none — alert `normal` from `run` | currently piggybacks the SDK job (`update-agent-sdk-scheduled.sh:105-109`) |
| `manual-tests` | run the suite; handoff on failures | claude/sonnet, worktree | prompt.md = today's triager prompt; tool constraints move into the prompt and `--allowedTools` in `schedule.yaml` (`workstream.allowedTools`, added in this track) |
| `knip-sweep` | `pnpm lint:knip`, diff against `$SCHEDULE_STATE_DIR/last-report.txt`, handoff with new findings | claude/opus, worktree (`knip-exports`) | needs knip's 33 lines of pre-existing noise fixed first (on the `knip-exports` branch) |

Then delete `bin/update-agent-sdk-scheduled.sh`,
`bin/manual-tests-scheduled.sh`, their plists (`bin/schedules install`
boots the old labels out), and `logs/manual-tests/`. `docs/maintenance.md`'s
table becomes a pointer to `bin/schedules list`.

**Why this needs to change.** Two mechanisms for one job kind is the drift
the plan removes; migration is the proof the abstraction holds.

**First implementation chunk.** `docling-update` (run-only, simplest), then
`sdk-update`.

### Track G — The `cb-authoring-schedules` skill

**What.** `.claude/skills/cb-authoring-schedules/SKILL.md` (frontmatter as
`.claude/skills/cb-debug/SKILL.md:1-4`). Covers: whether a task should be a
schedule; the `run` contract (exit 0 silent, handoff only when there is
work, honor `SCHEDULE_DRY_RUN`, keep a comparison baseline in
`$SCHEDULE_STATE_DIR` so "new since last run" is real); what goes in
`prompt.md` (authority: push? file issues? edit code?; which outcomes map to
which priority; must end with `alert` or `done`); when `check` is worth
writing; `bin/schedules run <name> --dry-run` and `logs` for testing;
`lint`; migrating an ad hoc job. Worked examples: `docling-update`
(run-only) and `knip-sweep` (handoff) — each shows several aspects at once.

**First implementation chunk.** The skill, written after Track F so the
examples are real.

## Could this be simpler?

Simplest version: keep per-job launchd scripts, add one `bin/notify-from-
schedule` that appends a line to a file, and a page that tails the file.

What the plan buys over it, traced:

- The simple version cannot say "this job has not run" — the failure that
  actually happened twice. Overdue needs a declared cadence and a stamped
  `lastRunAt`, which is Track A + B (principle 4, never silent).
- The simple version keeps four plists with four cadences nobody can list
  (principle 7, discoverability; boxholder: "I'd like to be able to see a
  list of them easily").
- A line in a file has no state; the boxholder asked for title, message,
  details, priority — that is a record (principle 1, types are structure).

Things deliberately *not* added, per `stop-over-engineering`: no retry
policy (a failed run alerts; the next tick tries again); no per-alert
delivery routing (one macOS notification; Telegram later if wanted); no
persistent agent sessions (memory lives in docs); no scheduling expressions
beyond `<n>h|d|w` (cron syntax buys nothing on a laptop that sleeps).

## Subplans

None. The one candidate — "should `bin/` get real linting" — is a separate
decision noted in Track E and NOT in scope.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `schedule.yaml` invalid | B/E tests | `tick` alerts `important`, skips schedule | clear |
| `run` not executable | E tests | lint refuses at commit; `tick` alerts | clear |
| `run` hangs | B test with a fake `run` that sleeps | per-run timeout (default 2h, `timeout:` in yaml); kill, `failed`, alert | clear |
| Two ticks overlap (launchd + manual `run`) | B lock test | mkdir lock; second exits 0 with a log line | clear |
| Stale lock after a crash | B test | PID inside lock; dead PID → reclaim | clear |
| Laptop asleep at due time | B due-ness test (clock injected) | next tick after wake runs it once | clear |
| Laptop off a week | — | first tick after boot runs it; overdue shown meanwhile | clear |
| Session starts but agent bails | B "no done/alert" test | `important` alert after session exit | clear |
| Agent live in the workstream when due | B test | skip + `normal` alert | clear |
| `osascript` missing / notifications off | C test | record still written; delivery best-effort | clear (record) |
| Store root unwritable | B test | `tick` exits non-zero to launchd log; **nothing else** | see gap |
| Registry record lost (state dir wiped) | D test | `tick` re-merges `scheduled: true` on every start | clear |
| `remove --force` on a scheduled workstream | D test | culls worktree, keeps record | clear |
| Handoff written but exit non-zero | B test | treated as `failed` (log tail + handoff both in briefing) | clear |
| Plist never installed / bootout by an OS update | — | `bin/doctor.ts` gains a check: plist loaded and last tick < 1h | clear once added |

> **Critical gap:** store root unwritable — every schedule silently stops,
> and the overdue signal lives in the same unwritable store. Mitigation in
> plan: `bin/doctor.ts` checks store writability and last-tick age; the
> browser shows "scheduler: last tick N ago" from `state.json` at the store
> root, and a missing/old value renders red. Accepted residual: if the disk
> is gone, the browser reading it is gone too.

## Agent-flow / user-flow edge cases

- **Wrong priority** — agent tags a breaking SDK change `fyi`. ADDRESSED
  partially: `prompt.md` carries the mapping per schedule (Track G); no
  mechanical check is possible. The 14-day fade means a mis-tagged `fyi`
  still sits in the browser until acknowledged.
- **Stale handoff** — the developer resumes a workstream a week after the
  alert; the handoff list is stale. ADDRESSED: the next `run` produces a new
  handoff against the current baseline; the old one is in `runs/`.
- **Two agents in one scheduled workstream** — developer resumed the tab
  while a tick wants to start a session. ADDRESSED: liveness guard, alert.
- **Hand-edited yaml** — bad cadence spelling (`7days`). ADDRESSED: Zod
  literal pattern; lint at commit; `tick` alerts.
- **Fabricated "nothing new"** — a `run` script with no baseline reports
  everything every week (the knip case). ADDRESSED in the skill (baseline
  in `$SCHEDULE_STATE_DIR`) and by lint requiring `SCHEDULE_DRY_RUN`
  handling; not mechanically enforced beyond that.
- **Validation error UX** — `tick` alert text for an invalid yaml names the
  file and the Zod path. ADDRESSED (Track E).
- **Transition state** — during Track F, an old plist and the new tick both
  run the SDK job. ADDRESSED: `bin/schedules install` boots out the two old
  labels; Track F deletes the scripts in the same chunk as enrolment.

## NOT in scope

- **`deploy.sh` reporting.** It is hook-driven, not scheduled. Its
  out-of-band truth (`.last-deployed-sha` + doctor) already works. A later
  change may call `bin/schedules alert --workstream deploy` if a
  non-schedule caller proves useful; not now, because it would make the
  alert store a general inbox before one schedule has used it.
- **Real linting for `bin/`.** `eslint.config.mjs:1-10` is a stub by
  decision; this plan lints `schedules/**` only. Widening is its own call.
- **Telegram / push delivery.** One macOS notification suffices; the record
  is the channel.
- **Enrolling security-overview regen, knowledge-audit revisit, doc
  refresh, feedback collection.** The framework issue lists them; each needs
  its own `run` design. They follow after the four migrations prove the
  shape.
- **Codex release monitor.** The framework issue asks for it; it is a new
  schedule (`codex-update`) authored with the skill, after Track G.
- **Box-scheduler integration.** Different substrate; a `box-health` schedule
  can wrap `cb health` later.
- **Injecting into a live session.** `resume` still prints "manual
  forwarding required" for live tabs; scheduled sessions are headless so this
  path is rarely hit.

## Open design questions

- **Handoff by file vs exit code.** Plan chooses the file
  (`$SCHEDULE_HANDOFF`): it carries content, and exit 0 keeps "success"
  unambiguous for shell authors. Boxholder has not confirmed.
- **Headless by default.** Plan chooses headless (`claude -p`) with `resume`
  as the way in. Alternative: `important` opens a Terminal tab at once.
  Lean: headless; a tab appearing unbidden at 03:00 is not helpful.
- **Where cadence lives.** Plan: `schedule.yaml` only; `docs/maintenance.md`
  points at `bin/schedules list`. Lean firm.
- **Persistent session for `sdk-update`.** The current job resumes one
  session for continuity. Plan: fresh session, ledger is memory. If the
  first migrated runs show the agent re-deriving too much, add
  `workstream.session: persistent`.

## Knowledge audits

None. Every concept here is dev-repo-facing (skill, CLI, `schedules/`);
box agents never see it, and `knowledge-audits.yaml` tests what a *box*
agent knows. The `cb-authoring-schedules` skill is the agent-facing
document, and its worked examples are the recall mechanism.

## Implementation order

1. Track A — schema + loader + tests.
2. Track B chunk 1 — store, lock, `list`, `run --dry-run`, `tick` for
   run-only schedules.
3. Track C — `alert`, `done`, `ack`.
4. Track B chunk 2 — workstream start, post-session check, "no report"
   alert.
5. Track D chunk 1 — registry field, routing branch, list row field.
6. Track E — lint + pre-commit + shellcheck.
7. Track F — `docling-update`, `sdk-update`, `manual-tests`, `knip-sweep`
   (the last waits for the `knip-exports` branch to land its noise fix).
8. Track D chunk 2 — the browser section.
9. Track G — the skill, with real examples.
10. `bin/doctor.ts` scheduler checks; `docs/maintenance.md` rewrite;
    `bin/CLAUDE.md` section.

## Rollout shape

- **Tests first.** `bin/schedules.test.ts` (Node test runner) is written
  per chunk before the code: cadence parsing, due-ness with an injected
  clock, lock/stale-lock, outcome classification, alert records, the
  routing table, lint verdicts. Each row in Failure modes marked "test" maps
  to one named test. No doctests: this is `bin/`, not the box.
- **Knowledge audits:** none (above).
- **Migration:** Track F is scripted by hand per job, in one chunk each,
  each chunk deleting the old script and booting out its plist. No data
  migrates — logs under `logs/manual-tests/` are deleted, not moved (they
  were never durable).
- **Done when:** `bin/schedules list` shows four enabled schedules with a
  `lastRunAt` written by a real tick; `bin/schedules run knip-sweep
  --dry-run` prints a handoff; the browser shows the Scheduled section with
  one acknowledged alert; `git grep -l 'osascript\|terminal-notifier
  \|PushNotification' bin/` returns only `bin/schedules.ts`; a cross-model
  review of this plan and of the diff has been run and its findings
  reconciled.
