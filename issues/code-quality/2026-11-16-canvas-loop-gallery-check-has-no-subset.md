---
title: "canvas-loop gallery:check has no way to check a subset"
workstream: unattached
area: canvas-loop
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
---

`pnpm --dir canvas-loop run gallery:check` renders every exercise and takes
10–11 minutes. That is longer than one foreground tool call (10 minutes), and
the gallery README asks for a passing run before each gallery commit. There is
no slug filter and no mode that checks only exercises whose files changed.

`canvas-loop/src/headless/cli.ts` accepts `gallery check` with no arguments.

A `--slug <name>` filter (repeatable) would let a session split the run. A
changed-files mode would fit the pre-commit loop. Keep the full run for finish.

Evidence: `canvas-brushes/20261116T024236Z-review-adjudicated.md`,
`canvas-brushes/20261116T003718Z-implemented.md`.
