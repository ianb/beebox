---
title: "No documented pattern or helper for smoke-testing a trick without a later shell command masking an earlier failure's exit code"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

While testing a new generator trick outside of `bbx trick`'s own auto-commit
path (to avoid it capturing unrelated dirty files — see the separate
auto-commit issue filed in this triage), an agent ran a multi-command shell
sequence (generate, then inspect/clean up) and the sequence reported exit 0
even though the generation step itself had failed, because later diagnostic
and cleanup commands in the same sequence succeeded and their exit code was
what the shell ultimately reported. The agent caught this only by manually
checking output rather than trusting the reported exit status.

## Suggested direction

Document the standard pattern for a trick smoke-test in the trick-authoring
docs (`set -euo pipefail`, or checking `$?` immediately after the command
that matters rather than after a trailing cleanup step), or provide a small
`bbx trick`-adjacent smoke-test helper that runs a trick in isolation and
reports the generator's own exit status distinctly from any surrounding
diagnostic/cleanup commands.

## Why resolution is not obvious

This is general shell-scripting discipline rather than a beebox-specific
defect, so a documented convention may be enough; whether it's worth a
dedicated helper depends on how often trick authors hit this in practice,
which this single report doesn't establish.
