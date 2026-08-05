---
title: "`cli/commands/view-check.doctest.md` flakes under full-suite load"
area: callback-box
filed-by: agent
discovered-in: worktree-session-report-bounded — /finish full-suite verification
resolution: implemented
---

Resolved in `d590ed90`. The correctness fixture now gives each child render 60
seconds while the doctest file retains its 300-second outer hang limit. The
production command's timeout is unchanged. The focused test passed 7/7, and the
six-job callback-box suite passed 6,163/6,163.

`callback-box/test/cli/commands/view-check.doctest.md` failed during a full
`pnpm test` run.
The first scenario expected the `good.tsx` view result to have `ok: true`, but
the result had `ok: false` instead:

```
view-check.doctest.md:71 — expected true, got false
```

The scenario took 44 seconds. It calls `checkViews` with a 20-second timeout for
each view. The full suite ran many doctests concurrently, so resource contention
may have caused the valid view to exceed its timeout.

The exact file passed 7/7 immediately afterward in isolation with
`pnpm test test/cli/commands/view-check.doctest.md`. The session-report branch
did not change this test or the view rendering path.

Make this test robust under full-suite load. Preserve coverage that distinguishes
a valid view from a broken view; do not remove the timeout behavior from the
production command.
