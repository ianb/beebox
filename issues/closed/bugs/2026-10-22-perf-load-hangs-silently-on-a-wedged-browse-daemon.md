---
title: "`pnpm perf:load` hangs with no output when the `bin/browse` browser does not answer"
workstream: browse-wedge
area: beebox
labels: [dev-tooling]
filed-by: agent
discovered-in: worktree-boot-hint — measuring cold box loads, 2026-10-22
priority: normal
resolution: implemented
---

**Closed (implemented, 2026-10-30):** Third form fixed in 713bf637e/357afe042: every CDP command and the trace-complete event get a 60 s deadline, so an unanswered command fails the run (verified by freezing the browser mid-run: exit 1, CdpError named) instead of hanging.

On 2026-10-22, `pnpm perf:load` ran for minutes and printed nothing, or
printed one run and then exited with status 0 and no summary. Two causes were
seen:

- `cdpUrl()` in `beebox/src/dev/perf/load/cli.ts` calls `bin/browse get
  cdp-url` with `execFileSync` and no timeout. When this worktree's browse
  daemon was wedged, that call blocked the process, so no timer or log line
  ran. `bin/browse get url` also took more than 30 s. The daemon wedged again
  after it was killed and restarted.
- With the browse browser, CDP commands sent during a run went unanswered. A
  pending promise does not keep Node alive, so the process exited with status 0
  in the middle of the runs. The 120 s per-load timeout did not fire.

Workaround: start a separate headless Chrome for Testing with
`--remote-debugging-port` and a scratch `--user-data-dir`, and pass its
WebSocket URL with `--cdp`. All runs then completed.

Directions: give the `bin/browse get cdp-url` call a timeout, and fail when
the event loop drains before the runs finish (a `beforeExit` check), so a
stuck browser is reported as an error.

## Update (2026-10-23, worktree-perf-easy-wins)

`perf:load` now bounds the `bin/browse get cdp-url` call at 60 s and fails with
a message when the event loop drains before the runs finish. That covers both
causes above. A third form was seen the same day: `bin/browse get cdp-url`
answered in under a second, but the run then hung for more than 200 s with no
output and no exit, so something kept the event loop alive. Not diagnosed. A
separate headless Chrome with `--cdp` worked at once; the command is now in
`beebox/docs/development/performance.md`.
