---
title: "deploy-status lists its remote sections and units in several places"
workstream: unattached
area: bin
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
---

`bin/deploy-status` repeats two lists.

- Report sections: `remoteSections` in `bin/deploy-status.ts` names each
  remote section, and `collect` lists every report field again in its
  no-checkout early return. A new section (the relay section was one) edits
  both, plus the report type.
- Units: `parseHealth` in `bin/deploy-status-lib.ts` reads unit states by
  position from a hard-coded `["beebox-hub", "beebox-scheduler"]`, which must
  match the order of the remote `systemctl` call.

One list of sections and one list of units, each read by every user, would
remove the second edit in each case.

Evidence: `self-hosted-turn/20261113T225318Z-plan-reviewed.md`,
`self-hosted-turn/20261113T232326Z-implemented.md`.
