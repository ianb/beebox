---
title: "`cb init` doesn't refresh docs/generated/ for newly added box-local schemas"
workstream: document-card-view
area: callback-box
labels: [cli, schemas]
filed-by: agent
discovered-by: agent
discovered-in: main session — cb feedback triage from a real box
priority: important
resolution: implemented
---

Closed 2026-08-25: fixed by commit b6564a61 (`cb init` forces `generateDocs`,
skills folded in; `cb docs refresh` runs per box on every deploy). Verified on
the deployed server after the first deploy carrying the fix: on the four boxes
with box-local schemas (3, 9, 1, and 3 local types), every local type has its
`.claude/rules/card-<type>.md`, `docs/generated/card-<type>.md`, and skill;
rule and generated-doc counts match on each box; trees clean; the refresh's
`Sync templates from upstream` + `Refresh generated docs` commits are in each
box's history at deploy time.

After adding two box-local schemas (each with `instructions`), `cb init .` from
the package root correctly generated their `.claude/rules/card-*.md` files — the
count rose from 46 to 48 — but `docs/generated/` never picked up the matching
`card-*.md` docs, across repeated runs.

Not blocking: rule loading works, so agents still get the instructions. But
`docs/generated/` drifts out of sync with the schema registry for newly-added
box-local types, and a doc surface that silently lags its source is worse than
one that's obviously absent — a reader can't tell the difference between "this
type has no docs" and "this type's docs are stale".

Worth checking whether the rules path and the generated-docs path enumerate
schemas differently (one seeing box-local additions, the other only built-ins),
since that asymmetry would explain the exact symptom.
