---
title: "No box-level agent model: the reactor's model floats while chat's can be pinned"
workstream: model-engine-policy
resolution: implemented
area: beebox
filed-by: agent
discovered-in: field-test Track 2 chunk 2 (cross-model review finding)
labels: [field-test-findings, code-error]
needs: [design]
priority: normal
---

**Resolved 2026-08-26** by `docs/implemented-plans/model-engine-policy.md` (Track B, commit `4b953ffab`): the reactor now resolves and runs on the box's pinned `agentModel`, the same policy chat reads.

A box can pin the model its **chat** agent uses (`.beebox/chat-model.json`,
read by `loadCurrentModel` against `DEFAULT_MODEL_FILE`,
`src/core/chat/session/state.ts`). Nothing
pins the model its **reactor** agent uses. The reactor invokes agents through
`createAgent` (`src/core/reactor/batch-jobs.ts:53`, `chat-jobs.ts`) and never
passes a `model`, and `runAgent` (`src/core/agent/run.ts:30`) leaves it at the
SDK default. So intake, job processing, and the email→task step run on whatever
the SDK defaults to that week, even on a box whose owner deliberately chose a
model.

"Which model does my box think with?" is a question a boxholder can answer about
chat and not about the reactor — and the reactor is where most of the box's
autonomous work happens.

## Field-test side: settled (do not conflate with this)

This surfaced because the field-test tier wanted to pin the product's model for
run-to-run comparability. That half is resolved (`50cd2248`): the scenario field
is `models.chat`, and the run report states plainly that the reactor model is
unpinned rather than claiming a `box:` model that was only ever chat's. So the
harness is honest today; what remains is the product feature below, and it is
NOT a harness item.

## The product feature

Plumb a box-level agent model the reactor reads and passes to its agent runs.
Design questions to settle first (hence `needs: design`):

- **One setting or two?** Generalize `chat-model.json` into "the box's model"
  that both chat and reactor honor, or a separate reactor-model pointer? A
  single "box model" is simpler to reason about; a split lets someone run chat
  on a big model and batch reactor work on a cheaper one.
- **Behavior change for existing boxes.** Any box that has already pinned a chat
  model would suddenly pin its reactor too, changing what runs on their nightly
  wakeup. That is arguably desirable but must be an intended, announced change,
  not a silent one — which is the whole reason this is `needs: design` and not a
  quick fix.
- **Where it reads.** The reactor's `createAgent`/`runAgent` path is the seam;
  decide whether the model is resolved once per reactor run or per job.

Once it lands, the field test can pin the reactor too and the report can drop
the "unpinned" caveat.
