---
title: "bin/browse runner tests have no fake agent-browser, and nothing traces upstream calls"
workstream: unattached
area: browse
filed-by: agent
discovered-by: agent
discovered-in: "worktree-retrospective — retrospective 20261031-234313"
---

Two faults in `browse/src/runner.ts` needed a real browser to find: the ceiling
killed only the node shim while a child held the pipes, and a process-group fix
broke Ctrl-C. A per-command `AGENT_BROWSER_*` value made the daemon restart its
background state, which took about 15 bisect steps to find.

Proposed:
- A fake `agent-browser` binary with a configurable delay and a grandchild that
  holds stdout, for runner tests.
- An env switch in the runner that logs each upstream argv.

Evidence:
- `browse-wedge/20261030T080912Z-implemented.md`
- `browse-wedge/20261030T084348Z-review-adjudicated.md`
- `browse-wedge/20261030T125421Z-implemented.md`
