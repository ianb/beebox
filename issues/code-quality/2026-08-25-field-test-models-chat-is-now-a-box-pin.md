---
title: "Field-test `models.chat` now pins the whole box — the name says otherwise"
workstream: model-engine-policy
area: callback-box
filed-by: agent
discovered-in: model/engine policy work — cross-model review of the implementation
labels: [field-test, naming]
priority: backlog
---

A field-test scenario's `models.chat` used to write `.callback-box/chat-model.json`
and so pin chat alone. It now writes the box's model policy (`agentModel` in
`config/box.json`), which chat **and the reactor** read — that was the point, and
the run report says so. The field name did not follow.

Rename `models.chat` → `models.box` across `src/field-test/scenario.ts`,
`results.ts` (the persisted result schema), `report.ts`, `run-seed.ts`, and the
two checked-in scenarios under `field-tests/`. It was left out of the policy work
because the schema is `strictObject` and results are persisted, so it is a real
rename with a compatibility question (accept both for a while, or migrate the
stored results), not a sed.

Also worth folding in: `models.operator` is a different kind of value — it goes
straight to the operator's SDK call, which accepts a tier alias like `opus`,
while `models.chat` is now resolved to a concrete model id at scenario load. Two
fields, two vocabularies, one `models:` block. Say which is which in the format
docs, or make both ids.
