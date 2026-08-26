---
title: "\"haiku\" from the chat reviewer and retro observer reaches the Codex SDK verbatim"
workstream: model-engine-policy
area: callback-box
filed-by: agent
discovered-by: Ian
discovered-in: worktree-model-engine-policy — cluster survey for the model/engine policy work
labels: [codex, engines]
---

Two small passes name their model as a bare provider-shaped nickname:

- `src/core/chat/review/reviewer.ts:72` — `const DEFAULT_REVIEWER_MODEL = "haiku";`
- `src/core/retro/observer.ts:27` — `const DEFAULT_OBSERVER_MODEL = "haiku";`

Both reach the engine through `createAgent`, which on a Codex box builds a Codex
delegate that forwards the string unchanged: `src/core/agent/codex-agent.ts:45`
passes `model: invoke.model` into the Codex run. So a Codex box asks the Codex
SDK for `haiku`.

This is the same defect class that
[procedure model pins are Claude-only](../closed/bugs/2026-08-23-procedure-model-pins-are-claude-only.md)
closed for procedures (commit `8a7dced6`). That fix introduced the portable tier
vocabulary and `resolveProcedureModel(engine, tier)`
(`src/shared/agent-models.ts:56`) and deliberately left other callers alone;
these two are what it left.

`normalizeModelId` does not help — it maps retired Claude ids forward, and
`haiku` is not one of them.

The fix is not a local one: it is the "small model" slot, which is why this is
being taken with the cluster rather than patched. Whatever names the small
passes' model must resolve through the engine-aware path like every other
invocation, so a nickname can never reach an engine that does not know it.

Related: [a small-model slot for title, summary and chat-review passes](../features/2026-08-25-small-model-slot.md).
