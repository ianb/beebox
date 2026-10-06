---
title: "Scheduled runs leave finished work on their worktree branches; later runs do not land it"
workstream: schedule-session-landing
area: schedules
filed-by: agent
discovered-by: Ian
discovered-in: main — disk cleanup and worktree review, 2026-10-02
priority: important
resolution: implemented
---

Resolved in the schedule-session-landing workstream. After every run of a
worktree schedule, a branch whose merge into `main` would change `main` is the
runner-owned `unlanded-commits` condition (`normal`). It stays open through
each digest and is filed after a week. The briefing lists the inherited
commits, so a prompt that lets the session land its own work covers them too.
The runner never lands.

Correction to "Observed": `cross-box-leak-scan` run `20261002-014511` was not
refused. It launched and reported (`runs/20261002-014511.result.json`). The
only "session already live" refusal is run `20260904-013251`, which read
`live` (a process signal), not `unknown`. Its cause cannot be recovered
because the alert did not carry the guard's reason. Refusal alerts now carry
it.

Worktree schedules commit on a long-lived branch and are expected to land with
`bin/land` (bbx-authoring-schedules, "How work leaves a worktree schedule").
Several schedules left work on their branches for weeks. Each later run judged
only its own findings, so nothing picked the stranded work up.

## Observed (2026-10-02)

- `cross-box-leak-scan`: commit `7c95a7cb6` (2026-09-11) was reported "Ready
  to land" in that run's `fyi` alert but was not landed. Later runs reported
  "nothing to land" because they made no new commits. Landed by hand as
  `853590f56`.
- `manual-tests`: two triage commits from the 2026-09-15 run were not on main.
- `tour-check`: one commit (`e98f25e64`) was not on main.
- `knip-sweep`: run `20260930-080535` ended with 42 uncommitted edits. Its last
  message was "Waiting on the full beebox suite before committing." The
  session exited without `alert` or `done` (the runner raised the bailed-run
  alert). This matches the background-wait stall pattern: the session
  backgrounded the suite and went idle.
- `cross-box-leak-scan` run `20261002-014511` was refused with "work waiting,
  session already live". No agent appeared live in that worktree later that
  day. The liveness guard treats `unknown` as live
  (`bin/lib/schedules-workstream.ts:37`), so a stale or unknown reading blocks
  a run.

## Why the fix is not obvious

- The runner could land, or refuse, at session end: "branch ahead of main
  after the session" is a mechanical check. But `bin/land` can refuse
  legitimately (main dirty, not a fast-forward), and the guidance says to wait
  a day instead of forcing.
- A pre-run check could alert when the branch is already ahead of main before
  the session starts, and the prompt could tell the session to land
  inherited commits first. That changes each schedule's authority.
- The bailed-run alert already fired for `knip-sweep`; the gap is that nobody
  acted on it, and the next run's baseline had already moved, so a rerun would
  hand off nothing.
- The false-live refusal needs its own diagnosis: what `agent-liveness`
  returned at 01:45 and why.
