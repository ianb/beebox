---
title: "bin/smoke's fixed 120 s walk budget blocks finish under host load"
workstream: unattached
area: beebox
labels: [finish, smoke, load, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
resolution: implemented
---

Closed 2026-10-29 (tooling-burndown): the walk's budget now grows with how much
slower than usual its finished steps ran (their total time over the total of
their run-log medians), up to 3 times 120 s. A step that hangs on a healthy host
gets no extension, because the steps before it ran at their usual speed; the
2026-10-27 and 2026-10-30 place-switch reds (earlier steps 0.5 to 1.5 times
usual, the failing step alone at 85 to 108 s) still fail at 120 s. The verdict
stays green or red, so `bin/finish-verify` needs no change; the result line
reads, for example, `SMOKE: green (49.1s of 139s budget, steps 1.2x usual)`.
Waiting for load to drop was not chosen: load stays at 10 to 40 for hours here,
and a separate load verdict would leave the later steps unwalked.

The smoke walk has one fixed 120 s budget (`BUDGET_MS` in `bin/smoke.ts`);
`Budget.race` in `bin/smoke-harness.ts` gives each step only the time that
remains. When other sessions load the machine (load average 10 to 40), steps
run 3 to 7 times their usual time, and a later step such as the place-switch or
landmark step fails because the earlier steps used the budget. Finish then blocks on
a change unrelated to the UI, and the agent waits for the load to drop and
reruns. Per-step timings with their medians (added 2026-10-12, see
issues/closed/bugs/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md)
show the cause but do not change the verdict.

Coding feedback: apple-stt-tuning/20261023T193620Z-landed.md,
gmail-404-stuck/20261023T050237Z-landed.md,
gmail-404-stuck/20261023T051627Z-landed.md,
knowledge-audit-refresh/20261023T125711Z-landed.md,
journey-walks-late-oct/20261023T124225Z-landed.md,
perf-easy-wins/20261024T012103Z-implemented.md (a stuck `bin/browse`
browser gave the same symptom). Earlier runs recorded three more on the
retrospective watch list.

Directions named in the entries: scale the walk budget by the steps' recorded
medians or by load average; wait for load to drop before the walk starts; or report a
walk over budget whose steps all slowed by a similar factor as a load verdict
distinct from red.
