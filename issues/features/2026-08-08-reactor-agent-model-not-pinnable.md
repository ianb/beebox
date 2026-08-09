---
title: "A field-test scenario's models.box pins chat only — the reactor's agent model floats"
area: callback-box
filed-by: agent
discovered-in: field-test Track 2 chunk 2 (cross-model review finding)
labels: [field-test-findings, code-error, harness]
---

`callback-box/field-tests/<scenario>/scenario.yaml` declares `models.box`, and
the plan (`docs/implemented-plans/agent-field-tests.md`, Track 2) states its purpose
plainly: *"the scenario pins which model the product's own agents run (chat's
persisted model setting and the reactor's) … because the existing setting is
opaque and letting it float would make weekly runs incomparable."*

Only half of that is achievable today. `run-seed.ts` writes
`.callback-box/chat-model.json`, which pins **chat**. The reactor's agent
invocations go through `runAgent` (`src/core/agent/run.ts`), which takes an
optional `model` that the reactor never passes and no env var overrides — so
reactor work (intake, job processing, the email→task step this tier exists to
watch) runs on whatever the SDK defaults to that week.

So a weekly report header that says `box: opus` is telling the reader something
that is true of chat and not true of the agent that processed their email. Two
runs a month apart are not comparable in the way the plan claims.

**Options**

1. Plumb a box-level agent-model setting the reactor reads (the honest fix, and
   probably useful outside field tests — "which model does my box think with?"
   is a question a boxholder can already ask about chat but not about the
   reactor).
2. Narrow the vocabulary instead: rename `models.box` to `models.chat` and have
   the report header say the reactor model is unpinned. Cheap, but it concedes
   the comparability the tier wanted.

Option 1 is the one worth doing; option 2 is what to do if it turns out the
reactor genuinely should not be pinnable. Until then `run-seed.ts` carries a
comment saying exactly what it does and does not pin.

This is the one real dependency inside the field-test finding set: it is a
product gap (no reactor-model setting) that surfaces as a harness limitation
(`models.box` half-works). Fixing it here resolves both — so it is a
fix-together, not two independent items.
