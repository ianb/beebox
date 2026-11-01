---
title: "Finish reruns the whole test selection after a merge that does not touch the branch"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: "worktree-retrospective — retrospective 20261031-234313"
---

A merge of main before landing forces a full `test:changed` run, even when the
merged paths do not interact with the branch. `finish-verify --only tests` has no
way to run a narrower set, so the finish skill's "reuse passing evidence" rule
has no tool behind it. Reported runs took 325 s to 515 s, and one took about 10 minutes.

Possible direction: select tests from the merged delta only, or accept named
tests, and report which earlier pass was reused.

Evidence:
- `tooling-burndown/20261030T154919Z-landed.md`
- `idle-eviction/20261030T180844Z-landed.md`
- `shared-browser/20261101T005213Z-landed.md`
- `box-isolation-followups/20261029T201326Z-landed.md`
