---
title: "Low-priority job cards never drain, and one wedges the search index indefinitely"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — investigating growth on a production box
labels: [code-error]
priority: important
---

`cb wakeup` runs its reactor cycle with `skipLowPriority: true`
(`callback-box/src/cli/commands/wakeup.ts:128`). A reactor cycle skips
entirely when every pending job is low priority
(`callback-box/src/core/reactor/cycle.ts:123`). Scheduled wakeup is the only
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
(`callback-box/src/cli/commands/wakeup-steps.ts:376`) returns early when a
`contains-backfill` job is already pending, and that early return is *before*
its `openSearchIndex(boxRoot)` call on line 381:

```ts
const pending = await findJobCards(jobsDir, { sourceFilter: CONTAINS_BACKFILL_SOURCE });
if (pending.length > 0) return 0;

await openSearchIndex(boxRoot);
```

`openSearchIndex` is the refresh — it is what reconciles the index against the
card tree. Its only other callers are `cb init` and `cb contains`, neither of
which runs on a schedule. So one undrainable low-priority card takes the
search index out of the wakeup path permanently.

Consequence on the observed box: `.callback-box/search-index.json` was last
written 2026-08-04 and is 165 MB, with a 19 MB companion manifest. It still
indexes roughly 141,000 documents that were removed from the box on 2026-08-06
— about 98% of its content is deleted files. The box's whole `.callback-box`
is 193 MB against 415 MB of content; comparable boxes on the same server sit
at 1–21 MB. Search results on that box are silently answering from a six-day-old
tree.

## Relationship to the closed intake-job issue

This is a sibling of
[gmail-intake-job-never-drains-quiescence](../closed/bugs/2026-08-08-gmail-intake-job-never-drains-quiescence.md),
not a recurrence of it. Same class — a card left in `box/jobs` that the
reactor as actually invoked never clears — but a different filter (priority,
not connector scope), a different job kind, and it bites production rather than
the field-test harness. That issue's fix (drain in the field-test pre-action)
does not touch the scheduled-wakeup path, so it could not have covered this.

The hazard is already half-documented in-tree:
`callback-box/src/schemas/todo-review-job.ts:37` explains that `low` is for
"genuinely-optional" work precisely because wakeup skips it. Nothing says what
happens when such a job is queued anyway and no one ever runs an unfiltered
reactor.

## Directions (unsettled)

- Age out low-priority jobs: after N wakeups (or N days) pending, promote to
  normal so they get processed, or expire the card.
- Run an unfiltered reactor on a slower cadence (e.g. the daily housekeeping
  tick) so low-priority work drains eventually.
- Separately, and independently worth doing: move the `openSearchIndex` call
  in `createContainsBackfillJob` above the pending-job early return. Refreshing
  the index is not conditional on wanting to queue a backfill — it is what
  tells you whether one is needed. This alone unwedges search without deciding
  the priority question.
- Decide whether a stale search index deserves a health check. Today nothing
  reports it; the index's own staleness is invisible until someone compares
  mtimes.
