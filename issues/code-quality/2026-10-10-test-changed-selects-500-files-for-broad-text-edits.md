---
title: "test:changed selects 500+ files for edits to broadly imported text, and the run outlasts the 10-minute shell limit"
workstream: unattached
area: beebox
labels: [testing, test-selection]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
design: ../../beebox/docs/plans/change-based-test-selection.md
---

Selection follows imports, so an edit to a module many files import selects
most of the suite even when the edit changes only text. Six sessions in three
days saw 499–621 selected files and runs of 10–13 minutes, past the agent
shell's 10-minute foreground limit; agents moved the run to the background or
split it into hand-picked batches.

Coding feedback: user-facing-language/20261009T120548Z-implemented.md (499
files for an agent-guide and ledger edit), hq-always/20261009T235132Z-implemented.md
(~520, feature removal), journey-walks-oct/20261009T001800Z-review-adjudicated.md
(~530, landmark schema edit), agents-md/20261010T045428Z-landed.md (621, rename
sweep), theme-polish/20261008T231544Z-landed.md (545, no progress output while
it ran), schedule-run-summaries/20261008T044723Z-landed.md (~640 s).

Directions named in the entries: a text-only change filter, progress output
from `finish-verify` naming the running batch, and documenting that the run is
expected to exceed 10 minutes.
