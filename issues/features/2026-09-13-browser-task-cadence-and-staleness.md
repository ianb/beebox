---
title: "browser-task: a cadence field so a feed task can be due, and read as stale"
workstream: browser-tasks
area: beebox
priority: normal
labels: [browser-task, schedules]
filed-by: agent
discovered-by: the mn-pottery box agent, in its report on the first real run
discovered-in: worktree-browser-tasks — first Facebook page scan (2026-09-12)
---

A `browser-task` card is `open` or `closed`. A feed task is really a standing
subscription with three states: never scanned, scanned and current, scanned
and stale. Nothing says how often a task should run, so nothing can surface
"this page has not been scanned in four months". Today the only thing that
reruns a task is someone remembering.

`scheduled-script` cards carry a cadence; this card should too.

## Shape

- A `rescan-after` duration field (`14d`, `P2W`) on the card, optional.
- The view shows **due** when `last-upload` plus the cadence is in the past
  (and "never scanned" when there is no `last-upload`), instead of only the
  14-day stale line it shows now.
- A box listing of due tasks (dashboard or a landmark), so the boxholder sees
  what to run without opening each card.
- No automation: the executor is still a person starting a session. The
  cadence makes the ask visible, not the run automatic.

## Related

- `beebox/docs/implemented-plans/browser-task-card.md`
- the scan-history issue filed alongside this one
