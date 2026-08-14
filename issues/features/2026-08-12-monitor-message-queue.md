---
title: "Scheduled monitors have no way to talk to Ian — a message queue outside git"
workstream: unattached
area: monorepo
needs: [design]
labels: [scheduler, workstreams, notifications]
filed-by: agent
discovered-by: Ian
discovered-in: main session — cb feedback triage
priority: normal
---

The recurring jobs — the Agent SDK update monitor, the weekly manual-test run,
periodic health monitors, the scheduler daemon — all suffer the same problem:
**it's hard for them to tell Ian anything.** Each invented its own channel, and
none of them is something he can work through later.

| Job | How it reports |
|---|---|
| `bin/update-agent-sdk-scheduled.sh` | `PushNotification` + an `osascript` notification on nonzero exit |
| `bin/manual-tests-scheduled.sh` | its own `notify()`, plus a triage agent that files `issues/` items |
| `callback-box/deploy/deploy.sh` | `notify()` / `terminal-notifier` |
| the scheduler daemon (`cb tick`) | **nothing** — writes `.callback-box/scheduler.jsonl` and hopes |

Four jobs, four mechanisms, and a macOS notification is gone the moment it's
dismissed. Recent cost: a deploy died mid-run and said nothing (the trap never
fired), and `demo-daily-rumination` was broken for six weeks with no signal.

## The idea: a queue, out of git

A message queue **outside git** that scheduled work writes to and Ian reads —
so a monitor with something to say has somewhere durable to put it that isn't a
notification (ephemeral), an issue (too heavyweight for "FYI, I bumped a
version"), or a log file (nobody reads logs).

Out of git specifically because these are *messages*, not repository state:
they'd otherwise churn commits, conflict across worktrees, and force every
routine "nothing to report" into version control.

## The workstreams fit

Each monitor could **be a workstream**, so its messages are just that
workstream's, and getting back to it is reviving the workstream — the motion
`/workstreams/` already provides. That reuses the front page, the detail view,
and the resume verb rather than building a second inbox.

Open, and the reason this isn't obvious: **a monitor probably doesn't want a
worktree.** Nothing about "the SDK monitor has 3 unread messages" needs an
isolated checkout. Not terrible if it gets one, but unnecessary — so either the
workstream registry needs to admit worktree-less workstreams, or monitors get a
lighter-weight relationship to it. That's the design question worth settling
first, because it decides whether this is a small addition or a change to what a
workstream *is*.

## Open questions

- What's a message? A line, or something with a state (unread / acted on /
  dismissed)? The second is much more useful and much more machinery.
- Where does it live — `~/.cache`, a state dir, the box? It must survive a
  worktree being removed.
- Does anything escalate? A message nobody reads for a week is the failure this
  is meant to fix, so silence needs its own answer.
- Relationship to `issues/`: a message that turns out to matter should be
  promotable to an issue, the same way feedback is.
