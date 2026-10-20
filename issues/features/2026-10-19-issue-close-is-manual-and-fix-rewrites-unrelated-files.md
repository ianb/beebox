---
title: "Closing an issue is a manual sequence, and doc-check --fix then rewrites unrelated files"
workstream: unattached
area: bin
labels: [issues, doc-check, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261019-230412
---

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
