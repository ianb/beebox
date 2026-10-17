---
title: "finish-verify shows nothing while a long check runs"
workstream: finish-tooling
area: bin
labels: [finish, cli, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-selection-breadth — measuring broad test:changed runs, 2026-10-12
design: ../../beebox/docs/plans/change-based-test-selection.md
---

`bin/finish-verify.ts` runs each check with `spawnSync` (`:141`) and writes
the output file after the check exits (`:182`). It prints a result line only
when a check is done (`:243`). A `test:changed` run of about 500 files takes
10–13 minutes. During that time the finish agent and the person see no
output and no output file. theme-polish's coding feedback
(`theme-polish/coding-feedback/20261008T231544Z-landed.md`) asked for it:
*"Add stage/progress output to finish-verify (including the currently running
test batch), so a long verification is visible without inspecting
processes."*

What would fix it:

- Print `run  <command> → <output path>` before each check starts.
- Stream the check's output to that file while it runs, not after it exits.

Then an agent that runs `finish-verify` in the background can read the file.
The first line of a `test:changed` run gives the file count and an estimated
time (change-based-test-selection plan, revision 2026-10-12). This item is
for the `finish-tooling` workstream because that workstream is editing
`bin/finish-verify.ts` now.

**2026-10-16 (retrospective 20261016-225122):** asked for again in
`theme-polish/20261016T124904Z-landed.md`: a 576-file selected run took about
27 minutes, beyond the printed estimate, with no per-file progress.
