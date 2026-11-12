---
title: "Retrospective openers step fails its own diff check on engine-written bookkeeping files"
workstream: unattached
area: beebox
labels: [procedures, retrospective]
filed-by: agent
discovered-by: agent
discovered-in: "main checkout — first local scheduler pass on a test box, 2026-11-09"
---

`process-retrospective` failed at the `openers` step
(`beebox/templates/procedures/process-retrospective.procedure.card`). The agent
did the work correctly: it edited only `navigation.openers` on two landmark
cards and committed them by path. The step's instruction check then failed:

> The diff modifies bookkeeping run and usage files in addition to landmark
> cards. … the instruction requires the diff to touch nothing else.

The two other files were
`_bookkeeping/procedure/runs/<run>/run.procedure-run.card` and
`_bookkeeping/usage/session-manifest.jsonl`. The engine writes both during
every step. The agent did not edit them. The instruction "touch nothing but the
`navigation.openers` field" cannot pass while the reviewer sees those files.

Either the diff shown to the instruction check should leave out the engine's
own bookkeeping, or this instruction should exempt it. The first fixes every
procedure with a "touch nothing else" instruction. Check other procedure cards
for the same wording.

Because the step aborts, the openers marker is not written, so each run
redoes the openers pass and fails again.
