---
title: "finish-preflight reports what changed since the tested revision"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261113-003305
---

The finish agent reuses a passing check when the delta since its tested
revision cannot affect it (`.claude/agents/finish.md` step 3). Preflight still
lists the full verification set after a merge of main, so each finisher works
out the delta by hand, and some rerun the whole suite (415 s in one run) to be
safe.

Wanted: `bin/finish-preflight --tested <rev>` (or a recorded tested revision)
prints the paths changed between that revision and HEAD, grouped by the checks
they can affect, and marks checks the delta does not reach.

Evidence: `canvas-brushes/20261112T024731Z-landed.md`,
`chat-presence/20261113T015356Z-landed.md`, and the retrospective watch item
`finish-tested-revision-record` (two earlier entries).
