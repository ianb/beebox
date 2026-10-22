---
title: "`pnpm perf:load` hangs with no output when the `bin/browse` browser does not answer"
workstream: unattached
area: beebox
labels: [dev-tooling]
filed-by: agent
discovered-in: worktree-boot-hint — measuring cold box loads, 2026-10-22
priority: normal
---

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
