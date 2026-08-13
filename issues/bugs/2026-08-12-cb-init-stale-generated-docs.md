---
title: "`cb init` doesn't refresh docs/generated/ for newly added box-local schemas"
workstream: unattached
area: callback-box
labels: [cli, schemas]
filed-by: agent
discovered-by: agent
discovered-in: main session — cb feedback triage from a real box
---

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
