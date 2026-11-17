---
title: "bin/theme-check --all saturates the dev machine: one process chain per browser command, several sessions at once"
workstream: unattached
area: beebox
labels: [themes, theme-check, tours]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-theme-check-gate — the developer reported the machine as slow during a theme-check --all run
---

A `bin/theme-check --all` run makes the whole dev machine slow while it runs.
Other sessions, the hourly full suite, and the desktop all compete with it.
The next theme workstream should take this up before it relies on
`--all` as a landing gate.

## Observed

2026-11-17, 12-core Mac. Load average 78 (one-minute) during a run in the
`theme-check-gate` worktree, about 7 minutes into the run. The run used at
least five browser sessions (`theme-check-<pid>-<id>-2` … `-5`). The default
for `--jobs` is 3 (`beebox/test/tours/theme-check.ts`), so the run had a
higher value.

Split by source at one sample (`ps`, CPU percent summed over processes):

| Source | CPU | Processes |
|---|---|---|
| theme-check-gate (tsx, node, agent-browser CLI) | ~167% | 26 |
| Chrome for Testing (agent-browser) | ~117% | 84 |
| full suite (scheduled, concurrent) | ~144% | 10 |

The full suite was a coincidence of schedule. The theme-check share was the
largest and the developer named it as the cause they noticed.

## Why each command is expensive

`BrowseSession.run` and `.eval` (`beebox/test/tours/tour-lib/browse.ts`) spawn
`bin/browse` for every command. Each command then starts this chain:

1. `bin/browse` (bash)
2. `tsx browse/src/cli.ts` (node, with a TypeScript transform at start-up)
3. `node …/agent-browser/bin/agent-browser.js`
4. the `agent-browser-darwin-arm64` native binary

A theme check sends many short commands per case (`wait`, `scrollintoview`,
`click`, `eval` for geometry and contrast, `screenshot`). Thus most of the CPU
goes to Node and tsx start-up, not to the browser work. The comment on
`runJobs` says "each browse call mostly waits"; that holds for the browser, not
for the process chain that sends each call.

## Directions

- Keep one long-lived client per session. Send commands to the agent-browser
  daemon directly from the tour process, or batch the commands for one step into
  one `bin/browse batch` call (`bin/browse --help`: "Execute multiple commands
  sequentially (args or stdin)").
- Choose the session count from machine load, not only from `--jobs`. For
  example, cap it from `os.availableParallelism()` and the current load
  average. `bin/host-pressure.ts` reads memory pressure only, not CPU load.
- Measure before and after: wall time and summed CPU seconds for one `--all`
  run at `--jobs 3`.

Related: `issues/code-quality/2026-08-09-test-suite-per-file-cost-floor.md`
(the same Node + tsx start-up cost, paid per test file).
