---
title: "bbx tick exits 0 on errors and deferrals and reports no per-script result"
workstream: unattached
area: beebox
labels: [scheduler, testing, harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

`bbx tick` exits 0 when a script errored or was deferred and prints no
machine-readable outcome per script. Harness code that drives a box through
time (the journey phone walk) infers each outcome from side effects, such as a
diff of the notification log before and after the tick.

Coding feedback: journey-walks-late-oct/20261023T130255Z-plan-reviewed.md,
journey-walks-late-oct/20261023T131948Z-implemented.md,
journey-walks-late-oct/20261023T135922Z-plan-reviewed.md.

Direction named in the entries: `bbx tick --json` with ran, skipped (and
why), or error per script.
