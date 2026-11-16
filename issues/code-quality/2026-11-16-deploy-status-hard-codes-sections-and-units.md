---
title: "deploy-status lists its remote sections and units in several places"
workstream: unattached
area: bin
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
---

Adding a host service to `bin/deploy-status` takes edits in three places.
`remoteSections` in `bin/deploy-status.ts` lists the section names, and
`collect` repeats every section in its no-checkout early return.
`parseHealth` in `bin/deploy-status-lib.ts` reads unit states by position
from a hard-coded `["beebox-hub", "beebox-scheduler"]`.

One list of sections and one list of units, each used by every reader, would
make a new service a one-line change. The relay section was added this way.

Evidence: `self-hosted-turn/20261113T225318Z-plan-reviewed.md`,
`self-hosted-turn/20261113T232326Z-implemented.md`.
