---
title: "Closing an issue is a manual sequence, and doc-check --fix then rewrites unrelated files"
workstream: tooling-burndown
area: bin
labels: [issues, doc-check, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261019-230412
resolution: implemented
---

**Closed (implemented, 2026-10-30):** Landed in e42984ab0, 14281ed4a, and 1883523c6. The close verb moves the issue, sets resolution and workstream, puts the note first in the body, re-expresses the file's own links, and rewrites only references that resolve to the moved file, printing each one. It never runs doc-check --fix. Plan: [doc-move-and-issue-close](../../../beebox/docs/plans/doc-move-and-issue-close.md).

Closing an issue takes a `git mv` into `issues/closed/`, frontmatter edits
(`resolution:`, `workstream:`), a closing note, and a `doc-check --fix` run
to repair relative links. `--fix` runs over the whole working tree, so it also
rewrites links in files the session did not touch (a journey report, another
issue) and, in a shared worktree, runs another worker's uncommitted doc-check
code.

Coding feedback: bug-burndown/20261017T175245Z-implemented.md (asks for
`bin/issues close <path> --resolution <r> --note <text>`),
turn-feedback/20261019T013353Z-landed.md (asks for a move helper that reports
the rewrites first), bug-burndown-3/20261019T131455Z-implemented.md (`--fix`
applied another worker's 387-file sweep).

Direction: a `bin/issues close` verb that moves the file, sets the
frontmatter, adds the note, and rewrites only links that point at the moved
file, printing each rewritten path.

**2026-10-28 (retrospective 20261028-234100):** Two more sessions broke
relative links in a closed issue's body with `git mv`, and `--fix` could not
repair ambiguous basenames: bug-burndown-5/20261027T202959Z-implemented.md,
box-isolation-followups/20261027T055233Z-implemented.md. `issues/AGENTS.md`
"Closed items" now says to recompute them; a close verb that rewrites the links
is still the fix.
