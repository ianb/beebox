---
title: "\"Call before 7 November\" becomes a todo due 7 November"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — G-paperwork walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. Box-agent guidance (`docs/box/todos.md`): `due` is the last day the action still counts. Knowledge audit passed.

The insurance renewal letter in the G-paperwork walk said "please call us before 7 November 2026". The agent wrote the todo with `due="2026-11-07"` and told the person "you need to call them by 7 Nov". By the letter, a call on 7 November is late. In 2026, 7 November is a Saturday, so the last working day is earlier still.

The record's `dates:` entry is right (kind `deadline`, note "Call before this date"). Only the todo's `due` and the chat wording lose the "before".

Report: [G-paperwork](../../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (R1).

## Why the fix is not obvious

`beebox/box-docs/todos.md` does not say what `due` means for "before <date>" wording. One line could say: `due` is the last day on which the action still counts, so "before 7 November" is due 6 November. This is one instance. The G letter now gives 6 November, a Friday (`ecbc4bc80`), so the next G walk can check the same wording again.
