---
title: "test:changed selects 500+ files for edits to broadly imported text, and the run outlasts the 10-minute shell limit"
workstream: test-selection-breadth
resolution: implemented
area: beebox
labels: [testing, test-selection]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
design: ../../../beebox/docs/plans/change-based-test-selection.md
---

Closed by 6599ffbf3. Divergence: no text-only selection filter (rejected by the boxholder). `test:changed` prints the selected file count and an estimated time from ledger medians, and hints to run in the background at 300 s or more.

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

## Measurement (2026-10-12)

Full numbers are in the plan's "Revision 2026-10-12 — broad selections".

- The number of files is the main cause. About 500 files take about
  9.5 minutes at typical load. Load added 0–80% and took some runs past
  10 minutes. `capJobs` does not apply to selected runs.
- Four of the six sessions changed code in widely imported modules, not
  only text. Since 2026-09-15, 69 of 301 landings select 300 or more files.
  A text-only filter cuts more than 30% from 7 of them.
- Text-only edits do fail tests: `template-stock-hashes.doctest.md` and
  `briefing-openers.doctest.md` after a `briefing.tsx` text edit, and
  `agent-guide/lint.doctest.md`, which reads text through generated docs.
  `/finish` runs `test:changed`, not the full suite, so only the hourly run
  would catch what a filter skipped.

Decision (boxholder, 2026-10-12): no text-only filter. `test:changed`
prints the file count and an estimated time first, and the guidance says to
run it in the background when the estimate is 5 minutes or more. Progress
output from `finish-verify` is filed for the `finish-tooling` workstream:
[finish-verify shows nothing while a long check runs](../../features/2026-10-12-finish-verify-shows-no-progress-during-a-long-run.md).
The causes underneath (widely imported modules, per-file cost) belong to
[per-file cost floor](../../code-quality/2026-08-09-test-suite-per-file-cost-floor.md).
