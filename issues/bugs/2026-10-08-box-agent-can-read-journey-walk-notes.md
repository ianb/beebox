---
title: "A box agent can read journey-walk notes through the box's node_modules link"
workstream: unattached
area: beebox
labels: [test-harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk, 2026-10-08
---

The journey box's `node_modules/beebox` links into the dev worktree's
`beebox/` directory. That directory holds `beebox/test/user-stories/work/`
(gitignored), which contains the walkers' private notes. In the first
B-inventory walk the box agent ran a `grep` for "No body content". The result
listed `node_modules/beebox/test/user-stories/work/journeys/A-lending-2026-10-08/notes.md`
and the current run's `notes.md`. The agent did not open them (transcript
10:33:39).

A box agent that opens them could tailor answers to the walker's commentary,
and the walk would measure the wrong thing. The same link also exposes the
rest of the dev tree under `beebox/` to any box agent that searches
`node_modules`.

## Why the fix is not obvious

The link is how a box runs the dev engine, so it cannot be removed. Options:
keep the walk's `work/` directory outside `beebox/` (for example under the
scratchpad), or have the box agent's search tools skip `node_modules`. The
agent guide already marks `node_modules/` as not the agent's to edit
(`beebox/src/core/agent-guide/guide.md:368`), but not as off limits to read.
Related: [cross-box filesystem isolation](../features/2026-09-04-cross-box-filesystem-isolation.md).

Report: [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (R6, harness defect 2).
