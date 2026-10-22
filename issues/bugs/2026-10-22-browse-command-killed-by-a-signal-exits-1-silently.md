---
title: "A bin/browse command killed by a signal exits 1 with no message"
workstream: unattached
area: browse
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — G-paperwork and B-inventory walks, 2026-10-22
---

In the 2026-10-22 journey round, the G-paperwork and B-inventory walkers got no output and exit 1 from every `bin/browse snapshot` for the whole walk. Each call took 62-94 s. A walker cannot tell a hang, a timeout, a kill, and an empty page apart from this result. B tried six forms of the command and lost 9 minutes; G lost 8.

The cause of the kill is fixed: the worktree reaper SIGTERMed other sessions' in-flight agent-browser clients, and `21e9872db` now spares a process that is not a detached daemon. The silent result is not fixed. When upstream's client dies by a signal, `annotatedSnapshot` (`browse/src/act.ts:151-158`) writes the client's stderr, which is empty, and returns `e.code === -1 ? 1 : e.code`. Other commands that go through the same runner may do the same.

Reports: [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (H1), [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) (H1).

## Fix direction

- When the client ends by a signal, say so: "snapshot killed by SIGTERM after N s".
- Never produce an empty exit 1 from the runner; name the cause or say that upstream gave none.
- Bound `snapshot` with a timeout and name the commands that still work (`eval`, `screenshot`) in the error.

The upstream hang that made these snapshots slow enough to be reaped is recorded in [browse daemon wedges](2026-07-14-browse-daemon-wedges-on-animated-canvas.md).
