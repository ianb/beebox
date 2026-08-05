---
title: "`cli/commands/view-check.doctest.md` flakes under full-suite load"
area: callback-box
filed-by: agent
discovered-in: worktree-session-report-bounded — /finish full-suite verification
---

`test/cli/commands/view-check.doctest.md` failed during a full `pnpm test` run.
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
