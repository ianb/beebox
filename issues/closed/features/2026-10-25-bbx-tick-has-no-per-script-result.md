---
title: "bbx tick exits 0 on errors and deferrals and reports no per-script result"
workstream: unattached
area: beebox
labels: [scheduler, testing, harness]
filed-by: agent
discovered-by: agent
resolution: implemented
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

**Resolved 2026-10-29** — `bbx tick --json` prints a record per script (ran, skipped with reason, error with message). The exit status stays 0 on script errors: the field-test day advance runs `bbx tick` and fails on a nonzero exit. The journey phone-walk wait (`beebox/test/user-stories/journeys/phone-wait.ts`) reads each tick's outcome from the `--json` records; it keeps the notification-log diff only to find which notification was sent.

`bbx tick` exits 0 when a script errored or was deferred and prints no
machine-readable outcome per script. Harness code that drives a box through
time (the journey phone walk) infers each outcome from side effects, such as a
diff of the notification log before and after the tick.

Coding feedback: journey-walks-late-oct/20261023T130255Z-plan-reviewed.md,
journey-walks-late-oct/20261023T131948Z-implemented.md,
journey-walks-late-oct/20261023T135922Z-plan-reviewed.md.

Direction named in the entries: `bbx tick --json` with ran, skipped (and
why), or error per script.
