---
title: "bin/browse's pre-run reaper kills daemons that other sessions in the same worktree are using"
workstream: dev-loop-lifecycle
area: bin
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — several agents driving the app through bin/browse at once
priority: important
resolution: implemented
---

> **Fixed 2026-08-24** in
> [dev-loop-lifecycle](../../../beebox/docs/implemented-plans/dev-loop-lifecycle.md).
> Measured the window directly: `bin/browse` puts agent-browser processes on the
> process table at T+1s and its socket dir holds no `.pid` file until T+3s.
>
> The bash reaper is gone. `bin/process-cleanup.ts` already owned this decision
> and its header forbids a second copy; `bin/browse` now calls it
> (`reclaimWorktreeBrowsers`). The predicate gained the input it was missing —
> process age — so an unvouched daemon younger than 60s is never called an
> orphan. That closes the same window for `bin/workstreams panic` and the
> router's startup sweep, which both had it too.

Every `bin/browse` invocation reaps agent-browser processes before it runs
(`bin/browse:100-115`). It collects the PIDs named by `*.pid` files in the
worktree's socket directory, then kills every agent-browser process started
from this repo whose PID is not in that set:

```bash
done < <(pgrep -f "${REPO_DIR}/node_modules/agent-browser/bin" 2>/dev/null)
```

The reap is worktree-wide, not session-wide, and it treats "no pid file yet" as
"orphan". A daemon that another session started moments earlier — or a
`--session` daemon whose pid file has not been written yet — is killed by the
next command any other agent runs. The comment describing the mechanism assumes
the pid files "name the only live ones", which holds only when one command runs
at a time.

Symptom seen by five separate page checks during this run: `agent-browser exited
-1: (no output)`, empty snapshots, and page-ready timeouts, clustered when
several agents shared the worktree. Every command needed retries; some verdicts
took several attempts. One check counted ~79 agent-browser processes from
parallel sessions.

Two checks also reported `bin/browse open /admin` and `bin/browse open
/dev/composer-states` exiting 1 with no output while the full router URL
worked. The path rewrite itself is a two-line concatenation onto the worktree's
router base (`browse/src/worktree.ts:96-100`), so the likely explanation is the
same failed daemon start reported without a message.

This is separate from the shared default browser profile (two agents driving one
tab). Isolating with `--session <name>` fixes the tab collision but not this:
the reaper matches on the process, not on the session.
