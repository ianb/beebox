---
title: "Low-priority job cards never drain, and one wedges the search index indefinitely"
workstream: low-priority-jobs
area: beebox
filed-by: agent
discovered-in: worktree-box-family-email — investigating growth on a production box
labels: [code-error]
priority: important
resolution: implemented
---

`bbx wakeup` runs its reactor cycle with `skipLowPriority: true`
(`beebox/src/cli/commands/wakeup.ts:128`). A reactor cycle skips
entirely when every pending job is low priority
(`beebox/src/core/reactor/cycle.ts:123`). Scheduled wakeup is the only
thing that runs a reactor on a deployed box. So a box whose `box/jobs` holds
only low-priority cards never drains them — not late, never.

Observed on a production box: three pending job cards, all `priority: low`,
created 2026-05-17 (`calendar-review-job`, source `google-calendar`),
2026-06-19 and 2026-07-01 (`contains-backfill`, source `contains-backfill`).
Ages at time of writing: 85, 52 and 40 days. The box is otherwise healthy and
ticks every minute.

## The wedge

The stuck `contains-backfill` card is not just stale — it disables the search
index. `createContainsBackfillJob`
(`beebox/src/cli/commands/wakeup-steps.ts:376`) returns early when a
`contains-backfill` job is already pending, and that early return is *before*
its `openSearchIndex(boxRoot)` call on line 381:

```ts
const pending = await findJobCards(jobsDir, { sourceFilter: CONTAINS_BACKFILL_SOURCE });
if (pending.length > 0) return 0;

await openSearchIndex(boxRoot);
```

`openSearchIndex` is the refresh — it is what reconciles the index against the
card tree. Its only other callers are `bbx init` and `bbx contains`, neither of
which runs on a schedule. So one undrainable low-priority card takes the
search index out of the wakeup path permanently.

Consequence on the observed box: `.beebox/search-index.json` was last
written 2026-08-04 and is 165 MB, with a 19 MB companion manifest. It still
indexes roughly 141,000 documents that were removed from the box on 2026-08-06
— about 98% of its content is deleted files. The box's whole `.beebox`
is 193 MB against 415 MB of content; comparable boxes on the same server sit
at 1–21 MB. Search results on that box are silently answering from a six-day-old
tree.

## Relationship to the closed intake-job issue

This is a sibling of
[gmail-intake-job-never-drains-quiescence](2026-08-08-gmail-intake-job-never-drains-quiescence.md),
not a recurrence of it. Same class — a card left in `box/jobs` that the
reactor as actually invoked never clears — but a different filter (priority,
not connector scope), a different job kind, and it bites production rather than
the field-test harness. That issue's fix (drain in the field-test pre-action)
does not touch the scheduled-wakeup path, so it could not have covered this.

The hazard is already half-documented in-tree:
`beebox/src/schemas/todo-review-job.ts:37` explains that `low` is for
"genuinely-optional" work precisely because wakeup skips it. Nothing says what
happens when such a job is queued anyway and no one ever runs an unfiltered
reactor.

## Resolved

Fixed in `worktree-low-priority-jobs`, 2026-08-18.

**Low priority now means "may wait", not "may wait forever".** A low-priority
job pending longer than 24h earns a cycle of its own; a cycle triggered that
way admits at most the five oldest overdue jobs, so a box coming out of a long
wedge drains at a pace instead of dumping months of deferred work into one
agent prompt. What `skipLowPriority` was protecting still holds: an idle box
does not spend an agent turn every tick on filler, and normal work is never
delayed by a low-priority backlog. Age comes from the timestamp prefix every
job-card writer stamps into the filename — no card mutation, nothing to keep
in sync; an unstamped name falls back to mtime, and an age that can't be
established reads as young. See `discoverStage` in
`beebox/src/core/reactor/cycle.ts`.

**The index refresh has its own footing.** Rather than hoisting the one line,
`openSearchIndex` moved out of `createContainsBackfillJob` entirely and became
a `bbx wakeup` step (`refreshSearchIndex`), run unconditionally ahead of the
backfill step that reads the `contains` state it writes. A refresh whose
execution is incidental to an unrelated guard breaks again the next time that
guard grows a return. It returns false when it did not actually reconcile —
it threw, or it lost the search lock to another process and served the last
persisted index untouched — and the backfill step is skipped in that case
rather than choosing a batch from state that predates the card tree.

**Something complains now.** `bbx health` reports any job pending over 7 days as
a warning (`stalled-jobs`, in `health-stale.ts`). It reports the fact — a job
is old — independent of the reason, because the next instance of this class
will stall for a reason we haven't met: a failing agent, a connector-scoped
wakeup that never sees that job's source, a hand-written card.

## One correction to the diagnosis above

The wedge is narrower than "disables the search index". Search *queries* call
`openSearchIndex` too (`core/search/query.ts`), so a query refreshes the index
lazily on its own. What the stuck card removed was the only *scheduled*
refresh: the persisted index rots and bloats, and the next query pays the whole
reconciliation at once (and concurrent queries during that slow refresh take
the stale path). The observed box's index was six days behind because nothing
had searched it in six days, not because search was answering from a stale
tree.

## Deploy note

Prod boxes have accumulated these cards. The first full `bbx wakeup` after this
ships will do two things at once on such a box: process up to five long-overdue
low-priority jobs, and run the first index reconciliation in months — which on
the observed box means restoring a 165 MB index to drop ~141,000 deleted
documents, under the search lock. It is a one-time cost (the index shrinks to
its real size and every later refresh is cheap) and a query would have paid the
same cost, but it is worth watching rather than discovering.
