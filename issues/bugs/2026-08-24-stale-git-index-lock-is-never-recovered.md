---
title: "A stale `.git/index.lock` is treated as live contention forever — every committing task fails until a human deletes it"
workstream: stale-git-lock
area: callback-box
priority: important
labels: [git, scheduler, boxes]
filed-by: agent
discovered-by: agent
discovered-in: main session — a box's scheduled tasks failing for days on index.lock
---

Found on a real box: `.git/index.lock` present, **2.2 MB**, dated **11 hours
earlier**, with **no git process running**. A crashed git had left a
partially-written index behind. Every subsequent commit — scheduled tasks, the
box agent, and a hand-run `git commit` — failed with:

```
fatal: Unable to create '<box>/.git/index.lock': File exists.
```

Removing it (git's own advice: *"If it still fails, a git process may have
crashed in this repository earlier: remove the file manually to continue"*)
restored everything immediately.

## The gap

The codebase reads this condition carefully and then draws the wrong
conclusion. `lib/git-internal.ts` has a dedicated `GitIndexLockError` whose
docstring says the lock was held by "another process … and would not release
it", and `isContendedFailure()` classifies it so a task that **lost a race**
does not read as **broken**. `withBoxGitLock` serializes our own writers and
fails open.

All of that is right for *live* contention. **Nothing distinguishes a live
holder from an abandoned file.** A stale lock is permanent by nature, so the
system reports "contended — another process held the box's git index" every
run, forever, which reads as transient bad luck and invites waiting it out.
`cb health` says exactly that, indefinitely.

The signals to tell them apart are cheap and already on disk: the lock's age,
and whether any process actually has it open. Neither is consulted.

## Why it is worse than it sounds

- **It is silent to every writer at once.** The box agent's own auto-commits,
  the scheduler, procedures — all fail identically, so the box looks broadly
  broken rather than blocked on one file.
- **It masks the tasks it blocks.** A weekly job that fails on the lock records
  a contention failure and does not retry until next week, so one crashed git
  can cost a full cycle even after the lock is cleared.
- **The wording actively misleads.** "Another process held the box's git index"
  states something that is false, in a report a boxholder is meant to trust.

## What to fix

- **Detect staleness.** No holder (`lsof`) plus an age beyond any plausible git
  operation is a confident "abandoned". `lib/file-lock.ts` already does exactly
  this for our own locks — mtime-freshness stale recovery via `proper-lockfile`.
  Git's index lock gets none of it.
- **Then decide the policy deliberately.** Auto-removal is what git advises a
  human to do and is probably right for an unheld, hours-old lock; the
  conservative alternative is to keep failing but *say* it is stale and name the
  file to delete. Either beats today's indefinite "contended".
- **Surface it in health as its own check**, not as a per-task failure
  message — one stale file is a box-level condition, and reporting it per task
  is what let it hide for hours.
- **Consider a startup sweep**, matching the router's existing habit of
  reclaiming orphaned state on start.

## Related

- [Scheduled task dies on `.git/index.lock`](../closed/bugs/2026-08-18-scheduled-task-dies-on-git-index-lock.md)
  — the retry-budget work that produced `withBoxGitLock`. It solved contention
  between our own writers; it did not consider an abandoned lock, which is why
  the symptom returned looking identical.
