---
title: "Unattended schedules have no backstop against a permission prompt nobody can answer"
workstream: sdk-update
area: beebox
priority: backlog
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.259
labels: [sdk-update]
---

Claude Code 2.1.259 added `--permission-prompts none` (and the SDK's
`permissionPrompts: 'none'`) "for unattended headless hosts: anything that would
prompt is denied automatically while the active permission mode (including auto
mode) keeps deciding".

Every `schedules/*` run is such a host: `-p`, no terminal, nobody to answer. What
each run passes today comes from its `schedule.yaml` `permissionMode` —
`bypassPermissions` for most, `dontAsk` for `manual-tests`. Neither is quite the
same guarantee. A permission mode decides how *tool* permission checks resolve;
the new flag covers anything that would put up a prompt regardless of mode. That
those are different is not a guess: 2.1.259 also fixes *"remote and scheduled
sessions doing nothing after a connector-tool permission prompt was approved
while the session was paused"*, and 2.1.248 fixed background sessions waiting
silently on a hook that printed an invalid permission answer. Prompts have been
reaching unattended sessions by paths a mode does not cover.

The cost of one getting through is a run that produces nothing and reports
nothing — a bailed run, with the least diagnosable signature this schedule
system has, since the transcript just stops.

**The change would be small**: `bin/schedules-agent-command` builds the argv, so
this is one more flag alongside `--permission-mode`, plus a line in
`schedule.yaml`'s schema if it should be per-schedule rather than always-on.

**Worth deciding rather than defaulting**, in two respects. First, auto-denying
changes what a schedule does when it meets something it needs: it fails fast
instead of hanging, which is better, but a schedule that was *silently* relying
on a prompt would now visibly break — that is the point, and it should be a
choice. Second, `manual-tests` is the one schedule with a real allowlist, so it
is both the most likely to meet a denial and the one where a denial is most
clearly correct.

Not urgent: no schedule run has been observed to hang this way. Filed because
the backstop is cheap and the failure it prevents is the one this system reports
worst.

Context: the 2.1.259 entry in `docs/agent-sdk-notes.md`.
