# Sweep: unattended / scheduled work, and multi-model / delegation

Worktree: devprocess-talk at e9ba5c2c8. Run store = `<parent>/schedule-runs/` beside the main checkout (outside git, shared by all worktrees). Session registry = `~/.cache/beebox/workstreams/*.json` (retained workstreams only, 155 records).

Shared commands referenced below:
- RUNIDS: `cd <parent>/schedule-runs; for d in */; do ls $d/runs | sed -E 's/^([0-9]{8}-[0-9]{6}).*/\1/' | sort -u | wc -l; done` (distinct run ids per schedule; `handoff` files = sessions started).
- ALERTS: `cat <parent>/schedule-runs/*/alerts/*.json | jq -r '[.priority,.closedBy//"open"]|@tsv' | sort | uniq -c`
- TRAILER: `git log --all --format='%H %(trailers:key=Workstream,valueonly)' | grep -cE " <name>$"` (commits made inside the schedule's workstream).
- SCHED-ISSUES: grep over `issues/` for `workstream: <schedule>` or `discovered-in:` naming the schedule run (e.g. "the hourly full-suite run on main", "weekly smoke-tier review", "weekly manual-test triage"); full-suite issues also by filename `*full-suite-red*`.

Per-schedule run table (as of 2026-10-09; RUNIDS / handoff files / alert files / TRAILER commits):

| schedule | cadence | shape | born | run ids | sessions (handoffs) | alerts | workstream commits |
|---|---|---|---|---|---|---|---|
| sdk-update | 1d | handoff, persistent Opus 5.5 | 2026-08-24 7fab2fe3f | 46 | 36 | 38 | 36 |
| docling-update | 1w | run-only | 2026-08-24 7fab2fe3f | 36 | 0 | 1 | 0 |
| knip-sweep | 7d | handoff, Opus 5.5 | 2026-08-24 56fae9331 | 8 | 7 | 9 | 19 |
| manual-tests | 7d | handoff, Sonnet, sandboxed + check | 2026-08-24 00bbd508d | 7 | 3 | 6 | 3 |
| full-suite | 1h | run-only | 2026-08-25 b88d84861 | 871 | 0 | 119 | 0 |
| smoke-review | 7d | handoff, Opus 5.5 | 2026-08-26 a5e8e624c | 8 | 7 | 7 | 7 |
| tour-check | 7d | handoff, Opus 5.5 | 2026-08-26 2c9d75eed | 7 | 7 | 7 | 5 |
| supplemental-lint | 7d | handoff, Opus 5.5 | 2026-08-29 ccdfe5c98 | 6 | 5 | 6 | 10 |
| deferred-issues | 1h | run-only | 2026-08-31 cde25c645 | 739 | 0 | 9 | 0 |
| cross-box-leak-scan | 7d | handoff, Opus 5.5 | 2026-09-04 188f3c493 | 5 | 4 | 4 | 5 |
| box-convergence | 1h | run-only | 2026-09-12 b20ed01af | 470 | 0 | 14 | 0 |
| agent-docs-refresh | 7d | handoff, Sonnet | 2026-09-16 a41536f24 | 4 | 3 | 4 | 3 |
| alert-filing | 1d | run-only | 2026-09-18 7c46d0967 | 20 | 0 | 0 | 0 |
| disk-hygiene | 1d | run-only | 2026-10-02 715fb817e | 7 | 0 | 2 | 0 |
| retrospective | 3d | handoff, Opus 5.5 | 2026-10-07 3cf3c3965 | 2 | 2 | 3 | 3 |

There are 15 schedule directories (the brief said 14). Births by month: 2026-08: 9; 2026-09: 4; 2026-10: 2 (command: `for d in schedules/*/; do git log --format='%ad %h %s' --date=short --diff-filter=A -- $d/schedule.yaml | tail -1; done`).

---

# Part 1: unattended work

## Pre-schedules launchd jobs (one plist per job)
- **One line:** Before `schedules/`, each recurring job had its own launchd plist, log location and notify() code.
- **Lives in:** retired: `bin/update-agent-sdk-scheduled.sh`, `bin/manual-tests-scheduled.sh`, `bin/check-docling-update.ts`, knip script; prose in `<old-package>/docs/maintenance.md` (since cut to a pointer).
- **Appeared:** 2026-07-10 fa356a565 "Automate the agent-SDK update: launchd runner + consolidate the age guard"; 2026-08-06 e084243eb "schedule weekly manual tests"; 2026-08-06 a9822a86d "report scheduled test failures locally". Retired 2026-08-24 3ffc8885d "schedules: retire the old jobs' docs and plists (Track F)" (and 7fab2fe3f deletes `bin/update-agent-sdk-scheduled.sh` and `bin/check-docling-update.ts`).
- **Bottleneck relieved:** removed "remember to run it" for the SDK monitor, manual tests, knip, Docling currency.
- **New bottleneck exposed:** `beebox/docs/implemented-plans/scheduled-workstreams.md`: "Recurring jobs in this repo ... each hand-roll a launchd plist, a log location, and a way to tell the developer something"; "The whole plan exists because four jobs were resilient and silent." Also 3ffc8885d: "a booted-out label whose file survives comes back at the next login, and the SDK job would run twice a day from two mechanisms."
- **Evidence:** 4 jobs (plan doc). Commit 3ffc8885d: 254 lines deleted from maintenance docs.
- **Outcomes:** Abandoned 2026-08-24 (3ffc8885d), replaced by the schedules system; all four jobs re-enrolled the same day. 3ffc8885d also lists "not yet enrolled" cadence tasks (knowledge audits, security-overview regen, doc/prompt refresh, feedback collection, CSP review), several of which later became schedules (agent-docs-refresh, retrospective).
- **Prior-art mention:** no.

## Box-side scheduler daemon (product, launchd)
- **One line:** The box product's own `bbx tick` daemon runs box schedules (`_config/schedules/`) for registered boxes via launchd; distinct from the dev-repo scheduler.
- **Lives in:** `beebox/docs/scheduler.md`; box `_config/schedules/`.
- **Appeared:** 2026-02-24 34cbdcabd "Add scheduler daemon with launchd integration and per-box JSONL logs".
- **Bottleneck relieved:** product feature (boxes act on their own); not a dev-process tool.
- **New bottleneck exposed:** On the dev test box it costs model calls and rewrites the playground, hence the test1 rule below.
- **Evidence:** not measured (box content off limits).
- **Outcomes:** Still in use as a product feature. Judgment: precedent for "one launchd tick drives many jobs", which the dev scheduler later used.
- **Prior-art mention:** no.

## "enabled: false on test1" rule
- **One line:** The primary test box is a manual playground: most of its box schedules carry `enabled: false`, and agents must warn before `bbx wakeup` runs real agents over pending threads.
- **Lives in:** `beebox/docs/box-work.md:51-55`; boxholder memory note.
- **Appeared:** `git log -S'enabled: false' -- beebox/docs/box-work.md` (not run separately; doc present at HEAD).
- **Bottleneck relieved:** stops dev agents from spending model calls and mutating the test box by accident.
- **New bottleneck exposed:** not visible.
- **Evidence:** none in repo.
- **Outcomes:** Judgment: a guard rule; no record of incidents in the repo.
- **Prior-art mention:** no.

## Schedules system (`schedules/` + `bin/schedules` + one launchd tick)
- **One line:** One tracked directory per recurring job, a single CLI as the only store writer, one launchd tick every 15 minutes, and Zod-validated run/alert records outside git.
- **Lives in:** `schedules/*/`, `bin/schedules`, `bin/schedules.ts`, `bin/lib/schedules*.ts`, `bin/docs/schedules.md`, `beebox/docs/implemented-plans/scheduled-workstreams.md`.
- **Appeared:** 2026-08-24 9718aedbc "schedules: the schedule.yaml schema, loader, and record shapes (Track A)"; same day cfabf04e4 "the store, the runner, and the alert commands (Tracks B1 + C)", 024e2f01d "headless launch and the workstream start (Track B chunk 2)", 703f3a8bb "bin/schedules lint ... (Track E)". Fixes 2026-08-25 1a96dfdb3 / 23ead90ce (launchd cwd and PATH).
- **Bottleneck relieved:** plan doc job statement: "When I add a new periodic task, I want to write one directory and run one command, so enrolling a task is cheaper than remembering to do it by hand." Also silent failure: "When a scheduled job silently stops running ... I want the browser to say 'overdue' without any job having to report its own death."
- **New bottleneck exposed:** alert noise (see "alert signal" below), unattended sessions leaving work stranded (see "park/unlanded/replay"), host load (see "host-pressure gate").
- **Evidence:** 15 schedules; 2,237 distinct run ids across all schedules since 2026-08-25 (sum of RUNIDS); 229 alert records (ALERTS); `bin/schedules list` at 2026-10-09 showed last tick "0w ago" and every schedule run within its cadence.
- **Outcomes:** In daily use for 6.5 weeks; jobs grew from 4 to 15. 48 public issues trace to schedule runs (SCHED-ISSUES; 27 closed) plus 29 `full-suite-red` issues (28 closed). 91 commits carry a schedule's `Workstream` trailer (sum of TRAILER column).
- **Prior-art mention:** no (dev/skills-review-2026-10.md mentions only that the authoring skill says "four" schedules when there are 14).

## Run-script head + agent handoff (two schedule shapes)
- **One line:** `run` gathers, compares, and decides whether anything changed (exit 0 silently when not); only `bin/schedules handoff` starts an agent workstream, whose `prompt.md` holds judgment and authority.
- **Lives in:** `bin/docs/schedules.md` ("When work is a schedule", "What `run` owes", "Writing `prompt.md`").
- **Appeared:** 2026-08-24 024e2f01d; shape named in plan `scheduled-workstreams.md` ("A schedule's head is a plain script; a workstream (with an agent) starts only when the script says there is work or when it fails").
- **Bottleneck relieved:** cost and unreliability of running an agent every tick. 7fab2fe3f: "The head is now cheap and dumb ... so the persistent Opus session starts on the days something was actually published instead of every day at 12:04." `bin/docs/schedules.md`: "A `run` that reasons about its findings will be wrong at 03:00 with nobody watching."
- **New bottleneck exposed:** handoff loops: "A handoff trigger must ignore what its own sessions write ... restarts itself every tick" (`bin/docs/schedules.md`).
- **Evidence:** 7 of 15 schedules are run-only; 8 hand off. sdk-update: 46 runs, 36 sessions; knip-sweep 8 runs, 7 sessions (table).
- **Outcomes:** Run-only schedules account for 2,143 of 2,237 runs (box-convergence, deferred-issues, full-suite, docling, alert-filing, disk-hygiene) with no agent cost. Judgment: the split is why hourly cadences are affordable.
- **Prior-art mention:** no.

## Scheduled workstreams (schedule launches a headless agent in a worktree)
- **One line:** A handoff creates or reuses a sticky workstream named after the schedule and runs `claude -p` / `codex exec` headless in its own worktree, briefing on stdin, killed at timeout.
- **Lives in:** `bin/lib/launch-headless.sh`, `bin/docs/schedules.md#headless-sessions`, `schedule.yaml` `workstream:` block (agent, model, effort, session fresh/persistent, permissionMode, tools/allowedTools, maxBudgetUsd).
- **Appeared:** 2026-08-24 024e2f01d; 2026-08-24 d8d314054 "workstreams: scheduled records are sticky (Track D chunk 1)"; 2026-08-24 e4134adbb "freshen a worktree schedule from main before the session starts"; 2026-08-24 0fda18d54 "fix(schedules): run sdk-update in its own worktree and land, not push main"; 2026-09-26 6dd8aebbd "Scheduled agents: name the run log and state dir in the briefing".
- **Bottleneck relieved:** recurring judgment work (SDK triage, dead code, tours, lint, docs) without a human starting a session.
- **New bottleneck exposed:** `sdk-update.yaml`: ran with `worktree: false` until 2026-08-25, "the agent could pull and commit over uncommitted work or under a live session"; issue `issues/.../2026-09-02-unattended-schedules-permission-prompts-none.md`; stranded work (next entry).
- **Evidence:** 81 headless sessions (sum of handoff files, RUNIDS); models in yaml: 6 on `claude-opus-5-5`, 2 on `sonnet`; budgets set on 4 (`maxBudgetUsd` 2-15).
- **Outcomes:** 91 commits on branches from scheduled sessions (TRAILER). Examples: sdk-update 36 commits, 23 with "bump" in subject (`git log main --grep='^Workstream: sdk-update' | grep -ci bump`); knip-sweep 19; supplemental-lint 10. Still in use.
- **Prior-art mention:** no.

## Park / unlanded-commits / replay (stranded-work handling)
- **One line:** Before each worktree-schedule session the runner parks uncommitted edits on `refs/schedules/<name>/parked/<runId>`, merges main, lists unlanded commits; after it, unlanded work is a `normal` alert; `--replay <runId>` reruns a session on a stored handoff.
- **Lives in:** `bin/docs/schedules.md#worktree-branch-between-runs`, `bin/lib/schedules*.ts`.
- **Appeared:** 2026-10-06 a8f45b4b8 "Schedules: park leftover edits, track unlanded commits, replay handoffs" (also introduces `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` and the foreground Bash cap for headless runs).
- **Bottleneck relieved:** a8f45b4b8: "a headless session that backgrounded the suite and ended its turn never came back; its uncommitted edits then made every later `git merge main` refuse; and committed work sat on schedule branches for weeks."
- **New bottleneck exposed:** not visible yet (3 days old).
- **Evidence:** 2 `unlanded-commits` alerts recorded (ALERTS, by `.condition`).
- **Outcomes:** Judgment: too new to measure; first alerts already surfaced two unlanded branches.
- **Prior-art mention:** no.

## Alerts, conditions, daily digest, and alert-filing
- **One line:** `bin/schedules alert` writes a durable record; `important` pops up immediately, `normal`/`fyi` wait for a 09:00 digest; `--condition` dedupes a standing problem; a non-fyi condition open 7 days is filed as a private issue by the `alert-filing` schedule.
- **Lives in:** `bin/docs/schedules.md#results-and-writer-boundary`, `schedules/alert-filing/run` (calls `bin/schedules file-standing`), `beebox/docs/implemented-plans/schedule-alert-signal.md`, workstreams app `/workstreams/alerts`.
- **Appeared:** 2026-08-24 cfabf04e4 (alert commands); 2026-09-18 00cb87339 "Plan schedule alert signal..."; 2026-09-18 f680b798e "Schedule alerts: conditions, resolve, important-only popups, migration"; 2026-09-18 7c46d0967 "Schedule alerts: daily digest and 7-day filing"; 2026-09-18 b4e980ca6 "Schedules report under conditions and the new priority meanings".
- **Bottleneck relieved:** plan: "I want it to interrupt me only if it cannot wait a day ... so I deal with schedules once a day instead of continuously"; "`box-convergence` has reported the same `needs-procedure` for three days. I want it counted once, and after a week I want it to become an issue instead of repeating."
- **New bottleneck exposed:** "a schedule whose alerts nobody reads is noise on a cadence" (`bin/docs/schedules.md`).
- **Evidence:** 229 alerts: 2026-08: 47, 2026-09: 143, 2026-10 (8 days): 39 (`jq -r '.createdAt[0:7]'`). By priority: important 116, normal 80, fyi 33. Closed by person 172, schedule (auto-resolve) 30, digest 13; open 14. Conditions in use: flakes 11, run-failed 6, red-unattributed 6, unconverged 3, unlanded-commits 2, low-disk 2; 194 records predate or lack a condition. alert-filing: 20 runs; 1 alert carries a filed issue path.
- **Outcomes:** Of 229 alerts, 43 closed without a person (schedule resolve or digest). Judgment: the 2026-09 peak (143) preceded the condition/digest change; October's rate is lower but the window is short.
- **Prior-art mention:** no.

## Overdue detection and missed-run catch-up
- **One line:** Due-ness is derived from stored `lastRunAt` + cadence + overdue allowance, so a machine that slept runs each job once at the next tick; `bin/schedules list`, workstream rows and `bin/doctor.ts` show heartbeat and plist health.
- **Lives in:** `bin/docs/schedules.md#store-cadence-and-locking`; root `CLAUDE.md` ("For recurring work or missed scheduled runs, use bbx-authoring-schedules"); `bin/doctor.ts`, `bin/doctor-checks.ts`.
- **Appeared:** 2026-08-24 cfabf04e4; 2026-08-24 f4640fd79 "doctor: check the scheduler heartbeat and that its launchd job is loaded"; root CLAUDE.md line from 2026-09-12 c8c728285.
- **Bottleneck relieved:** plan: "When the laptop was asleep at the scheduled time, I want the job to run at the next wake, once, and not pile up."
- **New bottleneck exposed:** not visible.
- **Evidence:** `bin/schedules list` 2026-10-09: no schedule overdue.
- **Outcomes:** Judgment: on a laptop host, this is what keeps weekly jobs at 7-8 runs over 6 weeks (knip 8, smoke-review 8, tour-check 7, manual-tests 7).
- **Prior-art mention:** no.

## Schedule lint and invalid-schedule alert
- **One line:** `bin/schedules lint` checks YAML schema, executables, dry-run support, reporting instructions, shellcheck and TS lint; pre-commit runs it; ticks keep an `invalid-schedule` condition open per broken schedule.
- **Lives in:** `bin/docs/schedules.md#validation`.
- **Appeared:** 2026-08-24 703f3a8bb.
- **Bottleneck relieved:** a broken schedule failing silently.
- **New bottleneck exposed:** not visible.
- **Evidence:** 0 `invalid-schedule` alerts in store.
- **Outcomes:** Judgment: no recorded invalid schedule reached the tick.
- **Prior-art mention:** no.

## Headless-session discipline (single-shot, foreground, fail-closed constraints)
- **One line:** Headless schedule sessions run with background tasks disabled and a Bash timeout equal to the run timeout; Codex schedules that declare Claude-only constraints (`tools`, `allowedTools`, `maxBudgetUsd`, `effort`) fail closed; a run with neither `alert` nor `done` is a "bailed" important alert.
- **Lives in:** `bin/docs/schedules.md#headless-sessions`, `bin/lib/launch-headless.sh`.
- **Appeared:** 2026-08-24 024e2f01d; 2026-10-06 a8f45b4b8 (background tasks off).
- **Bottleneck relieved:** sessions that ended their turn waiting on a background job (a8f45b4b8 quote above).
- **New bottleneck exposed:** not visible.
- **Evidence:** run-failed condition 6 alerts.
- **Outcomes:** Same rule promoted repo-wide for subagents (see "Foreground rule for workers").
- **Prior-art mention:** no.

## Sandboxed triage + `check` (manual-tests)
- **One line:** The manual-tests triager may only Edit issue files and run two `bin/schedules` commands; a post-session `check` verifies each append is an exact-prefix extension of a real open issue, then commits.
- **Lives in:** `schedules/manual-tests/schedule.yaml`, `schedules/manual-tests/check.ts`, `bin/docs/schedules.md#when-to-write-check`.
- **Appeared:** 2026-08-06 e084243eb (launchd version); 2026-08-24 00bbd508d "schedules: enroll manual-tests (Track F)".
- **Bottleneck relieved:** letting an unattended agent write into the repo without trusting it.
- **New bottleneck exposed:** not visible.
- **Evidence:** 7 runs, 3 sessions, 6 alerts; 3 issues by "weekly manual-test triage" marker (1 closed); 3 commits with trailer.
- **Outcomes:** Low volume. Judgment: the main product is the pattern (`check` as verifier), cited in the authoring doc as the example.
- **Prior-art mention:** no.

## full-suite (hourly batched suite on main + bisect)
- **One line:** Hourly, if anything landed, runs beebox's full test suite on main, bisects red to the landing that caused it, files one issue per landing, alerts.
- **Lives in:** `schedules/full-suite/` (19 files incl. tests), `bin/host-pressure.ts`.
- **Appeared:** 2026-08-25 b88d84861 "feat(schedules): full-suite runs main hourly and bisects red to the landing"; 2026-09-11 b47af3add "full-suite: gate on memory pressure, defer instead of running loaded".
- **Bottleneck relieved:** `schedule.yaml`: "the only thing that tests `main`, and the only thing that still runs everything. Iteration and /finish run selected tests; a failure that reaches main surfaces here within the hour." Enabled change-selected tests at finish (root CLAUDE.md: "the full suite is scheduled hourly on main").
- **New bottleneck exposed:** host load (2026-09-11 incident, `bin/host-pressure.ts` header: "18GB of swap was in use"); flaky tests (11 `flakes` condition alerts).
- **Evidence:** 871 runs, 856 result files, 119 alerts; 29 issues named `*full-suite-red*` (`ls issues/*/*full-suite-red* issues/closed/*/*full-suite-red* | wc -l`), 28 closed; 15 issues with "the hourly full-suite run on main" in `discovered-in`.
- **Outcomes:** 29 landings caught red on main and attributed, 28 of those issues closed (e.g. `issues/closed/bugs/2026-08-27-full-suite-red-drive-folder-mounts-1ae39b40.md`). 50 commit subjects mention full-suite. Still in use (last run 1h before sweep).
- **Prior-art mention:** no.

## Host-pressure gate
- **One line:** Memory-pressure reading (sysctl/vm_stat) shared by the test wrapper and full-suite; the run defers instead of running on a swapping host.
- **Lives in:** `bin/host-pressure.ts`, `bin/host-pressure.test.ts`.
- **Appeared:** 2026-09-11 b47af3add.
- **Bottleneck relieved:** header: "a load average measures runnable processes, not a swapping host, and the 2026-09-11 full-suite incident was the latter".
- **New bottleneck exposed:** not visible.
- **Evidence:** not counted (deferrals are not separate records).
- **Outcomes:** Judgment: prerequisite for running an hourly suite on the same laptop as a dozen agent sessions.
- **Prior-art mention:** no.

## sdk-update (daily SDK/Claude Code/Codex release monitor)
- **One line:** A cheap `run` checks npm registries against the ledger's last-reviewed line; a persistent Opus session reads release notes, records applicability in a ledger, bumps settled releases, files issues.
- **Lives in:** `schedules/sdk-update/` (`agent-sdk-notes.md` ledger, 3,293 lines).
- **Appeared:** 2026-07-10 fa356a565 (launchd); 2026-08-24 7fab2fe3f; 2026-08-24 0fda18d54 (own worktree); moved off `worktree: false` 2026-08-25 (yaml comment).
- **Bottleneck relieved:** plan: "When the SDK monitor sees a release that changes hook semantics, I want an issue filed and a short alert, so the change is a known event and not a mystery when a worker session breaks days later." Ledger: "v2.1.218's worktree git isolation silently broke /finish".
- **New bottleneck exposed:** model alias drift found by the monitor (issues `2026-09-22-opus-alias-still-pins-opus-5.md`, `2026-09-28-sonnet-alias-still-pins-sonnet-5.md`, `2026-09-04-codex-default-model-becomes-astra.md`).
- **Evidence:** 46 runs, 36 sessions, 38 alerts; 100 ledger headings (`grep -cE '^#{2,4} ' schedules/sdk-update/agent-sdk-notes.md`); 44 commits on main with `Workstream: sdk-update`, 23 with "bump"; 15 issues (6 closed).
- **Outcomes:** 23 SDK bump commits landed by the schedule; 15 issues filed covering harness changes (e.g. `2026-09-10-resumed-sessions-drop-appended-system-prompt.md`, `2026-09-02-unattended-schedules-permission-prompts-none.md`). Still in use.
- **Prior-art mention:** no.

## knip-sweep (weekly dead-code diff)
- **One line:** Runs knip, diffs against last week's baseline, hands off only new findings.
- **Lives in:** `schedules/knip-sweep/`.
- **Appeared:** 2026-08-24 56fae9331.
- **Bottleneck relieved:** plan job: "When a weekly knip sweep finds twelve new unused exports, I want to learn that once".
- **New bottleneck exposed:** not visible.
- **Evidence:** 8 runs, 7 sessions, 9 alerts; 19 trailer commits; 5 issues (2 closed).
- **Outcomes:** 19 commits from its sessions; cited as the baseline/diff pattern in the authoring doc.
- **Prior-art mention:** no.

## supplemental-lint (weekly oxlint + circular deps)
- **One line:** Weekly new oxlint and circular-dependency findings, handed to an Opus session.
- **Lives in:** `schedules/supplemental-lint/`.
- **Appeared:** 2026-08-29 ccdfe5c98 "Schedule supplemental lint sweeps".
- **Bottleneck relieved:** lint rules too slow/noisy for the commit path.
- **New bottleneck exposed:** not visible.
- **Evidence:** 6 runs, 5 sessions, 6 alerts; 10 trailer commits; 1 issue (open).
- **Outcomes:** 10 commits.
- **Prior-art mention:** no.

## smoke-review (weekly review of the smoke tier)
- **One line:** Weekly evidence packet on smoke steps (which never fail, which bugs escaped) judged by an Opus session.
- **Lives in:** `schedules/smoke-review/`.
- **Appeared:** 2026-08-26 a5e8e624c "feat(schedules): weekly review of the smoke tier's shape".
- **Bottleneck relieved:** yaml: "is each step still earning its place, and is there something the walk should be checking that it isn't?"
- **New bottleneck exposed:** not visible.
- **Evidence:** 8 runs, 7 sessions, 7 alerts; 7 trailer commits; 5 issues (2 closed).
- **Outcomes:** 7 commits, 5 issues.
- **Prior-art mention:** no.

## tour-check (weekly browser-tour walk)
- **One line:** Walks every browser tour at two viewports; the session edits tours for intended drift or files regressions.
- **Lives in:** `schedules/tour-check/`, `beebox/docs/testing/tours.md`.
- **Appeared:** 2026-08-26 2c9d75eed "tours: repair the walks, fold dashboard into nav-pages, check them weekly".
- **Bottleneck relieved:** yaml: "Three of five tours had been silently failing for months before this existed (2026-08-26) — nobody ran them, so nobody knew."
- **New bottleneck exposed:** run length: "The runs of 2026-09-23, 09-30 and 10-07 all hit the old 1h limit before reporting" (timeout raised to 3h).
- **Evidence:** 7 runs, 7 sessions, 7 alerts; 5 trailer commits; 2 issues (1 closed).
- **Outcomes:** 5 commits; tours kept passing weekly; 3 of 7 runs timed out before the limit change.
- **Prior-art mention:** no.

## cross-box-leak-scan (weekly security scan)
- **One line:** Static sweep of the HTTP surface plus a read-only host audit locally and on the deployed server; new findings handed to an Opus session.
- **Lives in:** `schedules/cross-box-leak-scan/`.
- **Appeared:** 2026-09-04 188f3c493 "security: a repeatable scan for cross-box isolation on a shared host".
- **Bottleneck relieved:** one-off security review becoming a weekly diff.
- **New bottleneck exposed:** deploy-target config lives only in the real checkout (yaml comment).
- **Evidence:** 5 runs, 4 sessions, 4 alerts; 5 trailer commits; 2 issues (1 closed).
- **Outcomes:** 5 commits, 2 issues.
- **Prior-art mention:** no.

## agent-docs-refresh (weekly public-docs refresh)
- **One line:** Hands off commits since the last refresh that touch anything the public docs corpus describes; a Sonnet session updates pages.
- **Lives in:** `schedules/agent-docs-refresh/`.
- **Appeared:** 2026-09-16 a41536f24.
- **Bottleneck relieved:** docs drift ("The generated set tracks the engine on its own; the other two drift", run.ts).
- **New bottleneck exposed:** not visible.
- **Evidence:** 4 runs, 3 sessions, 4 alerts, 3 trailer commits.
- **Outcomes:** 3 commits.
- **Prior-art mention:** no.

## retrospective (every 3 days)
- **One line:** Gathers CODING_FEEDBACK notes, skill-usage aggregates and escaped bugs; an Opus session proposes guidance edits.
- **Lives in:** `schedules/retrospective/`, `bin/coding-feedback.ts`.
- **Appeared:** 2026-10-07 3cf3c3965; CODING_FEEDBACK 2026-10-07 b8fc4b1aa.
- **Bottleneck relieved:** guidance tuning on a cadence (3ffc8885d listed "feedback collection" as not yet enrolled).
- **New bottleneck exposed:** not visible.
- **Evidence:** 2 runs, 2 sessions, 3 alerts, 3 trailer commits.
- **Outcomes:** Judgment: 2 days old.
- **Prior-art mention:** no.

## box-convergence (hourly box maintenance)
- **One line:** From the main checkout, applies migrations and generated guidance to local boxes and production and reports boxes that remain unconverged.
- **Lives in:** `schedules/box-convergence/`.
- **Appeared:** 2026-09-12 b20ed01af "report local boxes that have drifted behind shipped migrations"; 2026-09-15 65af4d7a6 "yield the hourly sweep to live work"; 2026-09-16 eaa9703bf "treat an unreachable prod server as routine for a day".
- **Bottleneck relieved:** boxes falling behind shipped migrations.
- **New bottleneck exposed:** repeated identical alerts (the plan's `needs-procedure` example) leading to conditions.
- **Evidence:** 470 runs, 81 result files, 14 alerts (3 `unconverged`).
- **Outcomes:** Still running hourly. 2026-10-08 81c647230 "Retire every box data migration" touched it. Judgment: this is the box-side behavior the dev process depends on.
- **Prior-art mention:** no.

## deferred-issues (hourly)
- **One line:** Moves issues from `issues/deferred/` into their category queue once their date arrives.
- **Lives in:** `schedules/deferred-issues/`, `bin/deferred-issues.ts`.
- **Appeared:** 2026-08-31 cde25c645 "Add deferred issue activation".
- **Bottleneck relieved:** date-dependent work needing someone to remember it.
- **New bottleneck exposed:** not visible.
- **Evidence:** 739 runs, 9 alerts, 4 result files.
- **Outcomes:** Running; activations not separately counted.
- **Prior-art mention:** no.

## docling-update (weekly currency watch)
- **One line:** Run-only alert when a settled Docling release is newer than the pin; does not bump.
- **Lives in:** `schedules/docling-update/`.
- **Appeared:** 2026-08-24 7fab2fe3f.
- **Bottleneck relieved:** stale extractor pin.
- **New bottleneck exposed:** not visible.
- **Evidence:** 36 run ids, 1 alert.
- **Outcomes:** 1 alert in 6 weeks.
- **Prior-art mention:** no.

## disk-hygiene (daily)
- **One line:** Prunes rebuildable caches (uv, pnpm store, simulator clones) at most weekly; alerts when free disk stays low.
- **Lives in:** `schedules/disk-hygiene/run.ts`.
- **Appeared:** 2026-10-02 715fb817e.
- **Bottleneck relieved:** run.ts header: uv cache "reached 31 GB", pnpm store "reached 62 GB".
- **New bottleneck exposed:** not visible.
- **Evidence:** 7 runs, 2 alerts (`low-disk`), 10 subject mentions.
- **Outcomes:** Running; 2 low-disk alerts.
- **Prior-art mention:** no.

## bbx-authoring-schedules skill
- **One line:** Skill that routes recurring-work requests (and "replace a launchd job") to the schedules doc.
- **Lives in:** `.claude/skills/bbx-authoring-schedules/SKILL.md` (now 23 lines; mechanics in `bin/docs/schedules.md`).
- **Appeared:** 2026-08-24 (plan names it); shrunk 2026-10-07 6657f44d1 "Skill mechanics move to scripts".
- **Bottleneck relieved:** authoring consistency.
- **New bottleneck exposed:** `dev/skills-review-2026-10.md`: was 274 lines and said "four" schedules.
- **Evidence:** skill-usage 60 days: 19 sessions; Claude agent-invoked in 7, Codex in 12 (`node --import tsx bin/skill-usage.ts --since 60 --json | jq '.skills["bbx-authoring-schedules"]'`).
- **Outcomes:** 11 schedules authored after it existed.
- **Prior-art mention:** yes, skills-review: "shrink to ~120 ... says 'four' schedules".

---

# Part 2: multi-model and delegation

## Co-Authored-By distribution (key numbers)
- **One line:** Every Claude commit carries a model-specific `Co-Authored-By` trailer; Codex adds none.
- **Lives in:** git history.
- **Appeared:** n/a.
- **Bottleneck relieved:** n/a (attribution).
- **New bottleneck exposed:** Codex commits are not directly attributable.
- **Evidence:** `git log main --format=%B | grep -i '^Co-Authored-By:' | sed -E 's/<.*//' | sort | uniq -c | sort -rn`: Fable 5: 1,532; Opus 4.8 (1M): 878; Opus 5: 629; Fable 5.1: 516; Opus 5.5: 434; Opus 5 (1M): 411; Opus 4.6: 308; Opus 4.7: 213; Opus 4.7 (1M): 201; Opus 4.6 (1M): 185; Opus 5.5 (1M): 143; Sonnet 5: 108; Opus 4.5: 56; Sonnet 5.5: 47; Opus 4.8: 42; Sonnet 4.6: 13; "Claude Code": 13; Haiku 4.5: 3; "OpenAI Codex": 1. Totals: 5,732 trailers; main has 8,778 commits (7,033 non-merge). Families: Opus 3,500; Fable 2,048; Sonnet 168; Haiku 3.
  Codex proxy: non-merge commits since 2026-08-04 without Co-Authored-By: 997 of 3,748 (542 of them with a `Workstream` trailer). Joined with the session registry: commits in workstreams the registry records as `agent: codex` = 289 (283 without Co-Authored-By); `agent: claude` = 1,446 (1,396 with). Command: `git log main --no-merges -z --format='%(trailers:key=Co-Authored-By,valueonly,separator=;)|%(trailers:key=Workstream,valueonly,separator=;)'` joined with `jq -r 'select(.agent=="codex")|.name' ~/.cache/beebox/workstreams/*.json`.
  Monthly commits without Co-Authored-By (non-merge): 2026-05: 106, 06: 10, 07: 183, 08: 632, 09: 323, 10: 47.
- **Outcomes:** Codex authored at least 283 commits on main via 41 retained Codex workstreams (lower bound; culled workstreams are not in the registry). Fable became the largest single trailer value.
- **Prior-art mention:** no.

## Codex as a second engine (`--agent codex`)
- **One line:** `bin/launch-worktree-session --agent codex [--model]` runs OpenAI's Codex CLI in the same managed worktree, box clone, briefing and teardown flow as Claude.
- **Lives in:** `bin/launch-worktree-session`, `bin/lib/launch-session.sh`, `bin/codex-session-end`, `bin/lib/worktree-teardown.sh`, `bin/docs/worktree-lifecycle.md#sessions-and-generated-guidance`.
- **Appeared:** 2026-08-04 a9dcb4029 "feat(worktrees): launch OpenAI Codex sessions via launch-worktree-session --agent codex"; 2026-08-04 ad6acad97 "Give codex worktree sessions the teardown claude sessions get"; 2026-08-04 145e0c8d1 "feat(codex): grant finish/merge parity + mirror Claude skills and rules".
- **Bottleneck relieved:** second model family for review and capacity "when Claude quota is tight" (`.claude/skills/launch-worktree-session/SKILL.md`).
- **New bottleneck exposed:** ad6acad97: "Codex reads none of .claude/settings.json, so no SessionEnd/WorktreeRemove ever fired for it and codex worktrees only got collected by a manual `bin/worktrees sweep` (~10 had piled up)."
- **Evidence:** registry: 41 codex vs 97 claude workstreams (`cat ~/.cache/beebox/workstreams/*.json | jq -r '.agent // "none"' | sort | uniq -c`); Codex models: gpt-6-astra 12, gpt-5.6-sol 12, gpt-6-luna 7, gpt-6-sol 5, gpt-5.6-luna 3, gpt-5.3-codex-spark 2.
- **Outcomes:** 289 commits on main from Codex workstreams (above). Still in use.
- **Prior-art mention:** yes, dev/workstream-story.md "The seam test": "adding Codex sessions turned out to be surprisingly easy".

## The agent-neutral seam (`bin/workstreams`)
- **One line:** Lifecycle logic moved out of Claude Code hooks into a plain CLI; Claude hooks and the Codex launcher are thin clients.
- **Lives in:** `bin/workstreams`, `bin/lib/worktree-*.sh`, `bin/docs/worktree-lifecycle.md#ownership-and-roots`.
- **Appeared:** 2026-08-08 6d671837b "Promote worktree creation into `bin/worktrees create`"; 2026-08-09 c7f37aa5b "Extract shared session launcher"; 2026-08-09 a4d74648f "Rename worktree CLI to workstreams".
- **Bottleneck relieved:** workstream-story.md: Codex "had to impersonate Claude Code's hook JSON to reach it".
- **New bottleneck exposed:** not visible.
- **Evidence:** see workstream counts above.
- **Outcomes:** Later reused by scheduled workstreams (2026-08-24), which launch `claude -p` or `codex exec` through the same create/liveness flow, and by GLM sessions.
- **Prior-art mention:** yes, dev/workstream-story.md (seam section, seam.svg).

## AGENTS.md / skill / agent mirrors for Codex
- **One line:** `bin/generate-agents-md.ts` writes gitignored AGENTS.md beside every CLAUDE.md, symlinks `.agents/skills/*` to `.claude/skills/*`, and `bin/generate-codex-agents.ts` writes `.codex/agents/<name>.toml` from `.claude/agents/*.md` with a model mapping (sonnet → luna).
- **Lives in:** `bin/generate-agents-md.ts`, `bin/generate-codex-agents.ts`, `.agents/skills/` (symlinks), `bin/codex-skill-links.test.ts`.
- **Appeared:** 2026-08-04 a9dcb4029 (AGENTS.md mirror: "no prose transform, so nothing can mangle and nothing can drift (the committed find-replace mirror removed in 872450eb is the anti-example)"); 2026-08-04 145e0c8d1 (skill mirror, `generateSkillLinks`); 2026-09-16 0d65810d0 "Generate Codex agent mirrors so Codex /finish runs on gpt-5.6-luna".
- **Bottleneck relieved:** 0d65810d0: "the only finish.toml was a hand-written, stale fork in the main checkout with no model pin, so Codex /finish ran on the session default model, and worktrees had no finish agent."
- **New bottleneck exposed:** skills-review-2026-10.md item 6, "Codex mirror drift": main's `.agents/skills/` holds three real directories from July; `generateSkillLinks` prunes symlinks only.
- **Evidence:** 21 skill symlinks in `.agents/skills/` (this worktree, `ls .agents/skills | wc -l`, minus header lines); `.claude/agents/` has 1 agent (finish).
- **Outcomes:** Codex sessions load the same guidance; skill-usage shows Codex agent invocations of cross-model in 88 sessions.
- **Prior-art mention:** yes, skills-review (mirror drift).

## GLM as a provider of the Claude agent
- **One line:** `--model glm-*` keeps the agent as `claude` but points it at Z.ai's Anthropic-compatible endpoint for that one launch; quota shown alongside Claude and Codex.
- **Lives in:** `bin/lib/glm-provider.sh`, `bin/launch-worktree-session` header.
- **Appeared:** 2026-09-14 fb0e21501 "feat(glm): launch workstreams on GLM, and show its quota beside the others"; 2026-10-06 776043cb5 "Turn off Claude Code telemetry on third-party-model runs".
- **Bottleneck relieved:** a third, cheap capacity pool for "bounded mechanical work" (launch skill).
- **New bottleneck exposed:** fb0e21501: putting the variables in `~/.claude/settings.json` "would silently redirect every Claude Code session on the machine".
- **Evidence:** registry: 2 workstreams on glm-5.3.
- **Outcomes:** 2 retained workstreams used it. Judgment: low use; the boxholder has noted the subscription is ending.
- **Prior-art mention:** no.

## Dev-side model-choice ladder
- **One line:** Launch guidance picks the model by work type: Opus 5.5 for most implementation; Fable 5.1 for hard reasoning or delegation-heavy work; Codex Sol/Astra for the other family or tight Claude quota; small models (gpt-6-luna, sonnet, glm-*) for bounded mechanical work.
- **Lives in:** `.claude/skills/launch-worktree-session/SKILL.md` ("Choose the agent and model"); `.claude/skills/finish/SKILL.md` (finish pinned to Sonnet / gpt-6-luna); `.claude/skills/cross-model/SKILL.md` ("Choose by family, not tier"); schedule yaml `model:` fields.
- **Appeared:** 2026-07-09 29d83450b "CLAUDE.md: when running as Fable, delegate to Sonnet/Opus subagents + Codex-review major work"; generalized 2026-09-12 c8c728285 "Apply compact root agent guidance".
- **Bottleneck relieved:** 29d83450b: "Fable is the most capable/expensive model, so when it's driving it should orchestrate".
- **New bottleneck exposed:** alias drift (`2026-09-22-opus-alias-still-pins-opus-5.md`); skills-review: "settle the default engine (line 77 says Codex, memory says Fable/Opus)"; "Whenever Opus is chosen, use 5.5" rule.
- **Evidence:** registry Claude models: opus 34, claude-opus-5-5 30(+1 [1m]), claude-fable-5-1 25, claude-fable-5 3, sonnet 2, glm-5.3 2; Codex as above. Schedules: 6 Opus 5.5, 2 Sonnet.
- **Outcomes:** Trailer counts show the shift: Opus 4.x through mid-2026, Fable 5 the largest single value (1,532), Opus 5.5 now default. Model-term file counts (`git grep -l -w -i <term>`): Sonnet 98, Fable 68, GLM 65, Haiku 57, Sol 36, Astra 17, Luna 14.
- **Prior-art mention:** no.

## Box product model registry (distinct from dev choices)
- **One line:** The product maps engines (claude, codex; glm as a claude provider) to tiers `efficient / balanced / strong / strongest` (e.g. Codex: luna/terra/sol/astra); a box has `agentModel`, `smallModel` and enabled `engines` in `_config/box.json`, and chats may pin their own model.
- **Lives in:** `beebox/src/shared/agent-models.ts`, `beebox/src/shared/model-ids.ts`, `beebox/src/shared/chat-models.ts`, `beebox/docs/model-policy.md`, `beebox/docs/implemented-plans/model-engine-policy.md`, `beebox/docs/implemented-plans/engine-aware-chat-models.md`.
- **Appeared:** 2026-08-14 d2c80f011 "Finalize engine-aware chat model plan"; 2026-08-23 0cb20cecd "Fix engine-aware procedure model tiers"; 2026-08-25 89a5fb669 "docs: how a box chooses the model it thinks with"; 2026-08-25 418dc4ceb "docs(plans): box model/engine policy".
- **Bottleneck relieved:** model-policy.md: deferring to the harness "left both blank on every unpinned box".
- **New bottleneck exposed:** model retirement remaps (`model-ids.ts`: GPT-5.6 Luna and Sol fold into GPT-6 replacements).
- **Evidence:** 8 issues carry `workstream: model-engine-policy` (`grep -rl "^workstream: model-engine-policy" issues | wc -l`).
- **Outcomes:** Shipped product feature. Judgment: the dev side's practice of running both engines fed the product's dual-engine support.
- **Prior-art mention:** no.

## Real model calls policy
- **One line:** Workstreams may and should call real models/APIs for experiments and verification; Jev and small models need no permission; ask before sending real box content out or spending real money; never in committed doctests.
- **Lives in:** `beebox/docs/testing/real-models.md`; root `CLAUDE.md` ("Real model and API calls are allowed ... Jev and small models are cheap").
- **Appeared:** 2026-09-28 e484fba40 "Docs: workstreams may make real model calls; check keys before assuming not".
- **Bottleneck relieved:** doc: "Do not assume they are off limits. Check what is available, then decide."
- **New bottleneck exposed:** not visible.
- **Evidence:** example use: `beebox/docs/reports/prompt-calibration-pilot-2026-09-12.md` (Astra, Sol, Fable, Opus on 12 cases; predates the doc).
- **Outcomes:** Judgment: 11 days old; no count of calls available.
- **Prior-art mention:** no.

## Delegation to subagents ("lightest capable worker")
- **One line:** Root guidance: delegate without asking, lightweight models for bounded searches, mid-tier for most implementation, strongest for hard reasoning; full briefings for workers.
- **Lives in:** root `CLAUDE.md` "Implement and verify".
- **Appeared:** 2026-04-14 272d4bde0 "plan-extraction: use subagents + pdftotext for file content" (first commit mentioning subagents); 2026-07-09 29d83450b (Fable-specific delegation); 2026-08-31 2da898a52 "docs: encourage lightweight search subagents"; 2026-09-12 c8c728285 (current wording, "lightest capable").
- **Bottleneck relieved:** main-thread context and expensive-model turns (29d83450b quote above).
- **New bottleneck exposed:** shared-worktree collisions: bin/CLAUDE.md "parallel agents in one worktree should work in different packages"; "a bare commit can capture another agent's staging".
- **Evidence:** refreshed skill-usage (2026-08-10 to 2026-10-09): Claude 225 sessions (177 interactive + 48 SDK) with 1,845 subagent transcripts; Codex 508 sessions (85 interactive + 423 exec) with 298 subagent rollouts (`node --import tsx bin/skill-usage.ts --since 60 --json | jq .sessions`). skills-review-2026-10.md (2026-08-08 to 10-07) gave 228 + 1,699 Claude and 492 + 287 Codex. 106 commit messages mention subagent/delegat (`git log -i --grep='subagent\|delegat' | wc -l`).
- **Outcomes:** About 8 subagent transcripts per interactive-or-SDK Claude session. Codex is run mostly as `exec` (423 of 508), consistent with Codex as a scripted reviewer (cross-model-run) rather than an interactive driver.
- **Prior-art mention:** partial: skills-review gives the session counts; no doc covers the delegation rule.

## Headless finish subagent
- **One line:** `/finish` dispatches a headless `finish` subagent on a pinned mid-tier model (Sonnet; gpt-6-luna in Codex) that merges only on a clean path and otherwise returns BLOCKED.
- **Lives in:** `.claude/agents/finish.md`, `.claude/skills/finish/SKILL.md`, generated `.codex/agents/finish.toml`.
- **Appeared:** 2026-07-03 42d39875c "chore(claude): run /finish in a subagent; show model in status line"; Codex mirror 2026-09-16 0d65810d0.
- **Bottleneck relieved:** 42d39875c: "so the merge/test churn stays out of the main chat thread".
- **New bottleneck exposed:** skills-review: briefings used bare `/finish` sigils in 61 Claude and 22 Codex sessions (now refused by the launcher's sigil check).
- **Evidence:** covered by the finish/landing sweep; not recounted here.
- **Outcomes:** Still the landing path; Codex parity added 2026-09-16.
- **Prior-art mention:** yes, skills-review and workstream-story (finish ritual).

## Foreground rule for workers
- **One line:** Tell workers to run long commands (test suites) in the foreground, because a subagent waiting on its own background job can stall with nothing running.
- **Lives in:** root `CLAUDE.md`; `bin/docs/schedules.md#headless-sessions`.
- **Appeared:** schedules 2026-10-06 a8f45b4b8; root CLAUDE.md 2026-10-07 2505aba8c "Fold repo-overlapping memories into tracked guidance".
- **Bottleneck relieved:** stalled background-waiting sessions (a8f45b4b8 quote).
- **New bottleneck exposed:** not visible.
- **Evidence:** none counted.
- **Outcomes:** Moved from a personal memory into tracked guidance. Judgment: lesson learned first in unattended schedules, then generalized.
- **Prior-art mention:** no.

## Agent quota posture (`bin/agent-quotas*.ts`)
- **One line:** Normalized Claude and Codex (and opt-in GLM) account quota windows with a pace calculation (expected vs. used percent), shown on the workstreams dashboard and `bin/workstreams quotas --json`.
- **Lives in:** `bin/agent-quotas.ts`, `bin/agent-quotas-{parse,requests,collect}.ts`, workstreams-app dashboard.
- **Appeared:** 2026-08-10 52dd5e406 "Add agent quota pace to workstreams dashboard"; 2026-08-10 db2ed9364 "Use SDK-backed Claude quota cache"; GLM 2026-09-14 fb0e21501.
- **Bottleneck relieved:** choosing engine/model against remaining weekly capacity (launch skill: "it affects capability and quota").
- **New bottleneck exposed:** not visible. The phrase "spare quota this week" was not found in the repo.
- **Evidence:** `bin/workstreams quotas --json` at 2026-10-09: Claude 5-hour 11%, 7-day 69%, Fable 7-day 52%; Codex 7-day 57%, gpt-reserve 7-day 0%.
- **Outcomes:** In use on the dashboard. Judgment: both families' weekly windows are past half, consistent with running both engines near capacity.
- **Prior-art mention:** no.

## Cross-model review (cross-reference only)
- **One line:** Other-family review for anything beyond a small fix; `bin/cross-model-run --engine codex|claude` runs a read-only reviewer.
- **Lives in:** `.claude/skills/cross-model/SKILL.md`, `bin/cross-model-run`.
- **Appeared:** 2026-08-04 aae37764a "feat(skills): make the cross-model review skill bidirectional"; runner 2026-10-07 6657f44d1. Covered by another sweep.
- **Evidence:** skill-usage: 235 sessions; Claude agent-invoked 139, Codex 88.
- **Outcomes:** see the other sweep.
- **Prior-art mention:** yes, workstream-story.md, meta-practices.html ("2026-06-04 codex cross-model review").

## Skill-usage counter (`bin/skill-usage.ts`)
- **One line:** Counts skill invocations, loads, briefing mentions and recurring failures across local Claude transcripts and Codex rollouts; prints names and counts only.
- **Lives in:** `bin/skill-usage.ts`, `bin/lib/skill-usage-*.ts`.
- **Appeared:** 2026-10-07 b4e7e7005 "bin/skill-usage: count skill use in Claude Code and Codex transcripts".
- **Bottleneck relieved:** measuring both engines with one tool.
- **New bottleneck exposed:** skills-review: Codex "agent invocations" are bulk SKILL.md reads; "Loaded-but-unused could not be shown".
- **Evidence:** ran cleanly in the foreground (exit 0) with `--since 60 --json`.
- **Outcomes:** Feeds the retrospective schedule and dev/skills-review-2026-10.md.
- **Prior-art mention:** yes, skills-review-2026-10.md is built on it.

---

## Summary

- 15 schedules (not 14), born 9 in 2026-08, 4 in 2026-09, 2 in 2026-10. 2,237 runs, 81 headless agent sessions, 229 alerts, 91 schedule-workstream commits. full-suite caught 29 red landings (28 closed); sdk-update landed 23 SDK bumps and filed 15 issues.
- Schedules replaced four per-job launchd plists on 2026-08-24 (3ffc8885d); the next problems were alert noise (conditions and digest, 2026-09-18), host load (2026-09-11), and stranded unattended work (2026-10-06).
- Co-Authored-By: 5,732 Claude trailers (Opus 3,500, Fable 2,048, Sonnet 168, Haiku 3); one "OpenAI Codex". Codex commits carry no trailer; 283 commits on main come from 41 Codex-launched workstreams (lower bound).
- Refreshed 60-day sessions: Claude 225 + 1,845 subagents; Codex 508 (423 exec) + 298 subagents.

Could not verify:
- Exact Codex commit count. No trailer distinguishes Codex; the registry covers only 155 retained workstreams.
- How many issues alert-filing filed. They go to `private-issues/`, which is off limits; one alert record carries an issue path.
- Whether the run store prunes old runs. The earliest run files match the birth dates, so it appears complete.
- The source of the "spare quota this week" phrase (not in the repo).
- Usage of the `enabled: false` rule. It is documented in `beebox/docs/box-work.md`, but box `_config/schedules/` was not read.
- Birth of `bin/check-docling-update.ts`. The add-commit search returned 1ee6d1ab7 (2026-08-01) for a combined path set, so this sha is unconfirmed.
