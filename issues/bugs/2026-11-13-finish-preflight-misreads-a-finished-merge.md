---
title: "finish-preflight misreads a merge that is already finished or resolved"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261113-003305
---

Two finish runs stopped on merge state that needed no judgment:

- HEAD was already a clean merge commit whose second parent was main, with no
  conflicted or staged paths, but `MERGE_HEAD` remained. A retry of
  `bin/finish-preflight` reported the merge as in progress. `git merge --quit`
  cleared the metadata and preflight then passed.
- Preflight exited 3 (conflicts) when the conflicts were already resolved in the
  index. The message did not say which state it had read.

Wanted: preflight recognizes a completed merge of the current main and clears
stale merge metadata, while still stopping on a real in-progress merge; and the
conflict message names the paths still unmerged (`git diff --diff-filter=U`).
See `bin/finish-preflight-merge.ts`.

Evidence: `box-game/20261112T184024Z-landed.md`,
`web-guidance-scan/20261112T072110Z-landed.md`.
