---
title: "Health checks for box growth — nothing notices a box accumulating files, directories, or history until it kills the server"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — raised by the boxholder after a real-box watcher OOM, 2026-08-05
priority: important
resolution: implemented
---

> **Closed (2026-10-02):** recovered from an unmerged branch. The box-growth health check shipped afterwards in `beebox/src/core/box-growth/health.ts`; see [box-growth-warning-cannot-clear](../bugs/2026-08-10-box-growth-warning-cannot-clear.md) and [box-growth-measures-no-bytes](2026-09-19-box-growth-measures-no-bytes.md). Paths and command names below predate the Bee Box rename.

> **Job to be done:** *When some part of my box starts running away, I want to
> find out because the system told me — not because it fell over.*

A real box accumulated **69,048 directories** (68,869 of them synced email) and
nothing noticed until `bbx serve` started OOM-crashing, five times over three
days, taking a day of debugging to trace
([watcher OOM](../../closed/bugs/2026-08-05-box-watcher-unbounded-scale-oom.md),
[connector limiters](../../closed/bugs/2026-08-05-email-connector-needs-volume-limiters.md)).

**Boxholder's framing (2026-08-05):** *"Maybe we need a health check about files,
directories, and history entries. If they are accumulating too fast that's
probably a health issue. Email isn't the only thing that can blow up."*

That last sentence is the point: email was this instance, not the class. Bulk
upload, scan import, captures, procedure runs, chat transcripts, and any future
high-volume connector can all produce the same shape.

## The gap in what exists today

`webapp/trpc/routers/health.ts` has real coverage — credentials
(`claude-credentials`, `gemini-api-key`, …), writability (`inbox-writable`,
`git-writable`, `archive-writable`), annex integrity, `nav-card`. **Every one of
them is a binary "is this configured / is this broken" check.** Not one asks "is
this box getting too big, or getting bigger too fast."

The closest existing precedent — and the right shape to generalize — is
`unfiled-captures` (`health.ts:156`), which reports a *backlog accumulating*
rather than a thing being broken.

## Design notes (not decisions)

- **Absolute AND rate, because they catch different failures.** An absolute
  threshold would have caught that box (69k directories is wrong however
  it got there). A growth rate catches a runaway *early*, before it's fatal, and
  catches a box that's fine-but-trending. Rate alone misses a box that was
  already pathological when adopted; absolute alone can't warn before the wall.
- **Per-subtree, or it isn't actionable.** "The box grew by 20k directories" is
  a shrug; "`box/inbox/email` grew by 20k directories" names the culprit and the
  fix. Attribution is most of the value.
- **What to count:** directories (the metric that actually killed us), files,
  git history size/commit count/object count, and largest-subtree breakdown.
  Directory count deserves first-class status precisely because it's the one
  nobody thinks about — it's what maps to watch handles, inotify limits, and
  whole-tree scan cost.
- **Where it runs matters.** A check hosted *inside* the box server can be
  starved by the very condition it's meant to report — that box's server was
  GC-thrashing so badly a one-card git commit took 29 seconds. Prefer a host
  that survives a sick box (scheduler/tick, or hub-level), and keep the check
  cheap enough to run regularly (walking 69k directories to learn you have 69k
  directories is fine hourly, not per-request).
- **Report, don't auto-remediate.** The check's job is to surface the anomaly to
  the boxholder (and to the agent as context); deciding *what to prune* is
  judgment that belongs to a human or an agent procedure, not to a code path
  that deletes things.
- **Detection is only half.** The other half is subsystems bounding themselves
  (the watcher item's "isolation" half). Detection without bounding means you
  learn why the process died; bounding without detection means silent
  degradation nobody investigates. Both, and they're separable work.
- **Loud at the moment, not only on a schedule.** A periodic check would have
  caught this eventually, but so would one log line when the watcher installed
  its 10,000th watch. Subsystems that allocate resources proportional to box
  size should say so once when the number is abnormal — cheaper than any
  scanner and immediate.

## Boxholder design guidance (2026-08-05)

**It must be a dismissible warning, not a verdict.** *"I might upload a couple
hundred images as part of some project, and that's intentional… it should
probably result in a warning, that can be addressed or dismissed."* So the check
needs persisted state — a baseline to measure growth against, plus a record of
what the boxholder already acknowledged, so an accepted burst stops nagging and
the new normal becomes the new baseline. A check that cries wolf on intentional
work gets ignored, which is worse than not having it.

**Attribution by source is the discriminator.** *"Things that come from chat are
probably okay. Things that come from connectors are the real danger, and we have
some git evidence of which is which."* That is the right instinct: user/chat-
driven growth is intentional by construction; connector-driven growth is the
unattended kind that ran to 69k directories. Weighting the warning by source
turns a noisy size metric into a meaningful one.

### But the git evidence is much thinner than it looks — verify before relying on it

Measured on a real box, last 2000 commits: **only ~32 carry a `Created-By:`
trailer** (~1.5%) — 12 `google-calendar-connector`, 12 `capture`, 3
`retrospective`, 3 `document-reanalyze`, 1 `wakeup-contains-backfill`, 1
`bbx init`. Everything else has none, including the bulk: 665 `Sync templates
from upstream`, 307 `Tick: housekeeping`, 79 `Sync calendar:` (note the calendar
connector emits 79 subject-matching commits but only 12 trailers — even a
connector that *knows* about trailers isn't consistently emitting them).

So the attribution channel exists as a convention and is nearly unpopulated in
practice. Any growth check that keys off `Created-By:` today would see almost
everything as unattributed. Options, in rough order of preference: fix trailer
coverage at the commit sites first (it's the durable fix and helps everything
else that reads history), fall back to commit-subject patterns where trailers
are missing (weaker, but `Sync calendar:` / `Tick: housekeeping` are real
signals), or attribute by path rather than by commit (`box/inbox/email` is a
connector's territory regardless of who committed it). Probably some of each —
but the coverage gap should be measured and stated, not assumed away.
