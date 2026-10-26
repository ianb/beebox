---
title: "bin/smoke's fixed 120 s step budget blocks finish under host load"
workstream: unattached
area: beebox
labels: [finish, smoke, load, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

The smoke walk gives each step a fixed 120 s budget. When other sessions load
the machine (load average 10 to 40), steps run 3 to 7 times their usual time
and the place-switch or landmark step exceeds the budget. Finish then blocks on
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

Directions named in the entries: scale a step's budget by its recorded median
or by load average; wait for load to drop before the walk starts; or report a
step over budget whose time is in line with the walk's overall slowdown as a
load verdict distinct from red.
