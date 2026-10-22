---
title: "A standing care hint becomes an undated todo and the only \"now\" item"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — G-paperwork walk, 2026-10-22
---

The boiler receipt in the G-paperwork walk had a handwritten line: "keep the ivy cut back!". The agent made it a todo with no date (box commit `3dcf605`). An undated todo means "due now, no date opinion" (`beebox/box-docs/todos.md:19`). It became the only "now" item. The Todos headline read "1 now · 5 later", and the five dated deadlines were "later". The Box page said "1 to do" (see [Box page count omits later todos](2026-10-22-box-page-to-do-count-omits-later-todos.md)).

The walker: "'now' is the ivy, undated, which isn't what I'd call urgent."

The person came to see what needs doing by when. The one item that the box puts first is a habit with no deadline, and the real deadlines sit behind it.

Report: [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (row 28).

## Why the fix is not obvious

Decide what a standing instruction is. Options: keep it as reference text on the record (the record already quotes it) and make no todo; or give the agent a rule in `beebox/box-docs/todos.md` that a habit with no deadline gets a `start` date or stays out of the todo list. The [closed non-date triggers issue](../closed/features/2026-09-15-todos-have-no-blocked-state-or-non-date-triggers.md) covers nearby ground.
